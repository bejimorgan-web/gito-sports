import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gito-soccer-rulesets-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.DATABASE_PATH = path.join(testDirectory, "soccer-rulesets.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(testDirectory, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(testDirectory, "backups");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";
process.env.DB_READONLY_MODE = "false";

const [databaseModule, routerModule, tokenModule, expressModule] = await Promise.all([
  import("../db/connection.js"),
  import("./soccer-rulesets.js"),
  import("../services/jwt.js"),
  import("express")
]);
const { closeDatabase, getDatabase } = databaseModule;
const { soccerRulesetsRouter } = routerModule;
const { createAccessToken } = tokenModule;
const express = expressModule.default;
const timestamp = "2026-10-01T00:00:00.000Z";

test("soccer rulesets require admins, pin an immutable season version, and preserve it when the default changes", async (t) => {
  let server: http.Server | undefined;
  t.after(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    closeDatabase();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  const database = getDatabase();
  database.prepare("INSERT INTO sports (id, name, slug, created_at, updated_at) VALUES ('soccer', 'Soccer', 'soccer', ?, ?)").run(timestamp, timestamp);
  database.prepare(`INSERT INTO competitions (id, sport_id, name, slug, scope, participant_type, created_at, updated_at)
    VALUES ('league', 'soccer', 'Domestic League', 'domestic-league', 'domestic', 'clubs', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare("INSERT INTO seasons (id, competition_id, name, status) VALUES ('season', 'league', '2026/27', 'active')").run();
  for (const [id, role] of [["admin-one", "admin"], ["admin-two", "admin"], ["operator", "operator"]]) {
    database.prepare(`INSERT INTO operator_users (id, name, email, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, id, `${id}@example.test`, role, timestamp, timestamp);
  }

  const app = express();
  app.use(express.json());
  app.use("/soccer-rulesets", soccerRulesetsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/soccer-rulesets`;
  const tokens = {
    first: createAccessToken({ sub: "admin-one", role: "admin" }),
    second: createAccessToken({ sub: "admin-two", role: "admin" }),
    operator: createAccessToken({ sub: "operator", role: "operator" })
  };
  const definition = (win: number) => ({
    sport: "soccer",
    formatTemplateId: "domestic_league",
    stages: [{ id: "league", name: "League", kind: "league", scheduling: "double_round_robin",
      points: { win, draw: 1, loss: 0 }, tieBreakers: [
        { criterion: "points", direction: "desc" },
        { criterion: "scoreDifference", direction: "desc" },
        { criterion: "entryId", direction: "asc" }
      ] }],
    qualificationRoutes: []
  });
  async function post(url: string, token: string | undefined, body: unknown) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  }

  assert.equal((await post(`${base}/competitions/league`, undefined, { ruleset: definition(3) })).status, 401);
  assert.equal((await post(`${base}/competitions/league`, tokens.operator, { ruleset: definition(3) })).status, 403);

  const proposalResponse = await post(`${base}/competitions/league`, tokens.first, { ruleset: definition(3) });
  assert.equal(proposalResponse.status, 201);
  const proposal = (await proposalResponse.json() as { data: { id: string } }).data;
  assert.equal((await post(`${base}/competitions/league/${proposal.id}/approve`, tokens.first, {})).status, 409);
  assert.equal((await post(`${base}/competitions/league/${proposal.id}/approve`, tokens.second, {})).status, 200);
  assert.equal((database.prepare("SELECT default_soccer_ruleset_id FROM competitions WHERE id = 'league'").get() as { default_soccer_ruleset_id: string }).default_soccer_ruleset_id, proposal.id);

  const pinResponse = await post(`${base}/competitions/league/seasons/season/pin`, tokens.first, { rulesetId: proposal.id });
  assert.equal(pinResponse.status, 201);
  const pin = (await pinResponse.json() as { data: { id: string } }).data;
  assert.equal((await post(`${base}/competitions/league/seasons/season/${pin.id}/approve`, tokens.first, {})).status, 409);
  assert.equal((await post(`${base}/competitions/league/seasons/season/${pin.id}/approve`, tokens.second, {})).status, 200);

  const nextResponse = await post(`${base}/competitions/league`, tokens.second, { ruleset: definition(4) });
  assert.equal(nextResponse.status, 201);
  const nextProposal = (await nextResponse.json() as { data: { id: string } }).data;
  assert.equal((await post(`${base}/competitions/league/${nextProposal.id}/approve`, tokens.first, {})).status, 200);

  const seasonRows = database.prepare(`SELECT source_ruleset_id AS sourceRulesetId, ruleset_json AS rulesetJson, status
    FROM season_soccer_rulesets WHERE id = ?`).get(pin.id) as { sourceRulesetId: string; rulesetJson: string; status: string };
  assert.equal(seasonRows.sourceRulesetId, proposal.id);
  assert.deepEqual(JSON.parse(seasonRows.rulesetJson), definition(3));
  assert.equal(seasonRows.status, "approved");
  assert.equal((database.prepare("SELECT default_soccer_ruleset_id FROM competitions WHERE id = 'league'").get() as { default_soccer_ruleset_id: string }).default_soccer_ruleset_id, nextProposal.id);
});
