import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeConfig } from '../config/env.js';

export const restoreAuditRouter = Router();

restoreAuditRouter.get('/', (_req, res) => {
  try {
    const auditFile = path.join(runtimeConfig.backupDir, 'restore-audit.log');
    if (!fs.existsSync(auditFile)) {
      return res.json({ entries: [] });
    }

    const text = fs.readFileSync(auditFile, 'utf8').trim();
    if (!text) {
      return res.json({ entries: [] });
    }

    const lines = text.split('\n').filter(Boolean);
    const entries = lines.map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    }).reverse();

    const limit = 100;
    res.json({ entries: entries.slice(0, limit) });
  } catch (error) {
    console.error('[restore-audit] read failed', error);
    res.status(500).json({ entries: [] });
  }
});
