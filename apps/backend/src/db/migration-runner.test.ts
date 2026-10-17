import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMigrationState,
  initializeMigrationBaseline,
  migrationChecksum,
  runMigrations,
  validateMigrationDefinitions,
  type SqlMigration
} from "./migration-runner.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";

function withDatabase(callback: (database: DatabaseSync) => void): void {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      callback(database);
    } finally {
      database.close();
    }
  });
}

const migrationOne: SqlMigration = {
  version: 1,
  name: "create-migration-events",
  sql: `
    CREATE TABLE migration_events (name TEXT NOT NULL);
    INSERT INTO migration_events(name) VALUES ('one');
  `
};

const migrationTwo: SqlMigration = {
  version: 2,
  name: "append-second-event",
  sql: "INSERT INTO migration_events(name) VALUES ('two');"
};

test("migrations apply in ascending order and persist their checksums", () => {
  withDatabase((database) => {
    assert.equal(runMigrations(database, [migrationOne, migrationTwo]), 2);
    assert.deepEqual(
      database.prepare("SELECT name FROM migration_events ORDER BY rowid").all(),
      [{ name: "one" }, { name: "two" }]
    );
    assert.deepEqual(
      database.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all(),
      [
        { version: 1, name: migrationOne.name, checksum: migrationChecksum(migrationOne) },
        { version: 2, name: migrationTwo.name, checksum: migrationChecksum(migrationTwo) }
      ]
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      2
    );
  });
});

test("repeated migration runs do not reapply completed definitions", () => {
  withDatabase((database) => {
    runMigrations(database, [migrationOne, migrationTwo]);
    runMigrations(database, [migrationOne, migrationTwo]);

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM migration_events").get() as { count: number }).count,
      2
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
      2
    );
  });
});

test("migration schema changes, ledger entry, and user_version commit together", () => {
  withDatabase((database) => {
    runMigrations(database, [migrationOne]);

    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM migration_events").get() as { count: number }).count,
      1
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
      1
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );
  });
});

test("failed migration rolls back schema, data, ledger, and version and can be retried", () => {
  withDatabase((database) => {
    const failingTwo: SqlMigration = {
      version: 2,
      name: migrationTwo.name,
      sql: `
        CREATE TABLE failed_migration_sentinel (value TEXT NOT NULL);
        INSERT INTO failed_migration_sentinel(value) VALUES ('must-rollback');
        INSERT INTO missing_migration_table(value) VALUES ('failure');
      `
    };

    runMigrations(database, [migrationOne]);
    assert.throws(
      () => runMigrations(database, [migrationOne, failingTwo]),
      /no such table: missing_migration_table/
    );
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'failed_migration_sentinel'").get(),
      undefined
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
      1
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );

    assert.equal(runMigrations(database, [migrationOne, migrationTwo]), 2);
    assert.deepEqual(
      database.prepare("SELECT name FROM migration_events ORDER BY rowid").all(),
      [{ name: "one" }, { name: "two" }]
    );
  });
});

test("an applied checksum mismatch is rejected before the next migration runs", () => {
  withDatabase((database) => {
    runMigrations(database, [migrationOne]);
    const changedOne = { ...migrationOne, sql: `${migrationOne.sql}\n-- changed definition` };
    const sideEffectTwo: SqlMigration = {
      version: 2,
      name: migrationTwo.name,
      sql: "CREATE TABLE checksum_mismatch_sentinel (value TEXT NOT NULL);"
    };

    assert.throws(
      () => runMigrations(database, [changedOne, sideEffectTwo]),
      /checksum mismatch for applied migration 1/
    );
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checksum_mismatch_sentinel'").get(),
      undefined
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );
  });
});

test("duplicate, unordered, gapped, and invalid migration definitions are rejected", () => {
  assert.throws(
    () => validateMigrationDefinitions([migrationOne, { ...migrationTwo, version: 1 }]),
    /invalid ordering/
  );
  assert.throws(
    () => validateMigrationDefinitions([migrationOne, { ...migrationTwo, name: migrationOne.name }]),
    /duplicate migration name/
  );
  assert.throws(
    () => validateMigrationDefinitions([migrationOne, { ...migrationTwo, version: 3 }]),
    /invalid ordering/
  );
  assert.throws(
    () => validateMigrationDefinitions([{ ...migrationOne, version: 0 }]),
    /invalid version/
  );
  assert.throws(
    () => validateMigrationDefinitions([{ ...migrationOne, sql: "  " }]),
    /has no SQL definition/
  );
});

test("a future user_version is rejected rather than downgraded", () => {
  withDatabase((database) => {
    runMigrations(database, [migrationOne]);
    database.exec("PRAGMA user_version = 99");

    assert.throws(
      () => assertMigrationState(database, [migrationOne]),
      /unsupported future schema version 99/
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      99
    );
  });
});

test("a fresh baseline records its schema evidence and version atomically", () => {
  withDatabase((database) => {
    const baseline: SqlMigration = {
      version: 1,
      name: "current-working-tree-bootstrap",
      sql: "sqlite_master-sha256:disposable-fixture",
      bootstrapBaseline: true
    };
    database.exec("CREATE TABLE bootstrap_sentinel (value TEXT NOT NULL)");

    initializeMigrationBaseline(database, baseline, { freshBootstrapVerified: true });
    assert.equal(assertMigrationState(database, [baseline]), 1);
    assert.deepEqual(
      database.prepare("SELECT version, name, checksum FROM schema_migrations").get(),
      { version: 1, name: baseline.name, checksum: migrationChecksum(baseline) }
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );
  });
});

test("an unledgered populated database cannot be adopted by the runner", () => {
  withDatabase((database) => {
    database.exec("CREATE TABLE adoption_sentinel (value TEXT); PRAGMA user_version = 1");

    assert.throws(
      () => runMigrations(database, [migrationOne]),
      /refusing to create a migration ledger for an existing unverified database/
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
      undefined
    );
  });
});

test("baseline initialization requires explicit fresh-bootstrap verification", () => {
  withDatabase((database) => {
    const baseline: SqlMigration = {
      version: 1,
      name: "current-working-tree-bootstrap",
      sql: "sqlite_master-sha256:disposable-fixture",
      bootstrapBaseline: true
    };
    database.exec("CREATE TABLE existing_sentinel (value TEXT); PRAGMA user_version = 1");

    assert.throws(
      () => initializeMigrationBaseline(database, baseline, { freshBootstrapVerified: false }),
    /without verified fresh or existing schema state/
    );
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
      undefined
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      1
    );
  });
});

test("the runner refuses view-only user_version-zero databases", () => {
  withDatabase((database) => {
    database.exec("CREATE VIEW existing_view AS SELECT 1 AS value");

    assert.throws(
      () => runMigrations(database, [migrationOne]),
      /refusing to create a migration ledger for an existing unverified database/
    );
    assert.equal(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get(),
      undefined
    );
  });
});
