import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultDevelopmentJwtSecret = "gito-local-development-secret";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

dotenv.config({ path: path.join(workspaceRoot, ".env") });

const nodeEnv = process.env.NODE_ENV ?? "development";
const port = Number(process.env.PORT ?? 4100);

const canonicalDatabasePath = path.resolve(workspaceRoot, "data", "gito.sqlite");

// For Render compatibility prefer explicit DATABASE_PATH or the platform writable
// directory `/tmp/gito.sqlite`. Fall back to workspace `data/gito.sqlite` for
// local development when DATABASE_PATH is not provided.
const resolvedDatabasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : process.env.NODE_ENV === "production"
  ? "/tmp/gito.sqlite"
  : canonicalDatabasePath;

const databasePath = resolvedDatabasePath;
const jwtSecret = process.env.JWT_SECRET ?? defaultDevelopmentJwtSecret;
const footballDataApiKey = process.env.FOOTBALL_DATA_API_KEY ?? "";
const footballDataBaseUrl =
  process.env.FOOTBALL_DATA_BASE_URL ?? "https://api.football-data.org/v4";
const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? null;
const adminPassword = process.env.ADMIN_PASSWORD ?? null;
const adminBootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN ?? null;
// Determine migration import file path:
// 1. If explicitly set via env var, use that
// 2. In production (dist), look for migration-export.json in dist/migration-export.json
// 3. In development, look for it in workspace root
const normalizedMigrationImportFile = process.env.MIGRATION_IMPORT_FILE
  ? path.resolve(process.env.MIGRATION_IMPORT_FILE)
  : (() => {
      // Try dist first (for production builds)
      const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migration-export.json");
      if (fs.existsSync(distPath)) {
        return distPath;
      }
      // Fall back to workspace root (for development)
      return path.join(workspaceRoot, "migration-export.json");
    })();
const autoImportMigration = (process.env.AUTO_IMPORT_MIGRATION ?? "false").toLowerCase() === "true";
const migrationImportToken = process.env.MIGRATION_IMPORT_TOKEN ?? null;

if (process.env.DATABASE_PATH && !path.isAbsolute(process.env.DATABASE_PATH)) {
  throw new Error(
    "[phase9-lockdown] DATABASE_PATH override must be absolute. Relative paths are not allowed."
  );
}

const absoluteDatabasePath = databasePath;

// Read-only mode (useful for Render safe scaling): if set, the server will
// open the sqlite DB in read-only mode and avoid writes that mutate schema.
const dbReadOnlyMode = (process.env.DB_READONLY_MODE ?? "false").toLowerCase() === "true";

// Backup configuration
const maxBackups = Number(process.env.MAX_BACKUPS ?? 20);
const maxAgeDays = Number(process.env.MAX_AGE_DAYS ?? 7);
const backupDir = process.env.BACKUP_DIR ?? "/tmp/backups";
const backupIntervalMs = Number(process.env.BACKUP_INTERVAL_MS ?? 15 * 60 * 1000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

if (!databasePath.trim()) {
  throw new Error("DATABASE_PATH must not be empty.");
}

if (nodeEnv === "production" && jwtSecret === defaultDevelopmentJwtSecret) {
  throw new Error("JWT_SECRET must be set to a deployment-specific secret in production.");
}

if (jwtSecret.length < 24) {
  throw new Error("JWT_SECRET must be at least 24 characters long.");
}

console.log(`FOOTBALL_DATA_API_KEY configured = ${Boolean(footballDataApiKey.trim())}`);
console.log(`FOOTBALL_DATA_BASE_URL configured = ${Boolean(footballDataBaseUrl.trim())}`);

export const env = {
  port,
  databasePath,
  absoluteDatabasePath,
  jwtSecret,
  footballDataApiKey,
  footballDataBaseUrl,
  adminEmail,
  adminPassword,
  adminBootstrapToken,
  migrationImportFile: normalizedMigrationImportFile,
  migrationImportToken,
} as const;

export const runtimeConfig = {
  dbReadOnlyMode,
  maxBackups,
  maxAgeDays,
  backupDir,
  backupIntervalMs,
  autoImportMigration,
};
