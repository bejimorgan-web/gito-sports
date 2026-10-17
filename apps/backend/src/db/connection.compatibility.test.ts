import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { competitionEntryMigration } from "./competition-entry-migration.js";
import { migrationChecksum } from "./migration-runner.js";
import { standingsRevisionsMigration } from "./standings-revisions-migration.js";
import { standingsCoverageMigration } from "./standings-coverage-migration.js";
import { standingsScheduleManifestMigration } from "./standings-schedule-manifest-migration.js";
import { standingsGovernanceMigration } from "./standings-governance-migration.js";
import { standingsSourceEvidenceMigration } from "./standings-source-evidence-migration.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";
import { markMigrationImported } from "./migration-import.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gito-startup-compat-"));

const isolatedEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  BACKUP_DIR: process.env.BACKUP_DIR,
  AUTO_RESTORE_BACKUP: process.env.AUTO_RESTORE_BACKUP,
  AUTO_IMPORT_MIGRATION: process.env.AUTO_IMPORT_MIGRATION,
  GITO_NEWS_TEST_MODE: process.env.GITO_NEWS_TEST_MODE
};

process.env.DATABASE_PATH = path.join(suiteRoot, "config-only.sqlite");
process.env.UPLOAD_DIR = path.join(suiteRoot, "config-uploads");
process.env.BACKUP_DIR = path.join(suiteRoot, "config-backups");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.GITO_NEWS_TEST_MODE = "false";

const { assertDatabaseStartupCompatibility } = await import("./connection.js");

for (const [key, value] of Object.entries(isolatedEnv)) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test.after(() => {
  fs.rmSync(suiteRoot, { recursive: true, force: true });
});

function createCaseDirectory(name: string): string {
  return fs.mkdtempSync(path.join(suiteRoot, `${name}-`));
}

function createSentinelDatabase(databasePath: string, userVersion: number): void {
  // Minimal rejection sentinels only; these intentionally do not model a legacy schema.
  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    database.exec(`
      CREATE TABLE compatibility_sentinel (
        id INTEGER PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO compatibility_sentinel(value) VALUES ('preserve-me');
      PRAGMA user_version = ${userVersion};
    `);
  } finally {
    database.close();
  }
}

function readDatabaseSnapshot(databasePath: string) {
  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
  try {
    const tableNames = (database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all() as Array<{ name: string }>).map((row) => row.name);
    return {
      version: Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version),
      schema: database.prepare(`
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        ORDER BY type, name
      `).all(),
      contents: tableNames.map((tableName) => ({
        tableName,
        rows: database.prepare(`SELECT * FROM "${tableName.replaceAll('"', '""')}"`).all()
      }))
    };
  } finally {
    database.close();
  }
}

function runStartup(databasePath: string, readOnly = false) {
  const startupScript = `
    import { getDatabase, closeDatabase } from "./src/db/connection.ts";
    try {
      getDatabase();
    } finally {
      closeDatabase();
    }
  `;
  const testDirectory = path.dirname(databasePath);
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", startupScript],
    {
      cwd: backendRoot,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_PATH: databasePath,
        UPLOAD_DIR: path.join(testDirectory, "uploads"),
        BACKUP_DIR: path.join(testDirectory, "backups"),
        LEGACY_DATABASE_PATH: path.join(testDirectory, "no-legacy-database.sqlite"),
        AUTO_RESTORE_BACKUP: "false",
        AUTO_IMPORT_MIGRATION: "false",
        GITO_NEWS_TEST_MODE: "false",
        DB_READONLY_MODE: readOnly ? "true" : "false"
      }
    }
  );
}

function assertStartupRejectedWithoutMutation(databasePath: string, expectedError: RegExp, readOnly = false): void {
  const before = readDatabaseSnapshot(databasePath);
  const firstAttempt = runStartup(databasePath, readOnly);
  assert.notEqual(firstAttempt.status, 0, firstAttempt.stdout);
  assert.match(`${firstAttempt.stdout}\n${firstAttempt.stderr}`, expectedError);
  assert.deepEqual(readDatabaseSnapshot(databasePath), before);

  const retry = runStartup(databasePath, readOnly);
  assert.notEqual(retry.status, 0, retry.stdout);
  assert.match(`${retry.stdout}\n${retry.stderr}`, expectedError);
  assert.deepEqual(readDatabaseSnapshot(databasePath), before);
}

