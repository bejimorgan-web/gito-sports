import assert from "node:assert/strict";
import test from "node:test";

import { competitionEntryMigration } from "../db/competition-entry-migration.js";
import { runMigrations, type SqlMigration } from "../db/migration-runner.js";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import { standingsRevisionsMigration } from "../db/standings-revisions-migration.js";
import { recordAcceptedScoreUpdateInTransaction } from "./accepted-score-revision-service.js";

const disposableV1: SqlMigration = {
  version: 1,
  name: "accepted-score-revision-test-prerequisites",
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
    CREATE TABLE operator_users (id TEXT PRIMARY KEY);
    CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE (id, competition_id, season_id),
      FOREIGN KEY (competition_id) REFERENCES competitions(id),
      FOREIGN KEY (season_id) REFERENCES seasons(id),
      FOREIGN KEY (home_team_id) REFERENCES teams(id),
      FOREIGN KEY (away_team_id) REFERENCES teams(id)
    );
    CREATE TABLE match_score_state (
      match_id TEXT PRIMARY KEY REFERENCES matches(id),
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      status TEXT NOT NULL,
      final_result_confirmed INTEGER NOT NULL
    );
  `
};

function withDatabase(callback: (database: DatabaseSync) => void): void {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      runMigrations(database, [
        disposableV1,
        competitionEntryMigration,
        standingsRevisionsMigration
      ]);
      database.exec(`
        INSERT INTO competitions(id) VALUES ('competition-1');
        INSERT INTO seasons(id, competition_id) VALUES ('season-1', 'competition-1');
        INSERT INTO teams(id) VALUES ('team-home'), ('team-away');
        INSERT INTO operator_users(id) VALUES ('operator-1');
        INSERT INTO matches (
          id, competition_id, season_id, home_team_id, away_team_id, status
        ) VALUES ('match-1', 'competition-1', 'season-1', 'team-home', 'team-away', 'live');
        INSERT INTO match_score_state(match_id, home_score, away_score, status, final_result_confirmed)
          VALUES ('match-1', 0, 0, 'live', 0);
      `);
      callback(database);
    } finally {
      database.close();
    }
  });
}

function writeInTransaction(
  database: DatabaseSync,
  input: Parameters<typeof recordAcceptedScoreUpdateInTransaction>[1]
) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    database.prepare(`
      UPDATE match_score_state
      SET home_score = ?, away_score = ?, status = ?, final_result_confirmed = ?
      WHERE match_id = ?
    `).run(input.homeScore, input.awayScore, input.resultStatus, input.finalResultConfirmed ? 1 : 0, input.matchId);
    const result = recordAcceptedScoreUpdateInTransaction(database, input);
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function recordOnlyInTransaction(
  database: DatabaseSync,
  input: Parameters<typeof recordAcceptedScoreUpdateInTransaction>[1]
) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = recordAcceptedScoreUpdateInTransaction(database, input);
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

test("manual accepted-score updates append atomically, suppress no-ops, and preserve corrections", () => {
  withDatabase((database) => {
    const first = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "live",
      finalResultConfirmed: false,
      sourceCategory: "manual_operator",
      actorOperatorId: "operator-1",
      createdAt: "2026-10-15T12:00:00.000Z"
    });
    assert.equal(first.appended, true);
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, result_status, final_result_confirmed,
             validation_state, source_category, actor_operator_id, revision_number,
             supersedes_revision_id
      FROM match_result_revisions WHERE id = ?
    `).get(first.revisionId), {
      home_score: 1,
      away_score: 0,
      result_status: "live",
      final_result_confirmed: 0,
      validation_state: "pending",
      source_category: "manual_operator",
      actor_operator_id: "operator-1",
      revision_number: 1,
      supersedes_revision_id: null
    });

    const noOp = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "live",
      finalResultConfirmed: false,
      sourceCategory: "manual_operator",
      actorOperatorId: "operator-1"
    });
    assert.deepEqual(noOp, { appended: false, revisionId: first.revisionId });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count, 1);

    const confirmed = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "manual_operator",
      actorOperatorId: "operator-1"
    });
    assert.equal(confirmed.appended, true);
    assert.deepEqual(database.prepare(`
      SELECT revision_number, result_status, final_result_confirmed, validation_state,
             source_category, supersedes_revision_id
      FROM match_result_revisions WHERE id = ?
    `).get(confirmed.revisionId), {
      revision_number: 2,
      result_status: "ended",
      final_result_confirmed: 1,
      validation_state: "accepted",
      source_category: "manual_operator",
      supersedes_revision_id: first.revisionId
    });

    const corrected = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 2,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "manual_operator",
      actorOperatorId: "operator-1"
    });
    assert.deepEqual(database.prepare(`
      SELECT revision_number, home_score, supersedes_revision_id
      FROM match_result_revisions WHERE id = ?
    `).get(corrected.revisionId), {
      revision_number: 3,
      home_score: 2,
      supersedes_revision_id: confirmed.revisionId
    });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count, 3);
  });
});

test("provider source attribution is recorded only when an explicit accepted update is supplied", () => {
  withDatabase((database) => {
    database.prepare("UPDATE matches SET status='ended' WHERE id='match-1'").run();
    const revision = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 0,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "provider"
    });
    assert.equal(revision.appended, true);
    const repeated = writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 0,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "provider"
    });
    assert.deepEqual(repeated, { appended: false, revisionId: revision.revisionId });
    assert.deepEqual(database.prepare(`
      SELECT source_category, actor_operator_id, source_reference, validation_state
      FROM match_result_revisions WHERE id = ?
    `).get(revision.revisionId), {
      source_category: "provider",
      actor_operator_id: null,
      source_reference: null,
      validation_state: "accepted"
    });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count, 1);
  });
});

test("invalid or missing scores fail the revision write and roll back score persistence", () => {
  withDatabase((database) => {
    database.exec(`
      CREATE TRIGGER reject_result_revisions
      BEFORE INSERT ON match_result_revisions
      BEGIN
        SELECT RAISE(ABORT, 'test revision write failure');
      END;
    `);
    assert.throws(() => writeInTransaction(database, {
      matchId: "match-1",
      homeScore: 2,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "manual_operator",
      actorOperatorId: "operator-1"
    }), /test revision write failure/);
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, status, final_result_confirmed
      FROM match_score_state WHERE match_id = 'match-1'
    `).get(), {
      home_score: 0,
      away_score: 0,
      status: "live",
      final_result_confirmed: 0
    });
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count, 0);

    database.exec("DROP TRIGGER reject_result_revisions;");
    assert.throws(() => writeInTransaction(database, {
      matchId: "match-1",
      homeScore: -1,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "manual_operator"
    }), /homeScore must be a non-negative safe integer/);
    assert.throws(() => recordOnlyInTransaction(database, {
      matchId: "match-1",
      homeScore: undefined,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      sourceCategory: "manual_operator"
    } as unknown as Parameters<typeof recordAcceptedScoreUpdateInTransaction>[1]), /homeScore must be a non-negative safe integer/);
    assert.throws(() => recordOnlyInTransaction(database, {
      matchId: "match-1",
      homeScore: 0,
      awayScore: 0,
      resultStatus: "live",
      finalResultConfirmed: true,
      sourceCategory: "provider"
    }), /only ended results can be marked as confirmed/);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count, 0);
  });
});
