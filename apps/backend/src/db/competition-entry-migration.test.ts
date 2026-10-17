import assert from "node:assert/strict";
import test from "node:test";

import { competitionEntryMigration } from "./competition-entry-migration.js";
import { migrationChecksum, runMigrations, type SqlMigration } from "./migration-runner.js";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";

const disposableV1: SqlMigration = {
  version: 1,
  name: "disposable-competition-entry-prerequisites",
  sql: `
    CREATE TABLE competitions (id TEXT PRIMARY KEY);
    CREATE TABLE seasons (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      UNIQUE (competition_id, id),
      FOREIGN KEY (competition_id) REFERENCES competitions(id)
    );
    CREATE TABLE teams (id TEXT PRIMARY KEY);
    CREATE TABLE players (id TEXT PRIMARY KEY);
    CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      FOREIGN KEY (competition_id) REFERENCES competitions(id),
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (home_team_id) REFERENCES teams(id),
      FOREIGN KEY (away_team_id) REFERENCES teams(id)
    );
  `
};

function withMigratedDatabase(callback: (database: DatabaseSync) => void): void {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      runMigrations(database, [disposableV1, competitionEntryMigration]);
      callback(database);
    } finally {
      database.close();
    }
  });
}

function seedContext(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO competitions(id) VALUES ('competition-a'), ('competition-b');
    INSERT INTO seasons(id, competition_id)
      VALUES ('season-a', 'competition-a'), ('season-b', 'competition-b');
    INSERT INTO teams(id) VALUES ('team-a'), ('team-b'), ('team-c');
    INSERT INTO players(id) VALUES ('player-a');
    INSERT INTO matches(id, competition_id, season_id, home_team_id, away_team_id)
      VALUES ('fixture-a', 'competition-a', 'season-a', 'team-a', 'team-b');
  `);
}

test("v2 migration records its ordered version, name, and definition checksum", () => {
  withMigratedDatabase((database) => {
    assert.equal(runMigrations(database, [disposableV1, competitionEntryMigration]), 2);
    assert.deepEqual(
      database.prepare("SELECT version, name, checksum FROM schema_migrations WHERE version = 2").get(),
      {
        version: 2,
        name: competitionEntryMigration.name,
        checksum: migrationChecksum(competitionEntryMigration)
      }
    );
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      2
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
      2
    );
  });
});

test("team and individual entries use canonical IDs and reject duplicate competitors per season", () => {
  withMigratedDatabase((database) => {
    seedContext(database);
    database.exec(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-team-a', 'competition-a', 'season-a', 'team', 'team-a', 'now');
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, player_id, created_at)
      VALUES ('entry-player-a', 'competition-a', 'season-a', 'individual', 'player-a', 'now');
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-team-a-other-context', 'competition-b', 'season-b', 'team', 'team-a', 'now');
    `);

    assert.throws(() => database.prepare(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('duplicate-team', 'competition-a', 'season-a', 'team', 'team-a', 'now')
    `).run(), /UNIQUE constraint failed: competition_entries\.competition_id, competition_entries\.season_id, competition_entries\.team_id/);

    assert.throws(() => database.prepare(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, player_id, created_at)
      VALUES ('duplicate-player', 'competition-a', 'season-a', 'individual', 'player-a', 'now')
    `).run(), /UNIQUE constraint failed: competition_entries\.competition_id, competition_entries\.season_id, competition_entries\.player_id/);

    assert.throws(() => database.prepare(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('wrong-season', 'competition-a', 'season-b', 'team', 'team-c', 'now')
    `).run(), /FOREIGN KEY constraint failed/);
  });
});

test("foreign keys reject orphan entries and fixture participant assignments", () => {
  withMigratedDatabase((database) => {
    seedContext(database);

    assert.throws(() => database.prepare(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('orphan-entry', 'missing-competition', 'missing-season', 'team', 'team-a', 'now')
    `).run(), /FOREIGN KEY constraint failed/);

    database.exec(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-team-a', 'competition-a', 'season-a', 'team', 'team-a', 'now');
    `);
    assert.throws(() => database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('orphan-participant', 'missing-fixture', 'competition-a', 'season-a', 'entry-team-a', 'home', 'now')
    `).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('wrong-context', 'fixture-a', 'competition-a', 'season-b', 'entry-team-a', 'away', 'now')
    `).run(), /FOREIGN KEY constraint failed/);
  });
});

test("fixture participant slots and competitor assignments cannot be duplicated", () => {
  withMigratedDatabase((database) => {
    seedContext(database);
    database.exec(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-team-a', 'competition-a', 'season-a', 'team', 'team-a', 'now');
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-team-b', 'competition-a', 'season-a', 'team', 'team-b', 'now');
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('participant-home', 'fixture-a', 'competition-a', 'season-a', 'entry-team-a', 'home', 'now');
    `);

    assert.throws(() => database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('duplicate-slot', 'fixture-a', 'competition-a', 'season-a', 'entry-team-b', 'home', 'now')
    `).run(), /UNIQUE constraint failed: fixture_participants\.match_id, fixture_participants\.slot/);

    assert.throws(() => database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('duplicate-entry', 'fixture-a', 'competition-a', 'season-a', 'entry-team-a', 'away', 'now')
    `).run(), /UNIQUE constraint failed: fixture_participants\.match_id, fixture_participants\.entry_id/);

    assert.throws(() => database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES ('blank-slot', 'fixture-a', 'competition-a', 'season-a', 'entry-team-b', '  ', 'now')
    `).run(), /CHECK constraint failed/);
  });
});

test("failed v2 migration rolls back all v2 schema and its ledger entry", () => {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      runMigrations(database, [disposableV1]);

      const failingV2: SqlMigration = {
        ...competitionEntryMigration,
        sql: `${competitionEntryMigration.sql}
          CREATE TABLE v2_partial_sentinel (value TEXT NOT NULL);
          INSERT INTO v2_partial_sentinel(value) VALUES ('must-rollback');
          INSERT INTO missing_v2_table(value) VALUES ('fail');
        `
      };
      assert.throws(
        () => runMigrations(database, [disposableV1, failingV2]),
        /no such table: missing_v2_table/
      );

      const remainingV2Objects = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE name IN (
          'competition_entries',
          'fixture_participants',
          'idx_seasons_competition_id_id',
          'idx_matches_participant_context',
          'v2_partial_sentinel'
        )
      `).all();
      assert.deepEqual(remainingV2Objects, []);
      assert.equal(
        (database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
        1
      );
      assert.equal(
        (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
        1
      );
    } finally {
      database.close();
    }
  });
});
