import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import { DesktopPlaybackTransport } from "./desktop-playback-transport.js";
import { DesktopSqliteStore } from "./desktop-storage.js";

function databasePath() { return path.join(os.tmpdir(), `gito-playback-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`); }
function cleanup(store: DesktopSqliteStore, file: string) { store.close(); fs.rmSync(file, { force: true }); for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true }); }
function jsonResponse(payload: unknown, contentType = "application/json") { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": contentType } }); }

test("production transport resolves Xtream identity and sanitizes HLS resources", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic Xtream", type: "xtream", baseUrl: "https://synthetic.invalid", credentialStoreRef: "xtream-credentials" });
    credentials.set("xtream-credentials", "synthetic-user", "synthetic-password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie-1", name: "Synthetic Movie" });
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "get_vod_streams") return jsonResponse([{ stream_id: "movie-1", stream_url: "https://synthetic.invalid/authenticated/movie.m3u8" }]);
      if (url.toString() === "https://synthetic.invalid/authenticated/movie.m3u8") return new Response("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://synthetic.invalid/secret/key\"\n#EXT-X-MAP:URI=\"https://synthetic.invalid/init.mp4\"\nsegment.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
      if (url.toString() === "https://synthetic.invalid/secret/key") return new Response("synthetic-key", { status: 200, headers: { "content-type": "application/octet-stream" } });
      if (url.toString() === "https://synthetic.invalid/init.mp4") return new Response("synthetic-init", { status: 200, headers: { "content-type": "video/mp4" } });
      if (url.toString() === "https://synthetic.invalid/authenticated/segment.ts") return new Response("synthetic-segment", { status: 200, headers: { "content-type": "video/mp2t" } });
      throw new Error(`unexpected synthetic request ${url.origin}${url.pathname}`);
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    const manifest = await transport.read({ sessionId: session.sessionId, requestId: "request-1", resourceId: "resource-001", resourceType: "manifest" });
    const text = new TextDecoder().decode(manifest.data);
    assert.equal(text.includes("synthetic.invalid"), false);
    assert.match(text, /gito-resource:\/\/resource-/);
    assert.equal(JSON.stringify(session).includes("synthetic-password"), false);
    assert.equal(JSON.stringify(manifest).includes("synthetic.invalid"), false);
    const logicalResources = [...text.matchAll(/gito-resource:\/\/(resource-[A-Za-z0-9_-]+)/g)].map((match) => match[1]!);
    assert.equal(logicalResources.length, 3);
    const key = await transport.read({ sessionId: session.sessionId, requestId: "request-key", resourceId: logicalResources[0]!, resourceType: "key" });
    const init = await transport.read({ sessionId: session.sessionId, requestId: "request-init", resourceId: logicalResources[1]!, resourceType: "init" });
    const segment = await transport.read({ sessionId: session.sessionId, requestId: "request-segment", resourceId: logicalResources[2]!, resourceType: "segment", byteRange: { start: 0, end: 100 } });
    assert.equal(new TextDecoder().decode(key.data), "synthetic-key");
    assert.equal(new TextDecoder().decode(init.data), "synthetic-init");
    assert.equal(new TextDecoder().decode(segment.data), "synthetic-segment");
  } finally {
    globalThis.fetch = originalFetch; cleanup(store, file);
  }
});

