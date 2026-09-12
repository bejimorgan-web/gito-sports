import "./iptv-test-environment.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../app.js";
import { getDatabase } from "../db/connection.js";
import { createAccessToken } from "./jwt.js";
import { createProvider, getProviderById, syncProviderChannels } from "../repositories/provider-repository.js";
import {
  syncXtreamCategories,
  syncXtreamMoviesDetailed,
  syncXtreamSeriesDetailed,
  syncXtreamSeasonsDetailed,
  syncXtreamEpisodesDetailed,
  upsertIptvCategory,
  upsertIptvEpgChannel,
  upsertIptvEpgProgramme
} from "../repositories/iptv-catalogue-repository.js";

const token = createAccessToken({ sub: "catalogue-api-test", role: "admin" });

async function startTestServer() {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(baseUrl: string, path: string, authenticated = true) {
  return fetch(`${baseUrl}${path}`, {
    headers: authenticated ? { authorization: `Bearer ${token}` } : undefined
  });
}

async function postJson(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

test("catalogue API returns normalized provider-scoped hierarchy and canonical pagination", async () => {
  const provider = createProvider({ name: `API Provider ${Date.now()}`, baseUrl: `https://api.example/${Date.now()}`, type: "xtream", authType: "basic", username: "user", password: "pass" });
  const otherProvider = createProvider({ name: `Other API Provider ${Date.now()}`, baseUrl: `https://other.example/${Date.now()}`, type: "xtream", authType: "basic", username: "other", password: "pass" });

  await syncXtreamCategories(provider.id, "live", [{ providerCategoryId: "sports", name: "Sports", metadata: { source: "fixture" } }]);
  await syncXtreamCategories(provider.id, "movie", [{ providerCategoryId: "movies", name: "Movies", metadata: {} }]);
  await syncXtreamCategories(provider.id, "series", [{ providerCategoryId: "shows", name: "Shows", metadata: {} }]);
  syncProviderChannels(provider.id, [{ name: "Sports One", url: "https://example.com/live/1.m3u8", externalRef: "1", groupName: "Sports", categoryId: "sports", logoUrl: "https://example.com/logo.png", metadata: { providerField: true } }]);
  syncProviderChannels(otherProvider.id, [{ name: "Other Channel", url: "https://example.com/live/2.m3u8", externalRef: "2" }]);

  await syncXtreamMoviesDetailed(provider.id, [{ externalId: "movie-1", categoryId: "movies", name: "A Movie", streamUrl: "https://example.com/movie.mp4", posterUrl: "https://example.com/poster.jpg", metadata: { plot: "Plot", year: 2026, genre: "Drama" } }]);
  await syncXtreamSeriesDetailed(provider.id, [{ externalId: "series-1", categoryId: "shows", name: "A Series", metadata: { plot: "Series plot" } }]);
  const seriesId = getSeriesId(provider.id, "series-1");
  await syncXtreamSeasonsDetailed(provider.id, [{ seriesExternalId: "series-1", providerSeasonId: "season-1", seasonNumber: 1, name: "Season 1", metadata: {} }]);
  const seasonId = getSeasonId(provider.id, seriesId);
  await syncXtreamEpisodesDetailed(provider.id, "series-1", [{ externalId: "episode-1", seasonNumber: 1, episodeNumber: 1, name: "Episode 1", streamUrl: "https://example.com/episode.mp4", metadata: { plot: "Episode plot" } }]);
  const epgChannel = upsertIptvEpgChannel(provider.id, { externalEpgChannelId: "epg-1", channelExternalRef: "1", name: "Sports One", metadata: {} });
  upsertIptvEpgProgramme(provider.id, { epgChannelId: epgChannel.id, externalProgrammeId: "programme-1", title: "Live Match", startAt: "2099-09-10T10:00:00.000Z", endAt: "2099-09-10T11:00:00.000Z", metadata: {} });

  const { server, baseUrl } = await startTestServer();
  try {
    const categories = await request(baseUrl, `/iptv/providers/${provider.id}/categories?contentType=movie`);
    assert.equal(categories.status, 200);
    assert.equal((await categories.json() as any).data.items[0].name, "Movies");

    const channels = await request(baseUrl, `/iptv/providers/${provider.id}/channels?page=1&pageSize=1&search=Sports`);
    const channelBody = await channels.json() as any;
    assert.equal(channels.status, 200);
    assert.ok(channelBody.data.total >= 1);
    assert.ok(channelBody.data.items.some((item: any) => item.name === "Sports One"));
    assert.equal(channelBody.data.items[0].playbackReference, "https://example.com/live/1.m3u8");
    assert.equal(channelBody.data.items[0].logoUrl, "https://example.com/logo.png");

    const movie = await request(baseUrl, `/iptv/providers/${provider.id}/movies`);
    const movieBody = await movie.json() as any;
    assert.equal(movieBody.data.items[0].title, "A Movie");
    assert.equal(movieBody.data.items[0].playbackReference, "https://example.com/movie.mp4");
    const movieDetail = await request(baseUrl, `/iptv/providers/${provider.id}/movies/${getMovieId(provider.id)}`);
    assert.equal((await movieDetail.json() as any).data.description, "Plot");

    const series = await request(baseUrl, `/iptv/providers/${provider.id}/series`);
    assert.equal((await series.json() as any).data.items[0].title, "A Series");
    const seasons = await request(baseUrl, `/iptv/providers/${provider.id}/series/${seriesId}/seasons`);
    assert.equal((await seasons.json() as any).data[0].seasonNumber, 1);
    const episodes = await request(baseUrl, `/iptv/providers/${provider.id}/seasons/${seasonId}/episodes?pageSize=1`);
    const episodeBody = await episodes.json() as any;
    assert.equal(episodeBody.data.items[0].title, "Episode 1");
    assert.equal(episodeBody.data.items[0].playbackReference, "https://example.com/episode.mp4");

    const epg = await request(baseUrl, `/iptv/providers/${provider.id}/epg/programmes?epgChannelId=${epgChannel.id}`);
    assert.equal((await epg.json() as any).data.items[0].externalProgrammeId, "programme-1");
    const upcoming = await request(baseUrl, `/iptv/providers/${provider.id}/epg/programmes?epgChannelId=${epgChannel.id}&upcoming=true`);
    assert.equal((await upcoming.json() as any).data.items[0].externalProgrammeId, "programme-1");

    const isolated = await request(baseUrl, `/iptv/providers/${provider.id}/channels?search=Other`);
    assert.equal((await isolated.json() as any).data.total, 0);
    const invalidPage = await request(baseUrl, `/iptv/providers/${provider.id}/movies?pageSize=101`);
    assert.equal(invalidPage.status, 400);
    const invalidTime = await request(baseUrl, `/iptv/providers/${provider.id}/epg/programmes?from=not-a-time`);
    assert.equal(invalidTime.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Xtream live category identity yields one browser group for four channels", async () => {
  const provider = createProvider({ name: `Xtream Group Identity ${Date.now()}`, baseUrl: `https://xtream-group.example/${Date.now()}`, type: "xtream", authType: "basic", username: "user", password: "pass" });
  await syncXtreamCategories(provider.id, "live", [{ providerCategoryId: "42", name: "Sports", metadata: { source: "xtream" } }]);
  syncProviderChannels(provider.id, [1, 2, 3, 4].map((number) => ({
    name: `Live ${number}`,
    url: `https://example.com/live/${number}.m3u8`,
    externalRef: String(number),
    categoryId: "42",
    groupName: "Sports"
  })));
  upsertIptvCategory(provider.id, { providerCategoryId: "Sports", contentType: "live", name: "Sports" });
  await syncXtreamCategories(provider.id, "live", [{ providerCategoryId: "42", name: "Sports", metadata: { source: "xtream" } }]);

  const { server, baseUrl } = await startTestServer();
  try {
    const categoriesResponse = await request(baseUrl, `/iptv/providers/${provider.id}/categories?contentType=live&pageSize=20`);
    const categoriesBody = await categoriesResponse.json() as any;
    assert.equal(categoriesResponse.status, 200);
    assert.equal(categoriesBody.data.total, 1);
    assert.equal(categoriesBody.data.items.length, 1);
    assert.equal(categoriesBody.data.items[0].providerCategoryId, "42");

    const channelsResponse = await request(baseUrl, `/iptv/providers/${provider.id}/channels?categoryId=${encodeURIComponent(categoriesBody.data.items[0].id)}&pageSize=20`);
    const channelsBody = await channelsResponse.json() as any;
    assert.equal(channelsResponse.status, 200);
    assert.equal(channelsBody.data.total, 4, JSON.stringify(channelsBody.data));
    assert.equal(channelsBody.data.items.length, 4, JSON.stringify(channelsBody.data));
    assert.equal(new Set(channelsBody.data.items.map((item: any) => item.id)).size, 4);
    assert.equal(new Set(channelsBody.data.items.map((item: any) => item.category.id)).size, 1);

    const storedCategories = getDatabase().prepare("SELECT COUNT(*) AS count FROM iptv_categories WHERE provider_id = ? AND content_type = 'live' AND status = 'active'").get(provider.id) as { count: number };
    assert.equal(storedCategories.count, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("catalogue API allows public provider-scoped requests and returns missing-record errors", async () => {
  const provider = createProvider({ name: `Auth API Provider ${Date.now()}`, baseUrl: `https://auth-api.example/${Date.now()}`, type: "xtream", authType: "basic", username: "user", password: "pass" });
  const { server, baseUrl } = await startTestServer();
  try {
    assert.equal((await request(baseUrl, `/iptv/providers/${provider.id}/movies`, false)).status, 200);
    assert.equal((await request(baseUrl, `/iptv/providers/${provider.id}/movies/missing`)).status, 404);
    assert.equal((await request(baseUrl, "/iptv/providers/missing/movies")).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("catalogue API returns saved M3U channel groups for the content browser", async () => {
  const provider = createProvider({ name: `M3U Provider ${Date.now()}`, baseUrl: `https://m3u.example/${Date.now()}.m3u8`, type: "m3u", authType: "none" });
  const otherProvider = createProvider({ name: `Other M3U Provider ${Date.now()}`, baseUrl: `https://other-m3u.example/${Date.now()}.m3u8`, type: "m3u", authType: "none" });
  syncProviderChannels(provider.id, [
    { name: "Sports One", url: "https://example.com/live/1.m3u8", externalRef: "1", tvgName: "Sports Guide One", groupName: "Sports", logoUrl: "https://example.com/sports.png" },
    { name: "Sports Two", url: "https://example.com/live/2.m3u8", externalRef: "2", tvgName: "Sports Guide Two", groupName: "Sports" },
    { name: "News One", url: "https://example.com/live/3.m3u8", externalRef: "3", groupName: "News" }
  ]);
  syncProviderChannels(otherProvider.id, [{ name: "Other Sports", url: "https://example.com/live/2.m3u8", externalRef: "2", groupName: "Other" }]);

  const { server, baseUrl } = await startTestServer();
  try {
    const response = await request(baseUrl, `/iptv/providers/${provider.id}/channels?page=1&pageSize=20`);
    assert.equal(response.status, 200);

    const body = await response.json() as any;
    assert.equal(body.data.items.length, 3);
    const sportsItems = body.data.items.filter((item: any) => item.category.name === "Sports");
    assert.equal(sportsItems.length, 2);
    assert.equal(sportsItems[0].providerId, provider.id);
    assert.equal(sportsItems[0].groupName, "Sports");
    assert.equal(sportsItems[0].categoryId, sportsItems[0].category.id);
    assert.equal(sportsItems.find((item: any) => item.tvgName === "Sports Guide One").logoUrl, "https://example.com/sports.png");
    assert.equal(new Set(sportsItems.map((item: any) => item.id)).size, 2);
    assert.equal(body.data.items.filter((item: any) => item.category.name === "News").length, 1);

    const isolated = await request(baseUrl, `/iptv/providers/${provider.id}/channels?search=Other`);
    assert.equal((await isolated.json() as any).data.total, 0);

    const categories = await request(baseUrl, `/iptv/providers/${provider.id}/categories?contentType=live&pageSize=20`);
    assert.equal(categories.status, 200);
    const categoryBody = await categories.json() as any;
    assert.ok(categoryBody.data.items.some((item: any) => item.name === "Sports"));
    assert.equal(categoryBody.data.items.some((item: any) => item.name === "Other"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("category selection resolves legacy provider category IDs", async () => {
  const provider = createProvider({ name: `Legacy Category Selection ${Date.now()}`, baseUrl: `https://legacy-category.example/${Date.now()}`, type: "xtream", authType: "basic", username: "user", password: "pass" });
  const category = upsertIptvCategory(provider.id, { providerCategoryId: "1", contentType: "live", name: "Sports" });
  const database = getDatabase();
  for (const number of [1, 2, 3, 4]) {
    database.prepare("INSERT INTO channels (id, provider_id, name, external_ref, category_id, group_name, url, content_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 'active', ?, ?)").run(`legacy-${number}`, provider.id, `Legacy ${number}`, String(number), "1", "Sports", `https://example.com/live/${number}.m3u8`, new Date().toISOString(), new Date().toISOString());
  }

  const { server, baseUrl } = await startTestServer();
  try {
    const response = await request(baseUrl, `/iptv/providers/${provider.id}/channels?categoryId=${encodeURIComponent(category.id)}&page=1&pageSize=20`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.data.total, 4);
    assert.equal(new Set(body.data.items.map((item: any) => item.id)).size, 4);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("M3U import activates only after canonical channels are saved", async () => {
  const provider = createProvider({ name: `M3U Import Provider ${Date.now()}`, baseUrl: `https://m3u-import.example/${Date.now()}.m3u8`, type: "m3u", authType: "none" });
  const { server, baseUrl } = await startTestServer();
  try {
    const successfulImport = await postJson(baseUrl, `/iptv/providers/${provider.id}/m3u`, {
      playlist: `#EXTM3U\n#EXTINF:-1 tvg-id="import-1" group-title="Sports",Imported Sports\nhttps://example.com/live/import-1.m3u8\n#EXTINF:-1 tvg-id="import-2" group-title="News",Imported News\nhttps://example.com/live/import-2.m3u8`
    });
    assert.equal(successfulImport.status, 201);
    const successfulBody = await successfulImport.json() as any;
    assert.equal(successfulBody.data.channelsCreated, 2);
    assert.deepEqual(new Set(successfulBody.data.categories), new Set(["Sports", "News"]));
    assert.equal(getProviderById(provider.id)?.status, "active");

    const failedProvider = createProvider({ name: `M3U Failed Provider ${Date.now()}`, baseUrl: `https://m3u-failed.example/${Date.now()}.m3u8`, type: "m3u", authType: "none" });
    const failedImport = await postJson(baseUrl, `/iptv/providers/${failedProvider.id}/m3u`, {
      playlist: "#EXTM3U\n#EXTINF:-1,Invalid Entry\nnot-a-stream-url"
    });
    assert.equal(failedImport.status, 201);
    assert.equal((await failedImport.json() as any).data.channelsCreated, 0);
    assert.equal(getProviderById(failedProvider.id)?.status, "failed");
    assert.equal(getDatabase().prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ?").get(failedProvider.id).count, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function getSeriesId(providerId: string, externalId: string) {
  return (getDatabase().prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND external_id = ?").get(providerId, externalId) as { id: string }).id;
}

function getSeasonId(providerId: string, seriesId: string) {
  return (getDatabase().prepare("SELECT id FROM iptv_seasons WHERE provider_id = ? AND series_id = ?").get(providerId, seriesId) as { id: string }).id;
}

function getMovieId(providerId: string) {
  return (getDatabase().prepare("SELECT id FROM iptv_movies WHERE provider_id = ?").get(providerId) as { id: string }).id;
}
