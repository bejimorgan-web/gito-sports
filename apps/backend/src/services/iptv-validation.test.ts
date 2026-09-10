import test from "node:test";
import assert from "node:assert/strict";

import { validateHttpStreamUrl } from "./url-validation.js";
import { parseM3uPlaylist } from "./m3u-parser.js";
import { buildXtreamEndpointCandidates, normalizeXtreamUrl, readResponseTextWithTimeout, testXtreamConnection } from "./xtream-codes.js";
import { detectProviderType } from "./provider-type-detector.js";
import { createProvider, getProviderById, listProviders, softDeleteProvider, syncProviderChannels, setProviderStatus } from "../repositories/provider-repository.js";
import { getDatabase } from "../db/connection.js";

test("accepts common non-http stream protocols", () => {
  assert.equal(validateHttpStreamUrl("rtmp://example.com/live/stream"), null);
  assert.equal(validateHttpStreamUrl("rtsp://example.com/live/stream"), null);
  assert.equal(validateHttpStreamUrl("udp://239.1.1.1:1234"), null);
  assert.equal(validateHttpStreamUrl("srt://example.com:8890"), null);
});

test("builds xtream endpoint candidates from common provider URL shapes", () => {
  const fromRoot = buildXtreamEndpointCandidates("https://example.com");
  assert.ok(fromRoot.some((url) => url.includes("/player_api.php")));

  const fromGetPhp = buildXtreamEndpointCandidates("https://example.com/get.php");
  assert.ok(fromGetPhp.some((url) => url.includes("/get.php")));

  const fromPlayerApi = buildXtreamEndpointCandidates("https://example.com/player_api.php");
  assert.ok(fromPlayerApi.some((url) => url.includes("/player_api.php")));

  const fromApiPath = buildXtreamEndpointCandidates("https://example.com/xtream");
  assert.ok(fromApiPath.some((url) => url.includes("/api.php")));
});

test("normalizes legitimate Xtream URLs and rejects unsafe input", () => {
  assert.equal(normalizeXtreamUrl("http://example.com:8080/").url, "http://example.com:8080");
  assert.equal(normalizeXtreamUrl("https://example.com/player_api.php").url, "https://example.com");
  assert.equal(normalizeXtreamUrl("https://example.com/xtream/").url, "https://example.com/xtream");
  assert.match(normalizeXtreamUrl("ftp://example.com").error ?? "", /HTTP\/HTTPS/);
  assert.match(normalizeXtreamUrl("not a url").error ?? "", /HTTP\/HTTPS/);
});

test("classifies Xtream authentication, network, timeout, and malformed responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ user_info: { auth: 1 } }), { status: 200 });
    assert.equal((await testXtreamConnection("https://example.com", "user", "pass")).ok, true);

    globalThis.fetch = async () => new Response("", { status: 401 });
    const authResult = await testXtreamConnection("https://example.com", "user", "wrong");
    assert.equal(authResult.statusCode, 401);
    assert.match(authResult.message, /Username or password/);

    globalThis.fetch = async () => {
      throw new Error("ENOTFOUND provider.example");
    };
    const networkResult = await testXtreamConnection("https://provider.example", "user", "pass");
    assert.equal(networkResult.statusCode, 503);

    globalThis.fetch = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    const timeoutResult = await testXtreamConnection("https://slow.example", "user", "pass");
    assert.equal(timeoutResult.statusCode, 408);

    globalThis.fetch = async () => new Response("not json", { status: 200 });
    const malformedResult = await testXtreamConnection("https://bad.example", "user", "pass");
    assert.match(malformedResult.message, /invalid response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not wait indefinitely for a provider response body", async () => {
  const response = { text: () => new Promise<string>(() => undefined) } as unknown as Response;
  const startedAt = Date.now();

  await assert.rejects(() => readResponseTextWithTimeout(response, 10), /timed out/i);
  assert.ok(Date.now() - startedAt < 1000);
});

test("parses m3u entries that include the stream URL inline", () => {
  const channels = parseM3uPlaylist(`#EXTM3U
#EXTINF:-1 tvg-id="chan1" group-title="News",Channel One,https://example.com/stream.m3u8
#EXTINF:-1 tvg-id="chan2" group-title="Sports",Channel Two
https://example.com/stream2.m3u8`);

  assert.equal(channels[0]?.name, "Channel One");
  assert.equal(channels[0]?.url, "https://example.com/stream.m3u8");
  assert.equal(channels[1]?.name, "Channel Two");
  assert.equal(channels[1]?.url, "https://example.com/stream2.m3u8");
});

test("detects provider kinds from URL shape and payload hints", async () => {
  const detectedM3u = await detectProviderType({ baseUrl: "https://example.com/playlist.m3u" });
  assert.equal(detectedM3u, "m3u");

  const detectedXtream = await detectProviderType({
    baseUrl: "https://example.com/xtream",
    username: "user",
    password: "pass"
  });
  assert.equal(detectedXtream, "xtream");
});

test("retries of the same validated provider payload do not create duplicate provider rows", () => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const input = {
    name: `Retry Provider ${uniqueSuffix}`,
    baseUrl: `https://example.com/xtream/${uniqueSuffix}`,
    type: "xtream" as const,
    authType: "basic" as const,
    username: "user",
    password: "pass"
  };

  const first = createProvider(input);
  const second = createProvider({
    ...input,
    name: `Retry Provider ${uniqueSuffix} - duplicate`
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(second.id, first.id);

  const matches = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count FROM providers WHERE deleted = 0 AND base_url = ? AND type = ? AND credential_username = ? AND credential_password = ?`
    )
    .get(input.baseUrl, input.type, input.username, input.password) as { count: number };

  assert.equal(matches.count, 1);

  const activeCountBeforeDelete = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM providers WHERE deleted = 0")
    .get() as { count: number };

  softDeleteProvider(first.id);
  assert.equal(getProviderById(first.id), undefined);
  assert.ok(listProviders().some((provider) => provider.id === first.id) === false);

  const deletedRow = getDatabase()
    .prepare("SELECT deleted FROM providers WHERE id = ?")
    .get(first.id) as { deleted: number };
  assert.equal(deletedRow.deleted, 1);

  const activeCount = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM providers WHERE deleted = 0")
    .get() as { count: number };
  assert.equal(activeCount.count, activeCountBeforeDelete.count - 1);
});

test("successful Xtream channel sync persists channels before activating the provider", () => {
  const provider = createProvider({
    name: `Xtream Sync ${Date.now()}`,
    baseUrl: `https://sync.example/${Date.now()}`,
    type: "xtream",
    authType: "basic",
    username: "sync-user",
    password: "sync-pass"
  });

  const channels = syncProviderChannels(provider.id, [
    { name: "Sports One", url: "https://example.com/sports-one.m3u8", externalRef: "sports-one", groupName: "Sports" }
  ]);
  setProviderStatus(provider.id, "active");

  assert.equal(channels.length, 1);
  assert.equal(getProviderById(provider.id)?.status, "active");
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active'").get(provider.id)!.count, 1);
});
