import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, allowSqliteInstantiation } from "./sqlite.js";

import { env, runtimeConfig } from "../config/env.js";
import { listBackups } from "../services/database-backup-service.js";
import { readInitialSchema, readNewsSchema } from "./schema.js";
import { rehydrateSyncStateOnStartup } from "../system/startup.js";
import { startBackupService } from "../services/database-backup-service.js";
import { scheduleBackgroundJob } from "../background/backgroundJobRunner.js";
import { importMigrationFile, isDatabaseCatalogEmpty, isMigrationImported } from "./migration-import.js";
import { NewsCollectionScheduler } from "../services/news-collection-scheduler.js";
import { NewsService } from "../services/news-service.js";

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

  const resolvedDatabasePath = runtimeConfig.newsTestMode ? ":memory:" : env.absoluteDatabasePath;

  console.log(`[startup] ========== DATABASE PERSISTENCE STARTUP ==========`);
  console.log(`[startup] RESOLVED_DATABASE_PATH=${resolvedDatabasePath}`);
  console.log(`[startup] DB_READONLY_MODE=${runtimeConfig.dbReadOnlyMode}`);

  // Auto-restore: If enabled and the DB file is missing or empty, attempt to
  // restore the latest valid backup before opening the database. This avoids
  // creating a fresh empty DB that would discard previous data.
  try {
    if (runtimeConfig.newsTestMode) {
      database = allowSqliteInstantiation(() => new DatabaseSync(":memory:"));
      database.exec(readInitialSchema());
      database.exec(readNewsSchema());
      ensureSchemaVersion(database);
      return database;
    }
    const autoRestore = runtimeConfig.autoRestoreBackup;
    const dbExists = fs.existsSync(resolvedDatabasePath);
    const dbStat = dbExists ? fs.statSync(resolvedDatabasePath) : null;
    const dbEmpty = !dbExists || (dbStat && dbStat.size === 0);

    if (autoRestore && dbEmpty) {
      console.log('[startup] AUTO_RESTORE_BACKUP enabled and DB missing/empty — searching backups');
      const backups = listBackups();
      for (const b of backups) {
        try {
          const backupPath = path.join(runtimeConfig.backupDir, b.filename);
          // Synchronously validate backup via PRAGMA integrity_check
          try {
            const checkDb = allowSqliteInstantiation(() => new DatabaseSync(backupPath, { readonly: true }));
            try {
              const row = checkDb.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
              const integrity = String(row?.integrity_check ?? "unknown");
              if (integrity === "ok") {
                // Ensure destination dir exists
                fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });
                fs.copyFileSync(backupPath, resolvedDatabasePath);
                console.log('[startup] restored backup to', resolvedDatabasePath, 'from', backupPath);
                try { (checkDb as any).close?.(); } catch {}
                break;
              }
            } finally {
              try { (checkDb as any).close?.(); } catch {}
            }
          } catch (err) {
            console.warn('[startup] failed to open/validate backup', b.filename, err);
          }
        } catch (err) {
          console.warn('[startup] backup validation failed for', b.filename, err);
        }
      }
    }
  } catch (err) {
    console.error('[startup] auto-restore failed', err);
  }

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

  // Open DB. If read-only mode requested, use better-sqlite3's readonly option to prevent writes.
  database = allowSqliteInstantiation(() => new DatabaseSync(resolvedDatabasePath, runtimeConfig.dbReadOnlyMode ? { readonly: true } : undefined));

  try {
    database.exec("PRAGMA foreign_keys = ON;");
  } catch (err) {
    console.error("[startup] failed to set PRAGMA on database — possible corruption", err);
    throw err;
  }

  // Ensure Phase 1 IPTV tables exist even on existing database files.
  try {
    if (
      !hasTable(database, "iptv_providers") ||
      !hasTable(database, "iptv_channels") ||
      !hasTable(database, "iptv_provider_health") ||
      !hasTable(database, "iptv_channel_index")
    ) {
      database.exec(readInitialSchema());
      console.log("[startup] applied missing IPTV schema fragments to existing database");
    }
  } catch (err) {
    console.error("[startup] failed to apply missing IPTV schema", err);
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

  try {
    const needsNewsSchema = !hasTable(database, "news_articles") || !hasTable(database, "news_sources");
    if (needsNewsSchema) {
      database.exec(readNewsSchema());
      console.log("[startup] applied news schema extensions");
    }
    ensureNewsSchemaColumns(database);
  } catch (err) {
    console.error("[startup] failed to apply news schema", err);
    throw err;
  }

  migrateExistingOperationalState(database);

  try {
    bootstrapAdminUserIfNeeded(database);
  } catch (err) {
    console.error("[AUTH BOOTSTRAP] failed", err);
  }

  // Optionally import production seed data from a migration export file when the
  // database is fresh and auto-import is enabled.
  if (runtimeConfig.autoImportMigration) {
    try {
      const importFile = env.migrationImportFile;
      if (!fs.existsSync(importFile)) {
        console.warn("[startup] AUTO_IMPORT_MIGRATION is enabled but import file was not found:", importFile);
      } else if (isMigrationImported(database)) {
        console.log("[startup] AUTO_IMPORT_MIGRATION skipped because migration has already been imported");
      } else if (isDatabaseCatalogEmpty(database)) {
        console.log("[startup] AUTO_IMPORT_MIGRATION enabled; importing migration file:", importFile);
        const result = importMigrationFile(database, importFile);
        console.log("[startup] migration import result:", {
          imported: result.imported,
          totalRows: result.totalRows,
          warnings: result.warnings.length,
          errors: result.errors.length,
          alreadyImported: result.alreadyImported ?? false,
        });
        if (result.errors.length > 0) {
          throw new Error(`Migration import completed with ${result.errors.length} errors`);
        }
      } else {
        console.log("[startup] AUTO_IMPORT_MIGRATION skipped because database contains existing catalog data");
      }
    } catch (err) {
      console.error("[startup] migration import failed", err);
      throw err;
    }
  }

  // Validate startup and ensure DB is healthy. If validation throws, propagate up.
  validateDatabaseStartup(database, resolvedDatabasePath);

  // Rehydrate operational state and start background services.
  // News integration tests opt out so their process has no recurring handles.
  try {
    rehydrateSyncStateOnStartup();
  } catch (err) {
    console.error("[startup] rehydrate failed", err);
  }

  if (!runtimeConfig.newsTestMode) {
    try {
      const newsService = new NewsService();
      const scheduler = new NewsCollectionScheduler(newsService, database);
      void scheduler.initialize();
      scheduleBackgroundJob("collect-news-sources", 5 * 60 * 1000, () => scheduler.runDueCollections());
    } catch (err) {
      console.error("[startup] failed to initialize news collection scheduler", err);
    }

    try {
      startBackupService();
    } catch (err) {
      console.error("[startup] failed to start backup service", err);
    }

    // Example periodic rehydration job: refresh provider availability every 5 minutes
    scheduleBackgroundJob("rehydrate-providers", 5 * 60 * 1000, () => rehydrateSyncStateOnStartup());
  }

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

function ensureNewsSchemaColumns(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS news_generated_rss_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_url TEXT NOT NULL, feed_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_fetched_at TEXT, status TEXT NOT NULL DEFAULT 'created',
      discovered_article_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, enabled INTEGER NOT NULL DEFAULT 1
      , crawler_tier TEXT NOT NULL DEFAULT 'http', failure_classification TEXT
    );
    CREATE TABLE IF NOT EXISTS news_generated_rss_articles (
      id TEXT PRIMARY KEY, generated_feed_id TEXT NOT NULL, external_id TEXT NOT NULL, canonical_url TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT, article_url TEXT NOT NULL, published_at TEXT, discovered_at TEXT NOT NULL,
      content_hash TEXT NOT NULL, source_name TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered',
      FOREIGN KEY (generated_feed_id) REFERENCES news_generated_rss_sources(id) ON DELETE CASCADE,
      UNIQUE(generated_feed_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_news_generated_rss_articles_feed ON news_generated_rss_articles(generated_feed_id);
  `);
  if (hasTable(database, "news_generated_rss_sources")) {
    for (const [columnName, columnType] of [["crawler_tier", "TEXT NOT NULL DEFAULT 'http'"], ["failure_classification", "TEXT"]] as const) {
      if (!hasColumn(database, "news_generated_rss_sources", columnName)) {
        database.exec(`ALTER TABLE news_generated_rss_sources ADD COLUMN ${columnName} ${columnType}`);
      }
    }
  }
  if (hasTable(database, "news_sources")) {
    const sourceColumns = [
      ["last_collected_at", "TEXT"],
      ["last_collection_status", "TEXT"],
      ["last_collection_message", "TEXT"],
      ["collection_interval_minutes", "INTEGER NOT NULL DEFAULT 60"],
      ["last_collection_attempt_at", "TEXT"],
      ["last_collection_succeeded_at", "TEXT"],
      ["last_collection_error", "TEXT"],
      ["last_collection_discovered_count", "INTEGER"],
      ["last_collection_new_count", "INTEGER"],
      ["last_collection_duplicate_count", "INTEGER"],
      ["rights_status", "TEXT DEFAULT 'unknown'"],
      ["rights_last_checked_at", "TEXT"],
      ["rights_review_notes", "TEXT"],
      ["rights_administrator_decision", "TEXT"],
      ["rights_decision_at", "TEXT"],
      ["rights_audit_summary", "TEXT"]
    ] as const;

    for (const [columnName, columnType] of sourceColumns) {
      if (!hasColumn(database, "news_sources", columnName)) {
        database.exec(`ALTER TABLE news_sources ADD COLUMN ${columnName} ${columnType}`);
      }
    }
  }

  if (hasTable(database, "news_articles")) {
    const articleColumns = [
      ["country_id", "TEXT"],
      ["author", "TEXT"],
      ["categories_json", "TEXT"],
      ["tags_json", "TEXT"],
      ["body_blocks_json", "TEXT"],
      ["content_availability", "TEXT"],
      ["content_origin", "TEXT"],
      ["fetched_body", "TEXT"],
      ["fetched_at", "TEXT"],
      ["fetch_status", "TEXT"],
      ["fetch_error", "TEXT"],
      ["external_id", "TEXT"]
    ] as const;

    for (const [columnName, columnType] of articleColumns) {
      if (!hasColumn(database, "news_articles", columnName)) {
        database.exec(`ALTER TABLE news_articles ADD COLUMN ${columnName} ${columnType}`);
      }
    }

    database.exec(`
      UPDATE news_articles
      SET content_availability = CASE
        WHEN body IS NULL AND summary IS NULL THEN 'no_content'
        WHEN body IS NOT NULL AND summary IS NOT NULL AND body <> summary THEN 'full_feed_content'
        ELSE 'summary_only'
      END,
      content_origin = CASE
        WHEN content_origin IS NULL AND body IS NOT NULL AND summary IS NOT NULL AND body <> summary THEN 'rss_full'
        WHEN content_origin IS NULL AND summary IS NOT NULL THEN 'summary'
        WHEN content_origin IS NULL THEN 'manual'
        ELSE content_origin
      END,
      fetch_status = COALESCE(fetch_status, 'idle')
      WHERE content_availability IS NULL OR content_origin IS NULL OR fetch_status IS NULL
    `);

    if (!hasTable(database, "news_source_rights_audits")) {
      database.exec(`
        CREATE TABLE news_source_rights_audits (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'full_republication_permitted', 'republication_permitted_with_conditions', 'limited_use_only', 'republication_not_permitted', 'review_required')),
          summary TEXT,
          review_notes TEXT,
          administrator_decision TEXT,
          checked_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE CASCADE
        );
      `);
    }

    if (!hasTable(database, "news_source_rights_evidence")) {
      database.exec(`
        CREATE TABLE news_source_rights_evidence (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          evidence_url TEXT NOT NULL,
          page_title TEXT,
          evidence_type TEXT NOT NULL CHECK (evidence_type IN ('rss_terms', 'terms_of_use', 'copyright_policy', 'republication_policy', 'syndication', 'licensing', 'other')),
          evidence_domain TEXT,
          evidence_origin TEXT,
          matched_rule TEXT,
          snippet TEXT,
          checked_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (audit_id) REFERENCES news_source_rights_audits(id) ON DELETE CASCADE
        );
      `);
    }

    if (!hasTable(database, "news_source_rights_permissions")) {
      database.exec(`
        CREATE TABLE news_source_rights_permissions (
          id TEXT PRIMARY KEY,
          audit_id TEXT NOT NULL,
          permission TEXT NOT NULL CHECK (permission IN ('full_article_republication', 'headline', 'summary_excerpt', 'original_link_reference', 'commercial_use', 'modification', 'attribution', 'image_reuse', 'video_reuse', 'ai_assisted_original_story')),
          allowed INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          evidence_url TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (audit_id) REFERENCES news_source_rights_audits(id) ON DELETE CASCADE
        );
      `);
    }

    if (hasTable(database, "news_source_rights_evidence")) {
      if (!hasColumn(database, "news_source_rights_evidence", "evidence_domain")) {
        database.exec("ALTER TABLE news_source_rights_evidence ADD COLUMN evidence_domain TEXT");
      }
      if (!hasColumn(database, "news_source_rights_evidence", "evidence_origin")) {
        database.exec("ALTER TABLE news_source_rights_evidence ADD COLUMN evidence_origin TEXT");
      }
      if (!hasColumn(database, "news_source_rights_evidence", "matched_rule")) {
        database.exec("ALTER TABLE news_source_rights_evidence ADD COLUMN matched_rule TEXT");
      }
    }

    if (!hasColumn(database, "news_articles", "external_id")) {
      database.exec("ALTER TABLE news_articles ADD COLUMN external_id TEXT");
    }

    if (!hasTable(database, "news_article_categories")) {
      database.exec(`
        CREATE TABLE news_article_categories (
          id TEXT PRIMARY KEY,
          article_id TEXT NOT NULL,
          category_type TEXT NOT NULL CHECK (category_type IN ('sport', 'country', 'team', 'competition', 'match')),
          entity_id TEXT NOT NULL,
          confidence INTEGER NOT NULL DEFAULT 100,
          reason TEXT,
          classification_source TEXT NOT NULL DEFAULT 'editorial',
          classification_status TEXT NOT NULL DEFAULT 'approved' CHECK (classification_status IN ('suggested', 'approved', 'rejected')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
          UNIQUE(article_id, category_type, entity_id)
        );
      `);
      database.exec(`
        CREATE INDEX idx_news_article_categories_article ON news_article_categories(article_id);
        CREATE INDEX idx_news_article_categories_type ON news_article_categories(category_type);
        CREATE INDEX idx_news_article_categories_entity ON news_article_categories(entity_id);
        CREATE INDEX idx_news_article_categories_approved_entity ON news_article_categories(category_type, entity_id, classification_status);
      `);
    }

    for (const [columnName, columnType] of [
      ["confidence", "INTEGER NOT NULL DEFAULT 100"],
      ["reason", "TEXT"],
      ["classification_source", "TEXT NOT NULL DEFAULT 'editorial'"],
      ["classification_status", "TEXT NOT NULL DEFAULT 'approved'"]
    ] as const) {
      if (!hasColumn(database, "news_article_categories", columnName)) {
        database.exec(`ALTER TABLE news_article_categories ADD COLUMN ${columnName} ${columnType}`);
      }
    }
    database.exec("CREATE INDEX IF NOT EXISTS idx_news_article_categories_approved_entity ON news_article_categories(category_type, entity_id, classification_status);");

    if (!hasTable(database, "news_article_research_results")) {
      database.exec(`
        CREATE TABLE news_article_research_results (
          id TEXT PRIMARY KEY,
          article_id TEXT NOT NULL,
          query TEXT NOT NULL,
          research_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE,
          UNIQUE(article_id)
        );
      `);
      database.exec(`
        CREATE INDEX idx_news_article_research_results_article ON news_article_research_results(article_id);
      `);
    }

    const categoryPairs = [
      ["sport_id", "sport"],
      ["country_id", "country"],
      ["team_id", "team"],
      ["competition_id", "competition"],
      ["match_id", "match"]
    ] as const;

    for (const [columnName, categoryType] of categoryPairs) {
      if (!hasColumn(database, "news_articles", columnName)) {
        continue;
      }

      database.exec(`
        INSERT OR IGNORE INTO news_article_categories (id, article_id, category_type, entity_id, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), a.id, '${categoryType}', a.${columnName}, a.created_at, a.updated_at
        FROM news_articles a
        WHERE a.${columnName} IS NOT NULL
      `);
    }

    ensureNewsSourceDeleteBehavior(database);
  }
}

function ensureNewsSourceDeleteBehavior(database: DatabaseSync) {
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(news_articles)").all() as Array<{ from: string; on_delete: string }>;
  const sourceForeignKey = foreignKeys.find((foreignKey) => foreignKey.from === "source_id");
  if (!sourceForeignKey || sourceForeignKey.on_delete.toUpperCase() === "SET NULL") {
    return;
  }

  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    database.exec("BEGIN TRANSACTION;");
    database.exec(`
      CREATE TABLE news_articles_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        summary TEXT,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
        sport_id TEXT,
        competition_id TEXT,
        team_id TEXT,
        country_id TEXT,
        match_id TEXT,
        source_id TEXT,
        source_name TEXT,
        source_url TEXT,
        author TEXT,
        categories_json TEXT,
        tags_json TEXT,
        content_availability TEXT,
        content_origin TEXT,
        fetched_body TEXT,
        fetched_at TEXT,
        fetch_status TEXT,
        fetch_error TEXT,
        created_by TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        external_id TEXT,
        FOREIGN KEY (sport_id) REFERENCES sports(id),
        FOREIGN KEY (competition_id) REFERENCES competitions(id),
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (country_id) REFERENCES countries(id),
        FOREIGN KEY (match_id) REFERENCES matches(id),
        FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by) REFERENCES operator_users(id)
      );
    `);
    database.exec(`
      INSERT INTO news_articles_new (
        id, title, slug, summary, body, status, sport_id, competition_id, team_id, country_id, match_id,
        source_id, source_name, source_url, author, categories_json, tags_json, content_availability,
        content_origin, fetched_body, fetched_at, fetch_status, fetch_error, created_by, published_at,
        created_at, updated_at, external_id
      )
      SELECT id, title, slug, summary, body, status, sport_id, competition_id, team_id, country_id, match_id,
        source_id, source_name, source_url, author, categories_json, tags_json, content_availability,
        content_origin, fetched_body, fetched_at, fetch_status, fetch_error, created_by, published_at,
        created_at, updated_at, external_id
      FROM news_articles;
    `);
    database.exec("DROP TABLE news_articles;");
    database.exec("ALTER TABLE news_articles_new RENAME TO news_articles;");
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_news_articles_status ON news_articles(status);
      CREATE INDEX IF NOT EXISTS idx_news_articles_sport ON news_articles(sport_id);
      CREATE INDEX IF NOT EXISTS idx_news_articles_competition ON news_articles(competition_id);
      CREATE INDEX IF NOT EXISTS idx_news_articles_team ON news_articles(team_id);
      CREATE INDEX IF NOT EXISTS idx_news_articles_match ON news_articles(match_id);
      CREATE INDEX IF NOT EXISTS idx_news_articles_created_at ON news_articles(created_at);
      CREATE INDEX IF NOT EXISTS idx_news_articles_published_at ON news_articles(published_at);
    `);
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

function createPasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 310000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

  return {
    hash,
    salt,
    iterations,
    algo: "pbkdf2_sha256"
  } as const;
}

export function syncAdminOperatorUserPassword(
  database: DatabaseSync,
  email: string,
  password: string
) {
  if (!email || !password) {
    return false;
  }

  const existingUser = database
    .prepare(
      "SELECT id, password_hash, password_salt, password_iterations, password_algo FROM operator_users WHERE email = ?"
    )
    .get(email) as
    | {
        id: string;
        password_hash?: string | null;
        password_salt?: string | null;
        password_iterations?: number | null;
        password_algo?: string | null;
      }
    | undefined;

  if (!existingUser) {
    return false;
  }

  const { hash, salt, iterations, algo } = createPasswordHash(password);

  database
    .prepare(
      `UPDATE operator_users
       SET password_hash = ?,
           password_salt = ?,
           password_iterations = ?,
           password_algo = ?,
           updated_at = ?
       WHERE email = ?`
    )
    .run(hash, salt, iterations, algo, new Date().toISOString(), email);

  return true;
}

export function createAdminOperatorUser(
  database: DatabaseSync,
  email: string,
  password: string,
  name = "Administrator"
) {
  const now = new Date().toISOString();
  const { hash, salt, iterations, algo } = createPasswordHash(password);
  const id = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO operator_users (
        id,
        name,
        email,
        role,
        status,
        last_login_at,
        password_hash,
        password_salt,
        password_iterations,
        password_algo,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, email, "admin", "active", null, hash, salt, iterations, algo, now, now);

  return { id, email, name, role: "admin", createdAt: now, updatedAt: now };
}

