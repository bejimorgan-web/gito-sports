import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-roster-import-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.AUTO_IMPORT_MIGRATION = "false";

const [
  { closeDatabase, getDatabase },
  { createHost },
  { createCompetition },
  { createSeason },
  { createTeam, getTeamById, importHostClubs },
  { listSeasonTeamMemberships, replaceSeasonTeamMemberships },
  { createCanonicalFixture, importCanonicalFixtures, listCanonicalFixtures }
] = await Promise.all([
  import("../db/connection.js"),
  import("./hosts-repository.js"),
  import("./competitions-repository.js"),
  import("./seasons-repository.js"),
  import("./teams-repository.js"),
  import("./competition-season-teams-repository.js"),
  import("./fixtures-repository.js")
]);

test("host roster CSV adds only new teams and season/fixture imports preserve existing rows", () => {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-roster", "Football", "football-roster", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-roster", "Exampleland", "EX", "EXL", timestamp, timestamp);
  const host = createHost({ sportId: "sport-roster", name: "Exampleland", type: "country", countryId: "country-roster" });

  const firstImport = importHostClubs(host.id, [
    { sportId: host.sportId, hostId: host.id, teamName: "North City", teamType: "club", shortName: "North", logoUrl: "" },
    { sportId: host.sportId, hostId: host.id, teamName: "Exampleland", teamType: "national", logoUrl: "crest-file.png" },
    { sportId: host.sportId, hostId: host.id, teamName: "South Town", teamType: "club", homeStadiumName: "South Ground" }
  ]);
  assert.equal(firstImport.createdCount, 3);
  const north = firstImport.created.find((team) => team.name === "North City")!;
  const national = firstImport.created.find((team) => team.type === "national")!;
  assert.equal(north.logoUrl, undefined);
  assert.equal(national.logoUrl, "crest-file.png");

  const secondImport = importHostClubs(host.id, [
    { teamId: north.id, sportId: host.sportId, hostId: host.id, teamName: "North City", teamType: "club" },
    { sportId: host.sportId, hostId: host.id, teamName: "south town", teamType: "club" },
    { sportId: host.sportId, hostId: host.id, teamName: "West Rovers", teamType: "club", logoUrl: "" }
  ]);
  assert.equal(secondImport.createdCount, 1);
  assert.equal(secondImport.skippedCount, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM teams WHERE host_id = ?").get(host.id)?.count, 4);

  const correctedImport = importHostClubs(host.id, [
    { teamName: "North City", teamType: "club", shortName: "NTH", homeStadiumName: "North Ground" }
  ], { updateExisting: true });
  assert.equal(correctedImport.createdCount, 0);
  assert.equal(correctedImport.updatedCount, 1);
  const correctedNorth = getTeamById(north.id)!;
  assert.equal(correctedNorth.id, north.id);
  assert.equal(correctedNorth.name, "North City");
  assert.equal(correctedNorth.shortName, "NTH");
  assert.equal(correctedNorth.homeStadiumName, "North Ground");

  assert.throws(() => importHostClubs(host.id, [
    { teamId: north.id, sportId: host.sportId, hostId: host.id, teamName: "North City", teamType: "club", shortName: "SHOULD ROLL BACK" },
    { sportId: host.sportId, hostId: host.id, teamName: "Invalid Type", teamType: "custom" }
  ], { updateExisting: true }), /club_type_must_be_club_or_national/);
  assert.equal(getTeamById(north.id)?.shortName, "NTH");

  assert.throws(() => importHostClubs(host.id, [
    { sportId: host.sportId, hostId: host.id, teamName: "Would Roll Back", teamType: "club" },
    { sportId: host.sportId, hostId: host.id, teamName: "Invalid Type", teamType: "custom" }
  ]), /club_type_must_be_club_or_national/);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM teams WHERE name = 'Would Roll Back'").get()?.count, 0);

  const competition = createCompetition({ sportId: host.sportId, hostId: host.id, name: "Example League", scope: "domestic", type: "league", participantType: "clubs" });
  const season = createSeason(competition.id, { name: "2026" });
  const south = firstImport.created.find((team) => team.name === "South Town")!;
  const seasonResult = replaceSeasonTeamMemberships(competition.id, season.id, [north.id, south.id]);
  assert.equal(seasonResult.count, 2);
  assert.deepEqual(listSeasonTeamMemberships(competition.id, season.id).map((entry) => entry.teamId).sort(), [north.id, south.id].sort());
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM competition_teams WHERE competition_id = ?").get(competition.id)?.count, 2);

  const otherHost = createHost({ sportId: host.sportId, name: "Otherland", type: "country" });
  const foreignTeam = createTeam({ sportId: host.sportId, hostId: otherHost.id, name: "Foreign FC", type: "club" });
  assert.throws(() => replaceSeasonTeamMemberships(competition.id, season.id, [foreignTeam.id]), /team_host_mismatch/);
  assert.equal(listSeasonTeamMemberships(competition.id, season.id).length, 2);

  const existingFixture = createCanonicalFixture({
    competitionId: competition.id, seasonId: season.id, homeTeamId: north.id, awayTeamId: south.id,
    startsAt: "2026-08-01T12:00:00.000Z"
  })!;
  const fixtureImport = importCanonicalFixtures({ hostId: host.id, competitionId: competition.id, seasonId: season.id, rows: [
    { fixtureId: existingFixture.id, homeTeamName: "", awayTeamName: "", startsAt: "" },
    { homeTeamName: "North City", awayTeamName: "South Town", startsAt: "2026-08-08T12:00:00.000Z", venueName: "North Ground" }
  ] });
  assert.equal(fixtureImport.createdCount, 1);
  assert.equal(fixtureImport.skippedCount, 1);
  const repeatImport = importCanonicalFixtures({ hostId: host.id, competitionId: competition.id, seasonId: season.id, rows: [
    { homeTeamName: "North City", awayTeamName: "South Town", startsAt: "2026-08-08T12:00:00.000Z" }
  ] });
  assert.equal(repeatImport.createdCount, 0);
  assert.equal(repeatImport.skippedCount, 1);
  assert.equal(listCanonicalFixtures({ competitionId: competition.id, seasonId: season.id, limit: 100 }).length, 2);
});

test.after(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
