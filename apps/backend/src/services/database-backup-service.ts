import fs from "node:fs";
import path from "node:path";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import { env, runtimeConfig } from "../config/env.js";

const cleanupIntervalMs = 12 * 60 * 60 * 1000; // 12 hours
const backupFilenamePattern = /^gito-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d+)?\.sqlite$/;
const minimumBackupHeadroomBytes = 16 * 1024 * 1024;
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

async function safeCreateBackupFile(backupPath: string): Promise<void> {
  const temporaryPath = `${backupPath}.tmp`;
  try { fs.unlinkSync(temporaryPath); } catch { /* stale temp is safe to replace */ }

  const db = openDatabaseConnection(false);
  try {
    const integrity = queryIntegrity(db);
    if (integrity !== "ok") {
      throw new Error(`Database integrity_check failed: ${integrity}`);
    }

    try {
      db.exec(`VACUUM INTO '${temporaryPath.replace(/'/g, "''")}'`);
    } catch (primaryError) {
      console.error("[database-backup-service] VACUUM INTO failed, falling back to file copy", primaryError);
      fs.copyFileSync(env.absoluteDatabasePath, temporaryPath);
    }
  } finally {
    const closeable = db as unknown as { close?: () => void };
    closeable.close?.();
  }

  const validation = await validateBackupPath(temporaryPath);
  if (!validation.valid) {
    try { fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
    throw new Error("backup_integrity_check_failed");
  }
  fs.renameSync(temporaryPath, backupPath);
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
