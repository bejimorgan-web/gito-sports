import "./iptv-test-environment.js";

import test from "node:test";
import assert from "node:assert/strict";

import { validateHttpStreamUrl } from "./url-validation.js";
import { parseM3uPlaylist } from "./m3u-parser.js";
import { syncParsedM3uCatalogue } from "./m3u-catalogue-sync.js";
import { buildXtreamEndpointCandidates, fetchXtreamCatalogueIncrementally, fetchXtreamChannels, normalizeXtreamUrl, readResponseTextWithTimeout, testXtreamConnection } from "./xtream-codes.js";
import { detectProviderType } from "./provider-type-detector.js";
import { deriveXtreamCredentialHint } from "./provider-type-detector.js";
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
    globalThis.fetch = async () => new Response(JSON.stringify({ user_info: { auth: 1, exp_date: "1893456000" } }), { status: 200 });
    const connected = await testXtreamConnection("https://example.com", "user", "pass");
    assert.equal(connected.ok, true);
    assert.equal(connected.expiresAt, "2030-01-01T00:00:00.000Z");

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

test("listChannelsPage accepts category filters when the category is stored as a provider category id or group name", async () => {
  const provider = createProvider({
    name: "Category Filter Provider",
    baseUrl: "https://example.com/category-filter",
    type: "xtream",
    username: "filter-user",
    password: "filter-pass"
  });

  syncProviderChannels(provider.id, [{
    name: "Sports One",
    externalRef: "sports-one",
    categoryId: "category-42",
    groupName: "Sports",
    url: "https://example.com/live/sports-one.m3u8",
    contentType: "live"
  }]);
  setProviderStatus(provider.id, "active");

  const byGroupName = listChannelsPage({ providerId: provider.id, category: "Sports" }, 1, 50, "active");
  assert.equal(byGroupName.total, 1);

  const byCategoryId = listChannelsPage({ providerId: provider.id, category: "category-42" }, 1, 50, "active");
  assert.equal(byCategoryId.total, 1);
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
      categoryId: "10",
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

test("incremental Xtream discovery bounds batches when a provider ignores pagination", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      const action = url.searchParams.get("action");
      if (action === "get_vod_categories") return new Response(JSON.stringify([{ category_id: "1", category_name: "Movies" }]), { status: 200 });
      if (action === "get_vod_streams") return new Response(JSON.stringify([
        { stream_id: "movie-1", name: "Movie 1", category_id: "1" },
        { stream_id: "movie-2", name: "Movie 2", category_id: "1" },
        { stream_id: "movie-3", name: "Movie 3", category_id: "1" }
      ]), { status: 200 });
      if (action === "get_series_categories") return new Response("[]", { status: 200 });
      if (action === "get_series") return new Response("[]", { status: 200 });
      return new Response("[]", { status: 200 });
    };

    const batches = [];
    for await (const batch of fetchXtreamCatalogueIncrementally("https://provider.example", "test-user", "test-pass", undefined, 2)) {
      batches.push(batch);
    }

    const movieBatches = batches.filter((batch) => batch.phase === "movies");
    assert.deepEqual(movieBatches.map((batch) => batch.records.length), [2, 1]);
    assert.equal(movieBatches.every((batch) => batch.paginated === false), true);
    assert.equal(movieBatches.flatMap((batch) => batch.records).length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses m3u entries that include the stream URL inline", () => {
  const channels = parseM3uPlaylist(`#EXTM3U
#EXTINF:-1 tvg-id="chan1" tvg-name="Guide One" tvg-logo="https://example.com/logo.png" group-title="News",Channel One,https://example.com/stream.m3u8
#EXTINF:-1 tvg-id="chan2" group-title="Sports",Channel Two
https://example.com/stream2.m3u8`);

  assert.equal(channels[0]?.name, "Channel One");
  assert.equal(channels[0]?.url, "https://example.com/stream.m3u8");
  assert.equal(channels[0]?.externalRef, "chan1");
  assert.equal(channels[0]?.tvgName, "Guide One");
  assert.equal(channels[0]?.logoUrl, "https://example.com/logo.png");
  assert.equal(channels[0]?.groupName, "News");
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

test("classifies an Xtream-style mixed M3U into live, movies, series, and episodes", async () => {
  const provider = createProvider({ name: `Mixed M3U ${Date.now()}`, baseUrl: `https://mixed-m3u.example/${Date.now()}`, type: "m3u", authType: "none" });
  const playlist = [
    "#EXTM3U",
    ...[1, 2, 3, 4].map((id) => `#EXTINF:-1 tvg-id=\"live-${id}\" group-title=\"Live TV\",Live ${id}\nhttps://provider.example/live/user/pass/${id}.m3u8`),
    ...[1, 2, 3, 4].map((id) => `#EXTINF:-1 tvg-id=\"movie-${id}\" group-title=\"Movies\",Movie ${id}\nhttps://provider.example/movie/user/pass/${id}.mp4`),
    ...[1, 2, 3, 4].map((id) => `#EXTINF:-1 series-id=\"series-1\" season-number=\"1\" episode-number=\"${id}\" group-title=\"Series One\",Episode ${id}\nhttps://provider.example/series/user/pass/${id}.mp4`)
  ].join("\n");
  const parsed = parseM3uPlaylist(playlist);
  const result = await syncParsedM3uCatalogue(provider.id, parsed);
  const database = getDatabase();

  assert.deepEqual(result, { liveChannels: 4, movies: 4, series: 1, episodes: 4 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND content_type = 'live'").get(provider.id).count, 4);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND content_type != 'live'").get(provider.id).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 4);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_seasons WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series_episodes WHERE series_id IN (SELECT id FROM iptv_series WHERE provider_id = ?) AND status = 'active'").get(provider.id).count, 4);
  assert.deepEqual(database.prepare("SELECT episode_number AS episodeNumber, stream_url AS streamUrl FROM iptv_series_episodes WHERE series_id IN (SELECT id FROM iptv_series WHERE provider_id = ?) AND status = 'active' ORDER BY episode_number").all(provider.id), [
    { episodeNumber: 1, streamUrl: "https://provider.example/series/user/pass/1.mp4" },
    { episodeNumber: 2, streamUrl: "https://provider.example/series/user/pass/2.mp4" },
    { episodeNumber: 3, streamUrl: "https://provider.example/series/user/pass/3.mp4" },
    { episodeNumber: 4, streamUrl: "https://provider.example/series/user/pass/4.mp4" }
  ]);
  assert.equal(parsed.filter((entry) => entry.contentType === "live").length, 4);
  assert.equal(parsed.filter((entry) => entry.contentType === "movie").length, 4);
  assert.equal(parsed.filter((entry) => entry.contentType === "series").length, 4);

  const repeated = await syncParsedM3uCatalogue(provider.id, parsed);
  assert.deepEqual(repeated, { liveChannels: 4, movies: 4, series: 1, episodes: 4 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND content_type = 'live' AND status = 'active'").get(provider.id).count, 4);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 4);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_seasons WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series_episodes WHERE series_id IN (SELECT id FROM iptv_series WHERE provider_id = ?) AND status = 'active'").get(provider.id).count, 4);

  const otherProvider = createProvider({ name: `Other M3U ${Date.now()}`, baseUrl: `https://other-m3u.example/${Date.now()}`, type: "m3u", authType: "none" });
  await syncParsedM3uCatalogue(otherProvider.id, [parsed[0]]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active'").get(otherProvider.id).count, 1);

  const changed = parsed.filter((entry) => entry.externalRef === "live-1" || entry.externalRef === "movie-1" || entry.episodeNumber === 1);
  const changedResult = await syncParsedM3uCatalogue(provider.id, changed);
  assert.deepEqual(changedResult, { liveChannels: 1, movies: 1, series: 1, episodes: 1 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND content_type = 'live' AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_seasons WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series_episodes WHERE series_id IN (SELECT id FROM iptv_series WHERE provider_id = ?) AND status = 'active'").get(provider.id).count, 1);

  await assert.rejects(() => syncParsedM3uCatalogue(provider.id, changed.map((entry) => ({ ...entry, url: "" }))), /m3u_catalogue_sync_(failed|invalid_entry)|constraint/i);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(provider.id).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM iptv_series_episodes WHERE series_id IN (SELECT id FROM iptv_series WHERE provider_id = ?) AND status = 'active'").get(provider.id).count, 1);

  const beforeEmptySync = database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active'").get(provider.id).count;
  assert.deepEqual(await syncParsedM3uCatalogue(provider.id, []), { liveChannels: 0, movies: 0, series: 0, episodes: 0 });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active'").get(provider.id).count, beforeEmptySync);
});

test("classifies mixed M3U entries from group metadata when paths are provider-specific", () => {
  const channels = parseM3uPlaylist(`#EXTM3U
#EXTINF:-1 tvg-id="live-1" group-title="GiTO Demo • Live TV",Live One
https://provider.example/demo_live_01.mp4
#EXTINF:-1 tvg-id="movie-1" group-title="GiTO Demo • Movies",Movie One
https://provider.example/demo_movie_01.mp4
#EXTINF:-1 tvg-id="series-1" season="1" episode-num="1" group-title="GiTO Demo • Series",Series Episode One
https://provider.example/demo_series_s01e01.mp4`);

  assert.deepEqual(channels.map((channel) => channel.contentType), ["live", "movie", "series"]);
  assert.equal(channels[0]?.url, "https://provider.example/demo_live_01.mp4");
  assert.equal(channels[1]?.url, "https://provider.example/demo_movie_01.mp4");
  assert.equal(channels[2]?.url, "https://provider.example/demo_series_s01e01.mp4");
  assert.equal(channels[2]?.seasonNumber, 1);
  assert.equal(channels[2]?.episodeNumber, 1);
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
  const playlistUrl = new URL("https://example.com/get.php");
  playlistUrl.searchParams.set("username", "demo-user");
  playlistUrl.searchParams.set("password", "demo-pass");
  const hint = deriveXtreamCredentialHint(playlistUrl.toString());
  assert.deepEqual(hint, { serverUrl: "https://example.com", username: "demo-user", password: "demo-pass" });
  assert.equal(deriveXtreamCredentialHint("https://example.com/playlist.m3u8"), undefined);
});

test("existing Xtream A plus a new M3U B with different credentials create distinct provider rows", () => {
  const xtreamInput = {
    name: `Xtream Provider ${Date.now()}`,
    baseUrl: `https://example.com/xtream/${Date.now()}`,
    type: "xtream" as const,
    authType: "basic" as const,
    username: "xtream-user",
    password: "xtream-pass"
  };
  const m3uInput = {
    name: `M3U Provider ${Date.now()}`,
    baseUrl: `https://example.com/m3u/${Date.now()}.m3u8`,
    type: "m3u" as const,
    authType: "none" as const
  };

  const xtreamProvider = createProvider(xtreamInput);
  const m3uProvider = createProvider(m3uInput);

  assert.ok(xtreamProvider);
  assert.ok(m3uProvider);
  assert.notEqual(xtreamProvider.id, m3uProvider.id);

  const providerRows = getDatabase()
    .prepare(
      `SELECT id, name, base_url, type, credential_username, credential_password FROM providers WHERE deleted = 0 ORDER BY created_at`
    )
    .all() as Array<{ id: string; type: string; base_url: string; credential_username: string | null; credential_password: string | null }>;

  assert.ok(providerRows.some((provider) => provider.id === xtreamProvider.id && provider.type === "xtream"));
  assert.ok(providerRows.some((provider) => provider.id === m3uProvider.id && provider.type === "m3u"));
  assert.equal(providerRows.filter((provider) => provider.base_url === xtreamInput.baseUrl).length, 1);
  assert.equal(providerRows.filter((provider) => provider.base_url === m3uInput.baseUrl).length, 1);
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
