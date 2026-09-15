import assert from "node:assert/strict";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import { DesktopPlaybackTransport } from "./desktop-playback-transport.js";
import { DesktopSqliteStore } from "./desktop-storage.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 3I-Y2 — Renderer Isolation Verification
 * 
 * Verify that playback sessions created for Movie/Episode entities
 * do not expose provider URLs, credentials, or sensitive information
 * to the renderer.
 */

function tempPath() { return path.join(os.tmpdir(), `gito-y2-isolation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`); }
function cleanup(store: DesktopSqliteStore, file: string) { store.close(); fs.rmSync(file, { force: true }); for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true }); }

function installSyntheticProvider() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "synthetic-provider-y2.invalid") {
      const action = url.searchParams.get("action");
      if (action === "get_vod_streams") {
        return new Response(JSON.stringify([
          { stream_id: "synthetic-movie-001", stream_url: "https://synthetic-provider-y2.invalid/vod/movie.m3u8" }
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (action === "get_series_info") {
        const seriesId = url.searchParams.get("series_id");
        return new Response(JSON.stringify({
          episodes: {
            "1": [{ id: "synthetic-episode-001", movie_url: "https://synthetic-provider-y2.invalid/vod/episode.m3u8" }]
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/vod/movie.m3u8") {
        return new Response("#EXTM3U\nvariant.m3u8", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
      }
      if (url.pathname === "/vod/episode.m3u8") {
        return new Response("#EXTM3U\nvariant.m3u8", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
      }
    }
    throw new Error("synthetic_provider_unmocked_url: " + String(input));
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

test("3I-Y2: Movie playback session does not expose provider URL or credentials to renderer", async () => {
  const dbPath = tempPath();
  const storage = new DesktopSqliteStore(dbPath);
  const credentials = new MemoryCredentialStore();
  const restore = installSyntheticProvider();

  try {
    // Setup synthetic provider, movie, and credentials
    const provider = storage.createProviderAccount({
      name: "Y2 Test Provider",
      type: "xtream",
      baseUrl: "https://synthetic-provider-y2.invalid/xtream/",
      credentialStoreRef: "y2-movie-creds"
    });
    credentials.set("y2-movie-creds", "secret_username", "secret_password");

    const movie = storage.upsertMovie({
      providerAccountId: provider.id,
      externalReference: "synthetic-movie-001",
      name: "Test Movie"
    });

    const transport = new DesktopPlaybackTransport(storage, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });

    // Verify session contains only safe identity information
    assert(typeof session.sessionId === "string", "session has sessionId");
    assert(session.entityType === "movie", "session preserves entityType");
    assert.equal(session.entityId, movie.id, "session preserves entityId");
    assert(typeof session.expiresAt === "string", "session has expiresAt");

    // Verify session does NOT contain provider URLs or credentials
    const sessionStr = JSON.stringify(session);
    assert(!sessionStr.includes("synthetic-provider-y2.invalid"), "session does not expose provider hostname");
    assert(!sessionStr.includes("secret_username"), "session does not expose credentials username");
    assert(!sessionStr.includes("secret_password"), "session does not expose credentials password");
    assert(!sessionStr.includes("xtream"), "session does not expose provider type");
    assert(!sessionStr.includes("https://"), "session does not expose any URLs");
    assert(!sessionStr.includes("http://"), "session does not expose any URLs");

    transport.cancel(session.sessionId);
  } finally {
    cleanup(storage, dbPath);
    restore();
  }
});

test("3I-Y2: Episode playback session does not expose provider URL or credentials to renderer", async () => {
  const dbPath = tempPath();
  const storage = new DesktopSqliteStore(dbPath);
  const credentials = new MemoryCredentialStore();
  const restore = installSyntheticProvider();

  try {
    // Setup synthetic provider, series, episode, and credentials
    const provider = storage.createProviderAccount({
      name: "Y2 Episode Provider",
      type: "xtream",
      baseUrl: "https://synthetic-provider-y2.invalid/xtream/",
      credentialStoreRef: "y2-episode-creds"
    });
    credentials.set("y2-episode-creds", "secret_user_123", "secret_pass_456");

    const series = storage.upsertSeries({
      providerAccountId: provider.id,
      externalReference: "synthetic-series-001",
      name: "Test Series"
    });

    const episode = storage.upsertEpisode({
      providerAccountId: provider.id,
      seriesId: series.id,
      externalReference: "synthetic-episode-001",
      episodeNumber: 1,
      name: "Test Episode"
    });

    const transport = new DesktopPlaybackTransport(storage, credentials);
    const session = await transport.start({ entityType: "episode", entityId: episode.id });

    // Verify session contains only safe identity information
    assert(typeof session.sessionId === "string", "session has sessionId");
    assert(session.entityType === "episode", "session preserves entityType");
    assert(session.entityId === episode.id, "session preserves entityId");
    assert(typeof session.expiresAt === "string", "session has expiresAt");

    // Verify session does NOT contain provider URLs or credentials
    const sessionStr = JSON.stringify(session);
    assert(!sessionStr.includes("synthetic-provider-y2.invalid"), "session does not expose provider hostname");
    assert(!sessionStr.includes("secret_user_123"), "session does not expose credentials username");
    assert(!sessionStr.includes("secret_pass_456"), "session does not expose credentials password");
    assert(!sessionStr.includes("xtream"), "session does not expose provider type");
    assert(!sessionStr.includes("https://"), "session does not expose any URLs");
    assert(!sessionStr.includes("http://"), "session does not expose any URLs");

    transport.cancel(session.sessionId);
  } finally {
    cleanup(storage, dbPath);
    restore();
  }
});

test("3I-Y2: Playback resource responses do not expose provider URLs through metadata", async () => {
  const dbPath = tempPath();
  const storage = new DesktopSqliteStore(dbPath);
  const credentials = new MemoryCredentialStore();
  const restore = installSyntheticProvider();

  try {
    const provider = storage.createProviderAccount({
      name: "Y2 Resource Provider",
      type: "xtream",
      baseUrl: "https://synthetic-provider-y2.invalid/xtream/",
      credentialStoreRef: "y2-res-creds"
    });
    credentials.set("y2-res-creds", "res_secret", "res_pass");

    const movie = storage.upsertMovie({
      providerAccountId: provider.id,
      externalReference: "synthetic-movie-001",
      name: "Resource Test Movie"
    });

    const transport = new DesktopPlaybackTransport(storage, credentials);
    const session = await transport.start({ entityType: "movie", entityId: movie.id });

    // Read root manifest
    const manifestResp = await transport.read({
      sessionId: session.sessionId,
      requestId: "manifest-req",
      resourceId: "resource-001",
      resourceType: "manifest"
    });

    // Verify manifest response metadata is safe
    assert(manifestResp.sessionId === session.sessionId, "response includes session id");
    assert(manifestResp.resourceType === "manifest", "response indicates resource type");
    assert(manifestResp.contentType.includes("mpegurl"), "response has playlist content type");

    // Verify manifest data does NOT contain provider URLs
    const manifestText = new TextDecoder().decode(manifestResp.data);
    assert(!manifestText.includes("synthetic-provider-y2.invalid"), "manifest does not contain provider URL");
    assert(manifestText.includes("gito-resource://"), "manifest uses logical resource IDs");
    assert(!manifestText.match(/https?:\/\//), "manifest contains no http/https URLs");

    transport.cancel(session.sessionId);
  } finally {
    cleanup(storage, dbPath);
    restore();
  }
});

// Note: Non-HLS bounded range behavior is thoroughly tested in desktop-playback-transport.test.ts
// Y2 focus is on renderer isolation, which is demonstrated above with Movie and Episode sessions.

