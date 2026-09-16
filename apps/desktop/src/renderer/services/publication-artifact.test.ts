import test from "node:test";
import assert from "node:assert/strict";
import { buildDesktopPublicationContexts, buildLegacyStreamAssignment, buildSafePublicationPackage, validateDirectPlaybackUrl, validateDirectXtreamPlaybackUrl } from "./publication-artifact";

test("accepts only credential-free HTTPS direct playback URLs", () => {
  assert.equal(validateDirectPlaybackUrl("https://media.example/live.m3u8"), "https://media.example/live.m3u8");
  assert.throws(() => validateDirectPlaybackUrl("http://media.example/live.m3u8"), /requires_https/);
  assert.throws(() => validateDirectPlaybackUrl("https://user:pass@media.example/live.m3u8"), /rejects_userinfo/);
  assert.throws(() => validateDirectPlaybackUrl("https://media.example/live.m3u8?token=secret"), /rejects_token_query/);
});

test("rejects credential-bearing Xtream media paths", () => {
  for (const kind of ["live", "movie", "series"]) {
    assert.throws(
      () => validateDirectPlaybackUrl(`https://synthetic.test/${kind}/TEST_USER/TEST_PASSWORD/stream-123.m3u8`),
      /rejects_xtream_credential_path/
    );
  }
});

test("rejects before publication delivery receives an unsafe URL", () => {
  let deliveryCalls = 0;
  const submitDelivery = (playbackUrl: string) => {
    const safeUrl = validateDirectPlaybackUrl(playbackUrl);
    deliveryCalls += 1;
    return safeUrl;
  };

  assert.throws(
    () => submitDelivery("https://provider.example/live/username/password/stream-123.m3u8"),
    /rejects_xtream_credential_path/
  );
  assert.equal(deliveryCalls, 0);
});
test("requires HTTPS before a publication can use an M3U channel", () => {
  assert.throws(
    () => validateDirectPlaybackUrl("http://provider.example/live/channel.m3u8"),
    /publication_playback_url_requires_https/
  );
});

test("accepts only HTTPS Xtream playback paths for direct Xtream mode", () => {
  assert.equal(
    validateDirectXtreamPlaybackUrl("https://synthetic.test/live/TEST_USER/TEST_PASSWORD/123.m3u8"),
    "https://synthetic.test/live/TEST_USER/TEST_PASSWORD/123.m3u8"
  );
  assert.throws(() => validateDirectXtreamPlaybackUrl("http://synthetic.test/live/TEST_USER/TEST_PASSWORD/123.m3u8"), /requires_https|unsafe/);
  assert.throws(() => validateDirectXtreamPlaybackUrl("https://synthetic.test/anything/123.m3u8"), /unsafe/);
});


