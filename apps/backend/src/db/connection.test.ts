import assert from "node:assert/strict";
import test from "node:test";

import { syncAdminOperatorUserPassword } from "./connection.js";
import { DatabaseSync, allowSqliteInstantiation } from "./sqlite.js";

test("syncAdminOperatorUserPassword updates an existing admin password", () => {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
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

      database.prepare(
        `INSERT INTO operator_users (
          id, name, email, role, status, last_login_at, password_hash, password_salt,
          password_iterations, password_algo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "admin-id",
        "Administrator",
        "admin@gito.local",
        "admin",
        "active",
        null,
        "old-hash",
        "old-salt",
        310000,
        "pbkdf2_sha256",
        new Date().toISOString(),
        new Date().toISOString()
      );

      assert.equal(syncAdminOperatorUserPassword(database, "admin@gito.local", "new-local-password"), true);
      const row = database.prepare("SELECT password_hash, password_salt, password_iterations, password_algo FROM operator_users WHERE email = ?").get("admin@gito.local") as {
        password_hash: string;
        password_salt: string;
        password_iterations: number;
        password_algo: string;
      };
      assert.equal(row.password_algo, "pbkdf2_sha256");
      assert.equal(row.password_iterations, 310000);
      assert.notEqual(row.password_hash, "old-hash");
      assert.notEqual(row.password_salt, "old-salt");
    } finally {
      database.close();
    }
  });
});
