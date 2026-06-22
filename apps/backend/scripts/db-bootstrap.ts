#!/usr/bin/env tsx

import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "../src/db/connection.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScriptsRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function main() {
  const repoRoot = resolveScriptsRoot();
  const databasePath = process.env.DATABASE_PATH ?? path.join(repoRoot, "data", "gito.sqlite");

  console.log("[db-bootstrap] repository root:", repoRoot);
  console.log("[db-bootstrap] NODE_ENV:", process.env.NODE_ENV ?? "(not set)");
  console.log("[db-bootstrap] DATABASE_PATH:", databasePath);
  console.log("[db-bootstrap] AUTO_IMPORT_MIGRATION:", process.env.AUTO_IMPORT_MIGRATION ?? "false");
  console.log(
    "[db-bootstrap] MIGRATION_IMPORT_FILE:",
    process.env.MIGRATION_IMPORT_FILE ?? path.join(repoRoot, "migration-export.json")
  );

  const database = getDatabase();

  const counts = {
    sports: Number(database.prepare("SELECT COUNT(1) AS count FROM sports").get().count),
    teams: Number(database.prepare("SELECT COUNT(1) AS count FROM teams").get().count),
    matches: Number(database.prepare("SELECT COUNT(1) AS count FROM matches").get().count),
    streams: Number(database.prepare("SELECT COUNT(1) AS count FROM streams").get().count),
    operators: Number(database.prepare("SELECT COUNT(1) AS count FROM operator_users").get().count),
  };

  console.log("[db-bootstrap] counts:", counts);

  const requiredTables = ["sports", "teams", "matches", "streams"];
  const missing = requiredTables.filter((table) => counts[table] === 0);

  if (missing.length > 0) {
    console.warn("[db-bootstrap] bootstrap completed, but some required catalog tables are empty:", missing.join(", "));
    process.exit(2);
  }

  console.log("[db-bootstrap] bootstrap completed successfully.");
  process.exit(0);
}

main();
