import { Router } from "express";
import { getDatabase, isDatabaseInitialized } from "../db/connection.js";
import { isMigrationImported, getMigrationMetadata } from "../db/migration-import.js";

export const healthRouter = Router();

function getCount(database: ReturnType<typeof getDatabase>, table: string) {
  try {
    const query = table === "providers"
      ? "SELECT COUNT(1) AS count FROM providers WHERE deleted = 0"
      : `SELECT COUNT(1) AS count FROM ${table}`;
    const row = database.prepare(query).get() as { count: number };
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

function databaseSchemaReady(database: ReturnType<typeof getDatabase>): boolean {
  try {
    const schemaVersion = Number((database.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0);
    if (schemaVersion !== 1) return false;
    const requiredTables = [
      "sports",
      "teams",
      "competitions",
      "seasons",
      "matches",
      "streams",
      "providers",
      "channels",
      "operator_users",
      "news_articles",
      "news_article_categories",
      "news_article_media"
    ];
    const placeholders = requiredTables.map(() => "?").join(",");
    const rows = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .all(...requiredTables) as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name)).size === requiredTables.length;
  } catch {
    return false;
  }
}

healthRouter.get("/", (_request, response) => {
  if (!isDatabaseInitialized()) {
    response.status(200).json({
      status: "starting",
      service: "gito-backend",
      databaseReady: false,
      migrationImported: false,
      recordCounts: {},
      timestamp: new Date().toISOString()
    });
    return;
  }

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

  const databaseReady = databaseSchemaReady(db) && counts.operator_users > 0;

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
