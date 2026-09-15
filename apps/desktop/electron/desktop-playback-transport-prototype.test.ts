import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import {
  createPlaybackTransportHandlers,
  DesktopPlaybackTransportPrototype,
  type PlaybackSourceResolver
} from "./desktop-playback-transport-prototype.js";
import { DesktopSqliteStore } from "./desktop-storage.js";

type Fixture = {
  databasePath: string;
  store: DesktopSqliteStore;
  credentials: MemoryCredentialStore;
  providerA: ReturnType<DesktopSqliteStore["createProviderAccount"]>;
  providerB: ReturnType<DesktopSqliteStore["createProviderAccount"]>;
  movieA: ReturnType<DesktopSqliteStore["upsertMovie"]>;
};

function temporaryDatabasePath() {
  return path.join(os.tmpdir(), `gito-playback-prototype-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function cleanup(fixture: Fixture) {
  fixture.store.close();
  fs.rmSync(fixture.databasePath, { force: true });
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${fixture.databasePath}${suffix}`, { force: true });
}

function makeFixture(): Fixture {
  const databasePath = temporaryDatabasePath();
  const store = new DesktopSqliteStore(databasePath);
  const credentials = new MemoryCredentialStore();
  const providerA = store.createProviderAccount({ name: "Synthetic A", type: "xtream", baseUrl: "https://synthetic-a.invalid", credentialStoreRef: "credential-a" });
  const providerB = store.createProviderAccount({ name: "Synthetic B", type: "xtream", baseUrl: "https://synthetic-b.invalid", credentialStoreRef: "credential-b" });
  credentials.set("credential-a", "synthetic-user-a", "synthetic-password-a");
  credentials.set("credential-b", "synthetic-user-b", "synthetic-password-b");
  const movieA = store.upsertMovie({ providerAccountId: providerA.id, externalReference: "movie-123", name: "Synthetic Movie" });
  return { databasePath, store, credentials, providerA, providerB, movieA };
}

function makeResolver(options: { m3uEntries?: Array<{ externalReference: string; name: string; sourceUrl: string }> } = {}) {
  const calls: Array<{ kind: string; providerId: string; externalReference: string; username: string }> = [];
  const resolver: PlaybackSourceResolver = {
    async resolveXtream(context) {
      calls.push({ kind: "xtream", providerId: context.provider.id, externalReference: context.entity.externalReference ?? "", username: context.credentials.username });
      return { chunks: [new TextEncoder().encode("synthetic-media-chunk-1"), new TextEncoder().encode("synthetic-media-chunk-2")] };
    },
    async fetchM3u(context) {
      calls.push({ kind: "m3u-fetch", providerId: context.provider.id, externalReference: context.entity.externalReference ?? "", username: context.credentials.username });
      return options.m3uEntries ?? [];
    },
    async resolveM3u(context, entry) {
      calls.push({ kind: "m3u-resolve", providerId: context.provider.id, externalReference: entry.externalReference, username: context.credentials.username });
      return { chunks: [new TextEncoder().encode("synthetic-m3u-media")] };
    }
  };
  return { resolver, calls };
}

test("Xtream playback delivers synthetic media bytes without exposing provider URL or credentials", async () => {
  const fixture = makeFixture();
  const { resolver, calls } = makeResolver();
  try {
    const transport = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver);
    const handlers = createPlaybackTransportHandlers(transport);
    const session = await handlers.start({ entityType: "movie", entityId: fixture.movieA.id });
    const first = await handlers.media(session.sessionId);
    const second = await handlers.media(session.sessionId);
    const rendererVisible = JSON.stringify({ session, first, second });
    assert.equal(rendererVisible.includes("synthetic-a.invalid"), false);
    assert.equal(rendererVisible.includes("synthetic-password-a"), false);
    assert.equal(rendererVisible.includes("synthetic-user-a"), false);
    assert.equal(rendererVisible.includes("movie/123"), false);
    assert.equal(new TextDecoder().decode(first?.data), "synthetic-media-chunk-1");
    assert.equal(second?.done, true);
    assert.equal(session.entityId, fixture.movieA.id);
    assert.equal(calls[0]?.kind, "xtream");
    assert.equal(calls[0]?.providerId, fixture.providerA.id);
    assert.equal(calls[0]?.username, "synthetic-user-a");
  } finally {
    cleanup(fixture);
  }
});

test("renderer requests accept only local identity and reject URLs, credentials, and arbitrary destinations", async () => {
  const fixture = makeFixture();
  const { resolver } = makeResolver();
  try {
    const handlers = createPlaybackTransportHandlers(new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver));
    for (const field of ["url", "playbackUrl", "providerUrl", "manifestUrl", "username", "password", "token", "cookie", "authorization", "headers"]) {
      await assert.rejects(() => handlers.start({ entityType: "movie", entityId: fixture.movieA.id, [field]: "synthetic-secret" }), /playback_request_field_not_allowed/);
    }
  } finally {
    cleanup(fixture);
  }
});

