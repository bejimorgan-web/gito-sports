import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-phase7-streams-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCanonicalFixture } = await import("./fixtures-repository.js");
const { createCanonicalStream, deleteCanonicalStream, getStreamById, listStreams, updateCanonicalStream } = await import("./streams-repository.js");

function seed() {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES ('sport-1', 'Football', 'football', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES ('country-1', 'Germany', 'DE', 'DEU', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO competitions (id, sport_id, country_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES ('competition-1', 'sport-1', 'country-1', 'Bundesliga', 'bundesliga', 'domestic', 'league', 'clubs', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES ('team-1', 'sport-1', 'country-1', 'Bayern', 'bayern', 'club', 'active', ?, ?), ('team-2', 'sport-1', 'country-1', 'Dortmund', 'dortmund', 'club', 'active', ?, ?)").run(now, now, now, now);
  db.prepare("INSERT INTO providers (id, name, base_url, type, auth_type, status, created_at, updated_at) VALUES ('provider-1', 'Provider', 'https://provider.example', 'manual', 'none', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO channels (id, provider_id, name, url, status, created_at, updated_at) VALUES ('channel-1', 'provider-1', 'Sports HD', 'https://stream.example/live.m3u8', 'active', ?, ?)").run(now, now);
  db.prepare("INSERT INTO scheduling_matches (id, competition_id, home_team_id, away_team_id, kickoff_time, status, created_at, updated_at) VALUES ('legacy-1', 'competition-1', 'team-1', 'team-2', ?, 'scheduled', ?, ?)").run(now, now, now);
  const fixture = createCanonicalFixture({ competitionId: "competition-1", homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-08-20T15:00:00.000Z" });
  assert.ok(fixture);
  return fixture.id;
}

test("canonical stream lifecycle uses matches and preserves legacy tables", () => {
  const fixtureId = seed();
  const stream = createCanonicalStream(fixtureId, "channel-1");
  assert.equal(stream.matchId, fixtureId);
  assert.equal(listStreams({ matchId: fixtureId }).length, 1);
  assert.equal(getStreamById(stream.id)?.channelId, "channel-1");
  assert.throws(() => createCanonicalStream(fixtureId, "channel-1"), /stream_already_assigned/);
  const updated = updateCanonicalStream(fixtureId, stream.id, { protocol: "dash" });
  assert.equal(updated?.protocol, "dash");
  assert.equal(deleteCanonicalStream(fixtureId, stream.id), true);
  assert.equal(deleteCanonicalStream(fixtureId, stream.id), false);
  const db = getDatabase();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM scheduling_matches").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM match_streams").get().count, 0);
});

test.after(() => {
  const db = getDatabase() as unknown as { close?: () => void };
  db.close?.();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
