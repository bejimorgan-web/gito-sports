import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

export type ScoreSourceMode = "manual" | "api";

const settingKey = "scores.source_mode";

export function getScoreSourceMode(): ScoreSourceMode {
  const row = getDatabase().prepare(`
    SELECT setting_value AS value
    FROM operator_settings
    WHERE operator_user_id IS NULL AND setting_key = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(settingKey) as { value?: string } | undefined;
  return row?.value === "api" ? "api" : "manual";
}

export function setScoreSourceMode(mode: ScoreSourceMode): ScoreSourceMode {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = db.prepare(`
      SELECT id FROM operator_settings
      WHERE operator_user_id IS NULL AND setting_key = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(settingKey) as { id: string } | undefined;
    if (row) {
      db.prepare("UPDATE operator_settings SET setting_value = ?, updated_at = ? WHERE id = ?")
        .run(mode, now, row.id);
    } else {
      db.prepare(`
        INSERT INTO operator_settings (id, operator_user_id, setting_key, setting_value, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), settingKey, mode, now, now);
    }
    db.exec("COMMIT;");
    return mode;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
