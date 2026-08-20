import test from "node:test";
import assert from "node:assert/strict";

import { validateHttpStreamUrl } from "./url-validation.js";
import { parseM3uPlaylist } from "./m3u-parser.js";
import { buildXtreamEndpointCandidates, normalizeXtreamUrl, testXtreamConnection } from "./xtream-codes.js";
import { detectProviderType } from "./provider-type-detector.js";

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
