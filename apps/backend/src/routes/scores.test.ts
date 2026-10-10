import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-manual-scores-"));
const databasePath = path.join(testDirectory, "manual-scores.sqlite");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = databasePath;
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.GITO_NEWS_TEST_MODE = "false";
process.env.DB_READONLY_MODE = "false";
// Score provider methods are stubbed in this suite; the test key only enables
// the API source-mode guard and is never sent to an external service.
process.env.API_FOOTBALL_KEY = "test-provider-key";

const [
  { closeDatabase, ensureManualScoreSchema, getDatabase },
  { scoresRouter },
  { createAccessToken },
  { EventBus },
  { ScoreService, getFootballProvider },
  { ApiFootballService },
  { apiUsageGuard },
  { DatabaseSync, allowSqliteInstantiation }
] = await Promise.all([
  import("../db/connection.js"),
  import("./scores.js"),
  import("../services/jwt.js"),
  import("../events/event-bus.js"),
  import("../services/score-service.js"),
  import("../services/api-football-service.js"),
  import("../services/api-usage-guard.js"),
  import("../db/sqlite.js")
]);

function seedDatabase() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("sport-football", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("competition-1", "sport-football", "Local Cup", "local-cup", "national", timestamp, timestamp);
  database.prepare("INSERT INTO seasons (id, competition_id, name, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run("season-1", "competition-1", "2026", null, null, "active");
  database.prepare("INSERT INTO teams (id, sport_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("team-home", "sport-football", "Home", "club", timestamp, timestamp);
  database.prepare("INSERT INTO teams (id, sport_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("team-away", "sport-football", "Away", "club", timestamp, timestamp);
  database.prepare(`
    INSERT INTO matches (id, competition_id, season_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("fixture-1", "competition-1", "season-1", "team-home", "team-away", timestamp, "scheduled", timestamp, timestamp);

  for (const [id, role] of [["operator-admin", "admin"], ["operator-basic", "operator"]]) {
    database.prepare(`
      INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, id, `${id}@example.test`, role, "active", timestamp, timestamp);
  }
  return database;
}

function adminToken() {
  return createAccessToken({ sub: "operator-admin", role: "admin" });
}

function operatorToken() {
  return createAccessToken({ sub: "operator-basic", role: "operator" });
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
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/scores`
  };
}

async function request(
  baseUrl: string,
  route: string,
  method: string,
  body?: unknown,
  token?: string
) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>
  };
}

test("manual score API authorization, persistence, audit, notification and read-model integration", async (t) => {
  const database = seedDatabase();
  const { server, baseUrl } = await startTestServer();
  const manualUpdatedEvents: unknown[] = [];
  const onManualUpdate = (payload?: unknown) => manualUpdatedEvents.push(payload);
  EventBus.on("scores:updated", onManualUpdate);
  try {
    await t.test("rejects unauthenticated and non-admin writes without mutation", async () => {
      const missingAuth = await request(baseUrl, "/manual/fixture-1/start", "POST", { version: 0 });
      assert.equal(missingAuth.status, 401);
      const nonAdmin = await request(baseUrl, "/manual/fixture-1/start", "POST", { version: 0 }, operatorToken());
      assert.equal(nonAdmin.status, 403);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM match_score_state").get()?.count, 0);
    });

    await t.test("starts and updates the fixture, validates payload and rejects stale versions", async () => {
      const invalidTransition = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 0, homeScore: 1, awayScore: 0
      }, adminToken());
      assert.equal(invalidTransition.status, 409);

      const started = await request(baseUrl, "/manual/fixture-1/start", "POST", { version: 0 }, adminToken());
      assert.equal(started.status, 200);
      assert.equal(started.body.data.status, "live");
      assert.equal(started.body.data.version, 1);

      const invalidScore = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 1, homeScore: -1
      }, adminToken());
      assert.equal(invalidScore.status, 400);
      assert.equal(invalidScore.body.error, "invalid_homeScore");

      const invalidStatus = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 1, status: "halftime"
      }, adminToken());
      assert.equal(invalidStatus.status, 400);
      assert.equal(invalidStatus.body.error, "invalid_status");

      const updated = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 1, homeScore: 2, awayScore: 1
      }, adminToken());
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.version, 2);
      assert.equal(updated.body.data.homeScore, 2);

      const stale = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 1, homeScore: 3, awayScore: 1
      }, adminToken());
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error, "stale_score_version");
      assert.equal(database.prepare("SELECT home_score FROM match_score_state WHERE match_id = ?").get("fixture-1")?.home_score, 2);
    });

    await t.test("requires explicit final confirmation and rejects ordinary edits afterward", async () => {
      const prematureConfirm = await request(baseUrl, "/manual/fixture-1/confirm", "POST", { version: 2 }, adminToken());
      assert.equal(prematureConfirm.status, 409);

      const ended = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 2, status: "ended"
      }, adminToken());
      assert.equal(ended.status, 200);
      assert.equal(ended.body.data.finalResultConfirmed, false);

      const confirmed = await request(baseUrl, "/manual/fixture-1/confirm", "POST", { version: 3 }, adminToken());
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.data.finalResultConfirmed, true);

      const ordinaryEdit = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 4, homeScore: 4
      }, adminToken());
      assert.equal(ordinaryEdit.status, 409);
    });

    await t.test("corrects a confirmed result with an audit trail and exposes it in the score read model", async () => {
      const blockedCorrection = await request(baseUrl, "/manual/fixture-1/correct", "POST", {
        version: 4, homeScore: 1, awayScore: 2, reason: "Unauthorized correction"
      }, operatorToken());
      assert.equal(blockedCorrection.status, 403);
      assert.equal(database.prepare("SELECT home_score FROM match_score_state WHERE match_id = ?").get("fixture-1")?.home_score, 2);

      const missingReason = await request(baseUrl, "/manual/fixture-1/correct", "POST", {
        version: 4, homeScore: 1, awayScore: 2
      }, adminToken());
      assert.equal(missingReason.status, 400);

      const corrected = await request(baseUrl, "/manual/fixture-1/correct", "POST", {
        version: 4, homeScore: 1, awayScore: 2, reason: "Verified score correction"
      }, adminToken());
      assert.equal(corrected.status, 200);
      assert.equal(corrected.body.data.finalResultConfirmed, true);
      assert.equal(corrected.body.data.version, 5);

      const audit = database.prepare(`
        SELECT action, previous_home_score, previous_away_score, new_home_score, new_away_score
        FROM match_score_audit WHERE match_id = ? ORDER BY new_version
      `).all("fixture-1") as Array<Record<string, unknown>>;
      assert.deepEqual(audit.map((entry) => entry.action), [
        "score_updated", "score_updated", "score_updated", "final_result_confirmed", "score_corrected"
      ]);
      assert.deepEqual(
        [audit[4]?.previous_home_score, audit[4]?.previous_away_score, audit[4]?.new_home_score, audit[4]?.new_away_score],
        [2, 1, 1, 2]
      );

      const result = await ScoreService.getMatch("fixture-1");
      assert.equal(result?.match.score.home, 1);
      assert.equal(result?.match.score.away, 2);
      assert.equal(result?.match.status, "FT");
      assert.equal(manualUpdatedEvents.length, 5);
    });

    await t.test("reopens a confirmed result with reasoned audit and permits a new live update", async () => {
      const committedNotifications: Array<{
        inTransaction: boolean;
        status: string;
        version: number;
      }> = [];
      const onCommittedUpdate = (payload?: unknown) => {
        const event = payload as { source?: string; matchId?: string } | undefined;
        if (event?.source === "manual" && event.matchId === "fixture-1") {
          const observer = allowSqliteInstantiation(() => new DatabaseSync(databasePath, { readonly: true }));
          try {
            const persisted = observer.prepare(
              "SELECT status, version FROM match_score_state WHERE match_id = ?"
            ).get("fixture-1") as { status: string; version: number };
            committedNotifications.push(persisted);
          } finally {
            observer.close();
          }
        }
      };
      EventBus.on("scores:updated", onCommittedUpdate);
      try {
        const reopened = await request(baseUrl, "/manual/fixture-1/reopen", "POST", {
          version: 5,
          reason: "VAR review requires the match to resume"
        }, adminToken());
        assert.equal(reopened.status, 200);
        assert.equal(reopened.body.data.status, "live");
        assert.equal(reopened.body.data.finalResultConfirmed, false);
        assert.equal(reopened.body.data.homeScore, 1);
        assert.equal(reopened.body.data.awayScore, 2);
        assert.equal(reopened.body.data.version, 6);
        assert.equal(reopened.body.data.lastConfirmedAt, null);

        const audit = database.prepare(`
          SELECT action, operator_id, previous_version, new_version,
                 previous_home_score, previous_away_score, new_home_score, new_away_score,
                 previous_status, new_status, previous_final_result_confirmed,
                 new_final_result_confirmed, reason
          FROM match_score_audit WHERE match_id = ? ORDER BY new_version DESC LIMIT 1
        `).get("fixture-1") as Record<string, unknown>;
        assert.equal(audit.action, "final_result_reopened");
        assert.equal(audit.operator_id, "operator-admin");
        assert.equal(audit.previous_version, 5);
        assert.equal(audit.new_version, 6);
        assert.deepEqual(
          [
            audit.previous_home_score, audit.previous_away_score,
            audit.new_home_score, audit.new_away_score
          ],
          [1, 2, 1, 2]
        );
        assert.equal(audit.previous_status, "ended");
        assert.equal(audit.new_status, "live");
        assert.equal(audit.previous_final_result_confirmed, 1);
        assert.equal(audit.new_final_result_confirmed, 0);
        assert.equal(audit.reason, "VAR review requires the match to resume");
        assert.deepEqual(committedNotifications, [{
          status: "live",
          version: 6
        }]);

        const updated = await request(baseUrl, "/manual/fixture-1", "PATCH", {
          version: 6,
          homeScore: 3,
          awayScore: 2
        }, adminToken());
        assert.equal(updated.status, 200);
        assert.equal(updated.body.data.homeScore, 3);
        assert.equal(updated.body.data.awayScore, 2);
        assert.equal(updated.body.data.version, 7);
        assert.equal(updated.body.data.finalResultConfirmed, false);
      } finally {
        EventBus.off("scores:updated", onCommittedUpdate);
      }
    });

    await t.test("rolls back score state and emits no notification when audit persistence fails", async () => {
      database.exec(`
        CREATE TRIGGER reject_manual_score_audit
        BEFORE INSERT ON match_score_audit
        BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;
      `);
      const eventCount = manualUpdatedEvents.length;
      const response = await request(baseUrl, "/manual/fixture-1", "PATCH", {
        version: 7, homeScore: 5, awayScore: 2
      }, adminToken());
      assert.equal(response.status, 500);
      assert.deepEqual(
        database.prepare("SELECT home_score, away_score, version FROM match_score_state WHERE match_id = ?")
          .get("fixture-1"),
        { home_score: 3, away_score: 2, version: 7 }
      );
      assert.equal(manualUpdatedEvents.length, eventCount);
      database.exec("DROP TRIGGER reject_manual_score_audit;");
    });

    await t.test("reads persisted manual state through its protected endpoint", async () => {
      const read = await request(baseUrl, "/manual/fixture-1", "GET", undefined, adminToken());
      assert.equal(read.status, 200);
      assert.equal(read.body.data.homeScore, 3);
      assert.equal(read.body.data.version, 7);
    });

    await t.test("provider live refresh preserves manual scores while refreshing unrelated fixtures", testProviderRefreshPreservesManualScores);
    await t.test("provider fixture IDs are scoped to their provider identity", testProviderExternalIdCollisionAcrossProviders);

  } finally {
    EventBus.off("scores:updated", onManualUpdate);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function testProviderExternalIdCollisionAcrossProviders() {
  ScoreService.setSourceMode("api");
  const database = getDatabase();
  const activeProvider = getFootballProvider() as typeof ApiFootballService;
  const activeProviderKey = activeProvider === ApiFootballService ? "api-football" : "sportmonks";
  const otherProviderKey = activeProviderKey === "api-football" ? "sportmonks" : "api-football";
  database.prepare("UPDATE matches SET external_provider = ? WHERE id = ?").run(otherProviderKey, "fixture-1");
  const beforeState = database.prepare(`
    SELECT home_score, away_score, status, version, final_result_confirmed
    FROM match_score_state WHERE match_id = ?
  `).get("fixture-1");
  const beforeAuditCount = Number(database.prepare(
    "SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = ?"
  ).get("fixture-1")?.count);
  const originalGetLiveFixtures = activeProvider.getLiveFixtures;
  activeProvider.getLiveFixtures = async () => [{
    fixture: { id: 9001, date: new Date().toISOString(), status: { short: "1H", elapsed: 18 } },
    league: { id: 77, name: "Provider League", logo: null },
    teams: {
      home: { id: 101, name: "Provider Home", logo: null, winner: null },
      away: { id: 102, name: "Provider Away", logo: null, winner: null }
    },
    score: { fulltime: { home: null, away: null }, goals: { home: 1, away: 0 } }
  }];
  ScoreService.clearCache();
  apiUsageGuard.clearCache(true);
  try {
    const result = await ScoreService.listLiveScores();
    const providerMatch = result.matches.find((match) => match.id === "9001");
    assert.ok(providerMatch, "API mode must retain the provider fixture identity");
    assert.equal(providerMatch.score.home, 1);
    assert.equal(result.matches.some((match) => match.id === "fixture-1"), false,
      "API mode must not overlay the manual fixture");
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, status, version, final_result_confirmed
      FROM match_score_state WHERE match_id = ?
    `).get("fixture-1"), beforeState);
    assert.equal(Number(database.prepare(
      "SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = ?"
    ).get("fixture-1")?.count), beforeAuditCount);

    database.prepare("UPDATE matches SET external_provider = ? WHERE id = ?").run(activeProviderKey, "fixture-1");
    database.exec("DROP INDEX idx_matches_external_identity;");
    database.prepare(`
      INSERT INTO matches (
        id, competition_id, season_id, home_team_id, away_team_id, starts_at,
        external_provider, external_match_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "fixture-ambiguous", "competition-1", "season-1", "team-home", "team-away",
      new Date().toISOString(), activeProviderKey, "9001", "scheduled",
      new Date().toISOString(), new Date().toISOString()
    );
    ScoreService.clearCache();
    apiUsageGuard.clearCache(true);
    const ambiguousResult = await ScoreService.listLiveScores();
    const unresolvedProviderMatch = ambiguousResult.matches.find((match) => match.id === "9001");
    assert.ok(unresolvedProviderMatch, "ambiguous association must leave the provider result unmerged");
    assert.equal(ambiguousResult.matches.some((match) => match.id === "fixture-1"), false,
      "API mode must not append the canonical manual result");
    assert.deepEqual(database.prepare(`
      SELECT home_score, away_score, status, version, final_result_confirmed
      FROM match_score_state WHERE match_id = ?
    `).get("fixture-1"), beforeState);
    assert.equal(Number(database.prepare(
      "SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = ?"
    ).get("fixture-1")?.count), beforeAuditCount);
    database.prepare("DELETE FROM matches WHERE id = ?").run("fixture-ambiguous");
    database.exec(`
      CREATE UNIQUE INDEX idx_matches_external_identity
      ON matches(external_provider, external_match_id)
      WHERE external_provider IS NOT NULL AND external_match_id IS NOT NULL;
    `);
  } finally {
    activeProvider.getLiveFixtures = originalGetLiveFixtures;
    ScoreService.setSourceMode("manual");
    ScoreService.clearCache();
    apiUsageGuard.clearCache(true);
  }
}

async function testProviderRefreshPreservesManualScores() {
  ScoreService.setSourceMode("api");
  const database = getDatabase();
  database.prepare(`
    UPDATE matches
    SET external_provider = ?, external_match_id = ?
    WHERE id = ?
  `).run("api-football", "9001", "fixture-1");
  database.prepare(`
    INSERT INTO matches (
      id, competition_id, season_id, home_team_id, away_team_id,
      starts_at, external_provider, external_match_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "fixture-2", "competition-1", "season-1", "team-home", "team-away",
    new Date().toISOString(), "api-football", "9002", "scheduled",
    new Date().toISOString(), new Date().toISOString()
  );

  const beforeState = database.prepare(`
    SELECT home_score, away_score, status, version, final_result_confirmed
    FROM match_score_state WHERE match_id = ?
  `).get("fixture-1") as Record<string, unknown>;
  const beforeAuditCount = Number(database.prepare(
    "SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = ?"
  ).get("fixture-1")?.count);
  const originalGetLiveFixtures = ApiFootballService.getLiveFixtures;
  const providerFixtures = [
    {
      fixture: {
        id: 9001,
        date: new Date().toISOString(),
        status: { short: "1H", long: "First Half", elapsed: 18 }
      },
      league: { id: 77, name: "Provider League", logo: "https://example.test/league.png" },
      teams: {
        home: { id: 101, name: "Provider Home", logo: null, winner: null },
        away: { id: 102, name: "Provider Away", logo: null, winner: null }
      },
      score: {
        fulltime: { home: null, away: null },
        goals: { home: 9, away: 0 }
      }
    },
    {
      fixture: {
        id: 9002,
        date: new Date().toISOString(),
        status: { short: "2H", long: "Second Half", elapsed: 62 }
      },
      league: { id: 77, name: "Provider League", logo: "https://example.test/league.png" },
      teams: {
        home: { id: 101, name: "Provider Home", logo: null, winner: null },
        away: { id: 102, name: "Provider Away", logo: null, winner: null }
      },
      score: {
        fulltime: { home: null, away: null },
        goals: { home: 2, away: 1 }
      }
    }
  ];
  const scoreUpdateEvents: unknown[] = [];
  const onScoreUpdate = (payload?: unknown) => scoreUpdateEvents.push(payload);
  EventBus.on("scores:updated", onScoreUpdate);
  ApiFootballService.getLiveFixtures = async () => providerFixtures;
  ScoreService.clearCache();
  apiUsageGuard.clearCache(true);

  try {
    const result = await ScoreService.listLiveScores();
    const providerControlled = result.matches.find((match) => match.id === "9002");
    assert.ok(providerControlled, JSON.stringify(result.matches.map(({ id, status, score }) => ({ id, status, score }))));
    assert.equal(providerControlled.score.home, 2);
    assert.equal(providerControlled.score.away, 1);
    assert.equal(providerControlled.status, "2H");

    const apiControlledMatch = result.matches.find((match) => match.id === "9001");
    assert.ok(apiControlledMatch, "API mode should expose provider fixture 9001");
    assert.equal(apiControlledMatch.score.home, 9);
    assert.equal(apiControlledMatch.score.away, 0);
    assert.equal(apiControlledMatch.status, "1H");
    assert.equal(result.matches.some((match) => match.id === "fixture-1"), false,
      "API mode must not expose the dormant manual score overlay");

    assert.deepEqual(
      database.prepare(`
        SELECT home_score, away_score, status, version, final_result_confirmed
        FROM match_score_state WHERE match_id = ?
      `).get("fixture-1"),
      beforeState
    );
    assert.equal(Number(database.prepare(
      "SELECT COUNT(*) AS count FROM match_score_audit WHERE match_id = ?"
    ).get("fixture-1")?.count), beforeAuditCount);
    assert.equal(scoreUpdateEvents.length, 1);
    assert.deepEqual(scoreUpdateEvents[0], {
      cacheKey: "scores:live",
      source: "live",
      count: 2
    });

    assert.equal(result.matches.some((match) => match.id === "9001"), true,
      "API mode should retain provider fixture 9001 rather than suppressing it");
    assert.equal(result.matches.some((match) => match.id === "fixture-1"), false,
      "the provider result must not be duplicated under canonical fixture-1");
  } finally {
    ApiFootballService.getLiveFixtures = originalGetLiveFixtures;
    EventBus.off("scores:updated", onScoreUpdate);
    ScoreService.setSourceMode("manual");
    ScoreService.clearCache();
    apiUsageGuard.clearCache(true);
  }
}

test("additive score schema upgrade preserves existing fixture rows and schema version", () => {
  const migrationPath = path.join(testDirectory, "schema-upgrade.sqlite");
  const database = allowSqliteInstantiation(() => new DatabaseSync(migrationPath));
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE operator_users (id TEXT PRIMARY KEY);
      CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL,
        season_id TEXT,
        home_team_id TEXT NOT NULL,
        away_team_id TEXT NOT NULL
      );
      INSERT INTO matches (id, competition_id, season_id, home_team_id, away_team_id)
      VALUES ('existing-fixture', 'competition-1', 'season-1', 'team-home', 'team-away');
      PRAGMA user_version = 1;
    `);
    ensureManualScoreSchema(database);
    assert.deepEqual(
      database.prepare("SELECT id, competition_id, season_id, home_team_id, away_team_id FROM matches WHERE id = ?")
        .get("existing-fixture"),
      {
        id: "existing-fixture",
        competition_id: "competition-1",
        season_id: "season-1",
        home_team_id: "team-home",
        away_team_id: "team-away"
      }
    );
    assert.equal(Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), 1);
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("match_score_state")?.name, "match_score_state");
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("match_score_audit")?.name, "match_score_audit");
  } finally {
    database.close();
  }

  const unsupportedPath = path.join(testDirectory, "unsupported-version.sqlite");
  const unsupportedDatabase = allowSqliteInstantiation(() => new DatabaseSync(unsupportedPath));
  try {
    unsupportedDatabase.exec(`
      CREATE TABLE operator_users (id TEXT PRIMARY KEY);
      CREATE TABLE matches (id TEXT PRIMARY KEY);
      PRAGMA user_version = 2;
    `);
    assert.throws(() => ensureManualScoreSchema(unsupportedDatabase), /Unsupported schema version 2/);
    assert.equal(
      unsupportedDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("match_score_state"),
      undefined
    );
    assert.equal(Number((unsupportedDatabase.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), 2);
  } finally {
    unsupportedDatabase.close();
  }
});

test.after(() => {
  closeDatabase();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
