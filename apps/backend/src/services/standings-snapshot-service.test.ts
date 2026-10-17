import assert from "node:assert/strict";
import test from "node:test";

import { competitionEntryMigration } from "../db/competition-entry-migration.js";
import { runMigrations, type SqlMigration } from "../db/migration-runner.js";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import { standingsRevisionsMigration } from "../db/standings-revisions-migration.js";
import { conventionalTeamLeagueRuleset } from "./standings-calculation-service.js";
import {
  appendResultRevision,
  createStandingsSnapshot,
  type ResultRevisionRecord
} from "./standings-snapshot-service.js";

const disposableV1: SqlMigration = {
  version: 1,
  name: "disposable-standings-revisions-prerequisites",
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
      callback(database);
    } finally {
      database.close();
    }
  });
}

function seedCompetition(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO competitions(id) VALUES ('competition-1');
    INSERT INTO seasons(id, competition_id) VALUES ('season-1', 'competition-1');
    INSERT INTO teams(id) VALUES ('team-home'), ('team-away');
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, status
    ) VALUES (
      'match-1', 'competition-1', 'season-1', 'team-home', 'team-away', 'ended'
    );
    INSERT INTO match_score_state(match_id, home_score, away_score, status, final_result_confirmed)
      VALUES ('match-1', 1, 0, 'ended', 1);
    INSERT INTO competition_entries
      (id, competition_id, season_id, entry_type, team_id, created_at)
    VALUES
      ('entry-home', 'competition-1', 'season-1', 'team', 'team-home', '2026-01-01T00:00:00.000Z'),
      ('entry-away', 'competition-1', 'season-1', 'team', 'team-away', '2026-01-01T00:00:00.000Z');
    INSERT INTO fixture_participants
      (id, match_id, competition_id, season_id, entry_id, slot, created_at)
    VALUES
      ('participant-home', 'match-1', 'competition-1', 'season-1', 'entry-home', 'home', '2026-01-01T00:00:00.000Z'),
      ('participant-away', 'match-1', 'competition-1', 'season-1', 'entry-away', 'away', '2026-01-01T00:00:00.000Z');
  `);
}

function appendFinal(
  database: DatabaseSync,
  homeScore: number,
  awayScore: number
): ResultRevisionRecord {
  return appendResultRevision(database, {
    matchId: "match-1",
    homeScore,
    awayScore,
    resultStatus: "ended",
    finalResultConfirmed: true,
    validationState: "accepted",
    createdAt: "2026-10-15T08:00:00.000Z"
  });
}

function makeSnapshot(database: DatabaseSync, revisionId: string) {
  return createStandingsSnapshot(database, {
    competitionId: "competition-1",
    seasonId: "season-1",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-1", revisionId }]
  });
}

test("v3 migration creates revision and immutable snapshot structures without importing current scores", () => {
  withDatabase((database) => {
    seedCompetition(database);
    assert.deepEqual(
      database.prepare("SELECT home_score, away_score FROM match_score_state WHERE match_id='match-1'").get(),
      { home_score: 1, away_score: 0 }
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count,
      0
    );
    const objects = new Set((database.prepare(`
      SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger')
    `).all() as Array<{ name: string }>).map(({ name }) => name));
    for (const objectName of [
      "match_result_revisions",
      "standings_snapshots",
      "standings_snapshot_results",
      "standings_snapshot_rows",
      "trg_match_result_revisions_no_update",
      "trg_standings_snapshots_no_delete",
      "trg_standings_snapshot_rows_no_update"
    ]) {
      assert.ok(objects.has(objectName), `missing ${objectName}`);
    }
    assert.equal(
      (database.prepare("SELECT id FROM matches WHERE id='match-1'").get() as { id: string }).id,
      "match-1"
    );
  });
});

test("result revisions append in order, preserve source metadata, and cannot be changed", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const first = appendFinal(database, 1, 0);
    const second = appendFinal(database, 2, 0);
    assert.equal(first.revisionNumber, 1);
    assert.equal(first.supersedesRevisionId, null);
    assert.equal(first.sourceCategory, null);
    assert.equal(first.actorOperatorId, null);
    assert.equal(second.revisionNumber, 2);
    assert.equal(second.supersedesRevisionId, first.id);
    assert.deepEqual(
      (database.prepare(`
        SELECT revision_number AS revisionNumber, home_score AS homeScore, supersedes_revision_id AS supersedesId
        FROM match_result_revisions ORDER BY revision_number
      `).all() as Array<Record<string, unknown>>),
      [
        { revisionNumber: 1, homeScore: 1, supersedesId: null },
        { revisionNumber: 2, homeScore: 2, supersedesId: first.id }
      ]
    );
    assert.deepEqual(
      database.prepare(`
        SELECT home_score, away_score, status, final_result_confirmed
        FROM match_score_state WHERE match_id='match-1'
      `).get(),
      { home_score: 1, away_score: 0, status: "ended", final_result_confirmed: 1 }
    );
    assert.throws(() => database.prepare(
      "UPDATE match_result_revisions SET home_score=99 WHERE id=?"
    ).run(first.id), /result revisions are immutable/);
    assert.throws(() => database.prepare(
      "DELETE FROM match_result_revisions WHERE id=?"
    ).run(first.id), /result revisions are immutable/);
  });
});

test("invalid scores, revision ordering, statuses, and match references are rejected", () => {
  withDatabase((database) => {
    seedCompetition(database);
    for (const score of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => appendResultRevision(database, {
        matchId: "match-1",
        homeScore: score,
        awayScore: 0,
        resultStatus: "ended",
        finalResultConfirmed: true,
        validationState: "accepted"
      }), /homeScore must be a non-negative safe integer/);
    }
    assert.throws(() => appendResultRevision(database, {
      matchId: "missing-match",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      validationState: "accepted"
    }), /unknown match/);
    assert.throws(() => appendResultRevision(database, {
      matchId: "match-1",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "live",
      finalResultConfirmed: false,
      validationState: "accepted"
    }), /only confirmed ended results can be accepted/);

    const first = appendFinal(database, 1, 0);
    assert.throws(() => database.prepare(`
      INSERT INTO match_result_revisions (
        id, match_id, competition_id, season_id, revision_number, home_team_id, away_team_id,
        home_score, away_score, result_status, final_result_confirmed, validation_state, created_at
      ) VALUES (?, 'match-1', 'competition-1', 'season-1', 1, 'team-home', 'team-away',
        9, 0, 'ended', 1, 'accepted', '2026-10-15T08:00:00.000Z')
    `).run("duplicate-revision"), /next revision/);
    assert.throws(() => database.prepare(`
      INSERT INTO match_result_revisions (
        id, match_id, competition_id, season_id, revision_number, home_team_id, away_team_id,
        home_score, away_score, result_status, final_result_confirmed, validation_state, created_at
      ) VALUES ('gap-revision', 'match-1', 'competition-1', 'season-1', 3, 'team-home', 'team-away',
        9, 0, 'ended', 1, 'accepted', '2026-10-15T08:00:00.000Z')
    `).run(), /next revision/);
    assert.throws(() => database.prepare(`
      INSERT INTO match_result_revisions (
        id, match_id, competition_id, season_id, revision_number, home_team_id, away_team_id,
        home_score, away_score, result_status, final_result_confirmed, validation_state,
        supersedes_revision_id, created_at
      ) VALUES ('bad-parent', 'match-1', 'competition-1', 'season-1', 2, 'team-home', 'team-away',
        9, 0, 'ended', 1, 'accepted', 'missing-revision', '2026-10-15T08:00:00.000Z')
    `).run(), /immediately previous revision/);
    assert.equal(first.revisionNumber, 1);
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count,
      1
    );
  });
});

test("snapshot stores the exact accepted revision used by the calculator", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const revision = appendFinal(database, 2, 0);
    const snapshot = makeSnapshot(database, revision.id);
    assert.equal(snapshot.result.rows.find((row) => row.entryId === "entry-home")?.points, 3);
    assert.deepEqual(
      database.prepare(`
        SELECT match_id AS matchId, revision_id AS revisionId, revision_number AS revisionNumber
        FROM standings_snapshot_results WHERE snapshot_id = ?
      `).get(snapshot.id),
      { matchId: "match-1", revisionId: revision.id, revisionNumber: 1 }
    );
    assert.equal(
      (database.prepare(`
        SELECT content_hash FROM standings_snapshots WHERE id = ?
      `).get(snapshot.id) as { content_hash: string }).content_hash,
      snapshot.contentHash
    );
    assert.equal(
      (database.prepare(`
        SELECT points FROM standings_snapshot_rows WHERE snapshot_id=? AND entry_id='entry-home'
      `).get(snapshot.id) as { points: number }).points,
      3
    );
  });
});

test("failed snapshot row persistence rolls back metadata and source references", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const revision = appendFinal(database, 1, 0);
    database.exec(`
      CREATE TRIGGER fail_snapshot_row
      BEFORE INSERT ON standings_snapshot_rows
      BEGIN
        SELECT RAISE(ABORT, 'forced snapshot row failure');
      END;
    `);
    assert.throws(() => makeSnapshot(database, revision.id), /forced snapshot row failure/);
    for (const table of ["standings_snapshots", "standings_snapshot_results", "standings_snapshot_rows"]) {
      assert.equal(
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
        0,
        `${table} should roll back`
      );
    }
  });
});

test("a corrected result creates a new snapshot and leaves the previous snapshot unchanged", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const firstRevision = appendFinal(database, 1, 0);
    const firstSnapshot = makeSnapshot(database, firstRevision.id);
    const originalContent = (database.prepare(
      "SELECT content_hash, content_json FROM standings_snapshots WHERE id=?"
    ).get(firstSnapshot.id));
    const correction = appendFinal(database, 0, 2);
    const correctedSnapshot = makeSnapshot(database, correction.id);

    assert.equal(correction.revisionNumber, 2);
    assert.equal(correctedSnapshot.sequence, 2);
    assert.notEqual(correctedSnapshot.id, firstSnapshot.id);
    assert.notEqual(correctedSnapshot.contentHash, firstSnapshot.contentHash);
    assert.equal(correctedSnapshot.result.rows[0]?.entryId, "entry-away");
    const retainedContent = database.prepare(
      "SELECT content_hash, content_json FROM standings_snapshots WHERE id=?"
    ).get(firstSnapshot.id) as { content_hash: string; content_json: string };
    assert.equal(retainedContent.content_hash, (originalContent as { content_hash: string }).content_hash);
    assert.equal(retainedContent.content_json, (originalContent as { content_json: string }).content_json);
    assert.deepEqual(
      database.prepare(
        "SELECT revision_id FROM standings_snapshot_results WHERE snapshot_id=?"
      ).get(firstSnapshot.id),
      { revision_id: firstRevision.id }
    );
    assert.throws(() => database.prepare(
      "UPDATE standings_snapshots SET content_hash=? WHERE id=?"
    ).run("0".repeat(64), firstSnapshot.id), /standings snapshots are immutable/);
    assert.throws(() => database.prepare(
      "DELETE FROM standings_snapshot_rows WHERE snapshot_id=?"
    ).run(firstSnapshot.id), /standings snapshot rows are immutable/);
  });
});

test("identical explicit inputs yield identical rows and deterministic content hashes", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const revision = appendFinal(database, 2, 0);
    const first = makeSnapshot(database, revision.id);
    const second = makeSnapshot(database, revision.id);
    assert.deepEqual(first.result, second.result);
    assert.equal(first.contentHash, second.contentHash);
    assert.ok(!first.contentJson.includes(first.calculatedAt));
    assert.ok(!second.contentJson.includes(second.calculatedAt));
  });
});

test("ambiguous, missing, mismatched, and non-final revision selections are rejected", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const first = appendFinal(database, 1, 0);
    const correction = appendFinal(database, 0, 1);
    const base = {
      competitionId: "competition-1",
      seasonId: "season-1",
      ruleset: conventionalTeamLeagueRuleset
    };
    assert.throws(() => createStandingsSnapshot(database, {
      ...base,
      revisionSelections: [
        { matchId: "match-1", revisionId: first.id },
        { matchId: "match-1", revisionId: correction.id }
      ]
    }), /ambiguous result selection/);
    assert.throws(() => createStandingsSnapshot(database, {
      ...base,
      revisionSelections: [{ matchId: "match-1", revisionId: "missing-revision" }]
    }), /does not belong to match/);
    assert.throws(() => createStandingsSnapshot(database, {
      ...base,
      revisionSelections: []
    }), /requires an explicit result revision selection/);

    const pending = appendResultRevision(database, {
      matchId: "match-1",
      homeScore: 1,
      awayScore: 1,
      resultStatus: "ended",
      finalResultConfirmed: false,
      validationState: "pending"
    });
    assert.throws(() => makeSnapshot(database, pending.id), /not an accepted final result/);
  });
});

test("snapshot creation fails rather than storing a completed fixture with invalid participants", () => {
  withDatabase((database) => {
    seedCompetition(database);
    const revision = appendFinal(database, 1, 0);
    database.prepare(
      "DELETE FROM fixture_participants WHERE match_id='match-1' AND slot='away'"
    ).run();
    assert.throws(() => makeSnapshot(database, revision.id), /snapshot calculation rejected ended match/);
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_snapshots").get() as { count: number }).count,
      0
    );
  });
});
