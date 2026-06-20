import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, allowSqliteInstantiation } from "./sqlite.js";

import { env, runtimeConfig } from "../config/env.js";
import { readInitialSchema } from "./schema.js";
import { rehydrateSyncStateOnStartup } from "../system/startup.js";
import { startBackupService } from "../services/database-backup-service.js";
import { scheduleBackgroundJob } from "../background/backgroundJobRunner.js";

let database: DatabaseSync | null = null;
const EXPECTED_SCHEMA_VERSION = 1;

function getCount(database: DatabaseSync, table: string) {
  const row = database.prepare(`SELECT COUNT(1) AS count FROM ${table}`).get() as { count: number };
  return Number(row?.count ?? 0);
}

function ensureSchemaVersion(database: DatabaseSync) {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number | string } | undefined;
  let current = Number(row?.user_version ?? 0);

  if (!Number.isFinite(current)) {
    current = 0;
  }

  if (current === 0) {
    database.exec(`PRAGMA user_version = ${EXPECTED_SCHEMA_VERSION};`);
    current = EXPECTED_SCHEMA_VERSION;
  }

  if (current !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(
      `[startup] Unsupported schema version ${current}. Expected ${EXPECTED_SCHEMA_VERSION}.` 
    );
  }

  return current;
}

function validateDatabaseStartup(database: DatabaseSync, databasePath: string) {
  const stats = fs.statSync(databasePath);

  if (!stats.isFile()) {
    throw new Error(`[startup] Database path is not a file: ${databasePath}`);
  }

  if (stats.size <= 0) {
    throw new Error(`[startup] Database file is empty: ${databasePath}`);
  }

  const schemaVersion = ensureSchemaVersion(database);
  
  // PHASE9 LOCKDOWN: Comprehensive startup validation report
  console.log(`[startup] ========== DATABASE STARTUP VALIDATION ==========`);
  console.log(`[startup] DATABASE_PATH=${databasePath}`);
  console.log(`[startup] FILE_SIZE=${stats.size} bytes`);
  console.log(`[startup] SCHEMA_VERSION=${schemaVersion} (expected=${EXPECTED_SCHEMA_VERSION})`);
  
  // Fetch all required metrics
  const sportCount = getCount(database, "sports");
  const providerCount = getCount(database, "providers");
  const channelCount = getCount(database, "channels");
  const matchCount = getCount(database, "matches");
  const streamCount = getCount(database, "streams");
  
  console.log(`[startup] SPORT_COUNT=${sportCount}`);
  console.log(`[startup] PROVIDER_COUNT=${providerCount}`);
  console.log(`[startup] CHANNEL_COUNT=${channelCount}`);
  console.log(`[startup] MATCH_COUNT=${matchCount}`);
  console.log(`[startup] STREAM_COUNT=${streamCount}`);
  
  // Legacy detailed log
  console.log(
    `[startup] table row counts: matches=${matchCount}, streams=${streamCount}, scheduling_matches=${getCount(database, "scheduling_matches")}, match_streams=${getCount(database, "match_streams")}`
  );
  console.log(`[startup] ===================================================`);
}

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const resolvedDatabasePath = env.absoluteDatabasePath;

  console.log(`[startup] ========== DATABASE PERSISTENCE STARTUP ==========`);
  console.log(`[startup] RESOLVED_DATABASE_PATH=${resolvedDatabasePath}`);
  console.log(`[startup] DB_READONLY_MODE=${runtimeConfig.dbReadOnlyMode}`);

  const directory = path.dirname(resolvedDatabasePath);

  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }

  // If DB file does not exist, attempt to copy from bundled seed (if present)
  const bundledSeed = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "data", "gito-seed.sqlite");
  const exists = fs.existsSync(resolvedDatabasePath);

  if (!exists) {
    try {
      if (fs.existsSync(bundledSeed)) {
        fs.copyFileSync(bundledSeed, resolvedDatabasePath);
        console.log(`[startup] copied bundled seed DB to ${resolvedDatabasePath}`);
      } else {
        // create an empty DB file; schema will be applied after opening
        fs.writeFileSync(resolvedDatabasePath, "");
        console.log(`[startup] created empty DB file at ${resolvedDatabasePath}`);
      }
    } catch (err) {
      console.error(`[startup] failed to provision initial DB file:`, err);
    }
  }

  // Open DB. If read-only mode requested, use URI mode=ro to prevent writes.
  const openPath = runtimeConfig.dbReadOnlyMode ? `file:${resolvedDatabasePath}?mode=ro` : resolvedDatabasePath;
  database = allowSqliteInstantiation(() => new DatabaseSync(openPath));

  try {
    database.exec("PRAGMA foreign_keys = ON;");
  } catch (err) {
    console.error("[startup] failed to set PRAGMA on database — possible corruption", err);
    throw err;
  }

  // If DB was freshly created (size zero), apply initial schema
  try {
    const stats = fs.statSync(resolvedDatabasePath);
    if (stats.size === 0) {
      database.exec(readInitialSchema());
      console.log("[startup] applied initial schema to new database");
    }
  } catch (err) {
    console.error("[startup] error checking DB file after open", err);
  }

  migrateExistingOperationalState(database);

  // Validate startup and ensure DB is healthy. If validation throws, propagate up.
  validateDatabaseStartup(database, resolvedDatabasePath);

  // Rehydrate operational state and start background services
  try {
    rehydrateSyncStateOnStartup();
  } catch (err) {
    console.error("[startup] rehydrate failed", err);
  }

  try {
    startBackupService();
  } catch (err) {
    console.error("[startup] failed to start backup service", err);
  }

  // Example periodic rehydration job: refresh provider availability every 5 minutes
  scheduleBackgroundJob("rehydrate-providers", 5 * 60 * 1000, () => rehydrateSyncStateOnStartup());

  return database;
}

