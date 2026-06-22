#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDatabase } from "../src/db/connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScriptsRoot() {
  // apps/backend/scripts -> apps/backend -> apps -> <repo-root>
  return path.resolve(__dirname, "..", "..", "..");
}

function main() {
  const repoRoot = resolveScriptsRoot();
  console.log("[db-bootstrap] repository root:", repoRoot);
  console.log("[db-bootstrap] NODE_ENV:", process.env.NODE_ENV ?? "(not set)");
  console.log("[db-bootstrap] DATABASE_PATH:", process.env.DATABASE_PATH ?? "(default)");
  console.log("[db-bootstrap] AUTO_IMPORT_MIGRATION:", process.env.AUTO_IMPORT_MIGRATION ?? "false");
  console.log("[db-bootstrap] MIGRATION_IMPORT_FILE:", process.env.MIGRATION_IMPORT_FILE ?? path.join(repoRoot, "migration-export.json"));

  const database = getDatabase();

  const counts = {
    sports: database.prepare("SELECT COUNT(1) AS count FROM sports").get().count,
    teams: database.prepare("SELECT COUNT(1) AS count FROM teams").get().count,
    matches: database.prepare("SELECT COUNT(1) AS count FROM matches").get().count,
    streams: database.prepare("SELECT COUNT(1) AS count FROM streams").get().count,
    operators: database.prepare("SELECT COUNT(1) AS count FROM operator_users").get().count,
  };

  console.log("[db-bootstrap] counts:", counts);

  const required = ["sports", "teams", "matches", "streams"];
  const missing = required.filter((key) => counts[key] === 0);

  if (missing.length) {
    console.warn("[db-bootstrap] bootstrap completed, but some required catalog tables are empty:", missing.join(", "));
    process.exit(2);
  }

  console.log("[db-bootstrap] bootstrap completed successfully.");
  process.exit(0);
}

main();