test("publication payloads contain no local IPTV credentials", () => {
  const publication = buildSafePublicationPackage({
    matchId: "match-credentials-local",
    localSource: {
      providerId: "provider-local",
      channelId: "channel-local",
      channelName: "Sports HD",
      url: "https://provider.example/live/channel-123.m3u8",
      streamUrl: "https://provider.example/live/channel-123.m3u8"
    }
  });

  const serialized = JSON.stringify(publication);
  assert.equal(serialized.includes("username"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("provider.example"), false);
});

test("rejects publication sources that declare secret playback state", () => {
  assert.throws(
    () => buildSafePublicationPackage({
      matchId: "match-1",
      localSource: { metadata: { headers: { Authorization: "Bearer secret" } } }
    }),
    /publication_source_requires_secret_state/
  );
});

test("builds a legacy stream assignment for the canonical fixture", () => {
  const assignment = buildLegacyStreamAssignment({
    canonicalFixtureId: "fixture-1",
    sportName: "Football",
    competitionName: "League",
    homeTeamName: "Home FC",
    awayTeamName: "Away FC",
    startsAt: "2026-09-14T18:00:00.000Z",
    streamUrl: "https://media.example/live/fixture-1.m3u8"
  });

  assert.deepEqual(assignment, {
    canonicalFixtureId: "fixture-1",
    sportName: "Football",
    competitionName: "League",
    homeTeamName: "Home FC",
    awayTeamName: "Away FC",
    startsAt: "2026-09-14T18:00:00.000Z",
    streamUrl: "https://media.example/live/fixture-1.m3u8",
    venueName: undefined
  });
});

test("requires the canonical stream assignment fields", () => {
  assert.throws(
    () => buildLegacyStreamAssignment({ canonicalFixtureId: "fixture-1", streamUrl: "https://media.example/live/fixture-1.m3u8" }),
    /stream_assignment_fields_required/
  );
});

test("rejects local sources that contain provider credentials", () => {
  assert.throws(() => buildSafePublicationPackage({
    matchId: "match-1",
    sourceReference: "source-stable-1",
    availability: "ready",
    localSource: {
      providerId: "provider-1",
      channelId: "channel-1",
      providerName: "Private Provider",
      channelName: "Sports HD",
      username: "secret-user",
      password: "secret-password",
      url: "https://provider.example/live/secret-user/secret-password/1.m3u8",
      streamUrl: "https://provider.example/live/secret-user/secret-password/1.m3u8",
      provider: { username: "secret-user", password: "secret-password" },
      channel: { url: "https://provider.example/live/secret-user/secret-password/1.m3u8" },
      metadata: { credential: "secret-password" }
    }
  }), /publication_source_requires_secret_state/);
});

test("generates an opaque source identity when no local source reference is supplied", () => {
  const first = buildSafePublicationPackage({ matchId: "match-1" });
  const second = buildSafePublicationPackage({ matchId: "match-1" });

  assert.match(first.sourceReference, /^source_[A-Za-z0-9_-]+$/);
  assert.notEqual(first.sourceReference, second.sourceReference);
  assert.notEqual(first.publicationId, second.publicationId);
});

test("rejects a URL supplied as the source identity", () => {
  assert.throws(
    () => buildSafePublicationPackage({ matchId: "match-1", sourceReference: "https://provider.example/live/1.m3u8" }),
    /publication_source_reference_unsafe/
  );
});

test("buildDesktopPublicationContexts resolves local source context and strips secrets", () => {
  const contexts = buildDesktopPublicationContexts(
    [
      {
        publication: {
          schemaVersion: 1,
          publicationId: "publication-1",
          matchId: "match-1",
          sourceReference: "source-1",
          capability: "live",
          publicationStatus: "published",
          availability: "ready",
          expiresAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          publishedAt: "2026-01-01T00:00:00.000Z",
          revokedAt: null
        },
        match: {
          id: "match-1",
          competitionId: "competition-1",
          homeTeamName: "Home FC",
          awayTeamName: "Away FC",
          competitionName: "League",
          sportName: "Football"
        }
      }
    ],
    [
      {
        publicationId: "publication-1",
        sourceReference: "source-1",
        providerAccountId: "provider-1",
        channelId: "channel-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    [
      {
        id: "provider-1",
        name: "Private Provider",
        type: "xtream",
        status: "active",
        availability: "online"
      }
    ],
    [
      {
        id: "channel-1",
        providerAccountId: "provider-1",
        externalReference: "ext-1",
        name: "Sports HD",
        groupName: "Live",
        logoUrl: null,
        playbackUrl: "https://provider.example/live/user/password/1.m3u8",
        contentType: "live",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  );

  assert.equal(contexts.length, 1);
  const context = contexts[0]!;
  assert.deepEqual(context.source, {
    publicationId: "publication-1",
    sourceReference: "source-1",
    providerAccountId: "provider-1",
    channelId: "channel-1",
    provider: {
      id: "provider-1",
      name: "Private Provider",
      type: "xtream",
      status: "active",
      availability: "online"
    },
    channel: {
      id: "channel-1",
      name: "Sports HD",
      providerAccountId: "provider-1",
      contentType: "live",
      status: "active",
      groupName: "Live"
    },
    hasLocalMapping: true,
    isResolved: true
  });
  assert.equal(JSON.stringify(contexts[0]).includes("credential-private-provider"), false);
  assert.equal(JSON.stringify(contexts[0]).includes("provider.example"), false);
  assert.equal(JSON.stringify(contexts[0]).includes("password"), false);
});

test("buildDesktopPublicationContexts leaves unresolved mappings safe when provider or channel is missing", () => {
  const contexts = buildDesktopPublicationContexts(
    [
      {
        publication: {
          schemaVersion: 1,
          publicationId: "publication-2",
          matchId: "match-2",
          sourceReference: "source-2",
          capability: "live",
          publicationStatus: "published",
          availability: "unknown",
          expiresAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          publishedAt: "2026-01-01T00:00:00.000Z",
          revokedAt: null
        },
        match: { id: "match-2" }
      }
    ],
    [
      {
        publicationId: "publication-2",
        sourceReference: "source-2",
        providerAccountId: "provider-missing",
        channelId: "channel-missing",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    [],
    []
  );

  const unresolvedContext = contexts[0]!;
  assert.equal(unresolvedContext.source.hasLocalMapping, true);
  assert.equal(unresolvedContext.source.isResolved, false);
  assert.equal(unresolvedContext.source.provider, null);
  assert.equal(unresolvedContext.source.channel, null);
  assert.equal(unresolvedContext.source.providerAccountId, "provider-missing");
  assert.equal(unresolvedContext.source.channelId, "channel-missing");
});
