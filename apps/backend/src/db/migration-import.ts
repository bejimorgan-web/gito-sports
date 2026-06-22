import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "./sqlite.js";

export const IMPORT_ORDER = [
  "regions",
  "sports",
  "countries",
  "sport_countries",
  "providers",
  "channels",
  "competitions",
  "seasons",
  "teams",
  "competition_teams",
  "matches",
  "scheduling_matches",
  "match_streams",
  "streams",
  "operator_users",
  "operator_settings",
  "auth_sessions",
  "entity_catalog_mapping",
  "sport_host_links",
  "sport_competition_links",
  "sport_club_links",
  "sport_national_team_links",
  "competition_club_links",
  "competition_national_team_links",
  "host_competition_links",
];

const MIGRATION_META_TABLE = "migration_meta";
const DEFAULT_MIGRATION_ID = "initial_import";

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, "\"" )}"`;
}

function getTableColumns(db: DatabaseSync, tableName: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function createMigrationMetaTable(database: DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(MIGRATION_META_TABLE)} (
    id TEXT PRIMARY KEY,
    migration_version TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );`);
}

function getMigrationMeta(database: DatabaseSync) {
  if (!getTableColumns(database, MIGRATION_META_TABLE).size) {
    return null;
  }

  return database
    .prepare(`SELECT id, migration_version, imported_at FROM ${quoteIdent(MIGRATION_META_TABLE)} WHERE id = ?`)
    .get(DEFAULT_MIGRATION_ID) as { id: string; migration_version: string; imported_at: string } | null;
}

export function isMigrationImported(database: DatabaseSync): boolean {
  return Boolean(getMigrationMeta(database)?.id === DEFAULT_MIGRATION_ID);
}

export function getMigrationMetadata(database: DatabaseSync) {
  return getMigrationMeta(database);
}

export function markMigrationImported(database: DatabaseSync, migrationVersion: string) {
  createMigrationMetaTable(database);
  const now = new Date().toISOString();

  database
    .prepare(`INSERT OR REPLACE INTO ${quoteIdent(MIGRATION_META_TABLE)} (id, migration_version, imported_at) VALUES (?, ?, ?)`)
    .run(DEFAULT_MIGRATION_ID, migrationVersion, now);
}

export function getMigrationVersionFromFile(filePath: string) {
  const contents = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function describeFkViolations(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => {
    const table = String(row.table ?? "unknown");
    const rowid = String(row.rowid ?? "unknown");
    const parent = String(row.parent ?? "unknown");
    const fkid = String(row.fkid ?? "unknown");
    return `FK violation in ${table} rowid ${rowid}: parent=${parent} fkid=${fkid}`;
  });
}

function getCount(database: DatabaseSync, table: string) {
  const row = database.prepare(`SELECT COUNT(1) AS count FROM ${quoteIdent(table)}`).get() as { count: number };
  return Number(row?.count ?? 0);
}

function normalizeMigrationPayload(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Migration payload must be an object.");
  }

  const payload = raw as Record<string, any>;
  if (payload.tables && typeof payload.tables === "object" && !Array.isArray(payload.tables)) {
    return payload.tables;
  }

  return payload;
}

export interface MigrationImportResult {
  imported: number;
  totalRows: number;
  warnings: string[];
  errors: string[];
  alreadyImported?: boolean;
  tableStats: Record<string, { expected: number; imported: number; skipped: number; missingColumns: string[] }>;
}

export function importMigrationPayload(database: DatabaseSync, raw: unknown): MigrationImportResult {
  const tables = normalizeMigrationPayload(raw);
  const validTables = new Set(IMPORT_ORDER);
  const errors: string[] = [];
  const warnings: string[] = [];
  let imported = 0;
  let totalRows = 0;
  const tableStats: Record<string, { expected: number; imported: number; skipped: number; missingColumns: string[] }> = {};

  const existingOperatorEmails = new Set<string>();
  const existingOperatorIds = new Set<string>();
  if (getTableColumns(database, "operator_users").size > 0) {
    const operators = database.prepare("SELECT id, email FROM operator_users").all() as Array<{ id: string; email: string }>;
    for (const operator of operators) {
      if (operator.id) existingOperatorIds.add(operator.id);
      if (operator.email) existingOperatorEmails.add(operator.email.toLowerCase());
    }
  }

  const importSequence = IMPORT_ORDER.filter((tableName) => Object.prototype.hasOwnProperty.call(tables, tableName));

  try {
    database.exec("PRAGMA foreign_keys = OFF;");
    database.exec("BEGIN TRANSACTION;");

    for (const tableName of importSequence) {
      if (!validTables.has(tableName)) {
        warnings.push(`Skipped invalid table: ${tableName}`);
        continue;
      }

      const rows = tables[tableName] || [];
      if (!Array.isArray(rows) || rows.length === 0) {
        tableStats[tableName] = { expected: 0, imported: 0, skipped: 0, missingColumns: [] };
        continue;
      }

      const tableColumns = getTableColumns(database, tableName);
      if (tableColumns.size === 0) {
        errors.push(`Table ${tableName}: destination table not found or has no columns`);
        tableStats[tableName] = { expected: rows.length, imported: 0, skipped: rows.length, missingColumns: [] };
        continue;
      }

      const stats = { expected: rows.length, imported: 0, skipped: 0, missingColumns: new Set<string>() };
      totalRows += rows.length;

      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          errors.push(`Invalid row data for table ${tableName}`);
          stats.skipped++;
          continue;
        }

        const rowColumns = Object.keys(row);
        const insertColumns = rowColumns.filter((column) => tableColumns.has(column));

        rowColumns.forEach((column) => {
          if (!tableColumns.has(column)) {
            stats.missingColumns.add(column);
          }
        });

        if (insertColumns.length === 0) {
          errors.push(`Table ${tableName}: skipped row with no valid columns (${JSON.stringify(rowColumns.slice(0, 5))})`);
          stats.skipped++;
          continue;
        }

        if (tableName === "operator_users") {
          const email = typeof row.email === "string" ? row.email.toLowerCase() : "";
          const id = typeof row.id === "string" ? row.id : "";
          if ((id && existingOperatorIds.has(id)) || (email && existingOperatorEmails.has(email))) {
            stats.skipped++;
            continue;
          }
        }

        try {
          const placeholders = insertColumns.map(() => "?").join(",");
          const quotedColumns = insertColumns.map(quoteIdent).join(",");
          const values = insertColumns.map((col) => row[col]);
          const quotedTable = quoteIdent(tableName);

          const stmt = database.prepare(`INSERT OR REPLACE INTO ${quotedTable} (${quotedColumns}) VALUES (${placeholders})`);
          stmt.run(...values);
          imported++;
          stats.imported++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Table ${tableName}: ${message}`);
          stats.skipped++;
        }
      }

      tableStats[tableName] = {
        expected: stats.expected,
        imported: stats.imported,
        skipped: stats.skipped,
        missingColumns: Array.from(stats.missingColumns),
      };

      if (stats.missingColumns.size > 0) {
        warnings.push(`Table ${tableName}: export has columns not in schema: ${Array.from(stats.missingColumns).join(", ")}`);
      }
    }

    database.exec("COMMIT;");
    database.exec("PRAGMA foreign_keys = ON;");

    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
    if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
      const fkErrors = describeFkViolations(foreignKeyViolations);
      errors.push(...fkErrors);
    }
  } catch (err) {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // ignore rollback failure
    }
    database.exec("PRAGMA foreign_keys = ON;");
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Import failed: ${message}`);
  }

  return {
    imported,
    totalRows,
    warnings,
    errors,
    tableStats,
  };
}

export function importMigrationFile(database: DatabaseSync, filePath: string): MigrationImportResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Migration export file not found: ${filePath}`);
  }

  const migrationVersion = getMigrationVersionFromFile(filePath);
  const existingMigration = getMigrationMeta(database);
  if (existingMigration) {
    return {
      imported: 0,
      totalRows: 0,
      warnings: [`Migration already imported at ${existingMigration.imported_at}`],
      errors: [],
      alreadyImported: true,
      tableStats: {},
    };
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const result = importMigrationPayload(database, raw);

  if (result.errors.length === 0) {
    markMigrationImported(database, migrationVersion);
  }

  return result;
}

export function isDatabaseCatalogEmpty(database: DatabaseSync): boolean {
  return (
    getCount(database, "sports") === 0 &&
    getCount(database, "providers") === 0 &&
    getCount(database, "channels") === 0 &&
    getCount(database, "matches") === 0 &&
    getCount(database, "streams") === 0
  );
}
