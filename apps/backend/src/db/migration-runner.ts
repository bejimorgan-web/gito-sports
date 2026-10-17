import crypto from "node:crypto";
import type { DatabaseSync } from "./sqlite.js";

export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
  bootstrapBaseline?: boolean;
}

interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export const MIGRATION_LEDGER_TABLE = "schema_migrations";

const migrationLedgerSql = `CREATE TABLE ${MIGRATION_LEDGER_TABLE} (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL
)`;

export function migrationChecksum(migration: SqlMigration): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      version: migration.version,
      name: migration.name,
      sql: migration.sql,
      bootstrapBaseline: migration.bootstrapBaseline === true
    }))
    .digest("hex");
}

export function validateMigrationDefinitions(migrations: readonly SqlMigration[]): void {
  if (migrations.length === 0) {
    throw new Error("[migration] at least one migration definition is required");
  }

  const names = new Set<string>();
  let previousVersion = 0;

  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      throw new Error(`[migration] invalid version ${migration.version}; versions must be positive safe integers`);
    }
    if (migration.version !== previousVersion + 1) {
      throw new Error(`[migration] invalid ordering at version ${migration.version}; expected ${previousVersion + 1}`);
    }
    if (typeof migration.name !== "string" || migration.name.trim() !== migration.name || migration.name.length === 0) {
      throw new Error(`[migration] version ${migration.version} must have a non-empty, trimmed name`);
    }
    if (names.has(migration.name)) {
      throw new Error(`[migration] duplicate migration name "${migration.name}"`);
    }
    if (typeof migration.sql !== "string" || migration.sql.trim().length === 0) {
      throw new Error(`[migration] version ${migration.version} (${migration.name}) has no SQL definition`);
    }
    if (migration.bootstrapBaseline && migration.version !== 1) {
      throw new Error("[migration] a bootstrap baseline must be migration version 1");
    }

    names.add(migration.name);
    previousVersion = migration.version;
  }
}

function hasLedger(database: DatabaseSync): boolean {
  return Boolean(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(MIGRATION_LEDGER_TABLE));
}

function assertLedgerSchema(database: DatabaseSync): void {
  const row = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(MIGRATION_LEDGER_TABLE) as { sql?: string } | undefined;

  if (row?.sql !== migrationLedgerSql) {
    throw new Error("[migration] schema_migrations ledger has an unsupported structure");
  }
}

function getUserVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

function readAppliedMigrations(database: DatabaseSync): AppliedMigration[] {
  return database.prepare(
    `SELECT version, name, checksum, applied_at FROM ${MIGRATION_LEDGER_TABLE} ORDER BY version`
  ).all() as AppliedMigration[];
}

function assertAppliedMigrations(
  database: DatabaseSync,
  migrations: readonly SqlMigration[]
): number {
  if (!hasLedger(database)) {
    throw new Error("[migration] migration ledger is missing; refusing to adopt an unverified database");
  }
  assertLedgerSchema(database);

  const applied = readAppliedMigrations(database);
  if (applied.length === 0) {
    throw new Error("[migration] migration ledger is empty; refusing to adopt an unverified database");
  }

  for (let index = 0; index < applied.length; index += 1) {
    const entry = applied[index];
    const expected = migrations[index];
    if (!entry) {
      throw new Error(`[migration] migration ledger entry ${index + 1} is unavailable`);
    }
    if (!expected || entry.version !== expected.version) {
      throw new Error(`[migration] ledger version ${entry.version} has no matching migration definition`);
    }
    if (entry.name !== expected.name) {
      throw new Error(`[migration] migration ${entry.version} name mismatch: ledger has "${entry.name}", code has "${expected.name}"`);
    }
    if (entry.checksum !== migrationChecksum(expected)) {
      throw new Error(`[migration] checksum mismatch for applied migration ${entry.version} (${entry.name})`);
    }
  }

  const latestApplied = applied[applied.length - 1];
  const latestDefinition = migrations[migrations.length - 1];
  if (!latestApplied || !latestDefinition) {
    throw new Error("[migration] failed to determine the current migration version");
  }
  const latestAppliedVersion = latestApplied.version;
  const userVersion = getUserVersion(database);
  if (userVersion > latestDefinition.version) {
    throw new Error(`[migration] unsupported future schema version ${userVersion}`);
  }
  if (userVersion !== latestAppliedVersion) {
    throw new Error(`[migration] user_version ${userVersion} does not match latest ledger version ${latestAppliedVersion}`);
  }
  return latestAppliedVersion;
}

export function assertMigrationState(
  database: DatabaseSync,
  migrations: readonly SqlMigration[]
): number {
  validateMigrationDefinitions(migrations);
  return assertAppliedMigrations(database, migrations);
}

export function initializeMigrationBaseline(
  database: DatabaseSync,
  baseline: SqlMigration,
  options: { freshBootstrapVerified?: boolean; existingSchemaVerified?: boolean }
): void {
  validateMigrationDefinitions([baseline]);
  if (!options.freshBootstrapVerified && !options.existingSchemaVerified) {
    throw new Error("[migration] refusing baseline initialization without verified fresh or existing schema state");
  }
  if (!baseline.bootstrapBaseline) {
    throw new Error("[migration] baseline initialization requires a bootstrap-baseline definition");
  }
  if (hasLedger(database)) {
    throw new Error("[migration] refusing to initialize a baseline over an existing migration ledger");
  }

  const currentVersion = getUserVersion(database);
  if (currentVersion !== 0 && currentVersion !== baseline.version) {
    throw new Error(`[migration] cannot initialize baseline version ${baseline.version} over user_version ${currentVersion}`);
  }

  database.transaction(() => {
    database.exec(migrationLedgerSql);
    database.prepare(
      `INSERT INTO ${MIGRATION_LEDGER_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`
    ).run(baseline.version, baseline.name, migrationChecksum(baseline), new Date().toISOString());
    database.exec(`PRAGMA user_version = ${baseline.version}`);
  })();
}

export function runMigrations(
  database: DatabaseSync,
  migrations: readonly SqlMigration[]
): number {
  validateMigrationDefinitions(migrations);

  let latestAppliedVersion = hasLedger(database)
    ? assertAppliedMigrations(database, migrations)
    : 0;

  if (!hasLedger(database)) {
    const userVersion = getUserVersion(database);
    const schemaObjectCount = Number((database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
    ).get() as { count: number }).count);
    if (userVersion !== 0 || schemaObjectCount > 0) {
      throw new Error("[migration] refusing to create a migration ledger for an existing unverified database");
    }
  }

  for (const migration of migrations) {
    if (migration.version <= latestAppliedVersion) {
      continue;
    }
    if (migration.version !== latestAppliedVersion + 1) {
      throw new Error(`[migration] cannot apply version ${migration.version} after version ${latestAppliedVersion}`);
    }
    if (migration.bootstrapBaseline) {
      throw new Error("[migration] version 1 must be initialized by the verified fresh-bootstrap path");
    }

    database.transaction(() => {
      if (!hasLedger(database)) {
        database.exec(migrationLedgerSql);
      }
      database.exec(migration.sql);
      database.prepare(
        `INSERT INTO ${MIGRATION_LEDGER_TABLE} (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`
      ).run(migration.version, migration.name, migrationChecksum(migration), new Date().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version}`);
    })();
    latestAppliedVersion = migration.version;
  }

  return latestAppliedVersion;
}
