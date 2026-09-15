import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import { createDesktopPersistenceHandlers } from "./desktop-persistence-handlers.js";
import { DesktopPlaybackTransport } from "./desktop-playback-transport.js";
import { DesktopSqliteStore } from "./desktop-storage.js";
import { createDesktopPlaybackLoader } from "../src/renderer/services/desktop-playback-hls-loader.js";

function tempPath() { return path.join(os.tmpdir(), `gito-playback-e2e-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`); }
function cleanup(store: DesktopSqliteStore, file: string) { store.close(); fs.rmSync(file, { force: true }); for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true }); }
function response(body: string, contentType: string) { return new Response(body, { status: 200, headers: { "content-type": contentType } }); }
function manifestResources(text: string) { return [...text.matchAll(/gito-resource:\/\/(resource-[A-Za-z0-9_-]+)/g)].map((match) => match[1]!); }

function installProviderFixture() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "synthetic-provider.invalid") {
      const action = url.searchParams.get("action");
      if (action === "get_vod_streams") return response(JSON.stringify([{ stream_id: "movie-1", stream_url: "https://synthetic-provider.invalid/movie/master.m3u8" }]), "application/json");
      if (action === "get_series_info") return response(JSON.stringify({ episodes: { "1": [{ id: "episode-1", movie_url: "https://synthetic-provider.invalid/episode/master.m3u8" }] } }), "application/json");
      if (url.pathname === "/movie/master.m3u8" || url.pathname === "/episode/master.m3u8") return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8\n", "application/vnd.apple.mpegurl");
      if (url.pathname === "/movie/variant.m3u8" || url.pathname === "/episode/variant.m3u8") return response("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\nsegment-001.m4s\n", "application/vnd.apple.mpegurl");
      if (url.pathname.endsWith("/key.bin")) return response("synthetic-key", "application/octet-stream");
      if (url.pathname.endsWith("/init.mp4")) return response("synthetic-init", "video/mp4");
      if (url.pathname.endsWith("/segment-001.m4s")) return response("synthetic-segment", "video/iso.segment");
    }
    if (url.hostname === "synthetic-m3u.invalid") {
      if (url.pathname === "/movie/master.m3u8") return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8\n", "application/vnd.apple.mpegurl");
      if (url.pathname === "/movie/variant.m3u8") return response("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\nsegment-001.m4s\n", "application/vnd.apple.mpegurl");
      if (url.pathname.endsWith("/key.bin")) return response("synthetic-key", "application/octet-stream");
      if (url.pathname.endsWith("/init.mp4")) return response("synthetic-init", "video/mp4");
      if (url.pathname.endsWith("/segment-001.m4s")) return response("synthetic-segment", "video/iso.segment");
      if (url.pathname === "/list.m3u") return response("#EXTM3U\n#EXTINF:-1 tvg-id=\"m3u-movie\",M3U Movie\nhttps://synthetic-m3u.invalid/movie/master.m3u8\n", "audio/x-mpegurl");
      if (url.pathname === "/duplicate.m3u") return response("#EXTM3U\n#EXTINF:-1 tvg-id=\"m3u-movie\",A\nhttps://synthetic-m3u.invalid/movie/master.m3u8\n#EXTINF:-1 tvg-id=\"m3u-movie\",B\nhttps://synthetic-m3u.invalid/movie/master.m3u8\n", "audio/x-mpegurl");
      return response("#EXTM3U\n", "audio/x-mpegurl");
    }
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error("synthetic_unknown_destination");
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

async function traverse(handlers: ReturnType<typeof createDesktopPersistenceHandlers>, sessionId: string) {
  const master = await handlers.playbackRead({ sessionId, requestId: "master", resourceId: "resource-001", resourceType: "manifest" });
  const masterText = new TextDecoder().decode(master.data);
  assert.equal(masterText.includes("synthetic-provider.invalid"), false);
  const variantId = manifestResources(masterText)[0]!;
  const variant = await handlers.playbackRead({ sessionId, requestId: "variant", resourceId: variantId, resourceType: "playlist" });
  const variantText = new TextDecoder().decode(variant.data);
  assert.equal(variantText.includes("synthetic-provider.invalid"), false);
  const resources = manifestResources(variantText);
  assert.equal(resources.length, 3);
  const key = await handlers.playbackRead({ sessionId, requestId: "key", resourceId: resources[0]!, resourceType: "key" });
  const init = await handlers.playbackRead({ sessionId, requestId: "init", resourceId: resources[1]!, resourceType: "init" });
  const segment = await handlers.playbackRead({ sessionId, requestId: "segment", resourceId: resources[2]!, resourceType: "segment" });
  return { master, variant, key, init, segment };
}

