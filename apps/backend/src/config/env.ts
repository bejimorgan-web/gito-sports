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
const canonicalBackupDir = path.resolve(workspaceRoot, "data", "backups");
const configuredUploadDir = process.env.UPLOAD_DIR?.trim();
const resolvedUploadDir = path.resolve(configuredUploadDir ?? path.join(workspaceRoot, "data", "uploads"));
const productionUploadRoot = path.resolve("/var/data");
if (nodeEnv === "production") {
  if (!configuredUploadDir) {
    throw new Error("UPLOAD_DIR must be explicitly configured in production; use /var/data/uploads on the mounted persistent disk.");
  }
  const uploadRelativePath = path.relative(productionUploadRoot, resolvedUploadDir);
  if (!uploadRelativePath || uploadRelativePath.startsWith("..") || path.isAbsolute(uploadRelativePath)) {
    throw new Error("UPLOAD_DIR must be a child of /var/data in production; refusing an ephemeral or unsafe upload directory.");
  }
}
fs.mkdirSync(resolvedUploadDir, { recursive: true });

// Production must use an explicit DATABASE_PATH on the Render-mounted disk.
// Local development falls back to the workspace data directory when DATABASE_PATH
// is not provided.
const configuredDatabasePath = process.env.DATABASE_PATH?.trim();
if (nodeEnv === "production" && !configuredDatabasePath) {
  throw new Error("DATABASE_PATH must be explicitly configured in production; use the mounted persistent disk path.");
}

const resolvedDatabasePath = configuredDatabasePath
  ? path.resolve(configuredDatabasePath)
  : canonicalDatabasePath;

const databasePath = resolvedDatabasePath;
const jwtSecret = process.env.JWT_SECRET ?? defaultDevelopmentJwtSecret;
const footballDataApiKey = process.env.FOOTBALL_DATA_API_KEY ?? "";
const footballDataBaseUrl =
  process.env.FOOTBALL_DATA_BASE_URL ?? "https://api.football-data.org/v4";
const apiFootballKey = process.env.API_FOOTBALL_KEY ?? "";
const apiFootballBaseUrl = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
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
const newsTestMode = (process.env.GITO_NEWS_TEST_MODE ?? "false").toLowerCase() === "true";
const migrationImportToken = process.env.MIGRATION_IMPORT_TOKEN ?? null;
const aiApiKey = process.env.AI_API_KEY ?? "";
const aiProvider = process.env.AI_PROVIDER ?? "openai-compatible";
const aiModel = process.env.AI_MODEL ?? "gpt-4o-mini";
const aiBaseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1/chat/completions";
const aiClassificationEnabled = (process.env.AI_CLASSIFICATION_ENABLED ?? "false").toLowerCase() === "true";
const aiClassificationTimeoutMs = Number(process.env.AI_CLASSIFICATION_TIMEOUT_MS ?? 10000);

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
// Changed from 20 to 5 backups (60 hours retention with 12-hour schedule)
// See BACKUP_REDESIGN_SCHEMA_ANALYSIS.md for rationale
const maxBackups = Number(process.env.MAX_BACKUPS ?? 5);
const maxAgeDays = Number(process.env.MAX_AGE_DAYS ?? 7);
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : nodeEnv === "production"
  ? path.resolve(path.dirname(resolvedDatabasePath), "backups")
  : canonicalBackupDir;
const backupIntervalMs = Number(process.env.BACKUP_INTERVAL_MS ?? 12 * 60 * 60 * 1000);
const autoRestoreBackup = (process.env.AUTO_RESTORE_BACKUP ?? "true").toLowerCase() === "true";
const errorReportingEnabled = (process.env.ERROR_REPORTING_ENABLED ?? "true").toLowerCase() === "true";
const sentryDsn = process.env.SENTRY_DSN ?? "";

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

console.log(`FOOTBALL_DATA_API_ENABLED = ${Boolean(footballDataApiKey.trim())}`);
console.log(`API_FOOTBALL_ENABLED = ${Boolean(apiFootballKey.trim())}`);
console.log(`FOOTBALL_DATA_BASE_URL configured = ${Boolean(footballDataBaseUrl.trim())}`);
console.log(`API_FOOTBALL_BASE_URL configured = ${Boolean(apiFootballBaseUrl.trim())}`);

export const env = {
  port,
  databasePath,
  absoluteDatabasePath,
  jwtSecret,
  footballDataApiKey,
  footballDataBaseUrl,
  apiFootballKey,
  apiFootballBaseUrl,
  adminEmail,
  adminPassword,
  adminBootstrapToken,
  migrationImportFile: normalizedMigrationImportFile,
  migrationImportToken,
  aiApiKey,
  aiProvider,
  aiModel,
  aiBaseUrl,
} as const;

export const runtimeConfig = {
  dbReadOnlyMode,
  maxBackups,
  maxAgeDays,
  backupDir,
  backupIntervalMs,
  uploadDir: resolvedUploadDir,
  autoRestoreBackup,
  autoImportMigration,
  newsTestMode,
  errorReportingEnabled,
  sentryDsn,
  aiClassificationEnabled,
  aiClassificationTimeoutMs: Number.isFinite(aiClassificationTimeoutMs) && aiClassificationTimeoutMs > 0 ? Math.min(aiClassificationTimeoutMs, 30000) : 10000,
};
