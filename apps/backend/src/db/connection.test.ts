import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { syncAdminOperatorUserPassword } from "./connection.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";

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
