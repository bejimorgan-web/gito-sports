import { Router } from "express";
import { getDatabase } from "../db/connection.js";
import { isMigrationImported, getMigrationMetadata } from "../db/migration-import.js";

export const healthRouter = Router();

function getCount(database: ReturnType<typeof getDatabase>, table: string) {
  try {
    const row = database.prepare(`SELECT COUNT(1) AS count FROM ${table}`).get() as { count: number };
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

healthRouter.get("/", (_request, response) => {
  const db = getDatabase();

  const counts = {
    sports: getCount(db, "sports"),
    providers: getCount(db, "providers"),
    channels: getCount(db, "channels"),
    competitions: getCount(db, "competitions"),
    seasons: getCount(db, "seasons"),
    teams: getCount(db, "teams"),
    matches: getCount(db, "matches"),
    streams: getCount(db, "streams"),
    operator_users: getCount(db, "operator_users"),
  };

  const databaseReady =
    counts.sports > 0 &&
    counts.teams > 0 &&
    counts.matches > 0 &&
    counts.streams > 0 &&
    counts.operator_users > 0;

  const migrationImported = isMigrationImported(db);
  const migrationMeta = migrationImported ? getMigrationMetadata(db) : null;

  response.json({
    status: databaseReady ? "ok" : "degraded",
    service: "gito-backend",
    databaseReady,
    migrationImported,
    migrationMeta,
    recordCounts: counts,
    timestamp: new Date().toISOString(),
  });
});
