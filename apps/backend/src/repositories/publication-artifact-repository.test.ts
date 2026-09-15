import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = path.join(os.tmpdir(), `gito-publication-artifact-${process.pid}-${Date.now()}`);
const databasePath = path.join(tempRoot, "publication.sqlite");
const backupDir = path.join(tempRoot, "backups");
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.LEGACY_DATABASE_PATH = path.join(tempRoot, "missing-legacy.sqlite");
process.env.BACKUP_DIR = backupDir;
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.GITO_NEWS_TEST_MODE = "false";

const { closeDatabase, getDatabase } = await import("../db/connection.js");
const {
  approvePublicationArtifact,
  createPublicationArtifact,
  getPublicationArtifactById,
  getPublicationArtifactByMatchId,
  publishPublicationArtifact,
  revokePublicationArtifact,
  setPublicationDelivery,
  listPublishedPublicationFeed,
  updatePublicationArtifact
} = await import("./publication-artifact-repository.js");
const { validatePublicationSourceReference } = await import("../services/publication-artifact.js");

function seedMatch() {
  const db = getDatabase();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("sport-publication", "Football", "football-publication", timestamp, timestamp);
  db.prepare("INSERT INTO competitions (id, sport_id, name, slug, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("competition-publication", "sport-publication", "Test Competition", "test-competition-publication", "custom", timestamp, timestamp);
  db.prepare("INSERT INTO teams (id, sport_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)").run(
    "team-publication-home", "sport-publication", "Home", "home-publication", timestamp, timestamp,
    "team-publication-away", "sport-publication", "Away", "away-publication", timestamp, timestamp
  );
  db.prepare("INSERT INTO matches (id, competition_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "match-publication", "competition-publication", "team-publication-home", "team-publication-away", timestamp, "scheduled", timestamp, timestamp
  );
}

test("publication artifacts persist safe fields and lifecycle state", () => {
  seedMatch();
  const created = createPublicationArtifact({
    matchId: "match-publication",
    sourceReference: "opaque-source-reference",
    availability: "ready",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });

  assert.equal(created.schemaVersion, 1);
  assert.equal(created.publicationStatus, "draft");
  assert.equal(created.availability, "ready");
  assert.equal(created.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.equal(getPublicationArtifactById(created.publicationId)?.matchId, "match-publication");
  assert.equal(getPublicationArtifactByMatchId("match-publication")?.publicationId, created.publicationId);

  assert.throws(() => publishPublicationArtifact(created.publicationId), /publication_status_transition_invalid/);
  const approved = approvePublicationArtifact(created.publicationId);
  assert.equal(approved?.publicationStatus, "approved");
  assert.equal(approvePublicationArtifact(created.publicationId)?.publicationStatus, "approved");

  const published = publishPublicationArtifact(created.publicationId);
  assert.equal(published?.publicationStatus, "published");
  assert.ok(published?.publishedAt);

  for (const availability of ["ready", "degraded", "offline", "unknown"] as const) {
    assert.equal(updatePublicationArtifact(created.publicationId, { availability })?.availability, availability);
  }

  const revoked = revokePublicationArtifact(created.publicationId);
  assert.equal(revoked?.publicationStatus, "revoked");
  assert.equal(revoked?.availability, "offline");
  assert.ok(revoked?.revokedAt);
  assert.throws(() => publishPublicationArtifact(created.publicationId), /publication_status_terminal/);

  const keys = Object.keys(revoked ?? {}).sort();
  assert.deepEqual(keys, [
    "availability",
    "capability",
    "createdAt",
    "expiresAt",
    "matchId",
    "publicationId",
    "publicationStatus",
    "publishedAt",
    "revokedAt",
    "schemaVersion",
    "sourceReference",
    "updatedAt"
  ]);
  assert.equal("provider" in (revoked ?? {}), false);
  assert.equal("channel" in (revoked ?? {}), false);
  assert.equal("streamUrl" in (revoked ?? {}), false);
  assert.equal("playbackUrl" in (revoked ?? {}), false);
  assert.equal("url" in (revoked ?? {}), false);
  assert.equal(getPublicationArtifactById(created.publicationId)?.matchId, "match-publication");
  assert.equal("password" in (revoked ?? {}), false);
});

test("unsafe source references are rejected and publication state remains provider-neutral", () => {
  const unsafe = [
    "https://example.com/live/test.m3u8",
    "http://user:password@example.com/live/test",
    "/live/user/password/123.m3u8",
    "xtream://user:password@example.com/123",
    '{"username":"x","password":"y"}',
    Buffer.from("https://provider.example/live/user/password/1.m3u8").toString("base64")
  ];

  for (const value of unsafe) {
    assert.throws(
      () => validatePublicationSourceReference(value),
      (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "publication_source_reference_unsafe"
    );
    assert.throws(() => createPublicationArtifact({ matchId: "missing-match", sourceReference: value }), (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === "publication_source_reference_unsafe");
  }

  assert.equal(validatePublicationSourceReference("opaque-source-reference-123"), "opaque-source-reference-123");

  assert.equal("providerId" in unsafe, false);
  assert.equal("channelId" in unsafe, false);
});

test("published delivery is match-scoped and accepts only public HTTPS playback", () => {
  const artifact = createPublicationArtifact({ matchId: "match-publication", sourceReference: "desktop-publication-reference" });
  approvePublicationArtifact(artifact.publicationId);
  publishPublicationArtifact(artifact.publicationId);

  assert.throws(() => setPublicationDelivery(artifact.publicationId, { deliveryReference: "delivery-private", playbackUrl: "https://user:password@example.com/live.m3u8" }), /publication_delivery_url_unsafe/);
  assert.throws(() => setPublicationDelivery(artifact.publicationId, { deliveryReference: "delivery-token", playbackUrl: "https://example.com/live.m3u8?token=secret" }), /publication_delivery_url_unsafe/);
  assert.ok(setPublicationDelivery(artifact.publicationId, { deliveryReference: "delivery-public", playbackUrl: "https://media.example/live/match.m3u8" }));

  const published = listPublishedPublicationFeed().find((entry: any) => entry.publication.publicationId === artifact.publicationId) as any;
  assert.equal(published.deliveryReference, "delivery-public");
  assert.equal(published.playbackUrl, "https://media.example/live/match.m3u8");
  assert.equal("channelId" in published, false);
  assert.equal("providerId" in published, false);
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