test("production live playback starts for Xtream and credential-free M3U accounts", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const xtream = store.createProviderAccount({ name: "Synthetic Xtream", type: "xtream", baseUrl: "https://xtream.invalid", credentialStoreRef: "xtream-credentials" });
    credentials.set("xtream-credentials", "user", "password");
    const m3u = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    const xtreamChannel = store.upsertChannel({ providerAccountId: xtream.id, externalReference: "xtream-live-1", name: "Xtream Live", playbackUrl: "https://xtream.invalid/live/user/password/1.m3u8" });
    const m3uChannel = store.upsertChannel({ providerAccountId: m3u.id, externalReference: "m3u-live-1", name: "M3U Live", playbackUrl: "https://media.invalid/live.m3u8" });
    const transport = new DesktopPlaybackTransport(store, credentials);

    const xtreamSession = await transport.start({ entityType: "live", entityId: xtreamChannel.id });
    const m3uSession = await transport.start({ entityType: "live", entityId: m3uChannel.id });

    assert.equal(xtreamSession.entityId, xtreamChannel.id);
    assert.equal(m3uSession.entityId, m3uChannel.id);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("production live playback retries a legacy HTTPS URL over HTTP", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    const channel = store.upsertChannel({ providerAccountId: provider.id, externalReference: "live-1", name: "Legacy Live", playbackUrl: "https://media.invalid/live.m3u8" });
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input)); requests.push(url.toString());
      if (url.protocol === "https:") return new Response("", { status: 403 });
      return new Response("#EXTM3U\nsegment.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "live", entityId: channel.id });
    const manifest = await transport.read({ sessionId: session.sessionId, requestId: "manifest", resourceId: "resource-001", resourceType: "manifest" });
    assert.match(new TextDecoder().decode(manifest.data), /gito-resource:\/\/resource-/);
    assert.deepEqual(requests, ["https://media.invalid/live.m3u8", "http://media.invalid/live.m3u8"]);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("production live playback probes extensionless HLS sources before using ranged media", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    const channel = store.upsertChannel({ providerAccountId: provider.id, externalReference: "live-1", name: "Extensionless Live", playbackUrl: "https://media.invalid/live" });
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "media.invalid");
      assert.equal(new Headers(init?.headers).get("range"), null);
      return new Response("#EXTM3U\nsegment.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "live", entityId: channel.id });
    const manifest = await transport.read({ sessionId: session.sessionId, requestId: "manifest", resourceId: "resource-001", resourceType: "manifest" });
    assert.match(new TextDecoder().decode(manifest.data), /gito-resource:\/\/resource-/);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("production live playback probes extensionless non-HLS sources before ranged playback", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    const channel = store.upsertChannel({ providerAccountId: provider.id, externalReference: "m3u-live-1", name: "M3U Live", playbackUrl: "https://media.invalid/live" });
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).get("range"), null);
      return new Response("not a playlist", { status: 200, headers: { "content-type": "video/mp2t" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "live", entityId: channel.id });
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "manifest", resourceId: "resource-001", resourceType: "manifest" }), /playback_not_hls/);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("production transport constructs Xtream movie and episode URLs when direct URLs are absent", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic Xtream", type: "xtream", baseUrl: "https://synthetic.invalid", credentialStoreRef: "xtream-credentials" });
    credentials.set("xtream-credentials", "synthetic-user", "synthetic-password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie-1", name: "Movie" });
    const series = store.upsertSeries({ providerAccountId: provider.id, externalReference: "series-1", name: "Series" });
    const season = store.upsertSeason({ providerAccountId: provider.id, seriesId: series.id, externalReference: "season-1", seasonNumber: 1, name: "Season 1" });
    const episode = store.upsertEpisode({ providerAccountId: provider.id, seriesId: series.id, seasonId: season.id, externalReference: "episode-1", episodeNumber: 1, name: "Episode" });
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input)); requests.push(url.toString());
      if (url.searchParams.get("action") === "get_vod_streams") return jsonResponse([{ stream_id: "movie-1", container_extension: "mp4" }]);
      if (url.searchParams.get("action") === "get_series_info") return jsonResponse({ episodes: { "1": [{ id: "episode-1", container_extension: "mp4" }] } });
      return new Response("media", { status: 200, headers: { "content-type": "video/mp4", "content-length": "5" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const movieSession = await transport.start({ entityType: "movie", entityId: movie.id });
    await transport.read({ sessionId: movieSession.sessionId, requestId: "movie-media", resourceId: "resource-001", resourceType: "media", byteRange: { start: 0, end: 4 } });
    const episodeSession = await transport.start({ entityType: "episode", entityId: episode.id });
    await transport.read({ sessionId: episodeSession.sessionId, requestId: "episode-media", resourceId: "resource-001", resourceType: "media", byteRange: { start: 0, end: 4 } });
    assert.ok(requests.some((request) => request.includes("/movie/synthetic-user/synthetic-password/movie-1.mp4")));
    assert.ok(requests.some((request) => request.includes("/series/synthetic-user/synthetic-password/episode-1.mp4")));
  } finally {
    globalThis.fetch = originalFetch; cleanup(store, file);
  }
});

