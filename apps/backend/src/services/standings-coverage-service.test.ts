import assert from "node:assert/strict";
import test from "node:test";

import { competitionEntryMigration } from "../db/competition-entry-migration.js";
import { runMigrations, type SqlMigration } from "../db/migration-runner.js";
import { standingsCoverageMigration } from "../db/standings-coverage-migration.js";
import { standingsScheduleManifestMigration } from "../db/standings-schedule-manifest-migration.js";
import { standingsGovernanceMigration } from "../db/standings-governance-migration.js";
import { standingsSourceEvidenceMigration } from "../db/standings-source-evidence-migration.js";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import { standingsRevisionsMigration } from "../db/standings-revisions-migration.js";
import {
  assessStandingsCoverage,
  type AssessStandingsCoverageInput
} from "./standings-coverage-service.js";
import { conventionalTeamLeagueRuleset } from "./standings-calculation-service.js";
import {
  appendResultRevision,
  createStandingsSnapshot,
  type RevisionSelection,
  type ResultRevisionRecord
} from "./standings-snapshot-service.js";
import {
  recalculateStandingsAfterAcceptedResultChange,
  StandingsCoverageAssessmentError
} from "./standings-recalculation-service.js";
import {
  addExpectedScheduleFixture,
  createScheduleManifest,
  finalizeScheduleManifest as finalizeScheduleManifestWithSource,
  resolveExpectedScheduleFixture,
  validateScheduleManifest
} from "./standings-schedule-manifest-service.js";

