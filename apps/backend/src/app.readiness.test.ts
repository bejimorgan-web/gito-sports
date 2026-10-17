import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("health and database routes stay unavailable until startup succeeds and preserve healthy response fields", async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gito-readiness-test-"));
  const environmentKeys = [
    "NODE_ENV", "DATABASE_PATH", "BACKUP_DIR", "UPLOAD_DIR", "JWT_SECRET",
    "AUTO_IMPORT_MIGRATION", "GITO_NEWS_TEST_MODE", "DB_READONLY_MODE"
  ] as const;
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_PATH: path.join(temporaryRoot, "readiness.sqlite"),
    BACKUP_DIR: path.join(temporaryRoot, "backups"),
    UPLOAD_DIR: path.join(temporaryRoot, "uploads"),
    JWT_SECRET: "test-only-readiness-secret-long-enough",
    AUTO_IMPORT_MIGRATION: "false",
    GITO_NEWS_TEST_MODE: "false",
    DB_READONLY_MODE: "false"
  });

  let database: { prepare: (sql: string) => { run: (...parameters: unknown[]) => unknown }; exec: (sql: string) => void; close: () => void } | undefined;
  try {
    const [{ createApp }, connection, readiness] = await Promise.all([
      import("./app.js"),
      import("./db/connection.js"),
      import("./core/server-readiness.js")
    ]);
    const server = createApp().listen(0, "127.0.0.1");
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const startingHealth = await fetch(`${baseUrl}/health`);
    assert.equal(startingHealth.status, 503);
    const startingBody = await startingHealth.json() as Record<string, unknown>;
    assert.equal(startingBody.status, "starting");
    assert.equal(startingBody.databaseReady, false);
    assert.equal(startingBody.service, "gito-backend");
    assert.equal(typeof startingBody.timestamp, "string");
    assert.ok(startingHealth.headers.has("retry-after"));

    const blockedRoute = await fetch(`${baseUrl}/competitions`);
    assert.equal(blockedRoute.status, 503);
    assert.equal((await blockedRoute.json() as { error: string }).error, "service_initializing");

    database = connection.getDatabase();
    database.prepare(`INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      "readiness-test-admin", "Readiness Test", "readiness@example.invalid", "admin", "active",
      new Date().toISOString(), new Date().toISOString()
    );
    readiness.initializeCoreReadiness(() => database, () => {});
    readiness.markServerReady();

    // The base checkout supports v7; advance the test marker to v8 to verify
    // that health no longer treats every version above 1 as degraded. Startup
    // compatibility itself is exercised by the database connection before
    // this health-only marker is changed.
    database.exec("PRAGMA user_version = 8");
    const healthyResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthyResponse.status, 200);
    const healthyBody = await healthyResponse.json() as Record<string, unknown>;
    assert.equal(healthyBody.status, "ok");
    assert.equal(healthyBody.databaseReady, true);
    for (const field of ["service", "migrationImported", "migrationMeta", "recordCounts", "timestamp"]) {
      assert.ok(field in healthyBody, `expected health compatibility field ${field}`);
    }

    readiness.initializeCoreReadiness(
      () => { throw new Error("simulated migration v8 failure with private database details"); },
      () => {},
      () => {}
    );
    const failedHealth = await fetch(`${baseUrl}/health`);
    assert.equal(failedHealth.status, 503);
    const failedBody = await failedHealth.json() as Record<string, unknown>;
    assert.equal(failedBody.status, "degraded");
    assert.equal(failedBody.databaseReady, false);
    assert.equal(JSON.stringify(failedBody).includes(temporaryRoot), false);
    assert.equal(JSON.stringify(failedBody).includes("readiness.sqlite"), false);

    const blockedAfterFailure = await fetch(`${baseUrl}/competitions`);
    assert.equal(blockedAfterFailure.status, 503);
    assert.equal((await blockedAfterFailure.json() as { error: string }).error, "service_unavailable");
  } finally {
    database?.close();
    for (const key of environmentKeys) {
      const previousValue = previousEnvironment.get(key);
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    }
  }
});