test("production M3U transport fails closed for missing and ambiguous identities", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    credentials.set("m3u-credentials", "m3u-user", "m3u-password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "m3u-1", name: "M3U Movie" });
    globalThis.fetch = (async () => new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"m3u-1\",Movie\nhttps://synthetic.invalid/movie.m3u8\n", { status: 200 })) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    assert.equal(session.entityId, movie.id);

    globalThis.fetch = (async () => new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"other\",Movie\nhttps://synthetic.invalid/movie.m3u8\n", { status: 200 })) as typeof fetch;
    await assert.rejects(() => transport.start({ entityType: "movie", entityId: movie.id }), /m3u_playback_identity_not_found/);

    globalThis.fetch = (async () => new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"m3u-1\",Movie A\nhttps://synthetic.invalid/a\n#EXTINF:-1 tvg-id=\"m3u-1\",Movie B\nhttps://synthetic.invalid/b\n", { status: 200 })) as typeof fetch;
    await assert.rejects(() => transport.start({ entityType: "movie", entityId: movie.id }), /m3u_playback_identity_ambiguous/);
  } finally {
    globalThis.fetch = originalFetch; cleanup(store, file);
  }
});

test("production transport rejects unsafe inputs, isolates resources, and invalidates cancellation/expiry", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch; let now = 1_000;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic", type: "m3u", baseUrl: "https://playlist.invalid", credentialStoreRef: "credentials" });
    credentials.set("credentials", "user", "password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async () => new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://synthetic.invalid/movie\n", { status: 200 })) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    await assert.rejects(() => transport.start({ entityType: "movie", entityId: movie.id, url: "https://unsafe.invalid" }), /playback_request_field_not_allowed/);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    transport.cancel(session.sessionId);
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "r", resourceId: "resource-001", resourceType: "manifest" }), /playback_session_expired|playback_session_cancelled/);
    const expiring = new DesktopPlaybackTransport(store, credentials, { clock: () => now });
    const second = await expiring.start({ entityType: "movie", entityId: movie.id }); now += 601_000;
    await assert.rejects(() => expiring.read({ sessionId: second.sessionId, requestId: "r", resourceId: "resource-001", resourceType: "manifest" }), /playback_session_expired/);
  } finally {
    globalThis.fetch = originalFetch; cleanup(store, file);
  }
});

test("production playback sessions are invalidated on shutdown and cannot survive a new service instance", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic", type: "m3u", baseUrl: "https://playlist.invalid", credentialStoreRef: "credentials" });
    credentials.set("credentials", "user", "password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async () => new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://synthetic.invalid/movie.m3u8\n", { status: 200 })) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    transport.shutdown();
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "shutdown", resourceId: "resource-001", resourceType: "segment" }), /playback_session_expired/);
    const restarted = new DesktopPlaybackTransport(store, credentials);
    await assert.rejects(() => restarted.read({ sessionId: session.sessionId, requestId: "restart", resourceId: "resource-001", resourceType: "segment" }), /playback_session_expired/);
  } finally {
    globalThis.fetch = originalFetch; cleanup(store, file);
  }
});