const disposableV1: SqlMigration = {
  version: 1,
  name: "disposable-standings-coverage-prerequisites",
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

interface CoverageFixture {
  database: DatabaseSync;
  firstRevision: ResultRevisionRecord;
  firstSnapshotId: string;
}

const snapshotDatabaseById = new Map<string, DatabaseSync>();

function finalizeScheduleManifest(database: DatabaseSync, manifestId: string, finalizedAt?: string) {
  return finalizeScheduleManifestWithSource(database, manifestId, finalizedAt, {
    name: "Official test schedule",
    reference: "test-schedule-document",
    contentHash: "a".repeat(64)
  });
}

function ensureTestScheduleManifest(database: DatabaseSync, competitionId: string, seasonId: string): string | undefined {
  const fixtures = database.prepare(`
    SELECT id, home_team_id, away_team_id
    FROM matches
    WHERE competition_id = ? AND season_id = ?
    ORDER BY id
  `).all(competitionId, seasonId) as Array<{ id: string; home_team_id: string; away_team_id: string }>;
  if (fixtures.length === 0) return undefined;

  const latest = database.prepare(`
    SELECT id, state
    FROM standings_schedule_manifests
    WHERE competition_id = ? AND season_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(competitionId, seasonId) as { id: string; state: string } | undefined;
  if (latest?.state === "finalized") {
    const currentEntries = database.prepare(`
      SELECT fixture_key, home_team_id, away_team_id, match_id
      FROM standings_schedule_manifest_fixtures
      WHERE manifest_id = ?
      ORDER BY match_id
    `).all(latest.id) as Array<{ fixture_key: string; home_team_id: string; away_team_id: string; match_id: string }>;
    if (currentEntries.length === fixtures.length
      && currentEntries.every((entry, index) => {
        const fixture = fixtures[index];
        return entry.match_id === fixture?.id
          && entry.home_team_id === fixture.home_team_id
          && entry.away_team_id === fixture.away_team_id;
      })) {
      return latest.id;
    }
  }

  const manifest = createScheduleManifest(database, { competitionId, seasonId, createdAt: "2026-10-15T09:30:00.000Z" });
  for (const fixture of fixtures) {
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: `canonical:${fixture.id}`,
      homeTeamId: fixture.home_team_id,
      awayTeamId: fixture.away_team_id,
      matchId: fixture.id
    });
  }
  return finalizeScheduleManifest(database, manifest.id, "2026-10-15T09:31:00.000Z").id;
}

function withDatabase(callback: (database: DatabaseSync) => void): void {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      runMigrations(database, [
        disposableV1,
        competitionEntryMigration,
        standingsRevisionsMigration,
        standingsCoverageMigration,
        standingsScheduleManifestMigration,
        standingsGovernanceMigration,
        standingsSourceEvidenceMigration
      ]);
      callback(database);
    } finally {
      database.close();
    }
  });
}

function seedFixture(database: DatabaseSync, matchId: string, status = "ended"): void {
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, status
    ) VALUES (?, 'competition-1', 'season-1', 'team-home', 'team-away', ?)
  `).run(matchId, status);
  if (status !== "cancelled" && status !== "postponed") {
    database.prepare(`
      INSERT INTO fixture_participants
        (id, match_id, competition_id, season_id, entry_id, slot, created_at)
      VALUES (?, ?, 'competition-1', 'season-1', 'entry-home', 'home', '2026-01-01T00:00:00.000Z'),
             (?, ?, 'competition-1', 'season-1', 'entry-away', 'away', '2026-01-01T00:00:00.000Z')
    `).run(`${matchId}-home`, matchId, `${matchId}-away`, matchId);
  }
}

function seedCompetition(database: DatabaseSync): ResultRevisionRecord {
  database.exec(`
    INSERT INTO competitions(id) VALUES ('competition-1'), ('competition-foreign');
    INSERT INTO seasons(id, competition_id) VALUES ('season-1', 'competition-1'), ('season-foreign', 'competition-foreign');
    INSERT INTO teams(id) VALUES ('team-home'), ('team-away');
    INSERT INTO competition_entries
      (id, competition_id, season_id, entry_type, team_id, created_at)
    VALUES
      ('entry-home', 'competition-1', 'season-1', 'team', 'team-home', '2026-01-01T00:00:00.000Z'),
      ('entry-away', 'competition-1', 'season-1', 'team', 'team-away', '2026-01-01T00:00:00.000Z');
  `);
  seedFixture(database, "match-1");
  return appendResultRevision(database, {
    matchId: "match-1",
    homeScore: 1,
    awayScore: 0,
    resultStatus: "ended",
    finalResultConfirmed: true,
    validationState: "accepted",
    createdAt: "2026-10-15T08:00:00.000Z"
  });
}

function createSnapshot(
  database: DatabaseSync,
  revisionSelections: readonly RevisionSelection[],
  competitionId = "competition-1",
  seasonId = "season-1"
): string {
  const snapshot = createStandingsSnapshot(database, {
    competitionId,
    seasonId,
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections,
    calculatedAt: "2026-10-15T09:00:00.000Z"
  });
  snapshotDatabaseById.set(snapshot.id, database);
  return snapshot.id;
}

function createCoverageFixture(callback: (fixture: CoverageFixture) => void): void {
  withDatabase((database) => {
    const firstRevision = seedCompetition(database);
    const firstSnapshotId = createSnapshot(database, [
      { matchId: "match-1", revisionId: firstRevision.id }
    ]);
    callback({ database, firstRevision, firstSnapshotId });
  });
}

function assessmentInput(
  snapshotId: string,
  revisionSelections: AssessStandingsCoverageInput["revisionSelections"] = [
    { matchId: "match-1", revisionId: "revision-1" }
  ],
  options: Partial<AssessStandingsCoverageInput> = {}
): AssessStandingsCoverageInput {
  const database = snapshotDatabaseById.get(snapshotId);
  const manifestVersionId = database
    ? ensureTestScheduleManifest(database, options.scope?.competitionId ?? "competition-1", options.scope?.seasonId ?? "season-1")
    : undefined;
  return {
    scope: {
      type: "competition_season",
      competitionId: "competition-1",
      seasonId: "season-1"
    },
    snapshotId,
    policy: { allowedExclusionStatuses: [] },
    exclusions: [],
    revisionSelections,
    manifestVersionId,
    assessedAt: "2026-10-15T10:00:00.000Z",
    ...options
  };
}

function assessmentWithActualRevision(
  snapshotId: string,
  revision: ResultRevisionRecord,
  options: Partial<AssessStandingsCoverageInput> = {}
): AssessStandingsCoverageInput {
  return assessmentInput(snapshotId, [{ matchId: revision.matchId, revisionId: revision.id }], options);
}

test("v2-v7 migrations create immutable coverage, schedule, governance, and evidence tables in order", () => {
  withDatabase((database) => {
    assert.equal(
      (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      7
    );
    const tables = new Set((database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<{ name: string }>).map(({ name }) => name));
    assert.ok(tables.has("standings_coverage_assessments"));
    assert.ok(tables.has("standings_coverage_fixtures"));
    assert.ok(tables.has("standings_schedule_manifests"));
    assert.ok(tables.has("standings_schedule_manifest_fixtures"));
    assert.ok(tables.has("standings_coverage_manifest_fixtures"));
    const manifestColumns = new Set((database.prepare("PRAGMA table_info(standings_schedule_manifests)").all() as Array<{ name: string }>).map(({ name }) => name));
    assert.ok(manifestColumns.has("source_content_hash"));
    assert.throws(
      () => database.prepare(`
        INSERT INTO standings_coverage_assessments (
          id, competition_id, season_id, scope_type, snapshot_id, sequence,
          policy_json, eligibility_state, blocking_reasons_json, content_hash,
          content_json, assessed_at, expected_fixture_count
        ) VALUES ('orphan-assessment', 'competition-1', 'season-1', 'competition_season',
          'missing-snapshot', 1, '{}', 'ineligible', '[]', '${"0".repeat(64)}',
          '{}', '2026-10-15T00:00:00.000Z', 0)
      `).run(),
      /FOREIGN KEY constraint failed|coverage assessments require a finalized snapshot/
    );
  });
});

test("a complete competition/season fixture set is covered by the selected accepted revisions", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    seedFixture(database, "match-2");
    const secondRevision = appendResultRevision(database, {
      matchId: "match-2",
      homeScore: 0,
      awayScore: 2,
      resultStatus: "ended",
      finalResultConfirmed: true,
      validationState: "accepted",
      createdAt: "2026-10-15T08:01:00.000Z"
    });
    const snapshotId = createSnapshot(database, [
      { matchId: "match-1", revisionId: firstRevision.id },
      { matchId: "match-2", revisionId: secondRevision.id }
    ]);
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(snapshotId, firstRevision, {
      revisionSelections: [
        { matchId: "match-1", revisionId: firstRevision.id },
        { matchId: "match-2", revisionId: secondRevision.id }
      ]
    }));
    assert.equal(assessment.eligible, true);
    assert.deepEqual(assessment.decisions.map(({ fixtureId, state }) => [fixtureId, state]), [
      ["match-1", "required_covered"],
      ["match-2", "required_covered"]
    ]);
    const source = database.prepare(`
      SELECT match_id, fixture_status, home_team_id, away_team_id,
             participant_assignments_json, selected_revision_id
      FROM standings_coverage_fixtures
      WHERE assessment_id = ? ORDER BY match_id
    `).all(assessment.id) as Array<{
      match_id: string;
      fixture_status: string;
      home_team_id: string;
      away_team_id: string;
      participant_assignments_json: string;
      selected_revision_id: string;
    }>;
    assert.deepEqual(source.map(({ match_id, fixture_status, home_team_id, away_team_id, selected_revision_id }) =>
      [match_id, fixture_status, home_team_id, away_team_id, selected_revision_id]
    ), [
      ["match-1", "ended", "team-home", "team-away", firstRevision.id],
      ["match-2", "ended", "team-home", "team-away", secondRevision.id]
    ]);
    assert.deepEqual(JSON.parse(source[0]?.participant_assignments_json ?? "[]"), [
      { competitorType: "team", entryId: "entry-away", slot: "away", teamId: "team-away" },
      { competitorType: "team", entryId: "entry-home", slot: "home", teamId: "team-home" }
    ]);
  });
});

