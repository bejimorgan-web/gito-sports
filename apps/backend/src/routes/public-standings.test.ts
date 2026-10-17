import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-public-standings-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = path.join(testDirectory, "public-standings.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.DB_READONLY_MODE = "false";

const [
  { closeDatabase, getDatabase },
  { publicStandingsRouter },
  { standingsRouter },
  { createAccessToken },
  { appendResultRevision, createStandingsSnapshot },
  { conventionalTeamLeagueRuleset },
  { createScheduleManifest, addExpectedScheduleFixture, finalizeScheduleManifest },
  { assessStandingsCoverage }
] = await Promise.all([
  import("../db/connection.js"),
  import("./public-standings.js"),
  import("./standings.js"),
  import("../services/jwt.js"),
  import("../services/standings-snapshot-service.js"),
  import("../services/standings-calculation-service.js"),
  import("../services/standings-schedule-manifest-service.js"),
  import("../services/standings-coverage-service.js")
]);

const timestamp = "2026-02-01T00:00:00.000Z";

function seedStandings() {
  const database = getDatabase();
  const proposers = [
    ["public-ruleset-proposer", "public-ruleset-proposer@example.test"],
    ["public-ruleset-approver", "public-ruleset-approver@example.test"]
  ] as const;
  for (const [id, email] of proposers) {
    database.prepare(`
      INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 'active', ?, ?)
    `).run(id, id, email, timestamp, timestamp);
  }
  database.prepare(`
    INSERT INTO sports (id, name, slug, created_at, updated_at)
    VALUES ('sport-public', 'Football', 'football-public', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at)
    VALUES ('competition-public', 'sport-public', 'Public League', 'public-league', 'national', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO seasons (id, competition_id, name, status)
    VALUES ('season-public', 'competition-public', '2026', 'active'),
           ('season-no-snapshot', 'competition-public', '2025', 'completed')
  `).run();
  database.prepare(`
    INSERT INTO teams (id, sport_id, name, type, created_at, updated_at)
    VALUES ('team-public-home', 'sport-public', 'Home United', 'club', ?, ?),
           ('team-public-away', 'sport-public', 'Away City', 'club', ?, ?)
  `).run(timestamp, timestamp, timestamp, timestamp);
  database.prepare(`
    INSERT INTO competition_entries (
      id, competition_id, season_id, entry_type, team_id, player_id, created_at
    ) VALUES ('entry-public-home', 'competition-public', 'season-public', 'team', 'team-public-home', NULL, ?),
             ('entry-public-away', 'competition-public', 'season-public', 'team', 'team-public-away', NULL, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
    ) VALUES (
      'match-public', 'competition-public', 'season-public', 'team-public-home', 'team-public-away',
      '2026-02-02T00:00:00.000Z', 'ended', ?, ?
    )
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO fixture_participants (
      id, match_id, competition_id, season_id, entry_id, slot, created_at
    ) VALUES ('participant-public-home', 'match-public', 'competition-public', 'season-public', 'entry-public-home', 'home', ?),
             ('participant-public-away', 'match-public', 'competition-public', 'season-public', 'entry-public-away', 'away', ?)
  `).run(timestamp, timestamp);

  const revision = appendResultRevision(database, {
    matchId: "match-public",
    homeScore: 2,
    awayScore: 1,
    resultStatus: "ended",
    finalResultConfirmed: true,
    validationState: "accepted",
    sourceCategory: "manual_operator",
    createdAt: timestamp
  });
  const rulesetJson = JSON.stringify(conventionalTeamLeagueRuleset);
  const rulesetApprovalId = "public-ruleset-approval";
  database.prepare(`
    INSERT INTO standings_rulesets (
      id, competition_id, season_id, ruleset_id, ruleset_version, ruleset_json,
      ruleset_hash, status, proposed_by_operator_id, proposed_at
    ) VALUES (?, 'competition-public', 'season-public', ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    rulesetApprovalId,
    conventionalTeamLeagueRuleset.id,
    conventionalTeamLeagueRuleset.version,
    rulesetJson,
    crypto.createHash("sha256").update(rulesetJson).digest("hex"),
    proposers[0][0],
    timestamp
  );
  database.prepare(`
    UPDATE standings_rulesets SET status = 'approved', approved_by_operator_id = ?, approved_at = ? WHERE id = ?
  `).run(proposers[1][0], timestamp, rulesetApprovalId);
  const snapshot = createStandingsSnapshot(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-public", revisionId: revision.id }],
    rulesetApproval: {
      competitionId: "competition-public",
      seasonId: "season-public",
      rulesetId: conventionalTeamLeagueRuleset.id,
      rulesetVersion: conventionalTeamLeagueRuleset.version,
      approvalId: rulesetApprovalId,
      approvedByOperatorId: proposers[1][0],
      approvedAt: timestamp
    },
    calculatedAt: timestamp
  });
  const manifest = createScheduleManifest(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    createdAt: timestamp
  });
  addExpectedScheduleFixture(database, manifest.id, {
    fixtureKey: "matchday-1",
    homeTeamId: "team-public-home",
    awayTeamId: "team-public-away",
    matchId: "match-public"
  });
  finalizeScheduleManifest(database, manifest.id, timestamp, {
    name: "Official public test schedule",
    reference: "public-test-schedule",
    contentHash: "b".repeat(64)
  });
  const assessment = assessStandingsCoverage(database, {
    scope: { type: "competition_season", competitionId: "competition-public", seasonId: "season-public" },
    snapshotId: snapshot.id,
    policy: { allowedExclusionStatuses: [] },
    exclusions: [],
    manifestVersionId: manifest.id,
    assessedAt: timestamp
  });
  assert.equal(assessment.eligible, true);
  return { database, revision, snapshot, manifest, assessment };
}

async function startTestServer() {
  const express = (await import("express")).default;
  const app = express();
  app.use("/public/standings", publicStandingsRouter);
  app.use("/standings", standingsRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function get(url: string, token?: string) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test("public standings reads persisted data without auth and reports provisional coverage safely", async (t) => {
  let server: http.Server | undefined;
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    closeDatabase();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  const { database, revision, snapshot, manifest, assessment } = seedStandings();
  const runningServer = await startTestServer();
  server = runningServer.server;
  const publicUrl = `${runningServer.baseUrl}/public/standings`;
  const adminUrl = `${runningServer.baseUrl}/standings`;
  const adminToken = createAccessToken({ sub: "private-operator-id", role: "admin" });
  const counts = () => ({
    snapshots: (database.prepare("SELECT COUNT(*) AS count FROM standings_snapshots").get() as { count: number }).count,
    revisions: (database.prepare("SELECT COUNT(*) AS count FROM match_result_revisions").get() as { count: number }).count,
    manifests: (database.prepare("SELECT COUNT(*) AS count FROM standings_schedule_manifests").get() as { count: number }).count,
    assessments: (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count
  });

  assert.deepEqual(await get(`${adminUrl}/competition-public/season-public`), {
    status: 401,
    body: { error: "missing_token" }
  });

  const beforeReads = counts();
  const eligible = await get(`${publicUrl}/competition-public/season-public`);
  assert.equal(eligible.status, 200);
  assert.deepEqual(eligible.body.data.competition, { id: "competition-public", name: "Public League" });
  assert.deepEqual(eligible.body.data.season, { id: "season-public", name: "2026" });
  assert.deepEqual(eligible.body.data.snapshot, {
    id: snapshot.id,
    sequence: 1,
    calculatedAt: timestamp,
    ruleset: { id: conventionalTeamLeagueRuleset.id, version: conventionalTeamLeagueRuleset.version }
  });
  assert.equal(eligible.body.data.status, "eligible");
  assert.equal(eligible.body.data.explanation, null);
  assert.deepEqual(eligible.body.data.coverage, {
    status: "verified_complete",
    manifestVersion: 1,
    scheduleSource: { name: "Official public test schedule" }
  });
  assert.deepEqual(eligible.body.data.rows, [
    {
      rank: 1, team: { id: "team-public-home", name: "Home United" },
      played: 1, won: 1, drawn: 0, lost: 0,
      goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3
    },
    {
      rank: 2, team: { id: "team-public-away", name: "Away City" },
      played: 1, won: 0, drawn: 0, lost: 1,
      goalsFor: 1, goalsAgainst: 2, goalDifference: -1, points: 0
    }
  ]);
  assert.equal(JSON.stringify(eligible.body).includes("private-operator-id"), false);
  assert.equal("resultRevisions" in eligible.body.data, false);
  assert.equal("assessment" in eligible.body.data, false);
  assert.deepEqual(counts(), beforeReads);

  database.exec("DROP TRIGGER trg_standings_snapshots_no_update");
  const readSnapshotIntegrity = () => database.prepare(`
    SELECT ruleset_id, ruleset_version, content_hash, content_json
    FROM standings_snapshots WHERE id = ?
  `).get(snapshot.id) as {
    ruleset_id: string;
    ruleset_version: number;
    content_hash: string;
    content_json: string;
  };
  for (const mismatch of [
    { field: "ruleset_id", value: "corrupt-ruleset" },
    { field: "ruleset_version", value: conventionalTeamLeagueRuleset.version + 1 }
  ] as const) {
    database.prepare(`
      UPDATE standings_snapshots SET ${mismatch.field} = ? WHERE id = ?
    `).run(mismatch.value, snapshot.id);
    const beforeCorruptRead = readSnapshotIntegrity();
    const beforeCorruptReadCounts = counts();
    const corruptRulesetResponse = await get(`${publicUrl}/competition-public/season-public`);
    assert.equal(corruptRulesetResponse.status, 500);
    assert.deepEqual(corruptRulesetResponse.body, { error: "standings_data_invalid" });
    assert.equal(corruptRulesetResponse.body.data?.status, undefined);
    assert.deepEqual(counts(), beforeCorruptReadCounts);
    assert.deepEqual(readSnapshotIntegrity(), beforeCorruptRead);
    database.prepare(`
      UPDATE standings_snapshots
      SET ruleset_id = ?, ruleset_version = ?
      WHERE id = ?
    `).run(
      conventionalTeamLeagueRuleset.id,
      conventionalTeamLeagueRuleset.version,
      snapshot.id
    );
  }
  assert.deepEqual(readSnapshotIntegrity(), {
    ruleset_id: conventionalTeamLeagueRuleset.id,
    ruleset_version: conventionalTeamLeagueRuleset.version,
    content_hash: snapshot.contentHash,
    content_json: snapshot.contentJson
  });

  assert.equal((await get(`${publicUrl}/invalid%20id/season-public`)).status, 400);
  assert.equal((await get(`${publicUrl}/missing/season-public`)).status, 404);
  assert.equal((await get(`${publicUrl}/competition-public/missing`)).status, 404);
  assert.equal((await get(`${publicUrl}/competition-public/season-no-snapshot`)).status, 404);
  assert.equal((await get(`${publicUrl}/competition-public/season-public`, adminToken)).status, 200);
  assert.deepEqual(counts(), beforeReads);

  const incompleteManifest = createScheduleManifest(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    createdAt: "2026-02-03T00:00:00.000Z"
  });
  addExpectedScheduleFixture(database, incompleteManifest.id, {
    fixtureKey: "unresolved-fixture",
    homeTeamId: "team-public-home",
    awayTeamId: "team-public-away"
  });
  finalizeScheduleManifest(database, incompleteManifest.id, timestamp);
  const incompleteSnapshot = createStandingsSnapshot(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-public", revisionId: revision.id }],
    calculatedAt: "2026-02-04T00:00:00.000Z"
  });
  assessStandingsCoverage(database, {
    scope: { type: "competition_season", competitionId: "competition-public", seasonId: "season-public" },
    snapshotId: incompleteSnapshot.id,
    policy: { allowedExclusionStatuses: [] },
    exclusions: [],
    manifestVersionId: incompleteManifest.id,
    assessedAt: timestamp
  });
  const incomplete = await get(`${publicUrl}/competition-public/season-public`);
  assert.equal(incomplete.status, 200);
  assert.equal(incomplete.body.data.status, "provisional");
  assert.equal(incomplete.body.data.coverage.status, "incomplete");
  assert.match(incomplete.body.data.explanation, /incomplete or unresolved/);

  createScheduleManifest(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    createdAt: "2026-02-05T00:00:00.000Z"
  });
  const superseded = await get(`${publicUrl}/competition-public/season-public`);
  assert.equal(superseded.body.data.status, "provisional");
  assert.equal(superseded.body.data.coverage.status, "superseded");

  const unassessedSnapshot = createStandingsSnapshot(database, {
    competitionId: "competition-public",
    seasonId: "season-public",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-public", revisionId: revision.id }],
    calculatedAt: "2026-02-06T00:00:00.000Z"
  });
  const unassessed = await get(`${publicUrl}/competition-public/season-public`);
  assert.equal(unassessed.body.data.snapshot.id, unassessedSnapshot.id);
  assert.equal(unassessed.body.data.status, "provisional");
  assert.equal(unassessed.body.data.coverage.status, "unassessed");
  assert.match(unassessed.body.data.explanation, /not been verified/);
  assert.equal(database.prepare(`
    SELECT id, sequence, manifest_id, is_finalized
    FROM standings_coverage_assessments WHERE id = ?
  `).get(assessment.id)?.id, assessment.id);
  assert.equal(database.prepare(`
    SELECT id, sequence, manifest_id, is_finalized
    FROM standings_coverage_assessments WHERE id = ?
  `).get(assessment.id)?.manifest_id, manifest.id);

  database.exec("DROP TRIGGER trg_standings_snapshot_rows_no_update");
  database.prepare(`
    UPDATE standings_snapshot_rows SET scores_for = 999 WHERE snapshot_id = ? AND entry_id = ?
  `).run(unassessedSnapshot.id, "entry-public-home");
  const corrupt = await get(`${publicUrl}/competition-public/season-public`);
  assert.deepEqual(corrupt, {
    status: 500,
    body: { error: "standings_data_invalid" }
  });
});