test("production handler E2E traverses synthetic Movie and Episode HLS resources", async () => {
  const file = tempPath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const restore = installProviderFixture();
  try {
    const provider = store.createProviderAccount({ name: "Synthetic Xtream", type: "xtream", baseUrl: "https://synthetic-provider.invalid", credentialStoreRef: "e2e-credentials" });
    credentials.set("e2e-credentials", "fixture-user", "fixture-password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie-1", name: "Movie" });
    const series = store.upsertSeries({ providerAccountId: provider.id, externalReference: "series-1", name: "Series" });
    const season = store.upsertSeason({ providerAccountId: provider.id, seriesId: series.id, externalReference: "season-1", seasonNumber: 1, name: "Season 1" });
    const episode = store.upsertEpisode({ providerAccountId: provider.id, seriesId: series.id, seasonId: season.id, externalReference: "episode-1", episodeNumber: 1, name: "Episode" });
    const transport = new DesktopPlaybackTransport(store, credentials);
    const handlers = createDesktopPersistenceHandlers(store, credentials, undefined, transport);
    for (const entity of [{ entityType: "movie" as const, entityId: movie.id }, { entityType: "episode" as const, entityId: episode.id }]) {
      const session = await handlers.playbackStart(entity);
      const rendererView = JSON.stringify(session);
      assert.equal(rendererView.includes("synthetic-provider.invalid"), false);
      assert.equal(rendererView.includes("fixture-password"), false);
      const output = await traverse(handlers, session.sessionId);
      assert.equal(new TextDecoder().decode(output.key.data), "synthetic-key");
      assert.equal(new TextDecoder().decode(output.init.data), "synthetic-init");
      assert.equal(new TextDecoder().decode(output.segment.data), "synthetic-segment");
      let loaderData: ArrayBuffer | undefined;
      const Loader = createDesktopPlaybackLoader({
        start: async () => session,
        read: (input) => handlers.playbackRead(input),
        cancel: async (sessionId) => { handlers.playbackCancel(sessionId); }
      }, session.sessionId);
      const loader = new Loader({} as any);
      loader.load({ url: "gito-resource://resource-001", type: "manifest" }, {}, {
        onSuccess: (data: { data: ArrayBuffer }) => { loaderData = data.data; },
        onError: (error: unknown) => { throw error; }
      });
      for (let attempt = 0; attempt < 20 && !loaderData; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
      const loaderManifest = new TextDecoder().decode(loaderData);
      assert.match(loaderManifest, /#EXTM3U/);
      assert.match(loaderManifest, /gito-resource:\/\/resource-/);
      assert.equal(loaderManifest.includes("synthetic-provider.invalid"), false);
    }
    const persisted = JSON.stringify([...store.listMovies(provider.id), ...store.listSeries(provider.id), ...store.listSeasons(provider.id), ...store.listEpisodes(provider.id), ...store.listOperations(provider.id)]);
    assert.equal(persisted.includes("synthetic-provider.invalid"), false);
    assert.equal(persisted.includes("fixture-password"), false);
  } finally { restore(); cleanup(store, file); }
});

test("production handler E2E traverses unique M3U and fails closed for missing or duplicate identity", async () => {
  const file = tempPath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const restore = installProviderFixture();
  try {
    const provider = store.createProviderAccount({ name: "Synthetic M3U", type: "m3u", baseUrl: "https://synthetic-m3u.invalid/list.m3u", credentialStoreRef: "m3u-credentials" });
    credentials.set("m3u-credentials", "m3u-user", "m3u-password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "m3u-movie", name: "M3U Movie" });
    const transport = new DesktopPlaybackTransport(store, credentials);
    const handlers = createDesktopPersistenceHandlers(store, credentials, undefined, transport);
    const session = await handlers.playbackStart({ entityType: "movie", entityId: movie.id });
    const output = await traverse(handlers, session.sessionId);
    assert.equal(new TextDecoder().decode(output.segment.data), "synthetic-segment");

    store.updateProviderAccount(provider.id, { baseUrl: "https://synthetic-m3u.invalid/missing.m3u" });
    await assert.rejects(() => handlers.playbackStart({ entityType: "movie", entityId: movie.id }), /m3u_playback_identity_not_found/);
    store.updateProviderAccount(provider.id, { baseUrl: "https://synthetic-m3u.invalid/duplicate.m3u" });
    await assert.rejects(() => handlers.playbackStart({ entityType: "movie", entityId: movie.id }), /m3u_playback_identity_ambiguous/);
  } finally { restore(); cleanup(store, file); }
});

test("malicious renderer requests and cross-session resources are rejected", async () => {
  const file = tempPath(); const store = new DesktopSqliteStore(file); const credentials = new MemoryCredentialStore(); const restore = installProviderFixture();
  try {
    const provider = store.createProviderAccount({ name: "Synthetic", type: "xtream", baseUrl: "https://synthetic-provider.invalid", credentialStoreRef: "credentials" });
    credentials.set("credentials", "user", "password");
    const movie = store.upsertMovie({ providerAccountId: provider.id, externalReference: "movie-1", name: "Movie" });
    const transport = new DesktopPlaybackTransport(store, credentials); const handlers = createDesktopPersistenceHandlers(store, credentials, undefined, transport);
    await assert.rejects(() => handlers.playbackStart({ entityType: "movie", entityId: movie.id, providerAccountId: "other", url: "https://attacker.invalid" }), /playback_request_field_not_allowed/);
    const a = await handlers.playbackStart({ entityType: "movie", entityId: movie.id }); const b = await handlers.playbackStart({ entityType: "movie", entityId: movie.id });
    const manifestA = await handlers.playbackRead({ sessionId: a.sessionId, requestId: "a", resourceId: "resource-001", resourceType: "manifest" });
    const manifestB = await handlers.playbackRead({ sessionId: b.sessionId, requestId: "b", resourceId: "resource-001", resourceType: "manifest" });
    const resourceB = manifestResources(new TextDecoder().decode(manifestB.data))[0]!;
    await assert.rejects(() => handlers.playbackRead({ sessionId: a.sessionId, requestId: "cross", resourceId: resourceB, resourceType: "playlist" }), /playback_resource_mismatch/);
    await handlers.playbackCancel(a.sessionId);
    await assert.rejects(() => handlers.playbackRead({ sessionId: a.sessionId, requestId: "after-cancel", resourceId: "resource-001", resourceType: "manifest" }), /playback_session_expired/);
    assert.equal(JSON.stringify(manifestA).includes("synthetic-provider.invalid"), false);
  } finally { restore(); cleanup(store, file); }
});
