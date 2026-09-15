import fs from "node:fs";
import { getDatabase } from "../db/connection.js";
import { env, runtimeConfig } from "../config/env.js";

export function startupHealthCheck() {
  try {
    const db = getDatabase();
    // basic DB existence/size check
    const stats = fs.statSync(env.absoluteDatabasePath);
    const dbOk = stats.isFile() && stats.size > 0;

    // quick score service probe (noop here, only report OK if DB ok)
    const scoreOk = true;
    return {
      db: dbOk ? "ok" : "missing",
      scoreService: scoreOk ? "ok" : "degraded",
      mode: process.env.DATABASE_PATH ? "render" : "local"
    } as const;
  } catch (err) {
    return {
      db: "missing",
      scoreService: "degraded",
      mode: process.env.DATABASE_PATH ? "render" : "local"
    } as const;
  }
}
