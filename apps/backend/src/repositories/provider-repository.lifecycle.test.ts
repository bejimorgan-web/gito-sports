import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-provider-lifecycle-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { closeDatabase, getDatabase } = await import("../db/connection.js");
const { createProvider, purgeDeletedProviderData, softDeleteProvider } = await import("./provider-repository.js");

function seedOperationalRows() {
  const database = getDatabase();
  const timestamp = new Date().toISOString();

  database.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-1", "Football", "football", timestamp, timestamp);
  database.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-1", "Germany", "DE", "DEU", timestamp, timestamp);
  database.prepare("INSERT INTO competitions (id, sport_id, country_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run("competition-1", "sport-1", "country-1", "Bundesliga", "bundesliga", "domestic", "league", "clubs", timestamp, timestamp);
  database.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?), (?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(
    "team-1", "sport-1", "country-1", "Bayern", "bayern", "club", timestamp, timestamp,
    "team-2", "sport-1", "country-1", "Dortmund", "dortmund", "club", timestamp, timestamp
  );
  database.prepare("INSERT INTO matches (id, competition_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'published', ?, ?)").run("match-1", "competition-1", "team-1", "team-2", timestamp, timestamp, timestamp);
  database.prepare("INSERT INTO scheduling_matches (id, competition_id, home_team_id, away_team_id, kickoff_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)").run("scheduling-match-1", "competition-1", "team-1", "team-2", timestamp, timestamp, timestamp);
}

function seedProviderData(providerId: string, channelId: string, streamId: string, matchStreamId: string) {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO channels (id, provider_id, name, url, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(channelId, providerId, channelId, `https://${channelId}.example/live.m3u8`, timestamp, timestamp);
  database.prepare("INSERT INTO streams (id, match_id, channel_id, protocol, status, approval_status, health_status, created_at, updated_at) VALUES (?, 'match-1', ?, 'hls', 'assigned', 'assigned', 'unknown', ?, ?)").run(streamId, channelId, timestamp, timestamp);
  database.prepare("INSERT INTO match_streams (id, match_id, provider_id, channel_id, stream_url, created_at, updated_at) VALUES (?, 'scheduling-match-1', ?, ?, ?, ?, ?)").run(matchStreamId, providerId, channelId, `https://${channelId}.example/live.m3u8`, timestamp, timestamp);
}

test("provider cleanup removes channel dependents without touching unrelated provider data", () => {
  seedOperationalRows();
  const provider = createProvider({ name: "Cleanup Provider", baseUrl: "https://cleanup.example", type: "manual", authType: "none" });
  const unrelated = createProvider({ name: "Unrelated Provider", baseUrl: "https://unrelated.example", type: "manual", authType: "none" });
  const database = getDatabase();
  seedProviderData(provider.id, "channel-cleanup", "stream-cleanup", "match-stream-cleanup");
  seedProviderData(unrelated.id, "channel-unrelated", "stream-unrelated", "match-stream-unrelated");

  assert.equal(softDeleteProvider(provider.id), true);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM providers WHERE id = ? AND deleted = 1").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE id = 'channel-cleanup'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM streams WHERE id = 'stream-cleanup'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM match_streams WHERE id = 'match-stream-cleanup'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE id = 'channel-unrelated'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM streams WHERE id = 'stream-unrelated'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM match_streams WHERE id = 'match-stream-unrelated'").get().count, 1);
  assert.equal(database.prepare("SELECT status FROM matches WHERE id = 'match-1'").get().status, "published");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test("purgeDeletedProviderData removes streams before orphaned provider channels", () => {
  const database = getDatabase();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO providers (id, name, base_url, type, auth_type, status, deleted, created_at, updated_at) VALUES ('provider-purge', 'Purge Provider', 'https://purge.example', 'manual', 'none', 'active', 1, ?, ?)").run(timestamp, timestamp);
  seedProviderData("provider-purge", "channel-purge", "stream-purge", "match-stream-purge");

  assert.equal(purgeDeletedProviderData(database), 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM providers WHERE id = 'provider-purge'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE id = 'channel-purge'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM streams WHERE id = 'stream-purge'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM match_streams WHERE id = 'match-stream-purge'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE id = 'channel-unrelated'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM streams WHERE id = 'stream-unrelated'").get().count, 1);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
});

test.after(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});