test("a required fixture without an acceptable result blocks eligibility", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    seedFixture(database, "match-pending", "scheduled");
    const snapshotId = createSnapshot(database, [
      { matchId: "match-1", revisionId: firstRevision.id }
    ]);
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(snapshotId, firstRevision));
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.scheduleState, "verified_complete");
    assert.deepEqual(assessment.decisions.map(({ fixtureId, state }) => [fixtureId, state]), [
      ["match-1", "required_covered"],
      ["match-pending", "required_pending"]
    ]);
    assert.ok(assessment.blockingReasons.some(({ code, fixtureId }) =>
      code === "AWAITING_ACCEPTABLE_RESULT" && fixtureId === "match-pending"
    ));
    assert.notEqual(firstSnapshotId, snapshotId);
  });
});

test("an ended fixture with only an unconfirmed revision remains pending", () => {
  createCoverageFixture(({ database, firstRevision }) => {
    seedFixture(database, "match-unconfirmed", "scheduled");
    const snapshotId = createSnapshot(database, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ]);
    appendResultRevision(database, {
      matchId: "match-unconfirmed",
      homeScore: 1,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: false,
      validationState: "pending",
      sourceCategory: "manual_operator",
      createdAt: "2026-10-15T08:30:00.000Z"
    });
    database.prepare("UPDATE matches SET status = 'ended' WHERE id = 'match-unconfirmed'").run();

    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(snapshotId, firstRevision));
    const decision = assessment.decisions.find(({ fixtureId }) => fixtureId === "match-unconfirmed");
    assert.equal(decision?.state, "required_pending");
    assert.equal(decision?.reasonCode, "MISSING_SELECTED_RESULT");
    assert.equal(assessment.eligible, false);
  });
});

test("an explicit allowed cancellation exclusion is distinct from a missing result", () => {
  createCoverageFixture(({ database, firstRevision }) => {
    seedFixture(database, "match-cancelled", "cancelled");
    const snapshotId = createSnapshot(database, [
      { matchId: "match-1", revisionId: firstRevision.id }
    ]);
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(snapshotId, firstRevision, {
      policy: { allowedExclusionStatuses: ["cancelled"] },
      exclusions: [{
        matchId: "match-cancelled",
        status: "cancelled",
        reason: "Competition organizer recorded the fixture as cancelled."
      }]
    }));
    const excluded = assessment.decisions.find(({ fixtureId }) => fixtureId === "match-cancelled");
    assert.equal(excluded?.state, "explicitly_excluded");
    assert.equal(excluded?.reasonCode, "EXPLICIT_POLICY_EXCLUSION");
    assert.equal(assessment.eligible, true);
  });
});

