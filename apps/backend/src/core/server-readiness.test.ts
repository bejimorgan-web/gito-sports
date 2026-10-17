import assert from "node:assert/strict";
import test from "node:test";

import {
  allCoreReadinessFlagsReady,
  getReadinessStatus,
  hasStartupFailed,
  initializeCoreReadiness,
  isServerReady,
  markServerReady
} from "./server-readiness.js";

test("core readiness is published only after database migration and required setup complete", () => {
  const order: string[] = [];
  const initialized = initializeCoreReadiness(
    () => {
      order.push("database-and-migrations");
      assert.equal(isServerReady(), false);
      assert.equal(getReadinessStatus().readinessFlags.databaseReady, false);
    },
    () => {
      order.push("feature-flags");
      assert.equal(isServerReady(), false);
      assert.equal(getReadinessStatus().readinessFlags.databaseReady, true);
    },
    (error) => assert.fail(`unexpected startup error: ${String(error)}`)
  );

  assert.equal(initialized, true);
  assert.deepEqual(order, ["database-and-migrations", "feature-flags"]);
  assert.equal(allCoreReadinessFlagsReady(), true);
  assert.equal(isServerReady(), false);
  assert.equal(hasStartupFailed(), false);

  markServerReady();
  assert.equal(isServerReady(), true);
});

test("a required migration failure preserves the error and leaves readiness unavailable", () => {
  const migrationError = new Error("disposable migration failure");
  let loggedError: unknown;

  const initialized = initializeCoreReadiness(
    () => { throw migrationError; },
    () => assert.fail("feature setup must not run after database initialization fails"),
    (error) => { loggedError = error; }
  );

  assert.equal(initialized, false);
  assert.strictEqual(loggedError, migrationError);
  assert.equal(hasStartupFailed(), true);
  assert.equal(isServerReady(), false);
  assert.equal(allCoreReadinessFlagsReady(), false);
  markServerReady();
  assert.equal(isServerReady(), false);
});
