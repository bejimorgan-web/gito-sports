import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-score-revisions-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = path.join(testDirectory, "score-revisions.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.GITO_NEWS_TEST_MODE = "false";
process.env.DB_READONLY_MODE = "false";

const [
  { closeDatabase, getDatabase },
  { scoresRouter },
  { createAccessToken },
  { ScoreService },
  { addExpectedScheduleFixture, createScheduleManifest, finalizeScheduleManifest },
  { conventionalTeamLeagueRuleset },
  { recalculateStandingsAfterAcceptedResultChange }
] = await Promise.all([
  import("../db/connection.js"),
  import("./scores.js"),
  import("../services/jwt.js"),
  import("../services/score-service.js"),
  import("../services/standings-schedule-manifest-service.js"),
  import("../services/standings-calculation-service.js"),
  import("../services/standings-recalculation-service.js")
]);

function seedDatabase() {
  const database = getDatabase();
  const now = new Date().toISOString();
  const kickoff = new Date(Date.now() + 60_000).toISOString();
  database.prepare(`
    INSERT INTO sports (id, name, slug, created_at, updated_at)
    VALUES ('sport-football', 'Football', 'football', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at)
    VALUES ('competition-1', 'sport-football', 'League', 'league', 'national', ?, ?)
  `).run(now, now);
  database.prepare(`
    INSERT INTO seasons (id, competition_id, name, starts_at, ends_at, status)
    VALUES ('season-1', 'competition-1', '2026', NULL, NULL, 'active')
  `).run();
  database.prepare(`
    INSERT INTO teams (id, sport_id, name, type, created_at, updated_at)
    VALUES ('team-home', 'sport-football', 'Home', 'club', ?, ?),
           ('team-away', 'sport-football', 'Away', 'club', ?, ?)
  `).run(now, now, now, now);
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
    ) VALUES (?, 'competition-1', 'season-1', 'team-home', 'team-away', ?, 'scheduled', ?, ?)
  `).run("canonical-match-1", kickoff, now, now);
  database.prepare(`
    INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
    VALUES ('operator-admin', 'Admin', 'admin@example.test', 'admin', 'active', ?, ?)
  `).run(now, now);
  ScoreService.setSourceMode("manual");
  return database;
}

async function startTestServer() {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use("/scores", scoresRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/scores` };
}

