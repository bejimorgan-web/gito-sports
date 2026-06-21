import { Router } from "express";
import {
  createBackup,
  listBackups,
  validateBackup,
  getBackupStats
} from "../services/database-backup-service.js";
import { startupHealthCheck } from "../system/startup.js";
import fs from "node:fs";
import path from "node:path";
import { verifyAccessToken } from "../services/jwt.js";
import { env, runtimeConfig } from "../config/env.js";

export const systemRouter = Router();

systemRouter.post("/backup", async (_req, res) => {
  try {
    const backup = await createBackup();
    res.json({ success: true, backup: { filename: backup.filename, size: backup.size, createdAt: backup.timestamp } });
  } catch (error) {
    console.error("[system] manual backup failed", error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

systemRouter.get("/backups", (_req, res) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (error) {
    console.error("[system] list backups failed", error);
    res.status(500).json({ backups: [] });
  }
});

systemRouter.post("/restore/check", async (req, res) => {
  const filename = req.body?.filename ?? req.query?.filename;
  if (!filename || typeof filename !== "string") {
    res.status(400).json({ error: "filename is required" });
    return;
  }

  try {
    const validation = await validateBackup(filename);
    res.json({ valid: validation.valid, backup: validation.backup, integrity: validation.integrity });
  } catch (error) {
    console.error("[system] restore check failed", error);
    res.status(400).json({ valid: false, error: String(error) });
  }
});

systemRouter.get("/health", async (_req, res) => {
  const health = startupHealthCheck();
  const backupStats = await getBackupStats();

  const dbOk = health.db === "ok";
  const status = dbOk && health.scoreService === "ok" && health.iptvService === "ok" ? "ok" : "degraded";

  res.json({
    status,
    uptime: process.uptime(),
    db: health.db,
    iptv: health.iptvService,
    liveScores: health.scoreService,
    renderMode: process.env.DATABASE_PATH ? true : false,
    databaseBackup: {
      status:
        backupStats.backupDirExists && backupStats.backupCount > 0 && backupStats.latestBackupValid !== false
          ? "ok"
          : "warning",
      lastBackup: backupStats.latestBackup?.createdAt ?? null,
      backupCount: backupStats.backupCount
    }
  });
});

// Apply a backup to the active database file. Requires admin JWT or
// MIGRATION_IMPORT_TOKEN (Bearer token).
systemRouter.post("/restore/apply", async (req, res) => {
  const incomingAuthHeader = (req.headers.authorization ?? "").toString();
  const token = incomingAuthHeader.startsWith('Bearer ') ? incomingAuthHeader.slice('Bearer '.length) : incomingAuthHeader;
  const isMigrationToken = Boolean(process.env.MIGRATION_IMPORT_TOKEN && token === process.env.MIGRATION_IMPORT_TOKEN);

  let payload: any = null;
  if (!isMigrationToken && token) {
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      payload = null;
    }
  }

  const allowedByJwt = payload && (payload.role === 'admin' || payload.role === 'operator');
  if (!isMigrationToken && !allowedByJwt) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const filename = req.body?.filename ?? req.query?.filename;
  const force = (req.body?.force ?? req.query?.force ?? false) === true || String(req.body?.force ?? req.query?.force ?? "").toLowerCase() === "true";

  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    const validation = await validateBackup(filename);
    if (!validation.valid) {
      return res.status(400).json({ error: 'invalid_backup', details: validation });
    }

    const backupPath = path.join(runtimeConfig.backupDir, filename);
    const dbPath = env.absoluteDatabasePath;

    // If DB already exists and is non-empty, require explicit force to overwrite.
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.size > 0 && !force) {
        return res.status(400).json({ error: 'database_not_empty', message: 'Target database exists and is non-empty. Use force=true to overwrite.' });
      }
    }

    // Ensure destination dir exists
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(backupPath, dbPath);
    console.log('[system] restore applied:', filename, '->', dbPath);

    // Audit entry: success
    try {
      const auditDir = runtimeConfig.backupDir;
      fs.mkdirSync(auditDir, { recursive: true });
      const auditFile = path.join(auditDir, 'restore-audit.log');
      const entry = {
        timestamp: new Date().toISOString(),
        filename,
        appliedBy: (payload?.sub ?? (isMigrationToken ? 'migration-token' : null)) ?? null,
        force: Boolean(force),
        ip: req.ip ?? null,
        success: true
      };
      fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n');
    } catch (auditErr) {
      console.error('[system] failed to write restore audit entry', auditErr);
    }

    const restartOnApply = (process.env.AUTO_RESTORE_RESTART_ON_APPLY ?? 'false').toLowerCase() === 'true';
    // Send response first, then optionally exit to let platform restart
    res.json({ success: true, applied: true, filename, restartRequired: restartOnApply });

    if (restartOnApply) {
      console.log('[system] restart-on-apply enabled; exiting process to trigger restart');
      setTimeout(() => process.exit(0), 250);
    }

    return;
  } catch (err) {
    console.error('[system] restore apply failed', err);

    // Audit entry: failure
    try {
      const auditDir = runtimeConfig.backupDir;
      fs.mkdirSync(auditDir, { recursive: true });
      const auditFile = path.join(auditDir, 'restore-audit.log');
      const entry = {
        timestamp: new Date().toISOString(),
        filename,
        appliedBy: (payload?.sub ?? (isMigrationToken ? 'migration-token' : null)) ?? null,
        force: Boolean(force),
        ip: req.ip ?? null,
        success: false,
        error: String(err)
      };
      fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n');
    } catch (auditErr) {
      console.error('[system] failed to write failed restore audit entry', auditErr);
    }

    return res.status(500).json({ success: false, error: String(err) });
  }
});
