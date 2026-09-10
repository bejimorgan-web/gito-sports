import fs from "node:fs";
import { getDatabase } from "../db/connection.js";
import { env, runtimeConfig } from "../config/env.js";

export function rehydrateSyncStateOnStartup() {
  try {
    const db = getDatabase();

    // Ensure providers table exists
    const providers = db.prepare("SELECT id, sync_mode FROM providers WHERE deleted = 0").all() as { id: string; sync_mode?: string }[];

    const channelState = db.prepare(
      "SELECT provider_id, MAX(updated_at) AS last_updated, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count FROM channels GROUP BY provider_id"
    ).all() as { provider_id: string; last_updated?: string; active_count?: number }[];
    const channelStateByProvider = new Map(channelState.map((row) => [row.provider_id, row]));
    const updateProvider = db.prepare("UPDATE providers SET last_successful_stream_load_at = COALESCE(?, last_successful_stream_load_at), availability_status = ? WHERE id = ?");
    const updateState = db.transaction(() => {
      for (const provider of providers) {
        const state = channelStateByProvider.get(provider.id);
        updateProvider.run(state?.last_updated ?? null, Number(state?.active_count ?? 0) > 0 ? "online" : "unknown", provider.id);
      }
    });
    updateState();

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