async function request(baseUrl: string, route: string, method: string, body: unknown, token: string) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test("manual score APIs atomically append pending and confirmed revisions without changing responses or match IDs", async (t) => {
  const database = seedDatabase();
  const { server, baseUrl } = await startTestServer();
  const token = createAccessToken({ sub: "operator-admin", role: "admin" });
  try {
    const started = await request(baseUrl, "/manual/canonical-match-1/start", "POST", { version: 0 }, token);
    assert.equal(started.status, 200);
    assert.equal(started.body.data.matchId, "canonical-match-1");
    assert.equal(started.body.data.status, "live");
    assert.equal(started.body.data.finalResultConfirmed, false);
    assert.equal("revision" in started.body.data, false);
    assert.deepEqual(database.prepare(`
      SELECT match_id, home_score, away_score, result_status, final_result_confirmed,
             validation_state, source_category, actor_operator_id, revision_number
      FROM match_result_revisions WHERE match_id = 'canonical-match-1'
    `).get(), {
      match_id: "canonical-match-1",
      home_score: 0,
      away_score: 0,
      result_status: "live",
      final_result_confirmed: 0,
      validation_state: "pending",
      source_category: "manual_operator",
      actor_operator_id: "operator-admin",
      revision_number: 1
    });

    const updated = await request(baseUrl, "/manual/canonical-match-1", "PATCH", {
      version: 1,
      homeScore: 1,
      awayScore: 0
    }, token);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.matchId, "canonical-match-1");
    assert.equal(updated.body.data.homeScore, 1);
    assert.equal(updated.body.data.finalResultConfirmed, false);

    const noOp = await request(baseUrl, "/manual/canonical-match-1", "PATCH", {
      version: 2,
      homeScore: 1,
      awayScore: 0
    }, token);
    assert.equal(noOp.status, 200);
    assert.equal(noOp.body.data.version, 3);
    assert.equal((database.prepare(`
      SELECT COUNT(*) AS count FROM match_result_revisions WHERE match_id = 'canonical-match-1'
    `).get() as { count: number }).count, 2);

    const ended = await request(baseUrl, "/manual/canonical-match-1", "PATCH", {
      version: 3,
      status: "ended"
    }, token);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data.finalResultConfirmed, false);

    const confirmed = await request(baseUrl, "/manual/canonical-match-1/confirm", "POST", { version: 4 }, token);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.data.finalResultConfirmed, true);
    const accepted = database.prepare(`
      SELECT id, home_score, away_score, validation_state, source_category, actor_operator_id,
             revision_number, supersedes_revision_id
      FROM match_result_revisions
      WHERE match_id = 'canonical-match-1'
      ORDER BY revision_number DESC
      LIMIT 1
    `).get() as Record<string, unknown>;
    assert.deepEqual(accepted, {
      id: accepted.id,
      home_score: 1,
      away_score: 0,
      validation_state: "accepted",
      source_category: "manual_operator",
      actor_operator_id: "operator-admin",
      revision_number: 4,
      supersedes_revision_id: database.prepare(`
        SELECT id FROM match_result_revisions WHERE match_id = 'canonical-match-1' AND revision_number = 3
      `).get()?.id
    });

    const corrected = await request(baseUrl, "/manual/canonical-match-1/correct", "POST", {
      version: 5,
      homeScore: 2,
      awayScore: 0,
      reason: "Verified score correction"
    }, token);
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.data.matchId, "canonical-match-1");
    assert.equal(corrected.body.data.finalResultConfirmed, true);
    const correction = database.prepare(`
      SELECT home_score, away_score, validation_state, revision_number, supersedes_revision_id
      FROM match_result_revisions
      WHERE match_id = 'canonical-match-1'
      ORDER BY revision_number DESC
      LIMIT 1
    `).get();
    assert.deepEqual(correction, {
      home_score: 2,
      away_score: 0,
      validation_state: "accepted",
      revision_number: 5,
      supersedes_revision_id: accepted.id
    });
    assert.deepEqual(
      database.prepare("SELECT id FROM matches WHERE id='canonical-match-1'").get(),
      { id: "canonical-match-1" }
    );

    const now = new Date().toISOString();
    const kickoff = new Date(Date.now() + 60_000).toISOString();
    database.prepare(`
      INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at)
      VALUES ('competition-standings-e2e', 'sport-football', 'Standings E2E', 'standings-e2e', 'national', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO seasons (id, competition_id, name, starts_at, ends_at, status)
      VALUES ('season-standings-e2e', 'competition-standings-e2e', '2026', NULL, NULL, 'active')
    `).run();
    database.prepare(`
      INSERT INTO teams (id, sport_id, name, type, created_at, updated_at)
      VALUES ('team-third', 'sport-football', 'Third', 'club', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO competition_entries
        (id, competition_id, season_id, entry_type, team_id, created_at)
      VALUES ('entry-home-e2e', 'competition-standings-e2e', 'season-standings-e2e', 'team', 'team-home', ?),
             ('entry-away-e2e', 'competition-standings-e2e', 'season-standings-e2e', 'team', 'team-away', ?),
             ('entry-third-e2e', 'competition-standings-e2e', 'season-standings-e2e', 'team', 'team-third', ?)
    `).run(now, now, now);
    const standingsFixtures = [
      { id: "standings-match-1", homeTeamId: "team-home", awayTeamId: "team-away" },
      { id: "standings-match-2", homeTeamId: "team-home", awayTeamId: "team-third" },
      { id: "standings-match-3", homeTeamId: "team-away", awayTeamId: "team-third" }
    ];
    const entryByTeam = new Map([
      ["team-home", "entry-home-e2e"],
      ["team-away", "entry-away-e2e"],
      ["team-third", "entry-third-e2e"]
    ]);
    for (const fixture of standingsFixtures) {
      database.prepare(`
        INSERT INTO matches (
          id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
        ) VALUES (?, 'competition-standings-e2e', 'season-standings-e2e', ?, ?, ?, 'scheduled', ?, ?)
      `).run(fixture.id, fixture.homeTeamId, fixture.awayTeamId, kickoff, now, now);
      database.prepare(`
        INSERT INTO fixture_participants
          (id, match_id, competition_id, season_id, entry_id, slot, created_at)
        VALUES (?, ?, 'competition-standings-e2e', 'season-standings-e2e', ?, 'home', ?),
               (?, ?, 'competition-standings-e2e', 'season-standings-e2e', ?, 'away', ?)
      `).run(
        `${fixture.id}-home`, fixture.id, entryByTeam.get(fixture.homeTeamId), now,
        `${fixture.id}-away`, fixture.id, entryByTeam.get(fixture.awayTeamId), now
      );
    }
    const manifest = createScheduleManifest(database, {
      competitionId: "competition-standings-e2e",
      seasonId: "season-standings-e2e",
      createdAt: "2026-10-15T09:00:00.000Z"
    });
    for (const fixture of standingsFixtures) {
      addExpectedScheduleFixture(database, manifest.id, {
        fixtureKey: `fixture:${fixture.id}`,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        matchId: fixture.id
      });
    }
    const finalizedManifest = finalizeScheduleManifest(database, manifest.id, "2026-10-15T09:01:00.000Z", {
      name: "Official end-to-end schedule",
      reference: "E2E-SCHEDULE-2026",
      contentHash: crypto.createHash("sha256").update("official e2e schedule").digest("hex")
    });
    assert.equal(finalizedManifest.validation.complete, true);

    const enterAndConfirmResult = async (matchId: string, homeScore: number, awayScore: number) => {
      const resultStarted = await request(baseUrl, `/manual/${matchId}/start`, "POST", { version: 0 }, token);
      assert.equal(resultStarted.status, 200);
      const resultEnded = await request(baseUrl, `/manual/${matchId}`, "PATCH", {
        version: 1,
        homeScore,
        awayScore,
        status: "ended"
      }, token);
      assert.equal(resultEnded.status, 200);
      assert.equal(resultEnded.body.data.finalResultConfirmed, false);
      const resultConfirmed = await request(baseUrl, `/manual/${matchId}/confirm`, "POST", { version: 2 }, token);
      assert.equal(resultConfirmed.status, 200);
      assert.equal(resultConfirmed.body.data.finalResultConfirmed, true);
      assert.equal(database.prepare("SELECT status FROM matches WHERE id = ?").get(matchId)?.status, "ended");
    };
    await enterAndConfirmResult("standings-match-1", 2, 0);
    await enterAndConfirmResult("standings-match-2", 0, 1);
    await enterAndConfirmResult("standings-match-3", 2, 0);

    const readRevisionSelections = () => standingsFixtures.map(({ id }) => {
      const revision = database.prepare(`
        SELECT id FROM match_result_revisions
        WHERE match_id = ? AND validation_state = 'accepted'
        ORDER BY revision_number DESC LIMIT 1
      `).get(id) as { id: string } | undefined;
      assert.ok(revision);
      return { matchId: id, revisionId: revision.id };
    });
    const firstSelections = readRevisionSelections();
    const firstRecalculation = recalculateStandingsAfterAcceptedResultChange(database, {
      competitionId: "competition-standings-e2e",
      seasonId: "season-standings-e2e",
      ruleset: conventionalTeamLeagueRuleset,
      revisionSelections: firstSelections,
      manifestVersionId: finalizedManifest.id,
      policy: { allowedExclusionStatuses: [] },
      exclusions: [],
      calculatedAt: "2026-10-15T09:10:00.000Z",
      assessedAt: "2026-10-15T09:10:00.000Z"
    });
    assert.equal(firstRecalculation.coverage.eligible, true);
    assert.deepEqual(firstRecalculation.snapshot.result.rows.map((row) => ({
      entryId: row.entryId,
      rank: row.rank,
      played: row.played,
      points: row.points,
      scoreDifference: row.scoreDifference
    })), [
      { entryId: "entry-home-e2e", rank: 1, played: 2, points: 3, scoreDifference: 1 },
      { entryId: "entry-away-e2e", rank: 2, played: 2, points: 3, scoreDifference: 0 },
      { entryId: "entry-third-e2e", rank: 3, played: 2, points: 3, scoreDifference: -1 }
    ]);
    assert.deepEqual(
      database.prepare(`
        SELECT match_id, revision_id, revision_number
        FROM standings_snapshot_results
        WHERE snapshot_id = ?
        ORDER BY match_id
      `).all(firstRecalculation.snapshot.id),
      firstSelections.slice().sort((left, right) => left.matchId.localeCompare(right.matchId))
        .map(({ matchId, revisionId }) => ({ match_id: matchId, revision_id: revisionId, revision_number: 3 }))
    );
    assert.equal(
      (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_fixtures WHERE assessment_id = ?")
        .get(firstRecalculation.coverage.id) as { count: number }).count,
      3
    );
    const historicalSnapshot = database.prepare(`
      SELECT content_hash, content_json FROM standings_snapshots WHERE id = ?
    `).get(firstRecalculation.snapshot.id);
    const historicalAssessment = database.prepare(`
      SELECT content_hash, content_json FROM standings_coverage_assessments WHERE id = ?
    `).get(firstRecalculation.coverage.id);
    const historicalManifestHash = finalizedManifest.contentHash;

    const noOpAcceptedUpdate = await request(baseUrl, "/manual/standings-match-1/correct", "POST", {
      version: 3,
      homeScore: 2,
      awayScore: 0,
      reason: "Verify repeated result does not append duplicate evidence"
    }, token);
    assert.equal(noOpAcceptedUpdate.status, 200);
    assert.equal((database.prepare(`
      SELECT COUNT(*) AS count FROM match_result_revisions WHERE match_id = 'standings-match-1'
    `).get() as { count: number }).count, 3);

    const correctedStandingsResult = await request(baseUrl, "/manual/standings-match-1/correct", "POST", {
      version: 4,
      homeScore: 0,
      awayScore: 2,
      reason: "Verified score correction"
    }, token);
    assert.equal(correctedStandingsResult.status, 200);
    const secondSelections = readRevisionSelections();
    const correctedRecalculation = recalculateStandingsAfterAcceptedResultChange(database, {
      competitionId: "competition-standings-e2e",
      seasonId: "season-standings-e2e",
      ruleset: conventionalTeamLeagueRuleset,
      revisionSelections: secondSelections,
      manifestVersionId: finalizedManifest.id,
      policy: { allowedExclusionStatuses: [] },
      exclusions: [],
      calculatedAt: "2026-10-15T09:20:00.000Z",
      assessedAt: "2026-10-15T09:20:00.000Z"
    });
    assert.equal(correctedRecalculation.coverage.eligible, true);
    assert.notEqual(correctedRecalculation.snapshot.id, firstRecalculation.snapshot.id);
    assert.deepEqual(correctedRecalculation.snapshot.result.rows.map((row) => ({
      entryId: row.entryId,
      rank: row.rank,
      points: row.points,
      scoreDifference: row.scoreDifference
    })), [
      { entryId: "entry-away-e2e", rank: 1, points: 6, scoreDifference: 4 },
      { entryId: "entry-third-e2e", rank: 2, points: 3, scoreDifference: -1 },
      { entryId: "entry-home-e2e", rank: 3, points: 0, scoreDifference: -3 }
    ]);
    assert.notEqual(secondSelections[0]?.revisionId, firstSelections[0]?.revisionId);
    assert.deepEqual(
      database.prepare(`
        SELECT match_id, revision_id, revision_number
        FROM standings_snapshot_results
        WHERE snapshot_id = ?
        ORDER BY match_id
      `).all(correctedRecalculation.snapshot.id),
      secondSelections.slice().sort((left, right) => left.matchId.localeCompare(right.matchId))
        .map(({ matchId, revisionId }) => ({
          match_id: matchId,
          revision_id: revisionId,
          revision_number: matchId === "standings-match-1" ? 4 : 3
        }))
    );
    assert.deepEqual(
      database.prepare(`
        SELECT content_hash, content_json FROM standings_snapshots WHERE id = ?
      `).get(firstRecalculation.snapshot.id),
      historicalSnapshot
    );
    assert.deepEqual(
      database.prepare(`
        SELECT content_hash, content_json FROM standings_coverage_assessments WHERE id = ?
      `).get(firstRecalculation.coverage.id),
      historicalAssessment
    );
    assert.equal(finalizedManifest.contentHash, historicalManifestHash);

    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
      ) VALUES ('canonical-match-missing-score', 'competition-1', 'season-1', 'team-home', 'team-away',
                ?, 'scheduled', ?, ?)
    `).run(kickoff, now, now);
    const missingScoreStarted = await request(
      baseUrl,
      "/manual/canonical-match-missing-score/start",
      "POST",
      { version: 0 },
      token
    );
    assert.equal(missingScoreStarted.status, 200);
    const missingScoreEnded = await request(
      baseUrl,
      "/manual/canonical-match-missing-score",
      "PATCH",
      { version: 1, status: "ended" },
      token
    );
    assert.equal(missingScoreEnded.status, 200);
    const missingScoreConfirmation = await request(
      baseUrl,
      "/manual/canonical-match-missing-score/confirm",
      "POST",
      { version: 2 },
      token
    );
    assert.equal(missingScoreConfirmation.status, 400);
    assert.equal(missingScoreConfirmation.body.error, "score_values_required");
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM match_result_revisions
      WHERE match_id = 'canonical-match-missing-score'
        AND validation_state = 'accepted'
    `).get()?.count, 0);
    const explicitZeroZero = await request(
      baseUrl,
      "/manual/canonical-match-missing-score/confirm",
      "POST",
      { version: 2, homeScore: 0, awayScore: 0 },
      token
    );
    assert.equal(explicitZeroZero.status, 200);
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, validation_state, final_result_confirmed
      FROM match_result_revisions
      WHERE match_id = 'canonical-match-missing-score'
      ORDER BY revision_number DESC LIMIT 1
    `).get(), {
      home_score: 0,
      away_score: 0,
      validation_state: "accepted",
      final_result_confirmed: 1
    });

    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
      ) VALUES ('canonical-match-event', 'competition-1', 'season-1', 'team-home', 'team-away',
                ?, 'scheduled', ?, ?)
    `).run(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString(), new Date().toISOString());
    const eventFixtureStarted = await request(baseUrl, "/manual/canonical-match-event/start", "POST", { version: 0 }, token);
    assert.equal(eventFixtureStarted.status, 200);
    const scoreNote = await request(baseUrl, "/manual/canonical-match-event/events", "POST", {
      version: 1,
      minute: 10,
      eventType: "note",
      description: "Score verified from the match report",
      homeScore: 2,
      awayScore: 0
    }, token);
    assert.equal(scoreNote.status, 201);
    assert.equal(scoreNote.body.data.scoreState.homeScore, 2);
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, result_status, final_result_confirmed,
             validation_state, source_category, revision_number
      FROM match_result_revisions WHERE match_id = 'canonical-match-event'
      ORDER BY revision_number DESC LIMIT 1
    `).get(), {
      home_score: 2,
      away_score: 0,
      result_status: "live",
      final_result_confirmed: 0,
      validation_state: "pending",
      source_category: "manual_operator",
      revision_number: 2
    });

    await t.test("failed revision append rolls back manual score state and audit writes", async () => {
      database.prepare(`
        INSERT INTO matches (
          id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
        ) VALUES ('canonical-match-failure', 'competition-1', 'season-1', 'team-home', 'team-away',
                  ?, 'scheduled', ?, ?)
      `).run(new Date(Date.now() + 60_000).toISOString(), new Date().toISOString(), new Date().toISOString());
      database.exec(`
        CREATE TRIGGER reject_score_result_revision
        BEFORE INSERT ON match_result_revisions
        BEGIN
          SELECT RAISE(ABORT, 'forced result revision failure');
        END;
      `);
      const response = await request(baseUrl, "/manual/canonical-match-failure/start", "POST", { version: 0 }, token);
      assert.equal(response.status, 500);
      assert.deepEqual(database.prepare(`
        SELECT COUNT(*) AS count FROM match_score_state WHERE match_id = 'canonical-match-failure'
      `).get(), { count: 0 });
      assert.deepEqual(database.prepare(`
        SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = 'canonical-match-failure'
      `).get(), { count: 0 });
      assert.equal(database.prepare(`
        SELECT status FROM matches WHERE id = 'canonical-match-failure'
      `).get()?.status, "scheduled");
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test.after(() => {
  closeDatabase();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