export function ensureAdminOperatorUser(
  database: DatabaseSync,
  email: string,
  password: string
) {
  const countRow = database
    .prepare("SELECT COUNT(1) AS count FROM operator_users")
    .get() as { count: number } | undefined;

  const operatorsExisting = Number(countRow?.count ?? 0);
  const existingUser = database
    .prepare("SELECT id FROM operator_users WHERE email = ?")
    .get(email) as { id: string } | undefined;

  if (existingUser) {
    return { created: false, operatorsExisting, adminEmail: email };
  }

  createAdminOperatorUser(database, email, password);

  return { created: true, operatorsExisting, adminEmail: email };
}

export function bootstrapAdminUserIfNeeded(database: DatabaseSync) {
  if (runtimeConfig.dbReadOnlyMode) {
    console.warn("[AUTH BOOTSTRAP] skipped due read-only mode");
    return { operatorsExisting: 0, createdAdmin: false };
  }

  if (!hasTable(database, "operator_users")) {
    console.warn("[AUTH BOOTSTRAP] operator_users table missing, skipping bootstrap");
    return { operatorsExisting: 0, createdAdmin: false };
  }

  const row = database
    .prepare("SELECT COUNT(1) AS count FROM operator_users")
    .get() as { count: number } | undefined;
  const operatorsExisting = Number(row?.count ?? 0);
  let createdAdmin = false;

  const adminEmail = env.adminEmail;
  const adminPassword = env.adminPassword;

  if (operatorsExisting === 0) {
    if (adminEmail && adminPassword) {
      ensureAdminOperatorUser(database, adminEmail, adminPassword);
      createdAdmin = true;
    } else {
      console.warn(
        "[AUTH BOOTSTRAP] operators existing: 0, admin creation skipped because ADMIN_EMAIL and ADMIN_PASSWORD are not both set"
      );
    }
  } else if (adminEmail) {
    const existingUser = database
      .prepare("SELECT id FROM operator_users WHERE email = ?")
      .get(adminEmail) as { id: string } | undefined;

    if (!existingUser) {
      if (adminPassword) {
        ensureAdminOperatorUser(database, adminEmail, adminPassword);
        createdAdmin = true;
      } else {
        console.warn("[AUTH BOOTSTRAP] ADMIN_EMAIL is set but ADMIN_PASSWORD is missing; cannot create admin user");
      }
    } else if (adminPassword) {
      const synced = syncAdminOperatorUserPassword(database, adminEmail, adminPassword);
      console.log(`[AUTH BOOTSTRAP] admin password synced for ${adminEmail}: ${synced ? "true" : "false"}`);
    }
  }

  console.log(`[AUTH BOOTSTRAP] operators existing: ${operatorsExisting}`);
  console.log(`[AUTH BOOTSTRAP] created admin: ${createdAdmin ? "true" : "false"}`);

  return { operatorsExisting, createdAdmin };
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

  if (!hasColumn(database, "teams", "slug")) {
    database.exec("ALTER TABLE teams ADD COLUMN slug TEXT;");
  }

  if (!hasColumn(database, "matches", "external_provider")) {
    database.exec("ALTER TABLE matches ADD COLUMN external_provider TEXT;");
  }

  if (!hasColumn(database, "matches", "external_match_id")) {
    database.exec("ALTER TABLE matches ADD COLUMN external_match_id TEXT;");
  }

  if (!hasColumn(database, "scheduling_matches", "season_id")) {
    database.exec("ALTER TABLE scheduling_matches ADD COLUMN season_id TEXT;");
  }

  if (!hasColumn(database, "scheduling_matches", "venue_name")) {
    database.exec("ALTER TABLE scheduling_matches ADD COLUMN venue_name TEXT;");
  }

  if (!hasColumn(database, "scheduling_matches", "external_provider")) {
    database.exec("ALTER TABLE scheduling_matches ADD COLUMN external_provider TEXT;");
  }

  if (!hasColumn(database, "scheduling_matches", "external_match_id")) {
    database.exec("ALTER TABLE scheduling_matches ADD COLUMN external_match_id TEXT;");
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_external_identity
      ON matches(external_provider, external_match_id)
      WHERE external_provider IS NOT NULL AND external_match_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS scheduling_match_links (
      scheduling_match_id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL UNIQUE,
      link_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (link_status IN ('linked', 'ambiguous', 'unresolved', 'rejected')),
      confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
      linked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scheduling_match_id) REFERENCES scheduling_matches(id),
      FOREIGN KEY (match_id) REFERENCES matches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_scheduling_match_links_match ON scheduling_match_links(match_id);
    CREATE INDEX IF NOT EXISTS idx_scheduling_match_links_status ON scheduling_match_links(link_status);
  `);

  const teamsWithoutSlugs = database.prepare("SELECT id, sport_id, country_id, name FROM teams WHERE slug IS NULL OR slug = ''").all() as Array<{
    id: string;
    sport_id: string | null;
    country_id: string | null;
    name: string;
  }>;
  for (const team of teamsWithoutSlugs) {
    const baseSlug = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "team";
    let slug = baseSlug;
    let suffix = 1;
    while (database.prepare("SELECT 1 FROM teams WHERE sport_id IS ? AND country_id IS ? AND slug = ? AND id != ?").get(team.sport_id, team.country_id, slug, team.id)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    database.prepare("UPDATE teams SET slug = ? WHERE id = ?").run(slug, team.id);
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_sport_country_slug ON teams(sport_id, country_id, slug);");

  database.exec(`
    CREATE TABLE IF NOT EXISTS competition_season_teams (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      membership_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (competition_id) REFERENCES competitions(id),
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      UNIQUE (competition_id, season_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_competition_season_teams_competition ON competition_season_teams(competition_id);
    CREATE INDEX IF NOT EXISTS idx_competition_season_teams_season ON competition_season_teams(season_id);
    CREATE INDEX IF NOT EXISTS idx_competition_season_teams_team ON competition_season_teams(team_id);
    CREATE INDEX IF NOT EXISTS idx_competition_season_teams_competition_season ON competition_season_teams(competition_id, season_id);
  `);

  if (!hasTable(database, "mobile_analytics_events")) {
    database.exec(`CREATE TABLE IF NOT EXISTS mobile_analytics_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      session_id TEXT,
      match_id TEXT,
      payload TEXT,
      user_agent TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );`);
  }

  if (!hasTable(database, "mobile_ad_events")) {
    database.exec(`CREATE TABLE IF NOT EXISTS mobile_ad_events (
      id TEXT PRIMARY KEY,
      promotion_id TEXT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      match_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );`);
  }

  if (!hasTable(database, "mobile_ad_promotions")) {
    database.exec(`CREATE TABLE IF NOT EXISTS mobile_ad_promotions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      action_url TEXT,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  }

  if (!hasColumn(database, "competitions", "country_id")) {
    database.exec("ALTER TABLE competitions ADD COLUMN country_id TEXT;");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      sport_id TEXT NOT NULL,
      name TEXT NOT NULL,
      host_type TEXT NOT NULL CHECK (host_type IN ('country', 'organization', 'federation', 'association', 'regional', 'international', 'other')),
      country_id TEXT,
      logo_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (sport_id) REFERENCES sports(id),
      FOREIGN KEY (country_id) REFERENCES countries(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_sport_name ON hosts(sport_id, name);
  `);

  if (!hasColumn(database, "competitions", "host_id")) {
    database.exec("ALTER TABLE competitions ADD COLUMN host_id TEXT;");
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

  if (!hasColumn(database, "teams", "host_id")) {
    database.exec("ALTER TABLE teams ADD COLUMN host_id TEXT REFERENCES hosts(id);");
  }

  if (hasColumn(database, "competitions", "sport_id") && isColumnNotNullable(database, "competitions", "sport_id")) {
    database.exec("PRAGMA foreign_keys = OFF;");
    try {
      database.exec("BEGIN TRANSACTION;");
      database.exec(`
        CREATE TABLE IF NOT EXISTS competitions_new (
          id TEXT PRIMARY KEY,
          sport_id TEXT,
          host_id TEXT,
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
          FOREIGN KEY (host_id) REFERENCES hosts(id),
          FOREIGN KEY (country_id) REFERENCES countries(id),
          FOREIGN KEY (region_id) REFERENCES regions(id)
        );
      `);
      database.exec(`
        INSERT INTO competitions_new
        SELECT id, sport_id, host_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status, created_at, updated_at
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
        WHEN status = 'scheduled' AND id IN (SELECT match_id FROM streams) THEN 'assigned'
        ELSE status
      END
      WHERE status IN ('completed', 'scheduled')`
  );
}