test("an unallowed or implicit cancelled fixture blocks eligibility", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    seedFixture(database, "match-cancelled", "cancelled");
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(firstSnapshotId, firstRevision));
    assert.equal(assessment.eligible, false);
    assert.equal(
      assessment.decisions.find(({ fixtureId }) => fixtureId === "match-cancelled")?.state,
      "unresolved_ambiguous"
    );
    assert.ok(assessment.blockingReasons.some(({ code }) => code === "TERMINAL_FIXTURE_REQUIRES_EXPLICIT_EXCLUSION"));
  });
});

test("an exclusion without a reason and an unfinalized manifest are rejected", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const input = assessmentWithActualRevision(firstSnapshotId, firstRevision);
    const draft = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1"
    });
    assert.throws(
      () => assessStandingsCoverage(database, {
        ...input,
        manifestVersionId: draft.id
      }),
      /coverage requires an explicitly selected finalized schedule manifest/
    );
    assert.throws(
      () => assessStandingsCoverage(database, {
        ...input,
        exclusions: [{ matchId: "match-1", status: "cancelled", reason: "  " }]
      }),
      /every explicit exclusion requires a non-empty reason/
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      0
    );
  });
});

test("ambiguous participant assignments block eligibility", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    database.prepare("UPDATE fixture_participants SET slot = 'home-side' WHERE id = 'match-1-home'").run();
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(firstSnapshotId, firstRevision));
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.decisions[0]?.state, "unresolved_ambiguous");
    assert.equal(assessment.decisions[0]?.reasonCode, "INVALID_PARTICIPANT_ASSIGNMENT");
  });
});

