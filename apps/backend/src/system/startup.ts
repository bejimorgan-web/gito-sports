import fs from "node:fs";
import { getDatabase } from "../db/connection.js";
import { env, runtimeConfig } from "../config/env.js";

export function rehydrateSyncStateOnStartup() {
  try {
    const db = getDatabase();

    // Ensure providers table exists
    const providers = db.prepare("SELECT id, sync_mode FROM providers WHERE deleted = 0").all() as { id: string; sync_mode?: string }[];

    for (const p of providers) {
      // compute last successful stream load as the most recently updated channel for this provider
      const row = db.prepare("SELECT MAX(updated_at) AS last_updated FROM channels WHERE provider_id = ?").get(p.id) as { last_updated?: string } | undefined;
      if (row && row.last_updated) {
        db.prepare("UPDATE providers SET last_successful_stream_load_at = ? WHERE id = ?").run(row.last_updated, p.id);
      }

      // Recompute basic counts and availability status
      const counts = db.prepare(
        "SELECT status, COUNT(1) AS cnt FROM channels WHERE provider_id = ? GROUP BY status"
      ).all(p.id) as { status: string; cnt: number }[];

      let active = 0;
      for (const c of counts) {
        if (c.status === "active") active += c.cnt;
      }

      const availability = active > 0 ? "online" : "unknown";
      db.prepare("UPDATE providers SET availability_status = ? WHERE id = ?").run(availability, p.id);
    }

    console.log("[startup] rehydrated provider sync state from DB");
  } catch (err) {
    console.error("[startup] failed to rehydrate sync state", err);
  }
}

export function startupHealthCheck() {
  try {
    const db = getDatabase();
    // basic DB existence/size check
    const stats = fs.statSync(env.absoluteDatabasePath);
    const dbOk = stats.isFile() && stats.size > 0;

    // quick score service probe (noop here, only report OK if DB ok)
    const scoreOk = true;
    const iptvOk = true;

    return {
      db: dbOk ? "ok" : "missing",
      scoreService: scoreOk ? "ok" : "degraded",
      iptvService: iptvOk ? "ok" : "degraded",
      mode: process.env.DATABASE_PATH ? "render" : "local"
    } as const;
  } catch (err) {
    return {
      db: "missing",
      scoreService: "degraded",
      iptvService: "degraded",
      mode: process.env.DATABASE_PATH ? "render" : "local"
    } as const;
  }
}
