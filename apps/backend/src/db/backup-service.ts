import fs from "node:fs";
import path from "node:path";

import { getDatabase } from "./connection.js";
import { env, runtimeConfig } from "../config/env.js";

let running = false;

function formatTimestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

async function createBackupOnce() {
  if (running) return;
  running = true;
  try {
    const db = getDatabase();
    const backupDir = runtimeConfig.backupDir;
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = formatTimestamp();
    const backupPath = path.join(backupDir, `gito-${timestamp}.sqlite`);

    try {
      // Prefer VACUUM INTO for atomic consistent backup when available.
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
    } catch (err) {
      // Fallback: copy file (may be slightly inconsistent if DB is actively writing)
      try {
        fs.copyFileSync(env.absoluteDatabasePath, backupPath);
      } catch (copyErr) {
        console.error("[backup] failed to create backup via copy:", copyErr);
      }
    }

    // enforce retention
    try {
      const files = fs.readdirSync(backupDir)
        .filter((f) => f.endsWith(".sqlite"))
        .map((f) => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      const max = Number.isFinite(runtimeConfig.maxBackups) ? runtimeConfig.maxBackups : 10;
      if (files.length > max) {
        const toDelete = files.slice(max);
        for (const f of toDelete) {
          try {
            fs.unlinkSync(f.path);
          } catch (e) {
            console.error("[backup] failed to remove old backup", f.path, e);
          }
        }
      }
    } catch (cleanupErr) {
      console.error("[backup] cleanup failed", cleanupErr);
    }
  } catch (error) {
    console.error("[backup] unexpected error", error);
  } finally {
    running = false;
  }
}

export function startBackupService() {
  // Do not block startup. Run once and schedule interval.
  setImmediate(() => void createBackupOnce());
  setInterval(() => void createBackupOnce(), runtimeConfig.backupIntervalMs);
}

export async function createOnDemandBackup() {
  return createBackupOnce();
}