test("foreign competition/season fixtures are not included in the requested scope", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, status
      ) VALUES ('foreign-match', 'competition-foreign', 'season-foreign', 'team-home', 'team-away', 'ended')
    `).run();
    const assessment = assessStandingsCoverage(database, assessmentWithActualRevision(firstSnapshotId, firstRevision));
    assert.equal(assessment.eligible, true);
    assert.deepEqual(assessment.decisions.map(({ fixtureId }) => fixtureId), ["match-1"]);
    assert.ok(!assessment.decisions.some(({ fixtureId }) => fixtureId === "foreign-match"));
  });
});

test("stage, group, and round scopes fail closed because the fixture model has no such boundaries", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const matchColumns = new Set((database.prepare("PRAGMA table_info(matches)").all() as Array<{ name: string }>)
      .map(({ name }) => name));
    assert.ok(!matchColumns.has("stage_id"));
    assert.ok(!matchColumns.has("group_id"));
    assert.ok(!matchColumns.has("round_id"));
    const unsupported = assessmentInput(firstSnapshotId, [{ matchId: "match-1", revisionId: firstRevision.id }], {
      scope: {
        type: "group",
        competitionId: "competition-1",
        seasonId: "season-1"
      }
    });
    assert.throws(
      () => assessStandingsCoverage(database, unsupported),
      /unsupported scope type "group".*only competition_season/
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      0
    );
  });
});

test("conflicting explicit revision selection is recorded as ambiguous and blocks eligibility", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const correctedRevision = appendResultRevision(database, {
      matchId: "match-1",
      homeScore: 2,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      validationState: "accepted",
      createdAt: "2026-10-15T08:02:00.000Z"
    });
    const assessment = assessStandingsCoverage(database, assessmentInput(firstSnapshotId, [
      { matchId: "match-1", revisionId: firstRevision.id },
      { matchId: "match-1", revisionId: correctedRevision.id }
    ]));
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.decisions[0]?.state, "unresolved_ambiguous");
    assert.equal(assessment.decisions[0]?.reasonCode, "CONFLICTING_SELECTED_REVISIONS");
  });
});

test("a snapshot from another competition or season is rejected without an assessment", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const mismatched = assessmentInput(firstSnapshotId, [{ matchId: "match-1", revisionId: firstRevision.id }], {
      scope: {
        type: "competition_season",
        competitionId: "competition-foreign",
        seasonId: "season-foreign"
      }
    });
    assert.throws(
      () => assessStandingsCoverage(database, mismatched),
      /snapshot competition and season do not match the assessed scope/
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      0
    );
  });
});

test("reassessment after a correction creates new history without changing the finalized assessment", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const firstAssessment = assessStandingsCoverage(database, assessmentWithActualRevision(firstSnapshotId, firstRevision));
    const oldHeader = database.prepare(`
      SELECT content_hash, content_json, eligibility_state
      FROM standings_coverage_assessments WHERE id = ?
    `).get(firstAssessment.id);
    const oldDecisions = database.prepare(`
      SELECT match_id, coverage_state, selected_revision_id, reason_code, reason
      FROM standings_coverage_fixtures WHERE assessment_id = ?
    `).all(firstAssessment.id);
    const correctedRevision = appendResultRevision(database, {
      matchId: "match-1",
      homeScore: 0,
      awayScore: 0,
      resultStatus: "ended",
      finalResultConfirmed: true,
      validationState: "accepted",
      createdAt: "2026-10-15T08:03:00.000Z"
    });
    const correctedSnapshot = createSnapshot(database, [
      { matchId: "match-1", revisionId: correctedRevision.id }
    ]);
    const newAssessment = assessStandingsCoverage(database, assessmentWithActualRevision(
      correctedSnapshot,
      correctedRevision
    ));
    assert.notEqual(firstAssessment.id, newAssessment.id);
    assert.equal(newAssessment.sequence, 1);
    assert.deepEqual(
      database.prepare(`
        SELECT content_hash, content_json, eligibility_state
        FROM standings_coverage_assessments WHERE id = ?
      `).get(firstAssessment.id),
      oldHeader
    );
    assert.deepEqual(
      database.prepare(`
        SELECT match_id, coverage_state, selected_revision_id, reason_code, reason
        FROM standings_coverage_fixtures WHERE assessment_id = ?
      `).all(firstAssessment.id),
      oldDecisions
    );
    assert.throws(
      () => database.prepare(`
        UPDATE standings_coverage_assessments SET eligibility_state = 'ineligible' WHERE id = ?
      `).run(firstAssessment.id),
      /finalized coverage assessments are immutable/
    );
  });
});

test("assessment persistence rolls back the header and earlier decisions on a fixture write failure", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    seedFixture(database, "match-2", "scheduled");
    const snapshotId = createSnapshot(database, [
      { matchId: "match-1", revisionId: firstRevision.id }
    ]);
    database.exec(`
      CREATE TRIGGER fail_coverage_fixture_insert
      BEFORE INSERT ON standings_coverage_fixtures
      BEGIN
        SELECT RAISE(ABORT, 'injected coverage failure');
      END;
    `);
    assert.throws(
      () => assessStandingsCoverage(database, assessmentWithActualRevision(snapshotId, firstRevision)),
      /injected coverage failure/
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      0
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_fixtures").get() as { count: number }).count,
      0
    );
    assert.notEqual(firstSnapshotId, snapshotId);
  });
});

test("identical assessment inputs produce the same content hash", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const input = assessmentWithActualRevision(firstSnapshotId, firstRevision);
    const first = assessStandingsCoverage(database, input);
    const second = assessStandingsCoverage(database, {
      ...input,
      assessedAt: "2026-10-16T10:00:00.000Z"
    });
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.notEqual(first.assessedAt, second.assessedAt);
  });
});

test("identical finalized manifest content produces the same content hash", () => {
  const hashes: Array<string | null> = [];
  for (let run = 0; run < 2; run += 1) {
    withDatabase((database) => {
      seedCompetition(database);
      const manifest = createScheduleManifest(database, {
        competitionId: "competition-1",
        seasonId: "season-1",
        createdAt: "2026-10-15T09:30:00.000Z"
      });
      addExpectedScheduleFixture(database, manifest.id, {
        fixtureKey: "canonical:match-1",
        homeTeamId: "team-home",
        awayTeamId: "team-away",
        matchId: "match-1"
      });
      hashes.push(finalizeScheduleManifest(
        database,
        manifest.id,
        "2026-10-15T09:31:00.000Z"
      ).contentHash);
    });
  }
  assert.ok(hashes[0]);
  assert.equal(hashes[0], hashes[1]);
});

test("an empty explicit fixture set is not treated as complete", () => {
  withDatabase((database) => {
    seedCompetition(database);
    database.exec(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES
        ('entry-foreign-home', 'competition-foreign', 'season-foreign', 'team', 'team-home', '2026-01-01T00:00:00.000Z'),
        ('entry-foreign-away', 'competition-foreign', 'season-foreign', 'team', 'team-away', '2026-01-01T00:00:00.000Z');
    `);
    const snapshotId = createSnapshot(database, [], "competition-foreign", "season-foreign");
    const assessment = assessStandingsCoverage(database, {
      scope: {
        type: "competition_season",
        competitionId: "competition-foreign",
        seasonId: "season-foreign"
      },
      snapshotId,
      policy: { allowedExclusionStatuses: [] },
      exclusions: [],
      revisionSelections: []
    });
    assert.equal(assessment.eligible, false);
    assert.ok(assessment.blockingReasons.some(({ code }) => code === "NO_EXPLICIT_FIXTURES"));
  });
});

