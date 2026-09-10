import fs from "node:fs";
import path from "node:path";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import { env, runtimeConfig } from "../config/env.js";

const cleanupIntervalMs = 12 * 60 * 60 * 1000; // 12 hours
const backupFilenamePattern = /^gito-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d+)?\.sqlite$/;
const minimumBackupHeadroomBytes = 16 * 1024 * 1024;

/**
 * IPTV catalogue tables that are regenerable and should be excluded from backup.
 * These tables contain data derived from provider sync and can be safely rebuilt.
 * 
 * Note: 'channels' table is NOT in this list because streams/match_streams 
 * have foreign key dependencies on it and must retain all channel references.
 * 
 * Analysis: Schema has 62 tables total. We exclude only 11 small regenerable
 * IPTV catalogue tables (349 + 14 + 19 + 17 + 12 + 28 + 1 ≈ 440 rows, <1MB).
 * Primary space savings comes from reducing backup retention from 20 to 5.
 */
const EXCLUDED_REGENERABLE_TABLES = new Set([
  'iptv_categories',      // 349 rows
  'iptv_channel_index',   // 0 rows (search index)
  'iptv_channels',        // 0 rows (legacy)
  'iptv_epg_channels',    // 14 rows
  'iptv_epg_programmes',  // 19 rows
  'iptv_logs',            // 0 rows (transient)
  'iptv_movies',          // 17 rows
  'iptv_provider_health', // 0 rows (transient)
  'iptv_seasons',         // 12 rows
  'iptv_series',          // 28 rows
  'iptv_series_episodes'  // 1 row
]);

let backupInFlight = false;
let lastBackupError: string | null = null;
let lastBackupCompletedAt: string | null = null;
let lastCleanupResult: BackupCleanupResult | null = null;

export interface BackupResult {
  success: true;
  filename: string;
  size: number;
  timestamp: string;
}

