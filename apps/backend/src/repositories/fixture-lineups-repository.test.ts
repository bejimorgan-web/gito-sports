import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-lineups-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCanonicalFixture } = await import("./fixtures-repository.js");
const { createFormationTemplate, listFormationTemplates } = await import("./player-catalog-repository.js");
const { createPlayer, createSeasonSquad, createSquadPlayer } = await import("./player-catalog-repository.js");
const { clearFixtureLineup, getFixtureLineups, saveFixtureLineup } = await import("./fixture-lineups-repository.js");

function seed() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-1", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-1", "Spain", "ES", "ESP", timestamp, timestamp);
  database.prepare("INSERT INTO competitions (id, sport_id, country_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'domestic', 'league', 'clubs', 'active', ?, ?) ").run("competition-1", "sport-1", "country-1", "League", "league", timestamp, timestamp);
  database.prepare("INSERT INTO seasons (id, competition_id, name, status) VALUES (?, ?, ?, 'active')").run("season-1", "competition-1", "2026/27");
  for (const [id, name] of [["team-home", "Home FC"], ["team-away", "Away FC"]]) database.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, 'sport-1', 'country-1', ?, ?, 'club', 'active', ?, ?)").run(id, name, id, timestamp, timestamp);
  for (const teamId of ["team-home", "team-away"]) database.prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, 'competition-1', 'season-1', ?, 'active', ?, ?)").run(`membership-${teamId}`, teamId, timestamp, timestamp);
  const fixture = createCanonicalFixture({ competitionId: "competition-1", seasonId: "season-1", homeTeamId: "team-home", awayTeamId: "team-away", startsAt: "2026-08-23T19:30:00.000Z" })!;
  const homeSquad = createSeasonSquad({ teamId: "team-home", competitionId: "competition-1", seasonId: "season-1", name: "Home squad" });
  const awaySquad = createSeasonSquad({ teamId: "team-away", competitionId: "competition-1", seasonId: "season-1", name: "Away squad" });
  const homePlayers = [{ firstName: "Home", lastName: "Keeper" }, { firstName: "Home", lastName: "Striker" }].map((player, index) => createPlayer({ teamId: "team-home", ...player, jerseyNumber: index + 1 }));
  const awayPlayers = [{ firstName: "Away", lastName: "Player" }, { firstName: "Away", lastName: "Reserve" }].map((player, index) => createPlayer({ teamId: "team-away", ...player, jerseyNumber: index + 9 }));
  homePlayers.forEach((player) => createSquadPlayer({ squadId: homeSquad.id, playerId: player.id }));
  awayPlayers.forEach((player) => createSquadPlayer({ squadId: awaySquad.id, playerId: player.id }));
  const formation = createFormationTemplate({ sportId: "sport-1", name: "2-slot", formation: "2", positions: [{ x: 50, y: 80 }, { x: 50, y: 20 }] });
  return { fixture, homeSquad, awaySquad, homePlayers, awayPlayers, formation };
}

test("canonical lineups persist independently and enforce squad, slot, and confirmation rules", () => {
  const { fixture, homeSquad, awaySquad, homePlayers, awayPlayers, formation } = seed();
  const homeKeeper = homePlayers[0]!;
  const homeStriker = homePlayers[1]!;
  const awayPlayer = awayPlayers[0]!;
  const awayReserve = awayPlayers[1]!;
  const home = saveFixtureLineup(fixture.id, { teamId: "team-home", seasonSquadId: homeSquad.id, formationId: formation.id, status: "possible", starters: [{ slotIndex: 0, playerId: homeKeeper.id }], substitutes: [homeStriker.id], captainPlayerId: homeKeeper.id });
  const away = saveFixtureLineup(fixture.id, { teamId: "team-away", seasonSquadId: awaySquad.id, formationId: formation.id, status: "confirmed", starters: [{ slotIndex: 0, playerId: awayPlayer.id }, { slotIndex: 1, playerId: awayReserve.id }], substitutes: [] });
  assert.equal(home.status, "possible");
  assert.equal(getFixtureLineups(fixture.id).length, 2);
  assert.throws(() => saveFixtureLineup(fixture.id, { teamId: "team-home", seasonSquadId: homeSquad.id, formationId: formation.id, status: "confirmed", starters: [{ slotIndex: 0, playerId: homeKeeper.id }], substitutes: [homeStriker.id] }), /lineup_starting_xi_incomplete/);
  assert.throws(() => saveFixtureLineup(fixture.id, { teamId: "team-home", seasonSquadId: homeSquad.id, formationId: formation.id, status: "possible", starters: [{ slotIndex: 0, playerId: homeKeeper.id }, { slotIndex: 1, playerId: homeKeeper.id }], substitutes: [] }), /lineup_player_duplicate/);
  assert.throws(() => saveFixtureLineup(fixture.id, { teamId: "team-home", seasonSquadId: homeSquad.id, formationId: formation.id, status: "possible", starters: [{ slotIndex: 0, playerId: awayPlayer.id }], substitutes: [] }), /lineup_player_not_in_squad/);
  getDatabase().prepare("UPDATE players SET availability_status = 'injured', injury_type = 'Hamstring', expected_return_date = '2026-09-15', injury_notes = 'Muscle strain' WHERE id = ?").run(homeKeeper.id);
  assert.throws(() => saveFixtureLineup(fixture.id, { teamId: "team-home", seasonSquadId: homeSquad.id, formationId: formation.id, status: "confirmed", starters: [{ slotIndex: 0, playerId: homeKeeper.id }, { slotIndex: 1, playerId: homeStriker.id }], substitutes: [] }), /lineup_player_injured_cannot_confirm/);
  assert.equal(clearFixtureLineup(fixture.id, "team-home"), true);
  assert.equal(getFixtureLineups(fixture.id).some((lineup) => lineup.teamId === "team-away"), true);
});

test("football formation catalog provides standard presets with eleven normalized slots", () => {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT OR IGNORE INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-football-presets", "Football Presets", "football-presets", timestamp, timestamp);
  const sport = database.prepare("SELECT id FROM sports WHERE slug = 'football'").get() as { id: string };
  const formations = listFormationTemplates({ sportId: sport.id });
  assert.ok(formations.some((formation) => formation.name === "4-3-3"));
  assert.equal(formations.find((formation) => formation.name === "4-3-3")?.positions.length, 11);
  assert.ok(formations.find((formation) => formation.name === "4-3-3")?.positions.every((position) => position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100));
});

test.after(() => {
  const database = getDatabase() as unknown as { close?: () => void };
  database.close?.();
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary artifact */ } }
});
