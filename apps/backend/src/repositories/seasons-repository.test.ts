import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-phase2-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCompetition } = await import("./competitions-repository.js");
const { createSeason, getSeasonById, listSeasons, updateSeason } = await import("./seasons-repository.js");
const { createSeasonTeamMembership, listSeasonTeamMemberships } = await import("./competition-season-teams-repository.js");

function seedCatalog() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-1", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-1", "England", "GB", "GBR", timestamp, timestamp);
  database.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'club', 'active', ?, ?)").run("team-1", "sport-1", "country-1", "Example FC", "example-fc", timestamp, timestamp);
  const competition = createCompetition({ sportId: "sport-1", countryId: "country-1", name: "Premier League", scope: "domestic", type: "league", participantType: "clubs" });
  return { competitionId: competition.id };
}

test("Phase 2 season and membership foundation", () => {
  const { competitionId } = seedCatalog();
  const season = createSeason(competitionId, { name: "2026/27", startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2027-05-31T00:00:00.000Z" });

  assert.equal(getSeasonById(season.id)?.name, "2026/27");
  assert.equal(listSeasons(competitionId).length, 1);
  assert.throws(() => createSeason(competitionId, { name: "2026/27" }), /season_duplicate/);
  assert.throws(() => createSeason(competitionId, { name: "Invalid", startsAt: "not-a-date" }), /starts_at_invalid/);
  assert.throws(() => createSeason("missing-competition", { name: "2027/28" }), /competition_not_found/);

  const updated = updateSeason(season.id, { name: "2026/27 Updated" });
  assert.equal(updated?.name, "2026/27 Updated");

  const membership = createSeasonTeamMembership(competitionId, season.id, "team-1");
  assert.equal(membership.teamId, "team-1");
  assert.equal(listSeasonTeamMemberships(competitionId, season.id).length, 1);
  assert.throws(() => createSeasonTeamMembership(competitionId, season.id, "team-1"), /season_team_duplicate/);
  assert.throws(() => createSeasonTeamMembership(competitionId, season.id, "missing-team"), /team_not_found/);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM competition_season_teams").get().count, 1);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM matches").get().count, 0);
});

test.after(() => {
  const database = getDatabase() as unknown as { close?: () => void };
  database.close?.();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
