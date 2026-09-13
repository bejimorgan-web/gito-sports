import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { closeDatabase, migrateExistingOperationalState, syncAdminOperatorUserPassword } from "./connection.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";
import { readInitialSchema } from "./schema.js";

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

test("migrateExistingOperationalState adds missing logo_url to the channels table", () => {
  const tempDbPath = path.join(process.cwd(), "tmp", `channels-logo-migration-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });

  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(tempDbPath);

    try {
      db.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          name TEXT NOT NULL,
          external_ref TEXT,
          url TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'live',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
      `);

      migrateExistingOperationalState(db);

      const columns = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
      assert.ok(columns.some((column) => column.name === "logo_url"));
    } finally {
      db.close();
      fs.rmSync(tempDbPath, { force: true });
    }
  });
});

test("migrateExistingOperationalState repairs child tables that still reference legacy channel/provider names", () => {
  const tempDbPath = path.join(process.cwd(), "tmp", `legacy-child-schema-migration-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });

  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(tempDbPath);

    try {
      db.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE providers_legacy_upgrade (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE matches (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'scheduled',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE scheduling_matches (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'scheduled',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          name TEXT NOT NULL,
          external_ref TEXT,
          url TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'live',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
        CREATE TABLE channels_legacy_broken (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE streams (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          protocol TEXT NOT NULL DEFAULT 'hls',
          status TEXT NOT NULL DEFAULT 'idle',
          approval_status TEXT NOT NULL DEFAULT 'idle',
          approved_by_user_id TEXT,
          approved_at TEXT,
          rejection_reason TEXT,
          published_at TEXT,
          health_status TEXT NOT NULL DEFAULT 'unknown',
          health_reason TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_health_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (match_id) REFERENCES matches(id),
          FOREIGN KEY (channel_id) REFERENCES "channels_legacy_broken"(id)
        );
        CREATE TABLE match_streams (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          stream_url TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (channel_id) REFERENCES "channels_legacy_broken"(id),
          FOREIGN KEY (match_id) REFERENCES scheduling_matches(id),
          FOREIGN KEY (provider_id) REFERENCES "providers_legacy_upgrade"(id),
          UNIQUE (match_id, channel_id)
        );
      `);

      const timestamp = new Date().toISOString();
      db.prepare("INSERT INTO providers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("provider-1", "Test Provider", timestamp, timestamp);
      db.prepare("INSERT INTO providers_legacy_upgrade (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("legacy-provider-1", "Legacy Provider", timestamp, timestamp);
      db.prepare("INSERT INTO matches (id, created_at, updated_at) VALUES (?, ?, ?)").run("match-1", timestamp, timestamp);
      db.prepare("INSERT INTO scheduling_matches (id, created_at, updated_at) VALUES (?, ?, ?)").run("sched-1", timestamp, timestamp);
      db.prepare("INSERT INTO channels_legacy_broken (id) VALUES (?)").run("channel-1");

      db.prepare(
        "INSERT INTO channels (id, provider_id, name, url, content_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("channel-1", "provider-1", "Test Channel", "https://example.com/stream.m3u8", "live", "active", new Date().toISOString(), new Date().toISOString());
      db.prepare(
        "INSERT INTO streams (id, match_id, channel_id, protocol, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("stream-1", "match-1", "channel-1", "hls", "idle", new Date().toISOString(), new Date().toISOString());
      db.prepare(
        "INSERT INTO match_streams (id, match_id, provider_id, channel_id, stream_url, priority, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("match-stream-1", "sched-1", "legacy-provider-1", "channel-1", "https://example.com/stream.m3u8", 0, 1, new Date().toISOString(), new Date().toISOString());

      migrateExistingOperationalState(db);

      const streamFk = db.prepare("PRAGMA foreign_key_list(streams)").all() as Array<{ table: string }>;
      const matchStreamFk = db.prepare("PRAGMA foreign_key_list(match_streams)").all() as Array<{ from: string; table: string }>;
      const schemaRows = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('streams', 'match_streams')").all() as Array<{ name: string; sql: string }>;

      assert.deepEqual(streamFk.map((fk) => fk.table), ["channels", "matches"]);
      assert.deepEqual(matchStreamFk.map((fk) => fk.table), ["channels", "providers", "scheduling_matches"]);
      assert.ok(schemaRows.every((row) => !row.sql.includes("channels_legacy_broken") && !row.sql.includes("providers_legacy_upgrade")));
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM streams").get() as { count: number }).count, 1);
    } finally {
      db.close();
      fs.rmSync(tempDbPath, { force: true });
    }
  });
});

test("migrateExistingOperationalState adds tvg_name to legacy channels idempotently", () => {
  const tempDbPath = path.join(process.cwd(), "tmp", `channels-tvg-name-migration-${Date.now()}.sqlite`);
  fs.mkdirSync(path.dirname(tempDbPath), { recursive: true });

  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(tempDbPath);

    try {
      db.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          name TEXT NOT NULL,
          external_ref TEXT,
          url TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'live',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
        );
      `);

      const timestamp = new Date().toISOString();
      db.prepare("INSERT INTO providers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("provider-1", "Legacy Provider", timestamp, timestamp);
      db.prepare("INSERT INTO channels (id, provider_id, name, external_ref, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("channel-1", "provider-1", "Legacy Channel", "legacy-1", "https://provider.example/live/legacy-1.m3u8", timestamp, timestamp);

      migrateExistingOperationalState(db);
      migrateExistingOperationalState(db);

      const columns = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string; type: string; notnull: number }>;
      const tvgName = columns.find((column) => column.name === "tvg_name");
      assert.ok(tvgName);
      assert.equal(tvgName.type, "TEXT");
      assert.equal(tvgName.notnull, 0);

      const row = db.prepare("SELECT id, provider_id, url FROM channels WHERE id = ?").get("channel-1") as { id: string; provider_id: string; url: string };
      assert.deepEqual(row, { id: "channel-1", provider_id: "provider-1", url: "https://provider.example/live/legacy-1.m3u8" });
    } finally {
      db.close();
      fs.rmSync(tempDbPath, { force: true });
    }
  });
});

test("initial schema includes channels.tvg_name", () => {
  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(readInitialSchema());
      const columns = db.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string; type: string; notnull: number }>;
      const tvgName = columns.find((column) => column.name === "tvg_name");
      assert.ok(tvgName);
      assert.equal(tvgName.type, "TEXT");
      assert.equal(tvgName.notnull, 0);
    } finally {
      db.close();
    }
  });
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

test.after(() => {
  closeDatabase();
});
