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
const { buildMobileLiveMatches, isLiveWindowMatch } = await import("../routes/mobile.js");

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
  assert.throws(() => setPublicationDelivery(artifact.publicationId, { deliveryReference: "delivery-query-1", playbackUrl: "https://example.com/live.m3u8?token=secret" }), /publication_delivery_url_unsafe/);
  assert.ok(setPublicationDelivery(artifact.publicationId, { deliveryReference: "delivery-public", playbackUrl: "https://media.example/live/match.m3u8" }));
  assert.throws(() => setPublicationDelivery(artifact.publicationId, {
    deliveryReference: "delivery-invalid-xtream",
    playbackMode: "DIRECT_XTREAM",
    playbackUrl: "https://example.com/not-a-provider-resource.m3u8"
  }), /publication_delivery_url_unsafe/);

  const xtream = createPublicationArtifact({ matchId: "match-publication", sourceReference: "desktop-xtream-reference" });
  assert.ok(setPublicationDelivery(xtream.publicationId, {
    deliveryReference: "delivery-xtream",
    playbackMode: "DIRECT_XTREAM",
    playbackUrl: "http://synthetic.test/live/TEST_USER/TEST_PASSWORD/123.m3u8"
  }));

  const published = listPublishedPublicationFeed().find((entry: any) => entry.publication.publicationId === artifact.publicationId) as any;
  assert.equal(published.deliveryReference, "delivery-public");
  assert.equal(published.playbackUrl, "https://media.example/live/match.m3u8");
  assert.equal(published.playbackMode, "DIRECT_SAFE");
  assert.equal("channelId" in published, false);
  assert.equal("providerId" in published, false);

  approvePublicationArtifact(xtream.publicationId);
  publishPublicationArtifact(xtream.publicationId);
  const xtreamFeed = listPublishedPublicationFeed().find((entry: any) => entry.publication.publicationId === xtream.publicationId) as any;
  assert.equal(xtreamFeed.playbackMode, "DIRECT_XTREAM");
  assert.equal(xtreamFeed.playbackUrl, "http://synthetic.test/live/TEST_USER/TEST_PASSWORD/123.m3u8");
});