test("explicit recalculation uses the requested accepted revision and preserves prior snapshot and coverage history", () => {
  withDatabase((database) => {
    const firstRevision = seedCompetition(database);
    const firstSnapshotId = createSnapshot(database, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ]);
    const firstAssessment = assessStandingsCoverage(database, assessmentWithActualRevision(
      firstSnapshotId,
      firstRevision,
      { assessedAt: "2026-10-15T10:00:00.000Z" }
    ));
    assert.ok(firstAssessment.manifestVersionId);
    const priorAssessmentJson = database.prepare(
      "SELECT content_json FROM standings_coverage_assessments WHERE id = ?"
    ).get(firstAssessment.id) as { content_json: string };
    const firstSnapshotRows = database.prepare(`
      SELECT entry_id, rank, played, points
      FROM standings_snapshot_rows WHERE snapshot_id = ? ORDER BY rank
    `).all(firstSnapshotId);

    const correctedRevision = appendResultRevision(database, {
      matchId: "match-1",
      homeScore: 0,
      awayScore: 2,
      resultStatus: "ended",
      finalResultConfirmed: true,
      validationState: "accepted",
      sourceCategory: "manual_operator",
      createdAt: "2026-10-15T11:00:00.000Z"
    });
    const recalculated = recalculateStandingsAfterAcceptedResultChange(database, {
      competitionId: "competition-1",
      seasonId: "season-1",
      ruleset: conventionalTeamLeagueRuleset,
      revisionSelections: [{ matchId: "match-1", revisionId: correctedRevision.id }],
      manifestVersionId: firstAssessment.manifestVersionId,
      policy: { allowedExclusionStatuses: [] },
      exclusions: [],
      calculatedAt: "2026-10-15T12:00:00.000Z",
      assessedAt: "2026-10-15T12:00:00.000Z"
    });

    assert.deepEqual(
      database.prepare(`
        SELECT revision_id, revision_number FROM standings_snapshot_results
        WHERE snapshot_id = ?
      `).get(recalculated.snapshot.id),
      { revision_id: correctedRevision.id, revision_number: correctedRevision.revisionNumber }
    );
    assert.equal(recalculated.coverage.snapshotId, recalculated.snapshot.id);
    assert.equal(recalculated.coverage.eligible, true);
    assert.deepEqual(database.prepare(`
      SELECT entry_id, rank, played, points
      FROM standings_snapshot_rows WHERE snapshot_id = ? ORDER BY rank
    `).all(firstSnapshotId), firstSnapshotRows);
    assert.deepEqual(database.prepare(
      "SELECT content_json FROM standings_coverage_assessments WHERE id = ?"
    ).get(firstAssessment.id), priorAssessmentJson);
    assert.deepEqual(
      database.prepare(`
        SELECT revision_id, revision_number FROM standings_snapshot_results
        WHERE snapshot_id = ?
      `).get(firstSnapshotId),
      { revision_id: firstRevision.id, revision_number: firstRevision.revisionNumber }
    );
  });
});

test("failed coverage after snapshot creation reports a recoverable snapshot instead of success", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const assessmentInputValue = assessmentWithActualRevision(firstSnapshotId, firstRevision);
    assert.ok(assessmentInputValue.manifestVersionId);
    database.exec(`
      CREATE TRIGGER fail_coverage_assessment_insert
      BEFORE INSERT ON standings_coverage_assessments
      BEGIN
        SELECT RAISE(ABORT, 'injected assessment failure');
      END;
    `);

    let failure: unknown;
    try {
      recalculateStandingsAfterAcceptedResultChange(database, {
        competitionId: "competition-1",
        seasonId: "season-1",
        ruleset: conventionalTeamLeagueRuleset,
        revisionSelections: [{ matchId: firstRevision.matchId, revisionId: firstRevision.id }],
        manifestVersionId: assessmentInputValue.manifestVersionId,
        policy: { allowedExclusionStatuses: [] },
        exclusions: [],
        calculatedAt: "2026-10-15T12:00:00.000Z",
        assessedAt: "2026-10-15T12:00:00.000Z"
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof StandingsCoverageAssessmentError);
    assert.equal(failure.manifestVersionId, assessmentInputValue.manifestVersionId);
    assert.equal(failure.cause instanceof Error ? failure.cause.message : "", "injected assessment failure");
    assert.ok(database.prepare("SELECT is_complete FROM standings_snapshots WHERE id = ?")
      .get(failure.snapshot.id));
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      0
    );

    database.exec("DROP TRIGGER fail_coverage_assessment_insert;");
    const recovered = assessStandingsCoverage(database, {
      ...assessmentInputValue,
      snapshotId: failure.snapshot.id
    });
    assert.equal(recovered.eligible, true);
    assert.equal(recovered.snapshotId, failure.snapshot.id);
  });
});

