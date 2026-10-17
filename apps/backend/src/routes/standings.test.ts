import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-standings-api-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = path.join(testDirectory, "standings-api.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.DB_READONLY_MODE = "false";

const [
  { closeDatabase, getDatabase },
  { standingsRouter },
  { createAccessToken },
  { appendResultRevision, createStandingsSnapshot },
  { conventionalTeamLeagueRuleset },
  { createScheduleManifest, addExpectedScheduleFixture, finalizeScheduleManifest },
  { assessStandingsCoverage }
] = await Promise.all([
  import("../db/connection.js"),
  import("./standings.js"),
  import("../services/jwt.js"),
  import("../services/standings-snapshot-service.js"),
  import("../services/standings-calculation-service.js"),
  import("../services/standings-schedule-manifest-service.js"),
  import("../services/standings-coverage-service.js")
]);

const timestamp = "2026-01-01T00:00:00.000Z";

function seedDatabase() {
  const database = getDatabase();
  database.prepare(`
    INSERT INTO sports (id, name, slug, created_at, updated_at)
    VALUES ('sport-football', 'Football', 'football', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at)
    VALUES ('competition-api', 'sport-football', 'Test League', 'test-league', 'national', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO seasons (id, competition_id, name, status)
    VALUES ('season-api', 'competition-api', '2026', 'active'),
           ('season-empty', 'competition-api', '2025', 'completed')
  `).run();
  database.prepare(`
    INSERT INTO teams (id, sport_id, name, type, created_at, updated_at)
    VALUES ('team-home', 'sport-football', 'Home United', 'club', ?, ?),
           ('team-away', 'sport-football', 'Away City', 'club', ?, ?)
  `).run(timestamp, timestamp, timestamp, timestamp);
  database.prepare(`
    INSERT INTO competition_entries (
      id, competition_id, season_id, entry_type, team_id, player_id, created_at
    ) VALUES ('entry-home', 'competition-api', 'season-api', 'team', 'team-home', NULL, ?),
             ('entry-away', 'competition-api', 'season-api', 'team', 'team-away', NULL, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
    ) VALUES (
      'match-api', 'competition-api', 'season-api', 'team-home', 'team-away',
      '2026-01-02T00:00:00.000Z', 'ended', ?, ?
    )
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO fixture_participants (
      id, match_id, competition_id, season_id, entry_id, slot, created_at
    ) VALUES ('participant-home', 'match-api', 'competition-api', 'season-api', 'entry-home', 'home', ?),
             ('participant-away', 'match-api', 'competition-api', 'season-api', 'entry-away', 'away', ?)
  `).run(timestamp, timestamp);

  const revision = appendResultRevision(database, {
    matchId: "match-api",
    homeScore: 2,
    awayScore: 1,
    resultStatus: "ended",
    finalResultConfirmed: true,
    validationState: "accepted",
    sourceCategory: "manual_operator",
    createdAt: timestamp
  });
  const firstSnapshot = createStandingsSnapshot(database, {
    competitionId: "competition-api",
    seasonId: "season-api",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-api", revisionId: revision.id }],
    calculatedAt: timestamp
  });
  const manifest = createScheduleManifest(database, {
    competitionId: "competition-api",
    seasonId: "season-api",
    createdAt: timestamp
  });
  addExpectedScheduleFixture(database, manifest.id, {
    fixtureKey: "matchday-1-home-away",
    homeTeamId: "team-home",
    awayTeamId: "team-away",
    matchId: "match-api"
  });
  finalizeScheduleManifest(database, manifest.id, timestamp, {
    name: "Official test schedule",
    reference: "TEST-SCHEDULE-2026",
    contentHash: crypto.createHash("sha256").update("official test schedule").digest("hex")
  });
  const assessment = assessStandingsCoverage(database, {
    scope: { type: "competition_season", competitionId: "competition-api", seasonId: "season-api" },
    snapshotId: firstSnapshot.id,
    policy: { allowedExclusionStatuses: [] },
    exclusions: [],
    manifestVersionId: manifest.id,
    assessedAt: timestamp
  });
  assert.equal(assessment.eligible, true);

  return { database, firstSnapshot, revision, manifest, assessment };
}

async function startTestServer() {
  const express = (await import("express")).default;
  const app = express();
  app.use("/standings", standingsRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/standings` };
}

async function get(url: string, token?: string) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test("standings API returns only persisted snapshots and requires an admin for review", async (t) => {
  let server: http.Server | undefined;
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    closeDatabase();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });
  const { database, firstSnapshot, revision, manifest, assessment } = seedDatabase();
  const runningServer = await startTestServer();
  server = runningServer.server;
  const baseUrl = runningServer.baseUrl;
  const adminToken = createAccessToken({ sub: "admin", role: "admin" });
  const operatorToken = createAccessToken({ sub: "operator", role: "operator" });
  const readCounts = () => ({
    snapshots: (database.prepare("SELECT COUNT(*) AS count FROM standings_snapshots").get() as { count: number }).count,
    assessments: (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count,
    manifests: (database.prepare("SELECT COUNT(*) AS count FROM standings_schedule_manifests").get() as { count: number }).count
  });

  const url = `${baseUrl}/competition-api/season-api`;
  assert.equal((await get(url)).status, 401);
  assert.deepEqual(await get(url, operatorToken), {
    status: 403,
    body: { error: "admin_required" }
  });

  const beforeEligibleRead = readCounts();
  const firstResponse = await get(url, adminToken);
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.body.data.competition.name, "Test League");
  assert.equal(firstResponse.body.data.season.name, "2026");
  assert.equal(firstResponse.body.data.snapshot.id, firstSnapshot.id);
  assert.equal(firstResponse.body.data.snapshot.sequence, 1);
  assert.equal(firstResponse.body.data.coverage.status, "invalid");
  assert.equal(firstResponse.body.data.coverage.eligible, false);
  assert.deepEqual(firstResponse.body.data.coverage.assessment.manifest, {
    id: manifest.id,
    version: 1,
    state: "finalized",
    source: {
      name: "Official test schedule",
      reference: "TEST-SCHEDULE-2026",
      contentHash: crypto.createHash("sha256").update("official test schedule").digest("hex")
    }
  });
  assert.deepEqual(firstResponse.body.data.rows.map((row: any) => [
    row.rank,
    row.entry.displayName,
    row.played,
    row.goalsFor,
    row.goalsAgainst,
    row.goalDifference,
    row.points
  ]), [
    [1, "Home United", 1, 2, 1, 1, 3],
    [2, "Away City", 1, 1, 2, -1, 0]
  ]);
  assert.deepEqual(firstResponse.body.data.resultRevisions, [{
    matchId: "match-api",
    revisionId: revision.id,
    revisionNumber: 1
  }]);
  assert.deepEqual(readCounts(), beforeEligibleRead);

  createScheduleManifest(database, {
    competitionId: "competition-api",
    seasonId: "season-api",
    createdAt: "2026-01-02T00:00:00.000Z"
  });
  const beforeSupersededRead = readCounts();
  const supersededResponse = await get(url, adminToken);
  assert.equal(supersededResponse.body.data.coverage.status, "superseded");
  assert.equal(supersededResponse.body.data.coverage.eligible, false);
  assert.deepEqual(readCounts(), beforeSupersededRead);

  const latestSnapshot = createStandingsSnapshot(database, {
    competitionId: "competition-api",
    seasonId: "season-api",
    ruleset: conventionalTeamLeagueRuleset,
    revisionSelections: [{ matchId: "match-api", revisionId: revision.id }],
    calculatedAt: "2026-01-03T00:00:00.000Z"
  });
  const beforeLatestRead = readCounts();
  const latestResponse = await get(url, adminToken);
  assert.equal(latestResponse.body.data.snapshot.id, latestSnapshot.id);
  assert.equal(latestResponse.body.data.snapshot.sequence, 2);
  assert.equal(latestResponse.body.data.coverage.status, "unassessed");
  assert.equal(latestResponse.body.data.coverage.eligible, false);
  assert.equal(latestResponse.body.data.coverage.assessment, null);
  assert.deepEqual(database.prepare(`
    SELECT id, sequence, manifest_id, is_finalized
    FROM standings_coverage_assessments WHERE id = ?
  `).get(assessment.id), {
    id: assessment.id,
    sequence: 1,
    manifest_id: manifest.id,
    is_finalized: 1
  });
  assert.equal(database.prepare("SELECT is_complete FROM standings_snapshots WHERE id = ?").get(firstSnapshot.id)?.is_complete, 1);
  assert.equal((await get(`${baseUrl}/missing/season-api`, adminToken)).status, 404);
  assert.equal((await get(`${baseUrl}/competition-api/missing`, adminToken)).status, 404);
  assert.equal((await get(`${baseUrl}/competition-api/season-empty`, adminToken)).status, 404);
  assert.equal((await get(`${baseUrl}/invalid%20id/season-api`, adminToken)).status, 400);
  assert.deepEqual(readCounts(), beforeLatestRead);
});
