import { Router } from "express";
import {
  createBackup,
  listBackups,
  validateBackup,
  getBackupStats
} from "../services/database-backup-service";
import { startupHealthCheck } from "../system/startup";

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
