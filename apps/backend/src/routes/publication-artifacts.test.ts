import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = path.join(os.tmpdir(), `gito-publication-route-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(tempRoot, "publication.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(tempRoot, "missing-legacy.sqlite");
process.env.BACKUP_DIR = path.join(tempRoot, "backups");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.GITO_NEWS_TEST_MODE = "false";

const { createApp } = await import("../app.js");
const { closeDatabase, getDatabase } = await import("../db/connection.js");
const { createAccessToken } = await import("../services/jwt.js");

function seedMatch() {
  const db = getDatabase();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("sport-route", "Football", "football-route", timestamp, timestamp);
  db.prepare("INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("competition-route", "sport-route", "Test Competition", "test-competition-route", "custom", timestamp, timestamp);
  db.prepare("INSERT INTO teams (id, sport_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)").run(
    "team-route-home", "sport-route", "Home", "home-route", timestamp, timestamp,
    "team-route-away", "sport-route", "Away", "away-route", timestamp, timestamp
  );
  db.prepare("INSERT INTO matches (id, competition_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "match-route", "competition-route", "team-route-home", "team-route-away", timestamp, "scheduled", timestamp, timestamp
  );
}

const server = http.createServer(createApp());
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${address.port}`;
const token = createAccessToken({ sub: "publication-route-test", role: "admin" });
seedMatch();

async function post(body: unknown, authenticated = true) {
  return postPath("/publication-artifacts", body, authenticated);
}

async function postPath(path: string, body: unknown, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

test("accepts and persists a safe publication package", async () => {
  const response = await post({
    schemaVersion: 1,
    publicationId: "publication_route_1",
    matchId: "match-route",
    sourceReference: "source-route-1",
    capability: "live",
    publicationStatus: "published",
    availability: "ready",
    expiresAt: null
  });
  const body = await response.json() as { data?: Record<string, unknown> };

  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.data?.sourceReference, "source-route-1");
  assert.equal(body.data?.publicationStatus, "published");
  assert.equal("playbackUrl" in (body.data ?? {}), false);
  assert.equal("url" in (body.data ?? {}), false);
  assert.equal("provider" in (body.data ?? {}), false);
});

test("requires authentication and rejects forbidden request fields", async () => {
  const unauthenticated = await post({
    schemaVersion: 1,
    publicationId: "publication-unauthenticated",
    matchId: "match-route",
    sourceReference: "source-route-unauthenticated",
    capability: "live",
    publicationStatus: "published",
    availability: "ready",
    expiresAt: null
  }, false);
  assert.equal(unauthenticated.status, 401);

  for (const body of [
    {
      schemaVersion: 1,
      publicationId: "publication-playback-url",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      playbackUrl: "https://provider.example/live/user/password/1.m3u8"
    },
    {
      schemaVersion: 1,
      publicationId: "publication-credentials",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      username: "user",
      password: "password"
    },
    {
      schemaVersion: 1,
      publicationId: "publication-provider",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      provider: { username: "user", password: "password" }
    },
    {
      schemaVersion: 1,
      publicationId: "publication-channel-object",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      channel: { url: "https://provider.example/live/user/password/1.m3u8" }
    },
    {
      schemaVersion: 1,
      publicationId: "publication-stream-url",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      streamUrl: "https://provider.example/live/user/password/1.m3u8"
    },
    {
      schemaVersion: 1,
      publicationId: "publication-stream-url-raw",
      matchId: "match-route",
      sourceReference: "source-safe",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null,
      stream_url: "https://provider.example/live/user/password/1.m3u8"
    },
    {
      schemaVersion: 1,
      publicationId: "publication-url-source",
      matchId: "match-route",
      sourceReference: "https://provider.example/live/user/password/1.m3u8",
      capability: "live",
      publicationStatus: "published",
      availability: "ready",
      expiresAt: null
    }
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
  }
});

test("binds and publishes an artifact without legacy IPTV resolution", async () => {
  const createdResponse = await post({
    schemaVersion: 1,
    publicationId: "publication_binding_1",
    matchId: "match-route",
    sourceReference: "source-binding-a",
    capability: "live",
    publicationStatus: "draft",
    availability: "unknown",
    expiresAt: null
  });
  assert.equal(createdResponse.status, 201);

  const firstBind = await postPath("/publication-artifacts/publication_binding_1/bind", { matchId: "match-route" });
  const secondBind = await postPath("/publication-artifacts/publication_binding_1/bind", { matchId: "match-route" });
  assert.equal(firstBind.status, 200);
  assert.equal(secondBind.status, 200);
  assert.deepEqual((await firstBind.json()).data, (await secondBind.json()).data);

  const draftPublish = await postPath("/publication-artifacts/publication_binding_1/publish", {});
  assert.equal(draftPublish.status, 400);

  const approve = await postPath("/publication-artifacts/publication_binding_1/approve", {});
  const duplicateApprove = await postPath("/publication-artifacts/publication_binding_1/approve", {});
  assert.equal(approve.status, 200);
  assert.equal((await approve.json()).data.publicationStatus, "approved");
  assert.equal(duplicateApprove.status, 200);
  assert.equal((await duplicateApprove.json()).data.publicationStatus, "approved");

  const published = await postPath("/publication-artifacts/publication_binding_1/publish", {});
  const publishedBody = await published.json() as { data: Record<string, unknown> };
  assert.equal(published.status, 200);
  assert.equal(publishedBody.data.publicationStatus, "published");
  assert.equal("url" in publishedBody.data, false);
  assert.equal("playbackUrl" in publishedBody.data, false);
  assert.equal("providerId" in publishedBody.data, false);
  assert.equal("channelId" in publishedBody.data, false);
  assert.equal("streamUrl" in publishedBody.data, false);

  const availability = await postPath("/publication-artifacts/publication_binding_1/availability", {
    availability: "offline",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });
  const availabilityBody = await availability.json() as { data: Record<string, unknown> };
  assert.equal(availability.status, 200);
  assert.equal(availabilityBody.data.availability, "offline");
  assert.equal(availabilityBody.data.expiresAt, "2030-01-01T00:00:00.000Z");

  const revoked = await postPath("/publication-artifacts/publication_binding_1/revoke", {});
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).data.publicationStatus, "revoked");
});

