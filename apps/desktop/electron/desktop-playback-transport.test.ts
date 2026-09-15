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