function hasColumn(database: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];

  return rows.some((row) => row.name === columnName);
}

function isColumnNotNullable(database: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string; notnull: number }[];

  return rows.some((row) => row.name === columnName && row.notnull === 1);
}

function hasTable(database: DatabaseSync, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;

  return Boolean(row);
}

function seedShadowCatalogLayer(database: DatabaseSync) {
  if (!hasTable(database, "entity_catalog_mapping")) {
    return;
  }

  const existing = database.prepare("SELECT COUNT(1) AS count FROM entity_catalog_mapping").get() as { count: number };

  if (existing.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  const insertMapping = database.prepare(
    "INSERT INTO entity_catalog_mapping (id, entity_type, legacy_id, catalog_type, created_at) VALUES (?, ?, ?, ?, ?)"
  );

  for (const row of database.prepare("SELECT id FROM countries").all() as { id: string }[]) {
    insertMapping.run(crypto.randomUUID(), "country", row.id, "hosts", now);
  }

  for (const row of database.prepare("SELECT id FROM sports").all() as { id: string }[]) {
    insertMapping.run(crypto.randomUUID(), "sport", row.id, "sports", now);
  }

  for (const row of database.prepare("SELECT id FROM competitions").all() as { id: string }[]) {
    insertMapping.run(crypto.randomUUID(), "competition", row.id, "competitions", now);
  }

  for (const row of database.prepare("SELECT id, type FROM teams").all() as { id: string; type: string }[]) {
    if (row.type === "club") {
      insertMapping.run(crypto.randomUUID(), "team", row.id, "clubs", now);
    } else if (row.type === "national") {
      insertMapping.run(crypto.randomUUID(), "team", row.id, "nationalTeams", now);
    }
  }

  const insertLink = database.prepare(
    "INSERT INTO sport_host_links (id, sport_id, host_id, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const row of database.prepare("SELECT sport_id, country_id FROM sport_countries").all() as { sport_id: string; country_id: string }[]) {
    insertLink.run(crypto.randomUUID(), row.sport_id, row.country_id, now);
  }

  const insertSportCompetitionLink = database.prepare(
    "INSERT INTO sport_competition_links (id, sport_id, competition_id, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const row of database.prepare("SELECT id, sport_id FROM competitions WHERE sport_id IS NOT NULL").all() as { id: string; sport_id: string }[]) {
    insertSportCompetitionLink.run(crypto.randomUUID(), row.sport_id, row.id, now);
  }

  const insertHostCompetitionLink = database.prepare(
    "INSERT INTO host_competition_links (id, host_id, competition_id, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const row of database.prepare("SELECT id, country_id FROM competitions WHERE country_id IS NOT NULL").all() as { id: string; country_id: string }[]) {
    insertHostCompetitionLink.run(crypto.randomUUID(), row.country_id, row.id, now);
  }

  const insertSportClubLink = database.prepare(
    "INSERT INTO sport_club_links (id, sport_id, club_id, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertSportNationalTeamLink = database.prepare(
    "INSERT INTO sport_national_team_links (id, sport_id, national_team_id, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const row of database.prepare("SELECT id, sport_id, type FROM teams WHERE sport_id IS NOT NULL").all() as { id: string; sport_id: string; type: string }[]) {
    if (row.type === "club") {
      insertSportClubLink.run(crypto.randomUUID(), row.sport_id, row.id, now);
    } else if (row.type === "national") {
      insertSportNationalTeamLink.run(crypto.randomUUID(), row.sport_id, row.id, now);
    }
  }

  const insertCompetitionClubLink = database.prepare(
    "INSERT INTO competition_club_links (id, competition_id, club_id, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertCompetitionNationalTeamLink = database.prepare(
    "INSERT INTO competition_national_team_links (id, competition_id, national_team_id, created_at) VALUES (?, ?, ?, ?)"
  );

  for (const row of database.prepare(
    `SELECT ct.competition_id AS competition_id, t.id AS team_id, t.type AS team_type
      FROM competition_teams ct
      JOIN teams t ON t.id = ct.team_id`
  ).all() as { competition_id: string; team_id: string; team_type: string }[]) {
    if (row.team_type === "club") {
      insertCompetitionClubLink.run(crypto.randomUUID(), row.competition_id, row.team_id, now);
    } else if (row.team_type === "national") {
      insertCompetitionNationalTeamLink.run(crypto.randomUUID(), row.competition_id, row.team_id, now);
    }
  }
}

function migrateExistingOperationalState(database: DatabaseSync) {
  if (!hasColumn(database, "streams", "status")) {
    database.exec("ALTER TABLE streams ADD COLUMN status TEXT NOT NULL DEFAULT 'idle';");
  }

  if (!hasColumn(database, "streams", "health_status")) {
    database.exec("ALTER TABLE streams ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown';");
  }

  if (!hasColumn(database, "streams", "health_reason")) {
    database.exec("ALTER TABLE streams ADD COLUMN health_reason TEXT;");
  }

  if (!hasColumn(database, "streams", "failure_count")) {
    database.exec("ALTER TABLE streams ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(database, "streams", "last_health_at")) {
    database.exec("ALTER TABLE streams ADD COLUMN last_health_at TEXT;");
  }

  if (!hasColumn(database, "providers", "availability_status")) {
    database.exec("ALTER TABLE providers ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown';");
  }

  if (!hasColumn(database, "providers", "sync_mode")) {
    database.exec("ALTER TABLE providers ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'partial';");
  }

  if (!hasColumn(database, "providers", "last_successful_stream_load_at")) {
    database.exec("ALTER TABLE providers ADD COLUMN last_successful_stream_load_at TEXT;");
  }

  if (!hasColumn(database, "providers", "failed_channel_loads")) {
    database.exec("ALTER TABLE providers ADD COLUMN failed_channel_loads INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(database, "providers", "health_score")) {
    database.exec("ALTER TABLE providers ADD COLUMN health_score INTEGER NOT NULL DEFAULT 100;");
  }

  if (!hasColumn(database, "providers", "deleted")) {
    database.exec("ALTER TABLE providers ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;");
  }

  if (!hasColumn(database, "sports", "logo_url")) {
    database.exec("ALTER TABLE sports ADD COLUMN logo_url TEXT;");
  }

  if (!hasColumn(database, "countries", "flag_url")) {
    database.exec("ALTER TABLE countries ADD COLUMN flag_url TEXT;");

    if (hasColumn(database, "countries", "logo_url")) {
      database.exec("UPDATE countries SET flag_url = logo_url WHERE flag_url IS NULL;");
    }
  }

  if (!hasColumn(database, "countries", "created_at")) {
    database.exec("ALTER TABLE countries ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }

  if (!hasColumn(database, "countries", "updated_at")) {
    database.exec("ALTER TABLE countries ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }

  if (!hasColumn(database, "competitions", "country_id")) {
    database.exec("ALTER TABLE competitions ADD COLUMN country_id TEXT;");
  }

  if (!hasColumn(database, "competitions", "competition_type")) {
    database.exec("ALTER TABLE competitions ADD COLUMN competition_type TEXT NOT NULL DEFAULT 'league';");
  }

  if (!hasColumn(database, "competitions", "participant_type")) {
    database.exec("ALTER TABLE competitions ADD COLUMN participant_type TEXT NOT NULL DEFAULT 'clubs';");
  }

  if (!hasColumn(database, "competitions", "logo_url")) {
    database.exec("ALTER TABLE competitions ADD COLUMN logo_url TEXT;");
  }

  if (!hasColumn(database, "teams", "logo_url")) {
    database.exec("ALTER TABLE teams ADD COLUMN logo_url TEXT;");
  }

  if (hasColumn(database, "competitions", "sport_id") && isColumnNotNullable(database, "competitions", "sport_id")) {
    database.exec("PRAGMA foreign_keys = OFF;");
    try {
      database.exec("BEGIN TRANSACTION;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS competitions_new (
          id TEXT PRIMARY KEY,
          sport_id TEXT,
          country_id TEXT,
          region_id TEXT,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          scope TEXT NOT NULL,
          competition_type TEXT NOT NULL DEFAULT 'league',
          participant_type TEXT NOT NULL DEFAULT 'clubs',
          logo_url TEXT,
          current_season_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (sport_id) REFERENCES sports(id),
          FOREIGN KEY (country_id) REFERENCES countries(id),
          FOREIGN KEY (region_id) REFERENCES regions(id)
        );
      `);
      database.exec(`
        INSERT INTO competitions_new
        SELECT id, sport_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status, created_at, updated_at
        FROM competitions;
      `);
      database.exec("DROP TABLE competitions;");
      database.exec("ALTER TABLE competitions_new RENAME TO competitions;");
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_competitions_slug ON competitions(slug);");
      database.exec("COMMIT;");
    } finally {
      database.exec("PRAGMA foreign_keys = ON;");
    }
  }

  if (hasColumn(database, "teams", "sport_id") && isColumnNotNullable(database, "teams", "sport_id")) {
    database.exec("PRAGMA foreign_keys = OFF;");
    try {
      database.exec("BEGIN TRANSACTION;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS teams_new (
          id TEXT PRIMARY KEY,
          sport_id TEXT,
          country_id TEXT,
          name TEXT NOT NULL,
          short_name TEXT,
          type TEXT NOT NULL DEFAULT 'club',
          logo_url TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (sport_id) REFERENCES sports(id),
          FOREIGN KEY (country_id) REFERENCES countries(id)
        );
      `);
      database.exec(`
        INSERT INTO teams_new
        SELECT id, sport_id, country_id, name, short_name, type, logo_url, status, created_at, updated_at
        FROM teams;
      `);
      database.exec("DROP TABLE teams;");
      database.exec("ALTER TABLE teams_new RENAME TO teams;");
      database.exec("COMMIT;");
    } finally {
      database.exec("PRAGMA foreign_keys = ON;");
    }
  }

  // Add password columns to operator_users for bootstrapping and password-based auth
  if (!hasColumn(database, "operator_users", "password_hash")) {
    database.exec("ALTER TABLE operator_users ADD COLUMN password_hash TEXT;");
  }
  if (!hasColumn(database, "operator_users", "password_salt")) {
    database.exec("ALTER TABLE operator_users ADD COLUMN password_salt TEXT;");
  }
  if (!hasColumn(database, "operator_users", "password_iterations")) {
    database.exec("ALTER TABLE operator_users ADD COLUMN password_iterations INTEGER;");
  }
  if (!hasColumn(database, "operator_users", "password_algo")) {
    database.exec("ALTER TABLE operator_users ADD COLUMN password_algo TEXT;");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS sport_countries (
      id TEXT PRIMARY KEY,
      sport_id TEXT NOT NULL,
      country_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE CASCADE,
      FOREIGN KEY (country_id) REFERENCES countries(id)
    );
  `);

  seedShadowCatalogLayer(database);

  database.exec(
    `UPDATE providers
      SET status = CASE
        WHEN status IN ('active', 'pending', 'failed', 'invalid') THEN status
        WHEN status = 'inactive' THEN 'failed'
        WHEN status = 'archived' THEN 'invalid'
        ELSE 'pending'
      END`
  );

  database.exec(
    `UPDATE streams
      SET status = CASE approval_status
        WHEN 'pending_review' THEN 'assigned'
        WHEN 'draft' THEN 'idle'
        WHEN 'rejected' THEN 'failed'
        WHEN 'suspended' THEN 'disabled'
        WHEN 'approved' THEN CASE WHEN published_at IS NULL THEN 'approved' ELSE 'active' END
        ELSE status
      END
      WHERE approval_status IN ('pending_review', 'draft', 'rejected', 'suspended', 'approved')`
  );

  database.exec(
    `UPDATE matches
      SET status = CASE
        WHEN status = 'completed' THEN 'ended'
        WHEN status = 'postponed' THEN 'cancelled'
        WHEN status = 'scheduled' AND id IN (SELECT match_id FROM streams) THEN 'assigned'
        ELSE status
      END
      WHERE status IN ('completed', 'postponed', 'scheduled')`
  );
}