function downgradeManifestMigration(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER trg_standings_coverage_manifest_metadata_finalize;
    DROP TRIGGER trg_standings_coverage_schedule_finalize;
    DROP TRIGGER trg_standings_coverage_manifest_finalize_count;
    DROP TRIGGER trg_standings_coverage_manifest_fixtures_no_delete;
    DROP TRIGGER trg_standings_coverage_manifest_fixtures_no_update;
    DROP TRIGGER trg_standings_coverage_manifest_fixtures_insert;
    DROP TRIGGER trg_standings_coverage_manifest_context;
    DROP TRIGGER trg_standings_schedule_manifest_no_delete;
    DROP TRIGGER trg_standings_schedule_manifest_no_update;
    DROP TRIGGER trg_standings_schedule_manifest_finalize;
    DROP TRIGGER trg_standings_schedule_fixture_delete;
    DROP TRIGGER trg_standings_schedule_fixture_update;
    DROP TRIGGER trg_standings_schedule_fixture_insert;
    DROP TRIGGER trg_standings_schedule_manifest_version;
    DROP TABLE standings_coverage_manifest_fixtures;
    DROP TABLE standings_schedule_manifest_fixtures;
    DROP INDEX idx_standings_schedule_one_draft;
    DROP TABLE standings_schedule_manifests;
    ALTER TABLE standings_coverage_assessments DROP COLUMN expected_manifest_fixture_count;
    ALTER TABLE standings_coverage_assessments DROP COLUMN schedule_state;
    ALTER TABLE standings_coverage_assessments DROP COLUMN manifest_id;
    DELETE FROM schema_migrations WHERE version = 5;
    PRAGMA user_version = 4;
  `);
}

function downgradeGovernanceMigration(database: DatabaseSync): void {
  database.exec(`
    DROP TRIGGER trg_standings_ruleset_no_delete;
    DROP TRIGGER trg_standings_ruleset_no_update;
    DROP TRIGGER trg_standings_ruleset_proposal_only;
    DROP TABLE standings_rulesets;
    ALTER TABLE standings_schedule_manifests DROP COLUMN source_reference;
    ALTER TABLE standings_schedule_manifests DROP COLUMN source_name;
    DELETE FROM schema_migrations WHERE version = 6;
    PRAGMA user_version = 5;
  `);
}

function downgradeSourceEvidenceMigration(database: DatabaseSync): void {
  database.exec(`
    ALTER TABLE standings_schedule_manifests DROP COLUMN source_content_hash;
    DELETE FROM schema_migrations WHERE version = 7;
    PRAGMA user_version = 6;
  `);
}

// getDatabase() applies the current working-tree bootstrap, then the ordered v2-v7
// migration. This fixture is not historical-v1 or production schema evidence.
test("fresh bootstrap uses the current working-tree schema and startup path", () => {
  const testDirectory = createCaseDirectory("fresh-bootstrap-from-current-working-tree");
  const databasePath = path.join(testDirectory, "fresh.sqlite");
  const result = runStartup(databasePath);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const snapshot = readDatabaseSnapshot(databasePath);
  assert.equal(snapshot.version, 7);
  const tableNames = new Set(snapshot.schema.map((entry) => (entry as { name: string }).name));
  for (const tableName of [
    "sports", "competitions", "seasons", "teams", "matches", "operator_users",
    "news_articles", "match_score_state", "competition_entries", "fixture_participants",
    "match_result_revisions", "standings_snapshots", "standings_snapshot_results",
    "standings_snapshot_rows", "standings_coverage_assessments", "standings_coverage_fixtures",
    "standings_schedule_manifests", "standings_schedule_manifest_fixtures", "standings_rulesets",
    "standings_coverage_manifest_fixtures"
  ]) {
    assert.ok(tableNames.has(tableName), `expected fresh bootstrap table ${tableName}`);
  }
  assert.ok(tableNames.has("schema_migrations"), "fresh bootstrap must initialize the migration ledger");
  const ledger = snapshot.contents.find((entry) => entry.tableName === "schema_migrations");
  assert.deepEqual(ledger?.rows.map((row) => ({
    version: (row as { version: number }).version,
    name: (row as { name: string }).name
  })), [
    { version: 1, name: "current-working-tree-bootstrap" },
    { version: 2, name: competitionEntryMigration.name },
    { version: 3, name: standingsRevisionsMigration.name },
    { version: 4, name: standingsCoverageMigration.name },
    { version: 5, name: standingsScheduleManifestMigration.name },
    { version: 6, name: standingsGovernanceMigration.name },
    { version: 7, name: standingsSourceEvidenceMigration.name }
  ]);
  const v2Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 2) as
    { checksum: string } | undefined;
  assert.equal(v2Ledger?.checksum, migrationChecksum(competitionEntryMigration));
  const v3Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 3) as
    { checksum: string } | undefined;
  assert.equal(v3Ledger?.checksum, migrationChecksum(standingsRevisionsMigration));
  const v4Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 4) as
    { checksum: string } | undefined;
  assert.equal(v4Ledger?.checksum, migrationChecksum(standingsCoverageMigration));
  const v5Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 5) as
    { checksum: string } | undefined;
  assert.equal(v5Ledger?.checksum, migrationChecksum(standingsScheduleManifestMigration));
  const v6Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 6) as
    { checksum: string } | undefined;
  assert.equal(v6Ledger?.checksum, migrationChecksum(standingsGovernanceMigration));
  const v7Ledger = ledger?.rows.find((row) => (row as { version: number }).version === 7) as
    { checksum: string } | undefined;
  assert.equal(v7Ledger?.checksum, migrationChecksum(standingsSourceEvidenceMigration));
});

test("the explicitly sourced current-working-tree bootstrap fixture passes preflight read-only", () => {
  const testDirectory = createCaseDirectory("accepted-current-working-tree-bootstrap");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const before = readDatabaseSnapshot(databasePath);
  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
  try {
    assertDatabaseStartupCompatibility(database, {
      databasePath,
      readOnlyMode: true
    });
  } finally {
    database.close();
  }
  assert.deepEqual(readDatabaseSnapshot(databasePath), before);
});

test("supported migration-import metadata remains compatible with the bootstrap baseline", () => {
  const testDirectory = createCaseDirectory("migration-import-metadata");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    markMigrationImported(database, "disposable-import-version");
  } finally {
    database.close();
  }

  const verifiedDatabase = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
  try {
    assertDatabaseStartupCompatibility(verifiedDatabase, {
      databasePath,
      readOnlyMode: true
    });
  } finally {
    verifiedDatabase.close();
  }
});

test("read-only startup accepts the exact disposable v5 schema and makes no changes", () => {
  const testDirectory = createCaseDirectory("read-only-current-working-tree-bootstrap");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);
  const before = readDatabaseSnapshot(databasePath);

  const readOnlyStartup = runStartup(databasePath, true);
  assert.equal(readOnlyStartup.status, 0, `${readOnlyStartup.stdout}\n${readOnlyStartup.stderr}`);
  assert.deepEqual(readDatabaseSnapshot(databasePath), before);
});

test("writable startup advances an explicitly ledgered v2 database through migration v5", () => {
  const testDirectory = createCaseDirectory("writable-v2-to-v3");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    downgradeSourceEvidenceMigration(database);
    downgradeGovernanceMigration(database);
    downgradeManifestMigration(database);
    database.exec(`
      DROP TRIGGER trg_standings_coverage_assessments_no_delete;
      DROP TRIGGER trg_standings_coverage_assessments_no_update;
      DROP TRIGGER trg_standings_coverage_assessments_finalize;
      DROP TRIGGER trg_standings_coverage_fixtures_no_delete;
      DROP TRIGGER trg_standings_coverage_fixtures_no_update;
      DROP TRIGGER trg_standings_coverage_fixtures_insert;
      DROP TRIGGER trg_standings_coverage_assessments_snapshot;
      DROP TABLE standings_coverage_fixtures;
      DROP TABLE standings_coverage_assessments;
      DELETE FROM schema_migrations WHERE version = 4;
      DROP TRIGGER trg_standings_snapshot_rows_incomplete_only;
      DROP TRIGGER trg_standings_snapshot_rows_no_delete;
      DROP TRIGGER trg_standings_snapshot_rows_no_update;
      DROP TRIGGER trg_standings_snapshot_results_no_delete;
      DROP TRIGGER trg_standings_snapshot_results_no_update;
      DROP TRIGGER trg_standings_snapshot_results_valid;
      DROP TRIGGER trg_standings_snapshots_no_delete;
      DROP TRIGGER trg_standings_snapshots_complete;
      DROP TRIGGER trg_standings_snapshots_no_update;
      DROP TRIGGER trg_standings_snapshots_sequence;
      DROP TRIGGER trg_match_result_revisions_no_delete;
      DROP TRIGGER trg_match_result_revisions_no_update;
      DROP TRIGGER trg_match_result_revisions_order;
      DROP TABLE standings_snapshot_rows;
      DROP TABLE standings_snapshot_results;
      DROP TABLE standings_snapshots;
      DROP TABLE match_result_revisions;
      DELETE FROM schema_migrations WHERE version = 3;
      PRAGMA user_version = 2;
    `);
  } finally {
    database.close();
  }

  const upgraded = runStartup(databasePath);
  assert.equal(upgraded.status, 0, `${upgraded.stdout}\n${upgraded.stderr}`);
  const after = readDatabaseSnapshot(databasePath);
  assert.equal(after.version, 7);
  assert.ok(after.schema.some((entry) => (entry as { name: string }).name === "match_result_revisions"));
  assert.ok(after.schema.some((entry) => (entry as { name: string }).name === "standings_coverage_assessments"));
  assert.deepEqual(
    (after.contents.find((entry) => entry.tableName === "schema_migrations")?.rows as Array<{ version: number }>)
      .map(({ version }) => version),
    [1, 2, 3, 4, 5, 6, 7]
  );
});

test("read-only startup rejects a verified v1 database before attempting v2 through v7 migrations", () => {
  const testDirectory = createCaseDirectory("read-only-pending-migrations");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    downgradeSourceEvidenceMigration(database);
    downgradeGovernanceMigration(database);
    downgradeManifestMigration(database);
    database.exec(`
      DROP TRIGGER trg_standings_coverage_assessments_no_delete;
      DROP TRIGGER trg_standings_coverage_assessments_no_update;
      DROP TRIGGER trg_standings_coverage_assessments_finalize;
      DROP TRIGGER trg_standings_coverage_fixtures_no_delete;
      DROP TRIGGER trg_standings_coverage_fixtures_no_update;
      DROP TRIGGER trg_standings_coverage_fixtures_insert;
      DROP TRIGGER trg_standings_coverage_assessments_snapshot;
      DROP TABLE standings_coverage_fixtures;
      DROP TABLE standings_coverage_assessments;
      DROP TRIGGER trg_standings_snapshot_rows_incomplete_only;
      DROP TRIGGER trg_standings_snapshot_rows_no_delete;
      DROP TRIGGER trg_standings_snapshot_rows_no_update;
      DROP TRIGGER trg_standings_snapshot_results_no_delete;
      DROP TRIGGER trg_standings_snapshot_results_no_update;
      DROP TRIGGER trg_standings_snapshot_results_valid;
      DROP TRIGGER trg_standings_snapshots_no_delete;
      DROP TRIGGER trg_standings_snapshots_complete;
      DROP TRIGGER trg_standings_snapshots_no_update;
      DROP TRIGGER trg_standings_snapshots_sequence;
      DROP TRIGGER trg_match_result_revisions_no_delete;
      DROP TRIGGER trg_match_result_revisions_no_update;
      DROP TRIGGER trg_match_result_revisions_order;
      DROP TABLE standings_snapshot_rows;
      DROP TABLE standings_snapshot_results;
      DROP TABLE standings_snapshots;
      DROP TABLE match_result_revisions;
      DROP TABLE fixture_participants;
      DROP TABLE competition_entries;
      DROP INDEX idx_matches_participant_context;
      DROP INDEX idx_seasons_competition_id_id;
      DROP TABLE schema_migrations;
      PRAGMA user_version = 1;
    `);
  } finally {
    database.close();
  }

  assertStartupRejectedWithoutMutation(
    databasePath,
    /read-only mode requires the migration ledger; open writable once to apply verified migrations/,
    true
  );
});

test("structurally verified v1 databases upgrade through v7 and preserve fixture assignments", () => {
  const testDirectory = createCaseDirectory("v1-fixture-preservation");
  const databasePath = path.join(testDirectory, "bootstrap.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    downgradeSourceEvidenceMigration(database);
    downgradeGovernanceMigration(database);
    downgradeManifestMigration(database);
    database.exec(`
      DROP TRIGGER trg_standings_coverage_assessments_no_delete;
      DROP TRIGGER trg_standings_coverage_assessments_no_update;
      DROP TRIGGER trg_standings_coverage_assessments_finalize;
      DROP TRIGGER trg_standings_coverage_fixtures_no_delete;
      DROP TRIGGER trg_standings_coverage_fixtures_no_update;
      DROP TRIGGER trg_standings_coverage_fixtures_insert;
      DROP TRIGGER trg_standings_coverage_assessments_snapshot;
      DROP TABLE standings_coverage_fixtures;
      DROP TABLE standings_coverage_assessments;
      DROP TRIGGER trg_standings_snapshot_rows_incomplete_only;
      DROP TRIGGER trg_standings_snapshot_rows_no_delete;
      DROP TRIGGER trg_standings_snapshot_rows_no_update;
      DROP TRIGGER trg_standings_snapshot_results_no_delete;
      DROP TRIGGER trg_standings_snapshot_results_no_update;
      DROP TRIGGER trg_standings_snapshot_results_valid;
      DROP TRIGGER trg_standings_snapshots_no_delete;
      DROP TRIGGER trg_standings_snapshots_complete;
      DROP TRIGGER trg_standings_snapshots_no_update;
      DROP TRIGGER trg_standings_snapshots_sequence;
      DROP TRIGGER trg_match_result_revisions_no_delete;
      DROP TRIGGER trg_match_result_revisions_no_update;
      DROP TRIGGER trg_match_result_revisions_order;
      DROP TABLE standings_snapshot_rows;
      DROP TABLE standings_snapshot_results;
      DROP TABLE standings_snapshots;
      DROP TABLE match_result_revisions;
      DROP TABLE fixture_participants;
      DROP TABLE competition_entries;
      DROP INDEX idx_matches_participant_context;
      DROP INDEX idx_seasons_competition_id_id;
      DELETE FROM schema_migrations WHERE version > 1;
      PRAGMA user_version = 1;

      -- Existing GiTO deployments may have harmless additive indexes absent from the bootstrap fixture.
      CREATE INDEX idx_legacy_teams_name_audit ON teams(name);

      INSERT INTO competitions (id, name, slug, scope, created_at, updated_at)
        VALUES ('v2-test-competition', 'V2 Test', 'v2-test', 'national', 'now', 'now');
      INSERT INTO seasons (id, competition_id, name)
        VALUES ('v2-test-season', 'v2-test-competition', '2026');
      INSERT INTO teams (id, name, created_at, updated_at)
        VALUES ('v2-home-team', 'Home', 'now', 'now'),
               ('v2-away-team', 'Away', 'now', 'now');
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id,
        starts_at, status, created_at, updated_at
      ) VALUES (
        'v2-preserved-fixture', 'v2-test-competition', 'v2-test-season',
        'v2-home-team', 'v2-away-team', '2026-01-01T12:00:00.000Z',
        'scheduled', 'now', 'now'
      );
    `);
  } finally {
    database.close();
  }

  const before = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
  let originalFixture: unknown;
  try {
    originalFixture = before.prepare(
      "SELECT id, home_team_id, away_team_id, competition_id, season_id FROM matches WHERE id = ?"
    ).get("v2-preserved-fixture");
  } finally {
    before.close();
  }

  const migration = runStartup(databasePath);
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);

  const after = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
  try {
    assert.deepEqual(
      after.prepare("SELECT id, home_team_id, away_team_id, competition_id, season_id FROM matches WHERE id = ?")
        .get("v2-preserved-fixture"),
      originalFixture
    );
    assert.equal(
      (after.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      7
    );
    assert.ok(after.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_legacy_teams_name_audit"));
  } finally {
    after.close();
  }
});

test("populated version-zero databases are rejected before mutation and remain rejected on retry", () => {
  const testDirectory = createCaseDirectory("populated-version-zero");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  createSentinelDatabase(databasePath, 0);

  assertStartupRejectedWithoutMutation(
    databasePath,
    /refusing database with schema objects and user_version = 0/
  );
});

test("a view-only version-zero database is not mistaken for a fresh database", () => {
  const testDirectory = createCaseDirectory("view-only-version-zero");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    database.exec("CREATE VIEW compatibility_sentinel_view AS SELECT 1 AS value;");
  } finally {
    database.close();
  }

  assertStartupRejectedWithoutMutation(
    databasePath,
    /refusing database with schema objects and user_version = 0/
  );
});

test("future schema versions are rejected before startup mutations", () => {
  const testDirectory = createCaseDirectory("future-version");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  createSentinelDatabase(databasePath, 99);

  assertStartupRejectedWithoutMutation(databasePath, /Unsupported schema version 99/);
});

test("a version-one structure mismatch is rejected before startup mutations", () => {
  const testDirectory = createCaseDirectory("version-one-mismatch");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  createSentinelDatabase(databasePath, 1);

  assertStartupRejectedWithoutMutation(databasePath, /schema mismatch: required table sports is missing/);
});

test("a partially migrated unledgered version-one database is rejected unchanged", () => {
  const testDirectory = createCaseDirectory("unledgered-version-one");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  const bootstrap = runStartup(databasePath);
  assert.equal(bootstrap.status, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);

  const database = allowSqliteInstantiation(() => new DatabaseSync(databasePath));
  try {
    downgradeSourceEvidenceMigration(database);
    downgradeGovernanceMigration(database);
    downgradeManifestMigration(database);
    database.exec(`
      DROP TRIGGER trg_standings_coverage_assessments_no_delete;
      DROP TRIGGER trg_standings_coverage_assessments_no_update;
      DROP TRIGGER trg_standings_coverage_assessments_finalize;
      DROP TRIGGER trg_standings_coverage_fixtures_no_delete;
      DROP TRIGGER trg_standings_coverage_fixtures_no_update;
      DROP TRIGGER trg_standings_coverage_fixtures_insert;
      DROP TRIGGER trg_standings_coverage_assessments_snapshot;
      DROP TABLE standings_coverage_fixtures;
      DROP TABLE standings_coverage_assessments;
      DROP TRIGGER trg_standings_snapshot_rows_incomplete_only;
      DROP TRIGGER trg_standings_snapshot_rows_no_delete;
      DROP TRIGGER trg_standings_snapshot_rows_no_update;
      DROP TRIGGER trg_standings_snapshot_results_no_delete;
      DROP TRIGGER trg_standings_snapshot_results_no_update;
      DROP TRIGGER trg_standings_snapshot_results_valid;
      DROP TRIGGER trg_standings_snapshots_no_delete;
      DROP TRIGGER trg_standings_snapshots_complete;
      DROP TRIGGER trg_standings_snapshots_no_update;
      DROP TRIGGER trg_standings_snapshots_sequence;
      DROP TRIGGER trg_match_result_revisions_no_delete;
      DROP TRIGGER trg_match_result_revisions_no_update;
      DROP TRIGGER trg_match_result_revisions_order;
      DROP TABLE standings_snapshot_rows;
      DROP TABLE standings_snapshot_results;
      DROP TABLE standings_snapshots;
      DROP TABLE match_result_revisions;
      DROP TABLE fixture_participants;
      DROP TABLE competition_entries;
      DROP INDEX idx_matches_participant_context;
      DROP INDEX idx_seasons_competition_id_id;
      DROP TABLE schema_migrations;
      PRAGMA user_version = 1;
      CREATE TABLE competition_entries (id TEXT PRIMARY KEY);
    `);
  } finally {
    database.close();
  }

  assertStartupRejectedWithoutMutation(databasePath, /version-one database does not match a supported bootstrap schema/);
});

test("read-only startup rejects an unverified structure without changing it", () => {
  const testDirectory = createCaseDirectory("read-only-mismatch");
  const databasePath = path.join(testDirectory, "fixture.sqlite");
  createSentinelDatabase(databasePath, 1);

  assertStartupRejectedWithoutMutation(
    databasePath,
    /schema mismatch: required table sports is missing/,
    true
  );
});
