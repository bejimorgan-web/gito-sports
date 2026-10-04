import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("public debug endpoints report status without exposing credentials", async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gito-app-security-test-"));
  const environmentKeys = ["MIGRATION_IMPORT_TOKEN", "JWT_SECRET", "NODE_ENV", "DATABASE_PATH", "BACKUP_DIR", "UPLOAD_DIR"] as const;
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.MIGRATION_IMPORT_TOKEN = "test-only-migration-secret";
  process.env.JWT_SECRET = "test-only-jwt-secret-that-is-long-enough";
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = path.join(temporaryRoot, "test.sqlite");
  process.env.BACKUP_DIR = path.join(temporaryRoot, "backups");
  process.env.UPLOAD_DIR = path.join(temporaryRoot, "uploads");

  try {
    const { createApp } = await import("./app.js");
    const server = createApp().listen(0, "127.0.0.1");
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const versionResponse = await fetch(`${baseUrl}/__debug/version`);
    assert.equal(versionResponse.status, 200);
    const versionBody = await versionResponse.json() as Record<string, unknown>;
    assert.equal(versionBody.node_env, "test");
    assert.equal(typeof versionBody.timestamp, "string");
    assert.ok("commit" in versionBody);
    for (const field of ["env_token", "auth_header", "database_path", "jwt_secret_present", "MIGRATION_IMPORT_TOKEN", "JWT_SECRET"]) {
      assert.equal(field in versionBody, false);
    }
    assert.equal(JSON.stringify(versionBody).includes("test-only-migration-secret"), false);
    assert.equal(JSON.stringify(versionBody).includes("test-only-jwt-secret"), false);

    const migrationAuthResponse = await fetch(`${baseUrl}/__debug/migration-auth`, {
      headers: { authorization: "Bearer test-only-migration-secret" }
    });
    assert.equal(migrationAuthResponse.status, 200);
    const migrationAuthBody = await migrationAuthResponse.json() as Record<string, unknown>;
    assert.equal(migrationAuthBody.authorization_header_present, true);
    assert.equal(migrationAuthBody.node_env, "test");
    assert.equal("env_token" in migrationAuthBody, false);
    assert.equal("auth_header" in migrationAuthBody, false);
    assert.equal(JSON.stringify(migrationAuthBody).includes("test-only-migration-secret"), false);

    const capturedLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => capturedLogs.push(values.map(String).join(" "));
    let rejectedMigrationRequest: Response;
    try {
      rejectedMigrationRequest = await fetch(`${baseUrl}/api/admin/migration/import`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-only-bearer-should-not-be-logged",
          "content-type": "application/octet-stream"
        },
        body: "{}"
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(rejectedMigrationRequest.status, 401);
    assert.equal(capturedLogs.some((line) => line.includes("test-only-bearer-should-not-be-logged")), false);
  } finally {
    for (const key of environmentKeys) {
      const previousValue = previousEnvironment.get(key);
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    }
  }
});
