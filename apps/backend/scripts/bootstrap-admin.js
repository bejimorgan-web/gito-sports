#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import Database from "better-sqlite3";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDatabasePath() {
  // scripts/bootstrap-admin.js is located at apps/backend/scripts
  // climb to the repository root (apps/backend/scripts -> apps/backend -> apps -> <repo-root>)
  const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
  const canonical = path.join(workspaceRoot, "data", "gito.sqlite");

  if (process.env.DATABASE_PATH) {
    return path.resolve(process.env.DATABASE_PATH);
  }

  if (process.env.NODE_ENV === "production") {
    return "/tmp/gito.sqlite";
  }

  return canonical;
}
function ensureInitialSchema(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_users'")
    .get();

  if (tableExists) {
    return;
  }

  const schemaPath = path.resolve(__dirname, '..', 'src', 'db', 'schema', 'initial-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Initial schema file not found: ${schemaPath}`);
  }

  const initialSchema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(initialSchema);
  console.log('[bootstrap] Applied initial database schema.');
}
function main() {
  // Resolve and print the database path first so we always know which file is used
  const dbPath = resolveDatabasePath();
  console.log('[bootstrap] Using database:', dbPath);

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD environment variables must be set.");
    process.exit(1);
  }

  if (!fs.existsSync(dbPath)) {
  console.log("DB not found — creating new empty database at:", dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, "");
  }

  const db = new Database(dbPath);
  ensureInitialSchema(db);

  // Ensure operator_users table has the expected columns for this bootstrap
  function ensureOperatorUsersColumns(database) {
    const required = [
      { name: 'last_login_at', sql: 'TEXT' },
      { name: 'password_hash', sql: 'TEXT' },
      { name: 'password_salt', sql: 'TEXT' },
      { name: 'password_iterations', sql: 'INTEGER' },
      { name: 'password_algo', sql: 'TEXT' },
      { name: 'created_at', sql: 'TEXT' },
      { name: 'updated_at', sql: 'TEXT' }
    ];

    const existing = database.prepare("PRAGMA table_info('operator_users')").all() || [];
    const existingNames = new Set(existing.map(r => r.name));

    for (const col of required) {
      if (!existingNames.has(col.name)) {
        try {
          console.log(`[bootstrap] migrating operator_users: adding column ${col.name}`);
          database.exec(`ALTER TABLE operator_users ADD COLUMN ${col.name} ${col.sql}`);
        } catch (err) {
          console.error('[bootstrap] failed to ALTER TABLE operator_users:', err && err.message ? err.message : err);
        }
      }
    }
  }

  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_users'").get()) {
    ensureOperatorUsersColumns(db);
  }

  try {
    const row = db.prepare("SELECT COUNT(1) AS count FROM operator_users").get();
    const count = Number(row?.count ?? 0);

    if (count > 0) {
      console.error("Operator users already exist. Bootstrap not allowed.");
      process.exit(1);
    }

    // Hash password using PBKDF2
    const salt = crypto.randomBytes(16).toString("hex");
    const iterations = 310000;
    const hash = crypto
      .pbkdf2Sync(password, salt, iterations, 32, "sha256")
      .toString("hex");

    const algo = "pbkdf2_sha256";

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const insert = db.prepare(`
      INSERT INTO operator_users (
        id, name, email, role, status,
        last_login_at,
        password_hash, password_salt,
        password_iterations, password_algo,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      id,
      "Administrator",
      email,
      "admin",
      "active",
      null,
      hash,
      salt,
      iterations,
      algo,
      now,
      now
    );

    console.log("Admin user created successfully. ID:", id);
    console.log(
      "Important: Unset ADMIN_PASSWORD and remove this script from production."
    );
  } finally {
    db.close();
  }
}

main();