import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-player-catalog-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCompetition } = await import("./competitions-repository.js");
const {
  createFormationTemplate,
  createPlayer,
  createSeasonSquad,
  createSquadPlayer,
  getFormationTemplateById,
  getPlayerById,
  getSeasonSquadById,
  listFormationTemplates,
  listPlayers,
  listSeasonSquads,
  listSquadPlayers,
  updateFormationTemplate,
  updatePlayer,
  updateSeasonSquad,
  updateSquadPlayer,
} = await import("./player-catalog-repository.js");

function seedCatalog() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-1", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-1", "England", "GB", "GBR", timestamp, timestamp);
  database.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'club', 'active', ?, ?) ").run("team-1", "sport-1", "country-1", "Example FC", "example-fc", timestamp, timestamp);
  const competition = createCompetition({ sportId: "sport-1", countryId: "country-1", name: "Premier League", scope: "domestic", type: "league", participantType: "clubs" });
  return { competitionId: competition.id };
}

test("player catalog foundation tracks players, squads, and reusable formations", () => {
  const { competitionId } = seedCatalog();

  const player = createPlayer({
    teamId: "team-1",
    countryId: "country-1",
    firstName: "Jamie",
    lastName: "Morris",
    displayName: "Jamie Morris",
    position: "midfielder",
    jerseyNumber: 10,
  });

  assert.equal(getPlayerById(player.id)?.displayName, "Jamie Morris");
  assert.equal(listPlayers({ teamId: "team-1" }).length, 1);

  const updatedPlayer = updatePlayer(player.id, { position: "attacking-midfielder", jerseyNumber: 7 });
  assert.equal(updatedPlayer?.position, "attacking-midfielder");
  assert.equal(updatedPlayer?.jerseyNumber, 7);

  const squad = createSeasonSquad({ teamId: "team-1", competitionId, seasonId: undefined, name: "2026/27 squad" });
  assert.equal(getSeasonSquadById(squad.id)?.name, "2026/27 squad");
  assert.equal(listSeasonSquads({ teamId: "team-1" }).length, 1);

  const squadPlayer = createSquadPlayer({ squadId: squad.id, playerId: player.id, role: "starter", position: "AM", jerseyNumber: 7, isCaptain: true });
  assert.equal(listSquadPlayers(squad.id)[0]?.playerId, player.id);

  const updatedSquadPlayer = updateSquadPlayer(squadPlayer.id, { role: "bench", isCaptain: false });
  assert.equal(updatedSquadPlayer?.role, "bench");
  assert.equal(updatedSquadPlayer?.isCaptain, false);

  const updatedSquad = updateSeasonSquad(squad.id, { name: "2026/27 Senior Squad" });
  assert.equal(updatedSquad?.name, "2026/27 Senior Squad");

  const template = createFormationTemplate({
    sportId: "sport-1",
    name: "4-3-3",
    key: "4-3-3",
    formation: "4-3-3",
    positions: [{ x: 10, y: 25 }, { x: 30, y: 25 }, { x: 50, y: 25 }, { x: 70, y: 25 }, { x: 90, y: 25 }],
  });

  assert.equal(getFormationTemplateById(template.id)?.formation, "4-3-3");
  assert.equal(listFormationTemplates({ sportId: "sport-1" }).length, 11);
  assert.equal(listFormationTemplates({ sportId: "sport-1" }).some((item) => item.id === template.id), true);

  const updatedTemplate = updateFormationTemplate(template.id, { formation: "4-2-3-1" });
  assert.equal(updatedTemplate?.formation, "4-2-3-1");
});

test("existing single-position records remain valid and multi-position data normalizes safely", () => {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO players (id, team_id, country_id, first_name, last_name, display_name, availability_status, position, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, 'active', ?, ?)").run("legacy-cm-player", "team-1", "country-1", "Test", "Player", "Test Player", "CM", timestamp, timestamp);
  const legacyPlayer = getPlayerById("legacy-cm-player");
  assert.equal(legacyPlayer?.position, "CM");
  assert.equal(legacyPlayer?.primaryPosition, "CM");
  assert.deepEqual(legacyPlayer?.secondaryPositions, []);

  const player = createPlayer({
    teamId: "team-1",
    countryId: "country-1",
    firstName: "Joao",
    lastName: "Cancelo",
    displayName: "Joao Cancelo",
    position: "defender",
    secondaryPositions: ["fullback", "winger"],
  });

  assert.equal(player.position, "defender");
  assert.deepEqual(player.primaryPosition, "defender");
  assert.deepEqual(player.secondaryPositions, ["fullback", "winger"]);

  const duplicate = updatePlayer(player.id, {
    primaryPosition: "defender",
    secondaryPositions: ["defender", "winger", "winger", " "],
  });

  assert.equal(duplicate?.primaryPosition, "defender");
  assert.deepEqual(duplicate?.secondaryPositions, ["winger"]);

  const shortCodePlayer = createPlayer({
    teamId: "team-1",
    countryId: "country-1",
    firstName: "Test",
    lastName: "Shortcode",
    displayName: "Test Shortcode",
    primaryPosition: "RB",
    secondaryPositions: ["RB", "LB", "RM", "RM"],
  });

  assert.equal(shortCodePlayer.position, "RB");
  assert.equal(shortCodePlayer.primaryPosition, "RB");
  assert.deepEqual(shortCodePlayer.secondaryPositions, ["LB", "RM"]);

  const emptySecondaryPlayer = createPlayer({
    teamId: "team-1",
    countryId: "country-1",
    firstName: "Test",
    lastName: "Empty",
    displayName: "Test Empty",
    primaryPosition: "CM",
    secondaryPositions: [],
  });

  assert.deepEqual(emptySecondaryPlayer.secondaryPositions, []);

  const goalkeeper = createPlayer({
    teamId: "team-1",
    countryId: "country-1",
    firstName: "Mike",
    lastName: "Maignan",
    displayName: "Mike Maignan",
    primaryPosition: "goalkeeper",
    secondaryPositions: [],
  });

  assert.equal(goalkeeper.position, "goalkeeper");
  assert.deepEqual(goalkeeper.secondaryPositions, []);
});

test.after(() => {
  const database = getDatabase() as unknown as { close?: () => void };
  database.close?.();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
