import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-player-import-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { executePlayerImport, previewPlayerImport } = await import("./player-import-service.js");

function seed() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-1", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-1", "Spain", "ES", "ESP", timestamp, timestamp);
  database.prepare("INSERT INTO teams (id, sport_id, country_id, name, short_name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'club', 'active', ?, ?)").run("team-1", "sport-1", "country-1", "FC Barcelona", "Barcelona", "fc-barcelona", timestamp, timestamp);
  database.prepare("INSERT INTO competitions (id, sport_id, country_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'domestic', 'league', 'clubs', 'active', ?, ?)").run("competition-1", "sport-1", "country-1", "La Liga", "la-liga", timestamp, timestamp);
  database.prepare("INSERT INTO seasons (id, competition_id, name, status) VALUES (?, ?, ?, 'active')").run("season-1", "competition-1", "2026/27");
  database.prepare("INSERT INTO season_squads (id, team_id, competition_id, season_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)").run("squad-1", "team-1", "competition-1", "season-1", "Barcelona 2026/27 Squad", timestamp, timestamp);
}

test("imports new players, preserves multi-position data, and creates squad membership", () => {
  seed();
  const request = {
    rows: [{
      sourceRow: 2,
      sourceSheet: "Players",
      displayName: "Lamine Yamal",
      firstName: "Lamine",
      lastName: "Yamal",
      teamName: "Barcelona",
      competitionName: "La Liga",
      seasonName: "2026/27",
      primaryPosition: "RW",
      secondaryPositions: ["ST", "AM"],
      secondaryPositionsProvided: true,
      birthDate: "2007-07-13",
      heightCm: 180,
      weightKg: 72,
      jerseyNumber: 27,
      unmappedColumns: []
    }]
  };
  const preview = previewPlayerImport(request);
  assert.equal(preview.summary.errors, 0);
  assert.equal(preview.summary.creates, 1);
  let result;
  result = executePlayerImport(request);
  assert.deepEqual(result.playersCreated, 1);
  const database = getDatabase();
  const player = database.prepare("SELECT * FROM players WHERE display_name = ?").get("Lamine Yamal") as any;
  assert.equal(player.position, "RW");
  assert.deepEqual(JSON.parse(player.secondary_positions_json), ["ST", "AM"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM squad_players WHERE squad_id = ? AND player_id = ?").get("squad-1", player.id).count, 1);
});

test("updates existing players without clearing omitted optional fields", () => {
  if (Number(getDatabase().prepare("SELECT COUNT(*) AS count FROM season_squads").get().count) === 0) seed();
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO players (id, team_id, country_id, first_name, last_name, display_name, position, secondary_positions_json, height_cm, weight_kg, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run("player-1", "team-1", "country-1", "Gavi", "P", "Gavi P", "CM", JSON.stringify(["AM", "LW"]), 173, 70, timestamp, timestamp);
  const request = {
    mode: "update" as const,
    defaultSquadId: "squad-1",
    rows: [{ sourceRow: 2, sourceSheet: "Players", displayName: "Gavi P", teamName: "FC Barcelona", primaryPosition: "CM", secondaryPositions: [], unmappedColumns: [] }]
  };
  const preview = previewPlayerImport(request);
  const result = executePlayerImport(request);
  assert.equal(result.playersUpdated, 1);
  const player = database.prepare("SELECT * FROM players WHERE id = 'player-1'").get() as any;
  assert.equal(player.height_cm, 173);
  assert.equal(player.weight_kg, 70);
  assert.deepEqual(JSON.parse(player.secondary_positions_json), ["AM", "LW"]);
});

test("blocks duplicate workbook rows and unmatched clubs before writing", () => {
  const database = getDatabase();
  const before = Number(database.prepare("SELECT COUNT(*) AS count FROM players").get().count);
  const request = {
    mode: "create-update" as const,
    defaultCompetitionId: "competition-1",
    defaultSeasonId: "season-1",
    rows: [
      { sourceRow: 2, sourceSheet: "Players", displayName: "Duplicate Player", teamName: "Unknown FC", secondaryPositions: [], unmappedColumns: [] },
      { sourceRow: 3, sourceSheet: "Players", displayName: "Duplicate Player", teamName: "Unknown FC", secondaryPositions: [], unmappedColumns: [] }
    ]
  };
  const preview = previewPlayerImport(request);
  assert.equal(preview.summary.errors, 2);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM players").get().count), before);
});

test("database transaction rolls back all writes after a controlled failure", () => {
  const database = getDatabase();
  const before = Number(database.prepare("SELECT COUNT(*) AS count FROM players").get().count);
  assert.throws(() => database.transaction(() => {
    const timestamp = new Date().toISOString();
    database.prepare("INSERT INTO players (id, team_id, first_name, last_name, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)").run("rollback-player", "team-1", "Rollback", "Player", "Rollback Player", timestamp, timestamp);
    throw new Error("forced_import_failure");
  })(), /forced_import_failure/);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM players").get().count), before);
  assert.equal(database.prepare("SELECT id FROM players WHERE id = 'rollback-player'").get(), undefined);
});

test.after(() => {
  getDatabase().close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