test("provider isolation and session binding prevent cross-provider playback", async () => {
  const fixture = makeFixture();
  const { resolver, calls } = makeResolver();
  try {
    const movieB = fixture.store.upsertMovie({ providerAccountId: fixture.providerB.id, externalReference: "movie-123", name: "Synthetic Movie B" });
    const transport = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver);
    const sessionA = await transport.start({ entityType: "movie", entityId: fixture.movieA.id });
    const sessionB = await transport.start({ entityType: "movie", entityId: movieB.id });
    assert.notEqual(sessionA.providerAccountId, sessionB.providerAccountId);
    assert.equal((await transport.getSession(sessionA.sessionId))?.entityId, fixture.movieA.id);
    assert.equal((await transport.getSession(sessionB.sessionId))?.entityId, movieB.id);
    assert.deepEqual(calls.map((call) => call.providerId), [fixture.providerA.id, fixture.providerB.id]);
  } finally {
    cleanup(fixture);
  }
});

test("M3U unique match succeeds while missing and ambiguous matches fail closed", async () => {
  const fixture = makeFixture();
  const m3uProvider = fixture.store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "credential-m3u" });
  fixture.credentials.set("credential-m3u", "m3u-user", "m3u-password");
  const m3uMovie = fixture.store.upsertMovie({ providerAccountId: m3uProvider.id, externalReference: "m3u-movie-1", name: "M3U Movie" });
  try {
    const unique = makeResolver({ m3uEntries: [{ externalReference: "m3u-movie-1", name: "M3U Movie", sourceUrl: "https://synthetic-m3u.invalid/movie/secret" }] });
    const uniqueTransport = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, unique.resolver);
    const session = await uniqueTransport.start({ entityType: "movie", entityId: m3uMovie.id });
    assert.equal(new TextDecoder().decode((await uniqueTransport.readMedia(session.sessionId))?.data), "synthetic-m3u-media");

    const missing = makeResolver({ m3uEntries: [] });
    await assert.rejects(() => new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, missing.resolver).start({ entityType: "movie", entityId: m3uMovie.id }), /m3u_playback_identity_not_found/);

    const ambiguous = makeResolver({ m3uEntries: [
      { externalReference: "m3u-movie-1", name: "M3U Movie", sourceUrl: "https://synthetic-m3u.invalid/a" },
      { externalReference: "m3u-movie-1", name: "M3U Movie", sourceUrl: "https://synthetic-m3u.invalid/b" }
    ] });
    await assert.rejects(() => new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, ambiguous.resolver).start({ entityType: "movie", entityId: m3uMovie.id }), /m3u_playback_identity_ambiguous/);
  } finally {
    cleanup(fixture);
  }
});

test("cancellation, expiry, shutdown, and restart invalidate playback sessions", async () => {
  const fixture = makeFixture();
  const { resolver } = makeResolver();
  try {
    let now = 1_000;
    const transport = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver, { clock: () => now, sessionLifetimeMs: 100 });
    const session = await transport.start({ entityType: "movie", entityId: fixture.movieA.id });
    assert.equal(transport.cancel(session.sessionId), true);
    await assert.rejects(() => transport.readMedia(session.sessionId), /playback_session_inactive|playback_session_not_found/);

    const expiring = await transport.start({ entityType: "movie", entityId: fixture.movieA.id });
    now += 101;
    await assert.rejects(() => transport.readMedia(expiring.sessionId), /playback_session_expired/);
    assert.equal(transport.getSession(expiring.sessionId), null);

    const shutdownSession = await transport.start({ entityType: "movie", entityId: fixture.movieA.id });
    transport.shutdown();
    await assert.rejects(() => transport.readMedia(shutdownSession.sessionId), /playback_session_not_found/);

    const restarted = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver, { clock: () => now });
    assert.equal(restarted.getSession(shutdownSession.sessionId), null);
  } finally {
    cleanup(fixture);
  }
});

test("missing local identity fails before provider resolution", async () => {
  const fixture = makeFixture();
  const { resolver, calls } = makeResolver();
  try {
    const transport = new DesktopPlaybackTransportPrototype(fixture.store, fixture.credentials, resolver);
    await assert.rejects(() => transport.start({ entityType: "movie", entityId: "missing-movie" }), /playback_entity_not_found/);
    assert.deepEqual(calls, []);
  } finally {
    cleanup(fixture);
  }
});