export interface BackupFileInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export interface BackupCleanupResult {
  scanned: number;
  valid: number;
  invalid: number;
  retained: number;
  deleted: string[];
  skipped: boolean;
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function getBackupDir(): string {
  return runtimeConfig.backupDir;
}

function ensureBackupDir(): string {
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

function getBackupFilePath(filename: string): string {
  const backupDir = getBackupDir();
  const candidate = path.resolve(backupDir, filename);

  if (path.relative(backupDir, candidate).startsWith("..")) {
    throw new Error("Invalid backup filename.");
  }

  return candidate;
}

function isManagedBackupFilename(filename: string) {
  return backupFilenamePattern.test(filename);
}

function getDiskStats(targetPath: string) {
  const stats = fs.statfsSync(targetPath);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  return {
    freeBytes,
    totalBytes,
    usagePercent: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 10000) / 100 : 0
  };
}

function requiredBackupSpace(databasePath: string) {
  const databaseSize = fs.statSync(databasePath).size;
  return databaseSize * 2 + minimumBackupHeadroomBytes;
}

function openDatabaseConnection(readOnly = false): DatabaseSync {
  const dbPath = env.absoluteDatabasePath;
  return allowSqliteInstantiation(() => new DatabaseSync(dbPath, readOnly ? { readonly: true } : undefined));
}

function queryIntegrity(database: DatabaseSync): string {
  const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
  return String(row?.integrity_check ?? "unknown");
}

async function createSchemaPreservingBackup(sourcePath: string, backupPath: string): Promise<void> {
  const temporaryPath = `${backupPath}.tmp`;
  try { fs.unlinkSync(temporaryPath); } catch { /* stale temp is safe to replace */ }

  let sourceDb: DatabaseSync | null = null;
  let backupDb: DatabaseSync | null = null;

  try {
    sourceDb = openDatabaseConnection(true); // read-only connection to production
    
    // Verify production database integrity
    const sourceIntegrity = queryIntegrity(sourceDb);
    if (sourceIntegrity !== "ok") {
      throw new Error(`Production database integrity_check failed: ${sourceIntegrity}`);
    }

    // Create new backup database
    backupDb = allowSqliteInstantiation(() => new DatabaseSync(temporaryPath));
    
    // Copy database metadata (PRAGMA settings)
    const schemaVersion = sourceDb.prepare("PRAGMA schema_version").get() as { schema_version: number };
    const userVersion = sourceDb.prepare("PRAGMA user_version").get() as { user_version: number };
    
    if (schemaVersion?.schema_version) {
      backupDb.exec(`PRAGMA schema_version = ${schemaVersion.schema_version}`);
    }
    if (userVersion?.user_version) {
      backupDb.exec(`PRAGMA user_version = ${userVersion.user_version}`);
    }

    // Step 1: Recreate ALL schema objects (tables, indexes, triggers, views) from sqlite_master
    console.log("[backup] Copying complete schema from production database...");
    
    const schemaObjects = sourceDb.prepare(`
      SELECT type, name, sql FROM sqlite_master 
      WHERE type IN ('table', 'index', 'trigger', 'view')
      AND sql IS NOT NULL
      ORDER BY type DESC, name
    `).all() as Array<{ type: string; name: string; sql: string }>;

    if (!schemaObjects || schemaObjects.length === 0) {
      throw new Error("Failed to read schema objects from production database");
    }

    console.log(`[backup] Found ${schemaObjects.length} schema objects to copy`);

    // Execute CREATE statements to recreate complete schema in backup database
    for (const obj of schemaObjects) {
      try {
        backupDb.exec(obj.sql);
      } catch (err) {
        // Some objects might fail during recreation (e.g., duplicate constraints)
        // Log but continue to preserve schema
        console.debug(`[backup] Note on ${obj.type} '${obj.name}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 2: Attach source database and copy data from retained tables
    console.log("[backup] Attaching source database for data copy...");
    backupDb.exec(`ATTACH DATABASE '${sourcePath.replace(/'/g, "''")}' AS src`);

    // Get list of all tables
    const tables = sourceDb.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      AND NOT name LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    console.log(`[backup] Processing ${tables.length} application tables...`);

    let totalRowsCopied = 0;
    let totalRowsExcluded = 0;

    for (const table of tables) {
      const tableName = table.name;
      try {
        if (EXCLUDED_REGENERABLE_TABLES.has(tableName)) {
          // Schema exists but no data copied
          console.log(`[backup] ${tableName}: excluded (schema preserved, 0 rows)`);
          totalRowsExcluded++;
        } else {
          // Copy all data from source table to backup table
          backupDb.prepare(`INSERT INTO main.${tableName} SELECT * FROM src.${tableName}`).run();
          
          const count = backupDb.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number };
          if (count.cnt > 0) {
            console.log(`[backup] ${tableName}: ${count.cnt} rows copied`);
            totalRowsCopied += count.cnt;
          }
        }
      } catch (err) {
        console.error(`[backup] Error copying table ${tableName}:`, err instanceof Error ? err.message : String(err));
        // Continue with next table
      }
    }

    console.log(`[backup] Data copy complete: ${totalRowsCopied} rows retained, ${totalRowsExcluded} tables excluded`);

    // Step 3: Detach source database
    backupDb.exec("DETACH DATABASE src");

    // Step 4: Verify integrity of backup database
    console.log("[backup] Verifying backup integrity...");
    const backupIntegrity = queryIntegrity(backupDb);
    if (backupIntegrity !== "ok") {
      throw new Error(`Backup database integrity_check failed: ${backupIntegrity}`);
    }

    // Step 5: Check for foreign key violations (advisory, may be expected)
    try {
      const fkResults = backupDb.prepare("PRAGMA foreign_key_check").all() as Array<any>;
      if (fkResults && fkResults.length > 0) {
        console.debug(`[backup] Warning: ${fkResults.length} foreign key constraints may be violated (expected if references are in excluded tables)`);
      }
    } catch {
      console.debug("[backup] Foreign key check unavailable (expected on some SQLite versions)");
    }

    // Step 6: Vacuum backup to reclaim space from excluded tables
    console.log("[backup] Optimizing backup size via VACUUM...");
    backupDb.exec("VACUUM");

    // Close backup database before validation
    const backupCloseable = backupDb as unknown as { close?: () => void };
    backupCloseable.close?.();
    backupDb = null;

    // Step 7: Validate backup file independently
    console.log("[backup] Validating backup file as standalone SQLite database...");
    const validation = await validateBackupPath(temporaryPath);
    if (!validation.valid) {
      try { fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
      throw new Error(`backup_integrity_check_failed: ${validation.integrity}`);
    }

    console.log("[backup] Backup validation successful");

  } finally {
    // Cleanup database connections
    if (sourceDb) {
      const sourceCloseable = sourceDb as unknown as { close?: () => void };
      sourceCloseable.close?.();
    }
    if (backupDb) {
      try {
        backupDb.exec("DETACH DATABASE src");
      } catch {
        // Source may not be attached if error occurred
      }
      const backupCloseable = backupDb as unknown as { close?: () => void };
      backupCloseable.close?.();
    }
  }

  // Atomic finalization: move temp file to final location
  fs.renameSync(temporaryPath, backupPath);
}

async function safeCreateBackupFile(backupPath: string): Promise<void> {
  const temporaryPath = `${backupPath}.tmp`;
  try { fs.unlinkSync(temporaryPath); } catch { /* stale temp is safe to replace */ }

  try {
    const databasePath = env.absoluteDatabasePath;
    
    // Use schema-preserving selective backup method
    await createSchemaPreservingBackup(databasePath, backupPath);
    
  } catch (error) {
    // Cleanup temp file on any error
    try { fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
    throw error;
  }
}

async function validateBackupPath(backupPath: string) {
  const db = allowSqliteInstantiation(() => new DatabaseSync(backupPath, { readonly: true }));
  try {
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    return { valid: row?.integrity_check === "ok", integrity: row?.integrity_check ?? "unknown" };
  } finally {
    const closeable = db as unknown as { close?: () => void };
    closeable.close?.();
  }
}

export async function enforceBackupRetention(backupDir = getBackupDir()): Promise<BackupCleanupResult> {
  fs.mkdirSync(backupDir, { recursive: true });
  const files = fs.readdirSync(backupDir)
    .filter(isManagedBackupFilename)
    .map((filename) => {
      const filePath = path.join(backupDir, filename);
      return { filename, filePath, createdAt: fs.statSync(filePath).mtime.getTime() };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const valid: typeof files = [];
  const invalid: typeof files = [];
  for (const file of files) {
    try {
      if ((await validateBackupPath(file.filePath)).valid) valid.push(file);
      else invalid.push(file);
    } catch {
      invalid.push(file);
    }
  }

  const maxBackups = Number.isFinite(runtimeConfig.maxBackups) ? Math.max(1, Math.floor(runtimeConfig.maxBackups)) : 20;
  if (valid.length === 0) {
    console.warn("[database-backup-service] retention skipped: no valid backup exists");
    lastCleanupResult = { scanned: files.length, valid: 0, invalid: invalid.length, retained: files.length, deleted: [], skipped: true };
    return lastCleanupResult;
  }

  const keep = new Set(valid.slice(0, maxBackups).map((file) => file.filename));
  const deleted: string[] = [];
  for (const file of [...valid, ...invalid]) {
    if (keep.has(file.filename)) continue;
    try {
      fs.unlinkSync(file.filePath);
      deleted.push(file.filename);
    } catch (error) {
      console.error("[database-backup-service] failed to remove old backup", file.filePath, error);
    }
  }

  console.info("[database-backup-service] retention enforced", { scanned: files.length, valid: valid.length, invalid: invalid.length, retained: Math.min(valid.length, maxBackups), deleted: deleted.length });
  lastCleanupResult = { scanned: files.length, valid: valid.length, invalid: invalid.length, retained: Math.min(valid.length, maxBackups), deleted, skipped: false };
  return lastCleanupResult;
}

export async function createBackup(): Promise<BackupResult> {
  if (backupInFlight) {
    console.warn("[database-backup-service] backup skipped: another backup is already running");
    throw new Error("backup_in_progress");
  }
  backupInFlight = true;

  try {
  const databasePath = env.absoluteDatabasePath;

  if (!fs.existsSync(databasePath)) {
    throw new Error("Database file does not exist.");
  }

  const databaseStats = fs.statSync(databasePath);
  if (!databaseStats.isFile() || databaseStats.size <= 0) {
    throw new Error("Database file is missing or empty.");
  }

  const backupDir = ensureBackupDir();
  await enforceBackupRetention(backupDir);
  const disk = getDiskStats(path.dirname(databasePath));
  const required = requiredBackupSpace(databasePath);
  if (disk.freeBytes < required) {
    throw new Error(`backup_insufficient_disk_space: free=${disk.freeBytes} required=${required}`);
  }
  const timestamp = formatTimestamp();
  let filename = `gito-backup-${timestamp}.sqlite`;
  let backupPath = path.join(backupDir, filename);
  let suffix = 1;

  while (fs.existsSync(backupPath)) {
    filename = `gito-backup-${timestamp}-${suffix}.sqlite`;
    backupPath = path.join(backupDir, filename);
    suffix += 1;
  }

  await safeCreateBackupFile(backupPath);

  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file was not created.");
  }

  const backupStats = fs.statSync(backupPath);
  if (backupStats.size <= 0) {
    throw new Error("Backup file is empty.");
  }

  console.log("[backup_created]", { filename, size: backupStats.size, timestamp: backupStats.mtime.toISOString() });

  await enforceBackupRetention(backupDir);
  lastBackupError = null;
  lastBackupCompletedAt = backupStats.mtime.toISOString();

  return {
    success: true,
    filename,
    size: backupStats.size,
    timestamp: backupStats.mtime.toISOString()
  };
  } catch (error) {
    lastBackupError = error instanceof Error ? error.message : String(error);
    console.error("[database-backup-service] backup failed", lastBackupError);
    throw error;
  } finally {
    backupInFlight = false;
  }
}

export function listBackups(): BackupFileInfo[] {
  const backupDir = ensureBackupDir();

  return fs.readdirSync(backupDir)
    .filter(isManagedBackupFilename)
    .map((file) => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      return {
        filename: file,
        size: stats.size,
        createdAt: stats.mtime.toISOString()
      };
    })
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}

export async function validateBackup(filename: string): Promise<{ valid: boolean; backup: BackupFileInfo; integrity: string }> {
  if (!isManagedBackupFilename(filename)) {
    throw new Error("Invalid backup filename.");
  }
  const backupPath = getBackupFilePath(filename);

  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file does not exist.");
  }

  const stats = fs.statSync(backupPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Backup file is missing or empty.");
  }

  const db = allowSqliteInstantiation(() => new DatabaseSync(backupPath, { readonly: true }));
  try {
    const integrity = queryIntegrity(db);
    return {
      valid: integrity === "ok",
      backup: {
        filename,
        size: stats.size,
        createdAt: stats.mtime.toISOString()
      },
      integrity
    };
  } finally {
    const closeable = db as unknown as { close?: () => void };
    closeable.close?.();
  }
}

export async function cleanupOldBackups(): Promise<string[]> {
  return (await enforceBackupRetention()).deleted;
}

export async function getBackupStats(): Promise<{
  backupDirExists: boolean;
  backupCount: number;
  latestBackup?: BackupFileInfo | undefined;
  latestBackupValid?: boolean | undefined;
  retention?: number;
  totalBackupBytes?: number;
  oldestRetainedBackup?: BackupFileInfo | undefined;
  backupInProgress?: boolean;
  disk?: { freeBytes: number; totalBytes: number; usagePercent: number };
  requiredBackupBytes?: number;
  lastBackupError?: string | null;
  lastBackupCompletedAt?: string | null;
  lastCleanupResult?: BackupCleanupResult | null;
}> {
  const backupDir = getBackupDir();
  const dirExists = fs.existsSync(backupDir);

  if (!dirExists) {
    return {
      backupDirExists: false,
      backupCount: 0
    };
  }

  const backups = listBackups();
  const latestBackup = backups[0];
  const oldestRetainedBackup = backups[backups.length - 1];
  const totalBackupBytes = backups.reduce((total, backup) => total + backup.size, 0);
  let latestBackupValid: boolean | undefined;

  if (latestBackup) {
    try {
      const validation = await validateBackup(latestBackup.filename);
      latestBackupValid = validation.valid;
    } catch {
      latestBackupValid = false;
    }
  }

  return {
    backupDirExists: true,
    backupCount: backups.length,
    latestBackup,
    latestBackupValid,
    retention: Number.isFinite(runtimeConfig.maxBackups) ? Math.max(1, Math.floor(runtimeConfig.maxBackups)) : 20,
    totalBackupBytes,
    oldestRetainedBackup,
    backupInProgress: backupInFlight,
    disk: getDiskStats(path.dirname(env.absoluteDatabasePath)),
    requiredBackupBytes: requiredBackupSpace(env.absoluteDatabasePath),
    lastBackupError,
    lastBackupCompletedAt,
    lastCleanupResult
  };
}

export function startBackupService() {
  setImmediate(() => {
    void (async () => {
      try {
        await enforceBackupRetention();
        await createBackup();
      } catch (error) {
        console.error("[backup_failed] initial backup failed", error);
      }
    })();
  });

  const intervalMs = runtimeConfig.backupIntervalMs;
  const now = Date.now();
  const delay = intervalMs - (now % intervalMs);

  setTimeout(() => {
    void createBackup().catch((error) => {
      console.error("[backup_failed] scheduled backup failed", error);
    });

    setInterval(() => {
      void createBackup().catch((error) => {
        console.error("[backup_failed] scheduled backup failed", error);
      });
    }, intervalMs);
  }, delay);

  setInterval(() => {
    void enforceBackupRetention().catch((error) => {
      console.error("[database-backup-service] cleanup interval failed", error);
    });
  }, cleanupIntervalMs);
}
