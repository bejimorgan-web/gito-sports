#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

if ((process.env.NODE_ENV ?? "development").toLowerCase() === "production") {
  throw new Error("development_operator_bootstrap_production_forbidden");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..", "..", "..");
const databasePath = path.resolve(process.env.DATABASE_PATH?.trim() || path.join(workspaceRoot, "data", "gito.sqlite"));
const email = process.env.DEV_OPERATOR_EMAIL?.trim();
const password = process.env.DEV_OPERATOR_PASSWORD;

if (!email || !password) {
  throw new Error("DEV_OPERATOR_EMAIL and DEV_OPERATOR_PASSWORD are required");
}

if (!fs.existsSync(databasePath)) {
  throw new Error("development_database_not_found");
}

const database = new Database(databasePath);
try {
  const operatorUsers = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_users'").get();
  if (!operatorUsers) throw new Error("operator_users_table_missing");

  const existing = database.prepare("SELECT id FROM operator_users WHERE email = ?").get(email);
  if (existing) throw new Error("development_operator_already_exists");

  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 310000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  database.prepare(`
    INSERT INTO operator_users (
      id, name, email, role, status, last_login_at,
      password_hash, password_salt, password_iterations, password_algo,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, "Local Development Operator", email, "admin", "active", null, hash, salt, iterations, "pbkdf2_sha256", now, now);

  console.log("Local development operator created.");
} finally {
  database.close();
}