test("draft manifests keep stable fixture identities and finalized versions are immutable", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const first = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1",
      createdAt: "2026-10-15T13:00:00.000Z"
    });
    addExpectedScheduleFixture(database, first.id, {
      fixtureKey: "round-1-fixture-1",
      homeTeamId: "team-home",
      awayTeamId: "team-away"
    });
    addExpectedScheduleFixture(database, first.id, {
      fixtureKey: "round-1-fixture-1",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "match-1"
    });
    const finalized = finalizeScheduleManifest(database, first.id, "2026-10-15T13:01:00.000Z");

    assert.equal(finalized.state, "finalized");
    assert.equal(finalized.version, 1);
    assert.equal(finalized.fixtures.length, 1);
    assert.equal(finalized.fixtures[0]?.fixtureKey, "round-1-fixture-1");
    assert.equal(finalized.fixtures[0]?.matchId, "match-1");
    assert.equal(finalized.validation.complete, true);
    assert.equal(finalized.contentHash?.length, 64);
    const firstAssessment = assessStandingsCoverage(database, assessmentInput(firstSnapshotId, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ], { manifestVersionId: finalized.id }));
    const priorAssessment = database.prepare(`
      SELECT manifest_id, content_hash, content_json
      FROM standings_coverage_assessments WHERE id = ?
    `).get(firstAssessment.id);
    assert.throws(
      () => addExpectedScheduleFixture(database, finalized.id, {
        fixtureKey: "another-fixture",
        homeTeamId: "team-home",
        awayTeamId: "team-away"
      }),
      /finalized manifest versions are immutable/
    );
    assert.throws(
      () => database.prepare(`
        UPDATE standings_schedule_manifests SET content_hash = ? WHERE id = ?
      `).run("0".repeat(64), finalized.id),
      /finalized schedule manifests are immutable/
    );

    const second = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1",
      createdAt: "2026-10-15T13:02:00.000Z"
    });
    assert.equal(second.version, 2);
    assert.equal(second.supersedesManifestId, finalized.id);
    addExpectedScheduleFixture(database, second.id, {
      fixtureKey: "round-1-fixture-1",
      homeTeamId: "team-home",
      awayTeamId: "team-away"
    });
    resolveExpectedScheduleFixture(database, second.id, "round-1-fixture-1", "match-1");
    const finalizedSecond = finalizeScheduleManifest(database, second.id, "2026-10-15T13:03:00.000Z");
    assert.equal(finalizedSecond.fixtures[0]?.matchId, "match-1");
    assert.equal(validateScheduleManifest(database, finalized.id).contentHash, finalized.contentHash);
    const secondAssessment = assessStandingsCoverage(database, assessmentInput(firstSnapshotId, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ], { manifestVersionId: finalizedSecond.id }));
    assert.notEqual(firstAssessment.id, secondAssessment.id);
    assert.deepEqual(
      database.prepare(`
        SELECT manifest_id, content_hash, content_json
        FROM standings_coverage_assessments WHERE id = ?
      `).get(firstAssessment.id),
      priorAssessment
    );
  });
});

test("unresolved expected fixtures may be finalized as incomplete evidence but block eligibility", () => {
  createCoverageFixture(({ database, firstRevision }) => {
    const manifest = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1"
    });
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "match-1",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "match-1"
    });
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "future-fixture",
      homeTeamId: "team-home",
      awayTeamId: "team-away"
    });
    const finalized = finalizeScheduleManifest(database, manifest.id);
    assert.equal(finalized.state, "finalized");
    assert.equal(finalized.validation.complete, false);
    assert.ok(finalized.validation.findings.some(({ code }) => code === "UNRESOLVED_EXPECTED_FIXTURE"));
    const snapshotId = createSnapshot(database, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ]);
    const assessment = assessStandingsCoverage(database, assessmentInput(snapshotId, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ], { manifestVersionId: finalized.id }));
    assert.equal(assessment.scheduleState, "incomplete");
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.manifestDecisions.find(({ fixtureKey }) => fixtureKey === "future-fixture")?.state, "unresolved_ambiguous");
  });
});

test("a canonical fixture omitted from a finalized manifest makes schedule coverage invalid", () => {
  createCoverageFixture(({ database, firstRevision }) => {
    seedFixture(database, "match-omitted", "scheduled");
    const manifest = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1"
    });
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "only-listed-fixture",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "match-1"
    });
    const finalized = finalizeScheduleManifest(database, manifest.id);
    assert.ok(finalized.validation.findings.some(({ code, matchId }) =>
      code === "CANONICAL_FIXTURE_OMITTED" && matchId === "match-omitted"
    ));
    const snapshotId = createSnapshot(database, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ]);
    const assessment = assessStandingsCoverage(database, assessmentInput(snapshotId, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ], { manifestVersionId: finalized.id }));
    assert.equal(assessment.scheduleState, "invalid");
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.decisions.find(({ fixtureId }) => fixtureId === "match-omitted")?.reasonCode, "FIXTURE_NOT_IN_MANIFEST");
  });
});

