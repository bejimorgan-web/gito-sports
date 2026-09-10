import test from "node:test";
import assert from "node:assert/strict";

import { validateHttpStreamUrl } from "./url-validation.js";
import { parseM3uPlaylist } from "./m3u-parser.js";
import { buildXtreamEndpointCandidates, fetchXtreamChannels, normalizeXtreamUrl, readResponseTextWithTimeout, testXtreamConnection } from "./xtream-codes.js";
import { detectProviderType } from "./provider-type-detector.js";
import { createProvider, getProviderById, getProviderChannelDiagnostics, listChannelsPage, listProviders, softDeleteProvider, syncProviderChannels, setProviderStatus, updateProviderHealth } from "../repositories/provider-repository.js";
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

test("Xtream catalogue HTTP responses become normalized persisted channels", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.searchParams.get("username"), "demo-user");
      assert.equal(url.searchParams.get("password"), "demo-pass");

      if (url.searchParams.get("action") === "get_live_categories") {
        return new Response(JSON.stringify([{ category_id: "10", category_name: "Sports" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.searchParams.get("action") === "get_live_streams") {
        return new Response(JSON.stringify([{ stream_id: 42, name: "Sports One", category_id: "10" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ user_info: { auth: 1 } }), { status: 200 });
    };

    const channels = await fetchXtreamChannels("https://xtream.example:8080", "demo-user", "demo-pass");
    assert.equal(channels.length, 1);
    assert.deepEqual(channels[0], {
      name: "Sports One",
      externalRef: "42",
      groupName: "Sports",
      url: "https://xtream.example:8080/live/demo-user/demo-pass/42.m3u8"
    });
    assert.ok(requests.some((url) => url.searchParams.get("action") === "get_live_categories"));
    assert.ok(requests.some((url) => url.searchParams.get("action") === "get_live_streams"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Xtream empty or malformed catalogue responses are explicit failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "get_live_categories") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const emptyChannels = await fetchXtreamChannels("https://xtream.example", "user", "pass");
    assert.deepEqual(emptyChannels, []);

    globalThis.fetch = async () => new Response("not-json", { status: 200 });
    await assert.rejects(() => fetchXtreamChannels("https://xtream.example", "user", "pass"), /invalid|Unexpected token/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Xtream sync removes player_api.php from the normalized playback base", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "get_live_categories") return new Response("[]", { status: 200 });
      return new Response(JSON.stringify([{ stream_id: 7, name: "Channel" }]), { status: 200 });
    };

    const channels = await fetchXtreamChannels("https://xtream.example:8080/player_api.php", "user", "pass");
    assert.equal(channels[0]?.url, "https://xtream.example:8080/live/user/pass/7.m3u8");
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

test("parses tolerant M3U attributes and does not steal the next entry URL", () => {
  const channels = parseM3uPlaylist(`\uFEFF#EXTM3U
#extinf:-1 tvg-id = 'chan1' group-title=News,News One
#EXTVLCOPT:http-referrer=https://example.com
#EXTINF:-1 group-title="Sports",Sports One
https://example.com/sports.ts`);

  assert.equal(channels.length, 1);
  assert.equal(channels[0]?.name, "Sports One");
  assert.equal(channels[0]?.groupName, "Sports");
  assert.equal(channels[0]?.url, "https://example.com/sports.ts");
});

test("rejects disabled Xtream accounts even when the API returns HTTP 200", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ user_info: { auth: 0, status: "Disabled" } }), { status: 200 });
    const result = await testXtreamConnection("https://example.com", "user", "pass");
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes wrapped Xtream streams, string IDs, names, extensions, and encoded credentials", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "get_live_categories") {
        return new Response(JSON.stringify({ categories: [{ category_id: 10, category_name: "Sports" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ streams: [{ stream_id: "7", stream_name: "Sports One", category_id: 10, container_extension: "ts" }] }), { status: 200 });
    };

    const channels = await fetchXtreamChannels("https://example.com/base", "user name", "pass/word");
    assert.equal(channels[0]?.name, "Sports One");
    assert.equal(channels[0]?.groupName, "Sports");
    assert.equal(channels[0]?.url, "https://example.com/base/live/user%20name/pass%2Fword/7.ts");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("detects Xtream credentials from get.php M3U playlist URLs", async () => {
  const detectedXtream = await detectProviderType({
    baseUrl: "https://example.com/get.php?username=user&password=pass&type=m3u_plus&output=ts",
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

test("provider diagnostics report canonical totals instead of the current page size", () => {
  const provider = createProvider({
    name: `Stats Provider ${Date.now()}`,
    baseUrl: `https://stats.example/${Date.now()}`,
    type: "xtream",
    authType: "basic",
    username: "stats-user",
    password: "stats-pass"
  });

  syncProviderChannels(provider.id, [
    { name: "Live One", url: "https://example.com/live-one.m3u8", externalRef: "live-1", contentType: "live" },
    { name: "Movie One", url: "https://example.com/movie-one.m3u8", externalRef: "movie-1", contentType: "movie" },
    { name: "Series One", url: "https://example.com/series-one.m3u8", externalRef: "series-1", contentType: "series" }
  ]);
  updateProviderHealth({ providerId: provider.id, success: true, impact: "success" });

  const page = listChannelsPage({ providerId: provider.id }, 1, 2);
  const diagnostics = getProviderChannelDiagnostics(provider.id)!;

  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
  assert.deepEqual(diagnostics.contentTotals, { live: 1, movies: 1, series: 1 });
  assert.equal(diagnostics.totalChannels, 3);
  assert.equal(diagnostics.availabilityStatus, "online");

  syncProviderChannels(provider.id, [
    { name: "Live One Updated", url: "https://example.com/live-one-updated.m3u8", externalRef: "live-1", contentType: "live" },
    { name: "Movie One Updated", url: "https://example.com/movie-one-updated.m3u8", externalRef: "movie-1", contentType: "movie" },
    { name: "Series One Updated", url: "https://example.com/series-one-updated.m3u8", externalRef: "series-1", contentType: "series" }
  ]);
  assert.equal(getProviderChannelDiagnostics(provider.id)!.totalChannels, 3);
});

test("28,277 synchronized live channels are reported as the provider total", () => {
  const provider = createProvider({
    name: `Large Stats Provider ${Date.now()}`,
    baseUrl: `https://large-stats.example/${Date.now()}`,
    type: "xtream",
    authType: "basic",
    username: "large-user",
    password: "large-pass"
  });
  const channels = Array.from({ length: 28_277 }, (_, index) => ({
    name: `Live Channel ${index + 1}`,
    url: `https://example.com/live/${index + 1}.m3u8`,
    externalRef: String(index + 1),
    contentType: "live" as const
  }));

  syncProviderChannels(provider.id, channels);
  assert.equal(getProviderChannelDiagnostics(provider.id)!.contentTotals.live, 28_277);
  assert.equal(getProviderChannelDiagnostics(provider.id)!.totalChannels, 28_277);
});
