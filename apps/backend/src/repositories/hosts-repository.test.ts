import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-hosts-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { createHost, deleteHost, listHosts, updateHost } = await import("./hosts-repository.js");
const { createCompetition } = await import("./competitions-repository.js");
const { createSeason } = await import("./seasons-repository.js");
const { createSeasonTeamMembership } = await import("./competition-season-teams-repository.js");
const { getDatabase } = await import("../db/connection.js");
const { migrateLegacyCompetitionHosts } = await import("../db/host-migration.js");

test("supports multiple typed hosts and host-owned competitions", () => {
  const database = getDatabase();
  const now = new Date().toISOString();
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-football", "Football", "football", now, now);
  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-basketball", "Basketball", "basketball", now, now);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-england", "England", "GB", "GBR", now, now);

  const fifa = createHost({ sportId: "sport-football", name: "FIFA", type: "organization" });
  const caf = createHost({ sportId: "sport-football", name: "CAF", type: "federation" });
  const uefa = createHost({ sportId: "sport-football", name: "UEFA", hostType: "federation" });
  const other = createHost({ sportId: "sport-football", name: "Custom Host", type: "other" });
  const england = createHost({ sportId: "sport-football", name: "England", type: "country" });
  const fiba = createHost({ sportId: "sport-basketball", name: "FIBA", type: "federation" });

  assert.equal(listHosts("sport-football").length, 5);
  assert.equal(listHosts("sport-basketball").length, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM countries WHERE name IN ('FIFA', 'CAF')").get().count, 0);
  assert.throws(() => createHost({ sportId: "sport-football", name: "FIFA", type: "organization" }), /host_duplicate/);
  assert.throws(
    () => createHost({ sportId: "sport-football", name: "Invalid", type: "country" }),
    (error: any) => error?.code === "country_host_country_not_found" && /Select an existing country or create the country first/i.test(error.message)
  );
  assert.equal(fifa.countryId, undefined);
  assert.equal(caf.countryId, undefined);
  assert.equal(other.countryId, undefined);
  assert.equal(uefa.type, "federation");

  const changedToOrganization = updateHost(england.id, { type: "organization" });
  assert.equal(changedToOrganization?.countryId, undefined);
  assert.equal(updateHost(england.id, { type: "country" })?.countryId, "country-england");

  const worldCup = createCompetition({ sportId: "sport-football", hostId: fifa.id, name: "World Cup", scope: "international", type: "cup", participantType: "nationalTeams" });
  const premierLeague = createCompetition({ sportId: "sport-football", hostId: england.id, name: "Premier League", scope: "domestic", type: "league", participantType: "clubs" });
  assert.equal(worldCup.hostId, fifa.id);
  assert.equal(premierLeague.countryId, "country-england");
  assert.throws(() => createCompetition({ sportId: "sport-basketball", hostId: fifa.id, name: "Wrong Sport", scope: "international", type: "cup" }), /host_sport_mismatch/);
  const worldCupSeason = createSeason(worldCup.id, { name: "2026" });
  const premierLeagueSeason = createSeason(premierLeague.id, { name: "2026/27" });
  database.prepare("INSERT INTO teams (id, sport_id, name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("team-club", "sport-football", "Club FC", "club", now, now);
  database.prepare("INSERT INTO teams (id, sport_id, name, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("team-national", "sport-football", "National Team", "national", now, now);
  assert.equal(createSeasonTeamMembership(worldCup.id, worldCupSeason.id, "team-national").teamId, "team-national");
  assert.throws(() => createSeasonTeamMembership(worldCup.id, worldCupSeason.id, "team-club"), /team_participant_type_mismatch/);
  assert.equal(createSeasonTeamMembership(premierLeague.id, premierLeagueSeason.id, "team-club").teamId, "team-club");
  assert.throws(() => createSeasonTeamMembership(premierLeague.id, premierLeagueSeason.id, "team-national"), /team_participant_type_mismatch/);
  assert.equal(fiba.sportId, "sport-basketball");
  assert.equal(england.countryId, "country-england");

  const legacy = createCompetition({ sportId: "sport-football", countryId: "country-england", name: "FA Cup", scope: "domestic", type: "cup" });
  assert.equal(legacy.hostId, undefined);
  assert.equal(migrateLegacyCompetitionHosts(database), 1);
  assert.equal(database.prepare("SELECT host_id FROM competitions WHERE id = ?").get(legacy.id).host_id !== null, true);
  assert.throws(() => deleteHost(fifa.id), /host_in_use/);
  assert.equal(deleteHost(other.id), true);
});

test.after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${databasePath}${suffix}`);
    } catch {
      // temporary test artifact
    }
  }
  process.exit(0);
});