test("manifest validation rejects canonical fixtures in another scope or with different participants", () => {
  createCoverageFixture(({ database }) => {
    database.prepare(`
      INSERT INTO seasons(id, competition_id) VALUES ('season-other', 'competition-1')
    `).run();
    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, status
      ) VALUES ('foreign-match', 'competition-foreign', 'season-foreign',
        'team-home', 'team-away', 'scheduled')
    `).run();
    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, status
      ) VALUES ('other-season-match', 'competition-1', 'season-other',
        'team-home', 'team-away', 'scheduled')
    `).run();
    const manifest = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1"
    });
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "wrong-scope",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "foreign-match"
    });
    assert.ok(validateScheduleManifest(database, manifest.id).validation.findings.some(({ code }) =>
      code === "CANONICAL_FIXTURE_SCOPE_MISMATCH"
    ));
    assert.throws(
      () => finalizeScheduleManifest(database, manifest.id),
      /manifest has invalid entries: CANONICAL_FIXTURE_SCOPE_MISMATCH/
    );
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "wrong-scope",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "other-season-match"
    });
    assert.ok(validateScheduleManifest(database, manifest.id).validation.findings.some(({ code }) =>
      code === "CANONICAL_FIXTURE_SCOPE_MISMATCH"
    ));
    assert.throws(
      () => finalizeScheduleManifest(database, manifest.id),
      /manifest has invalid entries: CANONICAL_FIXTURE_SCOPE_MISMATCH/
    );
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "wrong-scope",
      homeTeamId: "team-away",
      awayTeamId: "team-home",
      matchId: "match-1"
    });
    assert.ok(validateScheduleManifest(database, manifest.id).validation.findings.some(({ code }) =>
      code === "CANONICAL_FIXTURE_PARTICIPANT_MISMATCH"
    ));
    assert.throws(
      () => finalizeScheduleManifest(database, manifest.id),
      /manifest has invalid entries: CANONICAL_FIXTURE_PARTICIPANT_MISMATCH/
    );
    assert.equal(validateScheduleManifest(database, manifest.id).state, "draft");
  });
});

test("manifest writes roll back on invalid canonical references and duplicate fixture assignments", () => {
  createCoverageFixture(({ database }) => {
    const manifest = createScheduleManifest(database, {
      competitionId: "competition-1",
      seasonId: "season-1"
    });
    addExpectedScheduleFixture(database, manifest.id, {
      fixtureKey: "first",
      homeTeamId: "team-home",
      awayTeamId: "team-away",
      matchId: "match-1"
    });
    assert.throws(
      () => addExpectedScheduleFixture(database, manifest.id, {
        fixtureKey: "duplicate-match",
        homeTeamId: "team-home",
        awayTeamId: "team-away",
        matchId: "match-1"
      }),
      /UNIQUE constraint failed/
    );
    assert.throws(
      () => addExpectedScheduleFixture(database, manifest.id, {
        fixtureKey: "unknown-match",
        homeTeamId: "team-home",
        awayTeamId: "team-away",
        matchId: "does-not-exist"
      }),
      /FOREIGN KEY constraint failed/
    );
    assert.equal(
      (database.prepare(`
        SELECT COUNT(*) AS count FROM standings_schedule_manifest_fixtures WHERE manifest_id = ?
      `).get(manifest.id) as { count: number }).count,
      1
    );
  });
});

test("coverage assessment manifest decisions persist atomically and hashes are deterministic", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const input = assessmentWithActualRevision(firstSnapshotId, firstRevision);
    const first = assessStandingsCoverage(database, input);
    const second = assessStandingsCoverage(database, { ...input, assessedAt: "2026-10-16T10:00:00.000Z" });
    assert.equal(first.scheduleState, "verified_complete");
    assert.equal(first.eligible, true);
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.manifestDecisions.length, 1);
    database.exec(`
      CREATE TRIGGER fail_coverage_manifest_fixture_insert
      BEFORE INSERT ON standings_coverage_manifest_fixtures
      BEGIN
        SELECT RAISE(ABORT, 'injected manifest decision failure');
      END;
    `);
    assert.throws(
      () => assessStandingsCoverage(database, input),
      /injected manifest decision failure/
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
      2
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_manifest_fixtures").get() as { count: number }).count,
      2
    );
  });
});

test("coverage remains ineligible without an explicitly selected manifest", () => {
  createCoverageFixture(({ database, firstRevision, firstSnapshotId }) => {
    const assessment = assessStandingsCoverage(database, assessmentInput(firstSnapshotId, [
      { matchId: firstRevision.matchId, revisionId: firstRevision.id }
    ], { manifestVersionId: undefined }));
    assert.equal(assessment.scheduleState, "unverified");
    assert.equal(assessment.eligible, false);
    assert.ok(assessment.blockingReasons.some(({ code }) => code === "SCHEDULE_MANIFEST_REQUIRED"));
  });
});