test("source replacement uses a distinct artifact without changing the original", async () => {
  const first = await post({
    schemaVersion: 1,
    publicationId: "publication_source_a",
    matchId: "match-route",
    sourceReference: "source-provider-a",
    capability: "live",
    publicationStatus: "published",
    availability: "offline",
    expiresAt: null
  });
  const second = await post({
    schemaVersion: 1,
    publicationId: "publication_source_b",
    matchId: "match-route",
    sourceReference: "source-provider-b",
    capability: "live",
    publicationStatus: "published",
    availability: "ready",
    expiresAt: null
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await first.json()).data.sourceReference, "source-provider-a");
  assert.equal((await second.json()).data.sourceReference, "source-provider-b");
});

test("published feed returns safe newest publication per match", async () => {
  const older = await post({
    schemaVersion: 1,
    publicationId: "publication_feed_older",
    matchId: "match-route",
    sourceReference: "source-feed-older",
    capability: "live",
    publicationStatus: "published",
    availability: "degraded",
    expiresAt: null
  });
  const newer = await post({
    schemaVersion: 1,
    publicationId: "publication_feed_newer",
    matchId: "match-route",
    sourceReference: "source-feed-newer",
    capability: "live",
    publicationStatus: "published",
    availability: "ready",
    expiresAt: null
  });
  assert.equal(older.status, 201);
  assert.equal(newer.status, 201);

  const response = await fetch(`${baseUrl}/publication-artifacts/published`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json() as { data: Array<{ publication: Record<string, unknown>; match: Record<string, unknown> }> };
  assert.equal(response.status, 200);
  const entry = body.data.find((item) => item.match.id === "match-route");
  assert.equal(entry?.publication.publicationId, "publication_feed_newer");
  assert.equal(entry?.publication.availability, "ready");
  assert.equal(entry?.match.competitionId, "competition-route");
  assert.equal("stream" in (entry ?? {}), false);
  assert.equal("channel" in (entry ?? {}), false);
  assert.equal("provider" in (entry ?? {}), false);
  assert.equal("playbackUrl" in (entry ?? {}), false);
});

test("mobile publication feed reuses the safe published read model", async () => {
  const response = await fetch(`${baseUrl}/mobile/publications`);
  const body = await response.json() as { data: Array<{ publication: Record<string, unknown>; match: Record<string, unknown> }> };
  assert.equal(response.status, 200);
  const entry = body.data.find((item) => item.match.id === "match-route");
  assert.equal(entry?.publication.publicationStatus, "published");
  assert.equal(entry?.match.competitionName, "Test Competition");
  assert.equal("providerId" in (entry ?? {}), false);
  assert.equal("channelId" in (entry ?? {}), false);
  assert.equal("playbackUrl" in (entry ?? {}), false);
  assert.equal("streams" in (entry ?? {}), false);
  assert.equal("match_streams" in (entry ?? {}), false);
});

test("lifecycle requests reject sensitive or unexpected fields", async () => {
  const response = await postPath("/publication-artifacts/publication_binding_1/bind", {
    matchId: "match-route",
    channelId: "backend-channel",
    playbackUrl: "https://provider.example/live/user/password/1.m3u8"
  });
  assert.equal(response.status, 400);
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