test("production non-HLS transport returns bounded 206 ranges without exposing the source URL", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid", credentialStoreRef: "credentials" });
    credentials.set("credentials", "user", "password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://media.invalid/movie.mp4\n", { status: 200, headers: { "content-type": "audio/x-mpegurl" } });
      if (url.hostname === "media.invalid") {
        assert.equal(init?.headers && new Headers(init.headers).get("range"), "bytes=10-19");
        return new Response("0123456789", { status: 206, headers: { "content-type": "video/mp4", "content-length": "10", "content-range": "bytes 10-19/100" } });
      }
      throw new Error("unexpected_destination");
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "whole-file", resourceId: "resource-001", resourceType: "media" }), /playback_range_required/);
    const result = await transport.read({ sessionId: session.sessionId, requestId: "range", resourceId: "resource-001", resourceType: "media", byteRange: { start: 10, end: 19 } });
    assert.equal(result.status, 206);
    assert.equal(result.contentType, "video/mp4");
    assert.deepEqual(result.range, { start: 10, end: 19, total: 100 });
    assert.equal(new TextDecoder().decode(result.data), "0123456789");
    assert.equal(JSON.stringify(result).includes("media.invalid"), false);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("non-HLS manifest probing returns playback_not_hls while ranged media remains supported", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid", credentialStoreRef: "credentials" });
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).hostname, "media.invalid");
      assert.equal(init?.headers && new Headers(init.headers).get("range"), "bytes=0-1048575");
      return new Response("0123456789", { status: 206, headers: { "content-type": "video/mp4", "content-length": "10", "content-range": "bytes 0-9/10" } });
    }) as typeof fetch;
    store.updateProviderAccount(provider.id, { baseUrl: "https://playlist.invalid/list.m3u" });
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://media.invalid/movie.mp4\n", { status: 200 });
      assert.equal(init?.headers && new Headers(init.headers).get("range"), "bytes=0-1048575");
      return new Response("0123456789", { status: 206, headers: { "content-type": "video/mp4", "content-length": "10", "content-range": "bytes 0-9/10" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "probe", resourceId: "resource-001", resourceType: "manifest" }), /playback_not_hls/);
    const result = await transport.read({ sessionId: session.sessionId, requestId: "media", resourceId: "resource-001", resourceType: "media", byteRange: { start: 0, end: 1048575 } });
    assert.equal(result.status, 206);
    assert.equal(result.contentType, "video/mp4");
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("HLS follows one permitted cross-origin redirect and pins child resources to the final origin", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch; const requests: string[] = [];
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "credentials" });
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input)); requests.push(url.toString());
      if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://source.invalid/master.m3u8\n", { status: 200 });
      if (url.hostname === "source.invalid") return new Response(null, { status: 302, headers: { location: "https://cdn.invalid/master.m3u8" } });
      if (url.hostname === "cdn.invalid" && url.pathname === "/master.m3u8") return new Response("#EXTM3U\nsegment.ts\n", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
      if (url.hostname === "cdn.invalid" && url.pathname === "/segment.ts") return new Response("segment", { status: 200, headers: { "content-type": "video/mp2t" } });
      throw new Error("unexpected_destination");
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    const manifest = await transport.read({ sessionId: session.sessionId, requestId: "manifest", resourceId: "resource-001", resourceType: "manifest" });
    const manifestText = new TextDecoder().decode(manifest.data);
    assert.match(manifestText, /gito-resource:\/\/resource-/);
    const resourceId = manifestText.match(/gito-resource:\/\/(resource-[A-Za-z0-9_-]+)/)?.[1];
    assert.ok(resourceId);
    const segment = await transport.read({ sessionId: session.sessionId, requestId: "segment", resourceId, resourceType: "segment" });
    assert.equal(new TextDecoder().decode(segment.data), "segment");
    assert.deepEqual(requests, ["https://playlist.invalid/list.m3u", "https://source.invalid/master.m3u8", "https://cdn.invalid/master.m3u8", "https://cdn.invalid/segment.ts"]);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("HLS redirect limits and malformed or non-HTTP redirects remain rejected", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid/list.m3u", credentialStoreRef: "credentials" });
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    const transport = new DesktopPlaybackTransport(store, credentials);
    for (const location of ["https://cdn.invalid/one.m3u8", "data:text/plain,unsafe", "https://cdn.invalid/three.m3u8"]) {
      let redirects = 0;
      globalThis.fetch = (async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://source.invalid/master.m3u8\n", { status: 200 });
        redirects += 1;
        if (location.startsWith("data:")) return new Response(null, { status: 302, headers: { location } });
        if (redirects <= 4) return new Response(null, { status: 302, headers: { location: `https://cdn.invalid/${redirects}.m3u8` } });
        return new Response("#EXTM3U\n", { status: 200 });
      }) as typeof fetch;
      const session = await transport.start({ entityType: "movie", entityId: movie.id });
      await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: `redirect-${redirects}`, resourceId: "resource-001", resourceType: "manifest" }), /playback_upstream_failed/);
    }
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});

test("non-HLS transport rejects unsafe redirects and unsupported media types", async () => {
  const file = databasePath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const originalFetch = globalThis.fetch;
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://playlist.invalid", credentialStoreRef: "credentials" });
    credentials.set("credentials", "user", "password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie", name: "Movie" });
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://media.invalid/movie.mp4\n", { status: 200 });
      return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/media" } });
    }) as typeof fetch;
    const transport = new DesktopPlaybackTransport(store, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });
    await assert.rejects(() => transport.read({ sessionId: session.sessionId, requestId: "redirect", resourceId: "resource-001", resourceType: "media", byteRange: { start: 0, end: 9 } }), /playback_upstream_failed/);

    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "playlist.invalid") return new Response("#EXTM3U\n#EXTINF:-1 tvg-id=\"movie\",Movie\nhttps://media.invalid/movie.mp4\n", { status: 200 });
      return new Response("not media", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const unsupported = await transport.start({ entityType: "movie", entityId: movie.id });
    await assert.rejects(() => transport.read({ sessionId: unsupported.sessionId, requestId: "type", resourceId: "resource-001", resourceType: "media", byteRange: { start: 0, end: 9 } }), /playback_unsupported_format/);
  } finally { globalThis.fetch = originalFetch; cleanup(store, file); }
});