test("live publication feed enforces the 30-minute window and canonical ordering", () => {
  const db = getDatabase();
  const now = Date.now();
  const soon = new Date(now + 10 * 60 * 1000).toISOString();
  const later = new Date(now + 20 * 60 * 1000).toISOString();
  const latest = new Date(now + 25 * 60 * 1000).toISOString();
  const hidden = new Date(now + 45 * 60 * 1000).toISOString();

  const sportId = "sport-live-order";
  const basketballId = "sport-live-basketball";
  const eplId = "competition-live-epl";
  const faCupId = "competition-live-facup";
  const laLigaId = "competition-live-laliga";
  const nbaId = "competition-live-nba";
  const englandHostId = "host-live-england";
  const spainHostId = "host-live-spain";
  const usaHostId = "host-live-usa";

  db.prepare("INSERT OR IGNORE INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(sportId, "Football", "football-live-order", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO sports (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(basketballId, "Basketball", "basketball-live-order", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, ?, ?, 'country', NULL, 'active', ?, ?)").run(englandHostId, sportId, "England", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, ?, ?, 'country', NULL, 'active', ?, ?)").run(spainHostId, sportId, "Spain", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, ?, ?, 'country', NULL, 'active', ?, ?)").run(usaHostId, basketballId, "USA", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO competitions (id, sport_id, host_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'international', 'league', 'clubs', 'active', ?, ?)").run(eplId, sportId, englandHostId, "Premier League", "premier-league-live-order", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO competitions (id, sport_id, host_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'international', 'cup', 'clubs', 'active', ?, ?)").run(faCupId, sportId, englandHostId, "FA Cup", "fa-cup-live-order", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO competitions (id, sport_id, host_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'international', 'league', 'clubs', 'active', ?, ?)").run(laLigaId, sportId, spainHostId, "La Liga", "la-liga-live-order", new Date().toISOString(), new Date().toISOString());
  db.prepare("INSERT OR IGNORE INTO competitions (id, sport_id, host_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'international', 'league', 'clubs', 'active', ?, ?)").run(nbaId, basketballId, usaHostId, "NBA", "nba-live-order", new Date().toISOString(), new Date().toISOString());

  const makeMatch = (id: string, competitionId: string, startsAt: string, status = "scheduled") => {
    db.prepare("INSERT OR IGNORE INTO teams (id, sport_id, name, slug, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'club', 'active', ?, ?) , (?, ?, ?, ?, 'club', 'active', ?, ?)").run(
      `${id}-home`, sportId, `${id} Home`, `${id}-home`, new Date().toISOString(), new Date().toISOString(),
      `${id}-away`, sportId, `${id} Away`, `${id}-away`, new Date().toISOString(), new Date().toISOString()
    );
    db.prepare("INSERT OR IGNORE INTO matches (id, competition_id, home_team_id, away_team_id, starts_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, competitionId, `${id}-home`, `${id}-away`, startsAt, status, new Date().toISOString(), new Date().toISOString()
    );
  };

  makeMatch("match-live-fa-cup", faCupId, soon, "scheduled");
  makeMatch("match-live-premier", eplId, later, "scheduled");
  makeMatch("match-live-premier-later", eplId, latest, "scheduled");
  makeMatch("match-live-la-liga", laLigaId, soon, "scheduled");
  makeMatch("match-live-nba", nbaId, soon, "scheduled");
  makeMatch("match-hidden-too-early", eplId, hidden, "scheduled");

  for (const matchId of ["match-hidden-too-early", "match-live-la-liga", "match-live-premier-later", "match-live-nba", "match-live-fa-cup", "match-live-premier"]) {
    const artifact = createPublicationArtifact({ matchId, sourceReference: `source-${matchId}` });
    approvePublicationArtifact(artifact.publicationId);
    publishPublicationArtifact(artifact.publicationId);
    setPublicationDelivery(artifact.publicationId, { deliveryReference: `delivery-${matchId}`, playbackUrl: `https://media.example/${matchId}.m3u8` });
  }

  const liveFeed = listPublishedPublicationFeed();
  const visible = buildMobileLiveMatches(liveFeed, new Date(now)).map((entry: any) => entry.match.id);

  assert.deepEqual(visible, [
    "match-live-nba",
    "match-publication",
    "match-live-fa-cup",
    "match-live-premier",
    "match-live-premier-later",
    "match-live-la-liga"
  ]);
  const unknownAvailability = buildMobileLiveMatches(liveFeed, new Date(now)).find((entry: any) => entry.match.id === "match-live-fa-cup");
  assert.equal(unknownAvailability?.stream.status, "unavailable");
  assert.equal(unknownAvailability?.stream.healthStatus, "unknown");
  assert.equal(visible.includes("match-hidden-too-early"), false);
  assert.equal(isLiveWindowMatch(new Date(now + 31 * 60 * 1000).toISOString(), "scheduled", new Date(now)), false);
  assert.equal(isLiveWindowMatch(new Date(now + 30 * 60 * 1000).toISOString(), "scheduled", new Date(now)), true);
  assert.equal(isLiveWindowMatch(new Date(now + 15 * 60 * 1000).toISOString(), "scheduled", new Date(now)), true);
  assert.equal(isLiveWindowMatch(new Date(now).toISOString(), "live", new Date(now)), true);
  assert.equal(isLiveWindowMatch(new Date(now - 10 * 60 * 1000).toISOString(), "ended", new Date(now)), false);
  assert.equal(isLiveWindowMatch(new Date(now - 10 * 60 * 1000).toISOString(), "cancelled", new Date(now)), false);
  assert.equal(isLiveWindowMatch(new Date(now - 10 * 60 * 1000).toISOString(), "postponed", new Date(now)), false);
  assert.equal(isLiveWindowMatch(undefined, "scheduled", new Date(now)), false);
  assert.equal(isLiveWindowMatch("invalid", "scheduled", new Date(now)), false);
});

test("live response preserves canonical identity and logo fields", () => {
  const now = new Date();
  const live = buildMobileLiveMatches([{
    match: {
      id: "match-live-identity",
      startsAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      status: "live",
      sportName: "Soccer",
      sportLogoUrl: "/uploads/soccer.png",
      hostName: "Germany",
      hostLogoUrl: "/uploads/germany.png",
      regionName: "Europe",
      countryName: "Germany",
      countryLogoUrl: "/uploads/germany-flag.png",
      competitionName: "Bundesliga",
      competitionLogoUrl: "/uploads/bundesliga.png",
      homeTeamName: "Bayern Munich",
      homeTeamLogoUrl: "/uploads/bayern.png",
      awayTeamName: "Borussia Dortmund",
      awayTeamLogoUrl: "/uploads/dortmund.png"
    },
    publication: { publicationId: "publication-live-identity", publicationStatus: "published", availability: "ready" },
    playbackUrl: "https://media.example/live.m3u8",
    playbackMode: "DIRECT_XTREAM"
  }], now);

  assert.deepEqual(live[0], {
    match: live[0].match,
    publication: live[0].publication,
    playbackUrl: "https://media.example/live.m3u8",
    playbackMode: "DIRECT_XTREAM",
    deliveryReference: undefined,
    stream: { id: "publication-live-identity", status: "active", healthStatus: "active" },
    homeTeamName: "Bayern Munich",
    awayTeamName: "Borussia Dortmund",
    competitionName: "Bundesliga",
    sportName: "Soccer",
    hostName: "Germany",
    regionName: "Europe",
    countryName: "Germany",
    sportLogoUrl: "/uploads/soccer.png",
    hostLogoUrl: "/uploads/germany.png",
    countryLogoUrl: "/uploads/germany-flag.png",
    competitionLogoUrl: "/uploads/bundesliga.png",
    homeTeamLogoUrl: "/uploads/bayern.png",
    awayTeamLogoUrl: "/uploads/dortmund.png"
  });
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
