import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { syncAdminOperatorUserPassword } from "./connection.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";

test("persistent database migration copies a valid legacy database only when the target is absent", async () => {
  const tempRoot = path.join(process.cwd(), "tmp", `persistent-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const legacyDbPath = path.join(tempRoot, "legacy", "gito.sqlite");
  const targetDbPath = path.join(tempRoot, "persistent", "gito.sqlite");

  fs.mkdirSync(path.dirname(legacyDbPath), { recursive: true });
  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });

  const legacyDb = allowSqliteInstantiation(() => new DatabaseSync(legacyDbPath));
  try {
    legacyDb.exec(`
      CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, sport_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE seasons (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE matches (id TEXT PRIMARY KEY, home_team_id TEXT, away_team_id TEXT, status TEXT NOT NULL DEFAULT 'scheduled', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE streams (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE operator_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', password_hash TEXT, password_salt TEXT, password_iterations INTEGER, password_algo TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE news_article_categories (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, category TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE news_article_media (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, media_type TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    legacyDb.prepare("INSERT INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("sport-1", "Football", "football", new Date().toISOString(), new Date().toISOString());
  } finally {
    legacyDb.close();
  }

  const { maybeMigrateLegacyDatabasePathIfNeeded } = await import("./connection.js");

  const result = maybeMigrateLegacyDatabasePathIfNeeded(targetDbPath, legacyDbPath);

  assert.equal(result.migrated, true);
  assert.equal(fs.existsSync(targetDbPath), true);

  const copiedDb = allowSqliteInstantiation(() => new DatabaseSync(targetDbPath, { readonly: true }));
  try {
    const sportRow = copiedDb.prepare("SELECT COUNT(1) AS count FROM sports").get() as { count: number };
    assert.equal(sportRow.count, 1);
  } finally {
    copiedDb.close();
  }

  const secondResult = maybeMigrateLegacyDatabasePathIfNeeded(targetDbPath, legacyDbPath);
  assert.equal(secondResult.migrated, false);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("syncAdminOperatorUserPassword updates an existing admin password to match the configured local dev value", () => {
  const tempDbPath = path.join(process.cwd(), "tmp", `auth-sync-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });

  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(tempDbPath);

    try {
      db.exec(`
        CREATE TABLE operator_users (
          id TEXT PRIMARY KEY,
          name TEXT,
          email TEXT,
          role TEXT,
          status TEXT,
          last_login_at TEXT,
          password_hash TEXT,
          password_salt TEXT,
          password_iterations INTEGER,
          password_algo TEXT,
          created_at TEXT,
          updated_at TEXT
        );
      `);

      const oldSalt = "old-salt-value";
      const oldHash = crypto.pbkdf2Sync("old-password", oldSalt, 310000, 32, "sha256").toString("hex");

      db.prepare(
        `INSERT INTO operator_users (
          id, name, email, role, status, last_login_at, password_hash, password_salt, password_iterations, password_algo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "admin-id",
        "Administrator",
        "admin@gito.local",
        "admin",
        "active",
        null,
        oldHash,
        oldSalt,
        310000,
        "pbkdf2_sha256",
        new Date().toISOString(),
        new Date().toISOString()
      );

      const updated = syncAdminOperatorUserPassword(db, "admin@gito.local", "new-local-password");
      assert.equal(updated, true);

      const row = db
        .prepare(
          "SELECT password_hash, password_salt, password_iterations, password_algo FROM operator_users WHERE email = ?"
        )
        .get("admin@gito.local") as {
          password_hash: string;
          password_salt: string;
          password_iterations: number;
          password_algo: string;
        };

      const derived = crypto
        .pbkdf2Sync("new-local-password", row.password_salt, row.password_iterations, 32, "sha256")
        .toString("hex");

      assert.equal(derived, row.password_hash);
      assert.equal(row.password_algo, "pbkdf2_sha256");
    } finally {
      db.close();
      fs.rmSync(tempDbPath, { force: true });
    }
  });
});
