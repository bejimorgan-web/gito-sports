import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-standings-workflow-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = path.join(testDirectory, "standings-workflow.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.DB_READONLY_MODE = "false";

const [
  { closeDatabase, getDatabase },
  { standingsRouter },
  { publicStandingsRouter },
  { createAccessToken },
  { appendResultRevision }
] = await Promise.all([
  import("../db/connection.js"),
  import("./standings.js"),
  import("./public-standings.js"),
  import("../services/jwt.js"),
  import("../services/standings-snapshot-service.js")
]);

const timestamp = "2026-01-01T00:00:00.000Z";

function seedWorkflowDatabase() {
  const database = getDatabase();
  database.prepare(`
    INSERT INTO sports (id, name, slug, created_at, updated_at)
    VALUES ('sport-workflow', 'Football', 'football', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO competitions (id, sport_id, name, slug, scope, participant_type, created_at, updated_at)
    VALUES ('competition-workflow', 'sport-workflow', 'Workflow League', 'workflow-league', 'national', 'clubs', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO seasons (id, competition_id, name, status)
    VALUES ('season-workflow', 'competition-workflow', '2026', 'active')
  `).run();
  database.prepare(`
    INSERT INTO teams (id, sport_id, name, type, created_at, updated_at)
    VALUES ('workflow-home', 'sport-workflow', 'Home United', 'club', ?, ?),
           ('workflow-away', 'sport-workflow', 'Away City', 'club', ?, ?)
  `).run(timestamp, timestamp, timestamp, timestamp);
  database.prepare(`
    INSERT INTO competition_season_teams (
      id, competition_id, season_id, team_id, membership_status, created_at, updated_at
    ) VALUES ('membership-home', 'competition-workflow', 'season-workflow', 'workflow-home', 'active', ?, ?),
             ('membership-away', 'competition-workflow', 'season-workflow', 'workflow-away', 'active', ?, ?)
  `).run(timestamp, timestamp, timestamp, timestamp);
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at
    ) VALUES ('workflow-ended', 'competition-workflow', 'season-workflow', 'workflow-home', 'workflow-away', ?, 'ended', ?, ?),
             ('workflow-scheduled', 'competition-workflow', 'season-workflow', 'workflow-away', 'workflow-home', ?, 'scheduled', ?, ?)
  `).run(timestamp, timestamp, timestamp, timestamp, timestamp, timestamp);
  const revision = appendResultRevision(database, {
    matchId: "workflow-ended",
    homeScore: 2,
    awayScore: 1,
    resultStatus: "ended",
    finalResultConfirmed: true,
    validationState: "accepted",
    sourceCategory: "manual_operator",
    createdAt: timestamp
  });
  return { database, revision };
}

test("admin workflow persists reviewed standings atomically and public GET remains read-only", async (t) => {
  let server: http.Server | undefined;
  t.after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    closeDatabase();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  const { database, revision } = seedWorkflowDatabase();
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use("/standings", standingsRouter);
  app.use("/public/standings", publicStandingsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const adminToken = createAccessToken({ sub: "workflow-admin", role: "admin" });
  const secondAdminToken = createAccessToken({ sub: "workflow-second-admin", role: "admin" });
  const operatorToken = createAccessToken({ sub: "workflow-operator", role: "operator" });
  for (const [id, email, role] of [
    ["workflow-admin", "workflow-admin@example.test", "admin"],
    ["workflow-second-admin", "workflow-second-admin@example.test", "admin"],
    ["workflow-operator", "workflow-operator@example.test", "operator"]
  ]) {
    database.prepare(`
      INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, id, email, role, timestamp, timestamp);
  }
  const soccerRules = {
    sport: "soccer",
    formatTemplateId: "domestic_league",
    stages: [{ id: "league", name: "League", kind: "league", scheduling: "double_round_robin",
      points: { win: 3, draw: 1, loss: 0 }, tieBreakers: [
        { criterion: "points", direction: "desc" },
        { criterion: "scoreDifference", direction: "desc" },
        { criterion: "scoresFor", direction: "desc" },
        { criterion: "entryId", direction: "asc" }
      ] }],
    qualificationRoutes: []
  };
  const soccerRulesJson = JSON.stringify(soccerRules);
  const soccerRulesHash = crypto.createHash("sha256").update(soccerRulesJson).digest("hex");
  database.prepare(`INSERT INTO competition_soccer_rulesets (id, competition_id, version, format_template_id, ruleset_json,
    ruleset_hash, status, proposed_by_operator_id, proposed_at) VALUES (?, 'competition-workflow', 1, 'domestic_league', ?, ?, 'pending', 'workflow-admin', ?)
  `).run("workflow-soccer-rules", soccerRulesJson, soccerRulesHash, timestamp);
  database.prepare(`UPDATE competition_soccer_rulesets SET status = 'approved', approved_by_operator_id = 'workflow-second-admin', approved_at = ? WHERE id = 'workflow-soccer-rules'`).run(timestamp);
  database.prepare(`UPDATE competitions SET default_soccer_ruleset_id = 'workflow-soccer-rules', default_soccer_format_id = 'domestic_league' WHERE id = 'competition-workflow'`).run();
  database.prepare(`INSERT INTO season_soccer_rulesets (id, competition_id, season_id, source_ruleset_id, version, format_template_id,
    ruleset_json, ruleset_hash, status, proposed_by_operator_id, proposed_at)
    VALUES ('workflow-season-soccer-rules', 'competition-workflow', 'season-workflow', 'workflow-soccer-rules', 1, 'domestic_league', ?, ?, 'pending', 'workflow-admin', ?)
  `).run(soccerRulesJson, soccerRulesHash, timestamp);
  database.prepare(`UPDATE season_soccer_rulesets SET status = 'approved', approved_by_operator_id = 'workflow-second-admin', approved_at = ?
    WHERE id = 'workflow-season-soccer-rules'`).run(timestamp);
  const workflowUrl = `${baseUrl}/standings/competition-workflow/season-workflow`;
  const schedule = [
    { fixtureKey: "workflow-ended", matchId: "workflow-ended", homeTeamId: "workflow-home", awayTeamId: "workflow-away" },
    { fixtureKey: "workflow-scheduled", matchId: "workflow-scheduled", homeTeamId: "workflow-away", awayTeamId: "workflow-home" }
  ];
  const ruleset = {
    id: "workflow-league-rules",
    version: 1,
    points: { win: 3, draw: 1, loss: 0 },
    trackedStatistics: ["played", "won", "drawn", "lost", "scoresFor", "scoresAgainst", "scoreDifference", "points"],
    tieBreakers: [
      { criterion: "points", direction: "desc" },
      { criterion: "scoreDifference", direction: "desc" },
      { criterion: "scoresFor", direction: "desc" },
      { criterion: "entryId", direction: "asc" }
    ]
  };
  const readCounts = () => ({
    entries: (database.prepare("SELECT COUNT(*) AS count FROM competition_entries").get() as { count: number }).count,
    participants: (database.prepare("SELECT COUNT(*) AS count FROM fixture_participants").get() as { count: number }).count,
    manifests: (database.prepare("SELECT COUNT(*) AS count FROM standings_schedule_manifests").get() as { count: number }).count,
    snapshots: (database.prepare("SELECT COUNT(*) AS count FROM standings_snapshots").get() as { count: number }).count,
    assessments: (database.prepare("SELECT COUNT(*) AS count FROM standings_coverage_assessments").get() as { count: number }).count
  });
  const initialCounts = readCounts();

  const proposalResponse = await fetch(`${workflowUrl}/rulesets`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ruleset })
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = await proposalResponse.json() as { data: { id: string } };
  const approvalResponse = await fetch(`${workflowUrl}/rulesets/${proposal.data.id}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${secondAdminToken}`, "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(approvalResponse.status, 200);
  const scheduleCsvBase64 = Buffer.from(
    "homeTeam,awayTeam\nHome United,Away City\nAway City,Home United\n",
    "utf8"
  ).toString("base64");
  const sourceFields = {
    rulesetApprovalId: proposal.data.id,
    scheduleSourceName: "Official competition schedule",
    scheduleSourceReference: "official-schedule-2026",
    scheduleCsvBase64
  };

  const unauthenticated = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((await fetch(`${baseUrl}/standings/invalid%20id/season-workflow/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: "{}"
  })).status, 400);
  assert.equal((await fetch(`${baseUrl}/standings/missing/season-workflow/workflow-context`, {
    headers: { authorization: `Bearer ${adminToken}` }
  })).status, 404);
  assert.equal((await fetch(`${baseUrl}/standings/competition-workflow/missing/workflow-context`, {
    headers: { authorization: `Bearer ${adminToken}` }
  })).status, 404);
  const nonAdmin = await fetch(`${workflowUrl}/workflow-context`, {
    headers: { authorization: `Bearer ${operatorToken}` }
  });
  assert.equal(nonAdmin.status, 403);

  const incomplete = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      teamIds: ["workflow-home", "workflow-away"],
      expectedFixtures: schedule.slice(0, 1),
      revisionSelections: [{ matchId: "workflow-ended", revisionId: revision.id }],
      ...sourceFields,
      scheduleConfirmed: true
    })
  });
  assert.equal(incomplete.status, 422);
  assert.deepEqual(readCounts(), initialCounts);

  const unresolvedResult = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      teamIds: ["workflow-home", "workflow-away"],
      expectedFixtures: schedule,
      revisionSelections: [],
      ...sourceFields,
      scheduleConfirmed: true
    })
  });
  assert.equal(unresolvedResult.status, 422);
  assert.deepEqual(readCounts(), initialCounts);

  const unknownFixture = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      teamIds: ["workflow-home", "workflow-away"],
      expectedFixtures: [
        { ...schedule[0], matchId: "unknown-fixture", fixtureKey: "unknown-fixture" },
        schedule[1]
      ],
      revisionSelections: [{ matchId: "workflow-ended", revisionId: revision.id }],
      ...sourceFields,
      scheduleConfirmed: true
    })
  });
  assert.equal(unknownFixture.status, 422);
  assert.deepEqual(readCounts(), initialCounts);

  const invalidTeam = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      teamIds: ["workflow-home", "unknown-team"],
      expectedFixtures: schedule,
      revisionSelections: [{ matchId: "workflow-ended", revisionId: revision.id }],
      ...sourceFields,
      scheduleConfirmed: true
    })
  });
  assert.equal(invalidTeam.status, 422);
  assert.deepEqual(readCounts(), initialCounts);

  const context = await fetch(`${workflowUrl}/workflow-context`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(context.status, 200);
  const contextBody = await context.json() as { data: { teamCandidates: unknown[]; fixtures: unknown[] } };
  assert.equal(contextBody.data.teamCandidates.length, 2);
  assert.equal(contextBody.data.fixtures.length, 2);

  const prepared = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      teamIds: ["workflow-home", "workflow-away"],
      expectedFixtures: schedule,
      revisionSelections: [{ matchId: "workflow-ended", revisionId: revision.id }],
      ...sourceFields,
      scheduleConfirmed: true
    })
  });
  assert.equal(prepared.status, 201);
  const preparedBody = await prepared.json() as {
    data: {
      snapshot: { id: string; sequence: number; rulesetId: string; rulesetVersion: number };
      manifest: { id: string; version: number; state: string };
      coverage: { id: string; eligible: boolean; scheduleState: string; blockingReasons: unknown[] };
    };
  };
  assert.equal(preparedBody.data.snapshot.sequence, 1);
  assert.equal(preparedBody.data.snapshot.rulesetId, ruleset.id);
  assert.equal(preparedBody.data.snapshot.rulesetVersion, ruleset.version);
  assert.equal(preparedBody.data.manifest.state, "finalized");
  assert.equal(preparedBody.data.coverage.eligible, false);
  assert.equal(preparedBody.data.coverage.scheduleState, "verified_complete");
  assert.ok(preparedBody.data.coverage.blockingReasons.length > 0);
  assert.equal(readCounts().entries, 2);
  assert.equal(readCounts().participants, 4);

  const snapshotContent = JSON.parse((database.prepare(
    "SELECT content_json AS contentJson FROM standings_snapshots WHERE id = ?"
  ).get(preparedBody.data.snapshot.id) as { contentJson: string }).contentJson) as {
    rulesetApproval: { competitionId: string; seasonId: string; rulesetId: string; rulesetVersion: number; approvalId: string; approvedByOperatorId: string; approvedAt: string };
    seasonSoccerRuleset: { id: string; version: number; formatTemplateId: string; rulesetHash: string };
  };
  assert.deepEqual(snapshotContent.rulesetApproval, {
    competitionId: "competition-workflow",
    seasonId: "season-workflow",
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    approvalId: proposal.data.id,
    approvedByOperatorId: "workflow-second-admin",
    approvedAt: snapshotContent.rulesetApproval.approvedAt
  });
  assert.deepEqual(snapshotContent.seasonSoccerRuleset, {
    id: "workflow-season-soccer-rules", version: 1, formatTemplateId: "domestic_league", rulesetHash: soccerRulesHash
  });

  database.prepare("UPDATE matches SET status = 'ended' WHERE id = 'workflow-scheduled'").run();
  const secondRevision = appendResultRevision(database, {
    matchId: "workflow-scheduled", homeScore: 1, awayScore: 1, resultStatus: "ended",
    finalResultConfirmed: true, validationState: "accepted", sourceCategory: "manual_operator", createdAt: timestamp
  });
  const finalizedResponse = await fetch(`${workflowUrl}/prepare`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ teamIds: ["workflow-home", "workflow-away"], expectedFixtures: schedule,
      revisionSelections: [{ matchId: "workflow-ended", revisionId: revision.id }, { matchId: "workflow-scheduled", revisionId: secondRevision.id }],
      ...sourceFields, scheduleConfirmed: true })
  });
  assert.equal(finalizedResponse.status, 201);
  const finalizedBody = await finalizedResponse.json() as { data: { snapshot: { id: string; sequence: number }; coverage: { eligible: boolean; scheduleState: string } } };
  assert.equal(finalizedBody.data.snapshot.sequence, 2);
  assert.equal(finalizedBody.data.coverage.eligible, true);
  assert.equal(finalizedBody.data.coverage.scheduleState, "verified_complete");

  const adminStandings = await fetch(workflowUrl, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminStandings.status, 200);
  const adminBody = await adminStandings.json() as {
    data: { snapshot: { rulesetApproval: { approvedByOperatorId: string; rulesetVersion: number } } };
  };
  assert.equal(adminBody.data.snapshot.rulesetApproval.approvedByOperatorId, "workflow-second-admin");
  assert.equal(adminBody.data.snapshot.rulesetApproval.rulesetVersion, ruleset.version);

  const beforePublicRead = readCounts();
  const publicResponse = await fetch(`${baseUrl}/public/standings/competition-workflow/season-workflow`);
  assert.equal(publicResponse.status, 200);
  const publicBody = await publicResponse.json() as { data: { snapshot: { id: string; rulesetApproval?: unknown }; status: string; rows: Array<{ team: { id: string }; rank: number; played: number; points: number }> } };
  assert.equal(publicBody.data.snapshot.id, finalizedBody.data.snapshot.id);
  assert.equal(publicBody.data.status, "eligible");
  assert.deepEqual(publicBody.data.rows.map(({ team, rank, played, points }) => ({ teamId: team.id, rank, played, points })), [
    { teamId: "workflow-home", rank: 1, played: 2, points: 4 },
    { teamId: "workflow-away", rank: 2, played: 2, points: 1 }
  ]);
  assert.equal("rulesetApproval" in publicBody.data.snapshot, false);
  assert.deepEqual(readCounts(), beforePublicRead);

  assert.throws(() => database.prepare("UPDATE standings_snapshots SET calculated_at = ? WHERE id = ?")
    .run(timestamp, preparedBody.data.snapshot.id));
  assert.throws(() => database.prepare("UPDATE standings_schedule_manifests SET state = 'draft' WHERE id = ?")
    .run(preparedBody.data.manifest.id));
  assert.throws(() => database.prepare("UPDATE standings_coverage_assessments SET eligibility_state = 'eligible' WHERE id = ?")
    .run(preparedBody.data.coverage.id));
});
