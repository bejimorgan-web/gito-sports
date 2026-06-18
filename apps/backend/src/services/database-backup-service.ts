import fs from "node:fs";
import path from "node:path";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite";
import { env, runtimeConfig } from "../config/env";

const cleanupIntervalMs = 12 * 60 * 60 * 1000; // 12 hours

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

function openDatabaseConnection(readOnly = false): DatabaseSync {
  const dbPath = env.absoluteDatabasePath;
  const openPath = readOnly ? `file:${dbPath}?mode=ro` : dbPath;
  return allowSqliteInstantiation(() => new DatabaseSync(openPath));
}

function queryIntegrity(database: DatabaseSync): string {
  const row = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
  return String(row?.integrity_check ?? "unknown");
}

async function safeCreateBackupFile(backupPath: string): Promise<void> {
  const db = openDatabaseConnection(false);
  try {
    const integrity = queryIntegrity(db);
    if (integrity !== "ok") {
      throw new Error(`Database integrity_check failed: ${integrity}`);
    }

    try {
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    } catch (primaryError) {
      console.error("[database-backup-service] VACUUM INTO failed, falling back to file copy", primaryError);
      fs.copyFileSync(env.absoluteDatabasePath, backupPath);
    }
  } finally {
    const closeable = db as unknown as { close?: () => void };
    closeable.close?.();
  }
}

export async function createBackup(): Promise<BackupResult> {
  const databasePath = env.absoluteDatabasePath;

  if (!fs.existsSync(databasePath)) {
    throw new Error("Database file does not exist.");
  }

  const databaseStats = fs.statSync(databasePath);
  if (!databaseStats.isFile() || databaseStats.size <= 0) {
    throw new Error("Database file is missing or empty.");
  }

  const backupDir = ensureBackupDir();
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

  return {
    success: true,
    filename,
    size: backupStats.size,
    timestamp: backupStats.mtime.toISOString()
  };
}

export function listBackups(): BackupFileInfo[] {
  const backupDir = ensureBackupDir();

  return fs.readdirSync(backupDir)
    .filter((file) => file.endsWith(".sqlite"))
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
  const backupPath = getBackupFilePath(filename);

  if (!fs.existsSync(backupPath)) {
    throw new Error("Backup file does not exist.");
  }

  const stats = fs.statSync(backupPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error("Backup file is missing or empty.");
  }

  const db = allowSqliteInstantiation(() => new DatabaseSync(`file:${backupPath}?mode=ro`));
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

export function cleanupOldBackups(): string[] {
  const backups = listBackups();
  if (backups.length === 0) {
    return [];
  }

  const deleted: string[] = [];
  const latestBackup = backups[0]!;
  const now = Date.now();
  const maxAgeMs = runtimeConfig.maxAgeDays * 24 * 60 * 60 * 1000;
  const maxBackups = Number.isFinite(runtimeConfig.maxBackups) ? runtimeConfig.maxBackups : 20;

  const candidates = backups.filter((backup) => backup.filename !== latestBackup.filename);
  const toDelete = new Set<string>();

  for (const backup of candidates) {
    if (now - Date.parse(backup.createdAt) > maxAgeMs) {
      toDelete.add(backup.filename);
    }
  }

  const remaining = backups.filter((backup) => !toDelete.has(backup.filename));
  if (remaining.length > maxBackups) {
    for (const backup of remaining.slice(maxBackups)) {
      if (backup.filename !== latestBackup.filename) {
        toDelete.add(backup.filename);
      }
    }
  }

  for (const filename of toDelete) {
    try {
      const filePath = getBackupFilePath(filename);
      fs.unlinkSync(filePath);
      console.log("[backup_deleted]", { filename });
      deleted.push(filename);
    } catch (error) {
      console.error("[database-backup-service] failed to delete old backup", filename, error);
    }
  }

  return deleted;
}

export async function getBackupStats(): Promise<{
  backupDirExists: boolean;
  backupCount: number;
  latestBackup?: BackupFileInfo | undefined;
  latestBackupValid?: boolean | undefined;
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
    latestBackupValid
  };
}

export function startBackupService() {
  setImmediate(() => {
    void createBackup().catch((error) => {
      console.error("[backup_failed] initial backup failed", error);
    });
    void cleanupOldBackups();
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
    try {
      cleanupOldBackups();
    } catch (error) {
      console.error("[database-backup-service] cleanup interval failed", error);
    }
  }, cleanupIntervalMs);
}
