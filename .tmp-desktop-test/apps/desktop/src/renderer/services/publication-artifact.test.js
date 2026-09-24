import test from "node:test";
import assert from "node:assert/strict";
import { buildDesktopPublicationContexts, buildSafePublicationPackage } from "./publication-artifact";
test("builds an allow-listed safe publication package", () => {
    const publication = buildSafePublicationPackage({
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
    });
    assert.deepEqual(publication, {
        schemaVersion: 1,
        publicationId: publication.publicationId,
        matchId: "match-1",
        sourceReference: "source-stable-1",
        capability: "live",
        publicationStatus: "draft",
        availability: "ready",
        expiresAt: null
    });
    const serialized = JSON.stringify(publication);
    assert.equal(serialized.includes("secret-user"), false);
    assert.equal(serialized.includes("secret-password"), false);
    assert.equal(serialized.includes("provider.example"), false);
    assert.equal(serialized.includes("playbackUrl"), false);
    assert.equal(serialized.includes("streamUrl"), false);
});
test("generates an opaque source identity when no local source reference is supplied", () => {
    const first = buildSafePublicationPackage({ matchId: "match-1" });
    const second = buildSafePublicationPackage({ matchId: "match-1" });
    assert.match(first.sourceReference, /^source_[A-Za-z0-9_-]+$/);
    assert.notEqual(first.sourceReference, second.sourceReference);
    assert.notEqual(first.publicationId, second.publicationId);
});
test("rejects a URL supplied as the source identity", () => {
    assert.throws(() => buildSafePublicationPackage({ matchId: "match-1", sourceReference: "https://provider.example/live/1.m3u8" }), /publication_source_reference_unsafe/);
});
test("buildDesktopPublicationContexts resolves local source context and strips secrets", () => {
    const contexts = buildDesktopPublicationContexts([
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
    ], [
        {
            publicationId: "publication-1",
            sourceReference: "source-1",
            providerAccountId: "provider-1",
            channelId: "channel-1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        }
    ], [
        {
            id: "provider-1",
            name: "Private Provider",
            type: "xtream",
            status: "active",
            availability: "online"
        }
    ], [
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
    ]);
    assert.equal(contexts.length, 1);
    const context = contexts[0];
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
    const contexts = buildDesktopPublicationContexts([
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
    ], [
        {
            publicationId: "publication-2",
            sourceReference: "source-2",
            providerAccountId: "provider-missing",
            channelId: "channel-missing",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
        }
    ], [], []);
    const unresolvedContext = contexts[0];
    assert.equal(unresolvedContext.source.hasLocalMapping, true);
    assert.equal(unresolvedContext.source.isResolved, false);
    assert.equal(unresolvedContext.source.provider, null);
    assert.equal(unresolvedContext.source.channel, null);
    assert.equal(unresolvedContext.source.providerAccountId, "provider-missing");
    assert.equal(unresolvedContext.source.channelId, "channel-missing");
});
