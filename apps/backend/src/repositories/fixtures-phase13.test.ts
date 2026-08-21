import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-phase13-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCanonicalFixture, deleteCanonicalFixture, findEquivalentCanonicalFixtures, getCanonicalFixtureById } = await import("./fixtures-repository.js");
const { createSeason } = await import("./seasons-repository.js");
const { createSeasonTeamMembership } = await import("./competition-season-teams-repository.js");

function seed() {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sports (id,name,slug,status,created_at,updated_at) VALUES ('sport-1','Football','football','active',?,?)").run(now, now);
  db.prepare("INSERT INTO countries (id,name,iso2_code,iso3_code,status,created_at,updated_at) VALUES ('country-1','Germany','DE','DEU','active',?,?)").run(now, now);
  db.prepare("INSERT INTO competitions (id,sport_id,country_id,name,slug,scope,competition_type,participant_type,status,created_at,updated_at) VALUES ('competition-1','sport-1','country-1','Bundesliga','bundesliga','domestic','league','clubs','active',?,?)").run(now, now);
  for (const [id, name] of [['team-1','Bayern Munich'],['team-2','Borussia Dortmund'],['team-3','RB Leipzig']] as const) db.prepare("INSERT INTO teams (id,sport_id,country_id,name,slug,type,status,created_at,updated_at) VALUES (?,'sport-1','country-1',?,?,'club','active',?,?)").run(id, name, id, now, now);
  const season = createSeason("competition-1", { name: "2026/27", startsAt: "2026-08-01T00:00:00Z", endsAt: "2027-05-30T00:00:00Z" });
  for (const teamId of ["team-1", "team-2", "team-3"]) createSeasonTeamMembership("competition-1", season.id, teamId);
  return { db, seasonId: season.id };
}

test("canonical fixture setup requires season membership and never touches legacy scheduling tables", () => {
  const { db, seasonId } = seed();
  assert.throws(() => createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "" }), (error: any) => error?.code === "invalid_starts_at" && /required/i.test(error.message));
  assert.throws(() => createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:00" }), (error: any) => error?.code === "invalid_starts_at" && /explicit timezone/i.test(error.message));
  assert.throws(() => createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "missing", startsAt: "2026-09-20T15:00:00Z" }), /team_not_found/);
  const fixture = createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:00:00Z", venueName: "Arena", externalProvider: "manual", externalMatchId: "fixture-1" });
  assert.ok(fixture);
  assert.equal(findEquivalentCanonicalFixtures({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:30:00Z" }).length, 1);
  assert.throws(() => createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:30:00Z" }), /canonical_fixture_duplicate/);
  assert.throws(() => createCanonicalFixture({ competitionId: "competition-1", seasonId, homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:00:00Z", externalProvider: "manual", externalMatchId: "fixture-1" }), /canonical_fixture_external_duplicate/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM scheduling_matches").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM match_streams").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM matches").get().count, 1);
  assert.equal(deleteCanonicalFixture(fixture!.id), true);
  assert.equal(getCanonicalFixtureById(fixture!.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM matches").get().count, 0);
});

test.after(() => {
  const db = getDatabase() as unknown as { close?: () => void };
  db.close?.();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {} }
});
