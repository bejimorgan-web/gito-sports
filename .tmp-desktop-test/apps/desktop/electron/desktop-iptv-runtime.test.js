import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "./credential-store.js";
import { DesktopIptvRuntime } from "./desktop-iptv-runtime.js";
import { DesktopSqliteStore } from "./desktop-storage.js";
function temporaryDatabasePath() {
    return path.join(os.tmpdir(), `gito-desktop-runtime-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}
function cleanup(databasePath) {
    fs.rmSync(databasePath, { force: true });
    for (const suffix of ["-wal", "-shm"])
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
function provider(store, name, credentialStoreRef) {
    return store.createProviderAccount({
        name,
        type: "xtream",
        baseUrl: "https://xtream.example",
        credentialStoreRef
    });
}
function response(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function installXtreamMock(options = {}) {
    const originalFetch = globalThis.fetch;
    let releaseBlocked;
    const requests = [];
    globalThis.fetch = (async (input, init) => {
        const url = new URL(String(input));
        requests.push(url.toString());
        const action = url.searchParams.get("action") ?? "";
        if (options.blockAction === action) {
            await new Promise((resolve, reject) => {
                releaseBlocked = resolve;
                init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            });
        }
        if (options.failAction === action)
            throw new Error("synthetic provider failure");
        switch (action) {
            case "get_live_categories": return response([{ category_id: "1", category_name: "Live" }]);
            case "get_vod_categories": return response([{ category_id: "1", category_name: "Movies" }]);
            case "get_vod_streams": return response([{ stream_id: "123", name: "Synthetic Movie", category_id: "1", stream_icon: "https://images.example/movie.png", stream_url: "https://provider.example/movie/secret-value" }]);
            case "get_series": return response([{ series_id: "100", name: "Synthetic Series", category_id: "1", cover: "https://images.example/series.png" }]);
            case "get_series_info": return response({
                seasons: [{ id: "season-1", season_num: 1, name: "Season 1" }],
                episodes: { "1": [{ id: "episode-1", episode_num: 1, title: "Episode 1", movie_url: "https://provider.example/episode/secret-value", info: { plot: "Synthetic plot", movie_image: "https://images.example/episode.png" } }] }
            });
            case "get_epg_channels": return response([{ epg_channel_id: "epg-1", channel_id: "live-1", stream_id: "live-1", name: "Synthetic Channel", logo: "https://images.example/channel.png" }]);
            case "get_short_epg": return response({ epg_list: [{ id: "programme-1", title: "Synthetic Programme", description: "Synthetic description", start: "1700000000", end: "1700003600", stream_url: "https://provider.example/epg/secret-value" }] });
            default: return response({});
        }
    });
    return {
        requests,
        release() {
            releaseBlocked?.();
            globalThis.fetch = originalFetch;
        }
    };
}
function installM3uMock(getPlaylist, options = {}) {
    const originalFetch = globalThis.fetch;
    let releaseBlocked;
    globalThis.fetch = (async (_input, init) => {
        if (options.block) {
            await new Promise((resolve, reject) => {
                releaseBlocked = resolve;
                init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            });
        }
        if (options.fail)
            throw new Error("synthetic M3U request failure");
        return new Response(getPlaylist(), { status: 200, headers: { "content-type": "audio/x-mpegurl" } });
    });
    return {
        release() {
            releaseBlocked?.();
            globalThis.fetch = originalFetch;
        }
    };
}
async function waitForOperation(runtime, operationId) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const operation = await runtime.getOperation(operationId);
        if (operation && ["completed", "failed", "cancelled", "timeout"].includes(operation.status))
            return operation;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("operation did not finish");
}
test("Xtream catalogue sync isolates providers, is idempotent, and discards playback URLs", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const mock = installXtreamMock();
    try {
        const providerA = provider(store, "Provider A", "credential-a");
        const providerB = provider(store, "Provider B", "credential-b");
        credentials.set("credential-a", "synthetic-user-a", "synthetic-password-a");
        credentials.set("credential-b", "synthetic-user-b", "synthetic-password-b");
        const runtime = new DesktopIptvRuntime(store, credentials);
        const first = await runtime.startXtreamCatalogueSync(providerA.id);
        assert.equal((await waitForOperation(runtime, first.id)).status, "completed");
        const second = await runtime.startXtreamCatalogueSync(providerA.id);
        assert.equal((await waitForOperation(runtime, second.id)).status, "completed");
        const other = await runtime.startXtreamCatalogueSync(providerB.id);
        assert.equal((await waitForOperation(runtime, other.id)).status, "completed");
        assert.equal(store.listMovies(providerA.id).length, 1);
        assert.equal(store.listMovies(providerB.id).length, 1);
        assert.notEqual(store.listMovies(providerA.id)[0]?.id, store.listMovies(providerB.id)[0]?.id);
        assert.equal(store.listCategories(providerA.id, "live").length, 1);
        assert.equal(store.listCategories(providerA.id, "movie").length, 1);
        assert.equal(store.listSeries(providerA.id).length, 1);
        assert.equal(store.listSeasons(providerA.id).length, 1);
        assert.equal(store.listEpisodes(providerA.id).length, 1);
        assert.equal(store.listMovies(providerA.id)[0]?.externalReference, "123");
        assert.equal(store.listEpisodes(providerA.id)[0]?.externalReference, "episode-1");
        assert.equal(JSON.stringify(store.listMovies(providerA.id)).includes("secret-value"), false);
        assert.equal(JSON.stringify(store.listEpisodes(providerA.id)).includes("secret-value"), false);
        assert.equal(JSON.stringify(store.listOperations(providerA.id)).includes("synthetic-password"), false);
        assert.equal(mock.requests.some((request) => request.includes("synthetic-password")), true);
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("failed Xtream catalogue sync does not archive existing records", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const mock = installXtreamMock({ failAction: "get_vod_streams" });
    try {
        const savedProvider = provider(store, "Provider", "credential");
        credentials.set("credential", "user", "password");
        const existing = store.upsertMovie({ providerAccountId: savedProvider.id, externalReference: "old", name: "Old movie" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        const operation = await runtime.startXtreamCatalogueSync(savedProvider.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "failed");
        assert.equal(store.getMovie(existing.id)?.status, "active");
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("cancelled Xtream catalogue sync does not archive existing records", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const mock = installXtreamMock({ blockAction: "get_vod_categories" });
    try {
        const savedProvider = provider(store, "Provider", "credential");
        credentials.set("credential", "user", "password");
        const existing = store.upsertMovie({ providerAccountId: savedProvider.id, externalReference: "old", name: "Old movie" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        const operation = await runtime.startXtreamCatalogueSync(savedProvider.id);
        for (let attempt = 0; attempt < 100 && !mock.requests.some((request) => request.includes("get_vod_categories")); attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await runtime.cancelOperation(operation.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "cancelled");
        assert.equal(store.getMovie(existing.id)?.status, "active");
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("Xtream EPG sync links local channels, isolates providers, is idempotent, and archives only on complete success", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const mock = installXtreamMock();
    try {
        const providerA = provider(store, "Provider A", "epg-credential-a");
        const providerB = provider(store, "Provider B", "epg-credential-b");
        credentials.set("epg-credential-a", "epg-user-a", "epg-password-a");
        credentials.set("epg-credential-b", "epg-user-b", "epg-password-b");
        const liveChannel = store.upsertChannel({ providerAccountId: providerA.id, externalReference: "live-1", name: "Synthetic Channel", playbackUrl: "https://live.example/channel" });
        const staleChannel = store.upsertEpgChannel({ providerAccountId: providerA.id, externalReference: "stale", name: "Stale EPG" });
        const staleProgrammeChannel = store.upsertEpgChannel({ providerAccountId: providerA.id, externalReference: "stale-programme", name: "Stale Programme Channel" });
        const staleProgramme = store.upsertEpgProgramme({ providerAccountId: providerA.id, epgChannelId: staleProgrammeChannel.id, externalReference: "stale-programme", title: "Stale", startAt: "2023-01-01T00:00:00.000Z", endAt: "2023-01-01T01:00:00.000Z" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        const first = await runtime.startEpgSync(providerA.id);
        assert.equal((await waitForOperation(runtime, first.id)).status, "completed");
        const second = await runtime.startEpgSync(providerA.id);
        assert.equal((await waitForOperation(runtime, second.id)).status, "completed");
        const third = await runtime.startEpgSync(providerB.id);
        assert.equal((await waitForOperation(runtime, third.id)).status, "completed");
        const providerAChannels = store.listEpgChannels(providerA.id);
        const providerAProgrammes = store.listEpgProgrammes(providerA.id);
        const providerBChannels = store.listEpgChannels(providerB.id);
        assert.equal(providerAChannels.filter((channel) => channel.externalReference === "epg-1").length, 1);
        assert.equal(providerAChannels.find((channel) => channel.externalReference === "epg-1")?.channelId, liveChannel.id);
        assert.equal(providerAProgrammes.filter((programme) => programme.externalReference === "programme-1").length, 1);
        assert.equal(providerBChannels.filter((channel) => channel.externalReference === "epg-1").length, 1);
        assert.notEqual(providerAChannels.find((channel) => channel.externalReference === "epg-1")?.id, providerBChannels.find((channel) => channel.externalReference === "epg-1")?.id);
        assert.equal(store.getEpgChannel(staleChannel.id)?.status, "archived");
        assert.equal(store.getEpgProgramme(staleProgramme.id)?.status, "archived");
        assert.equal(JSON.stringify(providerAChannels).includes("epg-password-a"), false);
        assert.equal(JSON.stringify(providerAProgrammes).includes("secret-value"), false);
        assert.equal(JSON.stringify(store.listOperations(providerA.id)).includes("epg-password-a"), false);
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("malformed Xtream EPG programmes are skipped without stale cleanup", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
        const action = new URL(String(input)).searchParams.get("action");
        if (action === "get_epg_channels")
            return response([{ epg_channel_id: "epg-1", name: "Channel" }]);
        if (action === "get_short_epg")
            return response({ epg_list: [{ id: "bad", title: "Bad", start: "not-a-time", end: "also-not-a-time" }] });
        return response({});
    });
    try {
        const savedProvider = provider(store, "Provider", "epg-credential");
        credentials.set("epg-credential", "user", "password");
        const stale = store.upsertEpgChannel({ providerAccountId: savedProvider.id, externalReference: "old", name: "Old" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        const operation = await runtime.startEpgSync(savedProvider.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "completed");
        assert.equal(store.getEpgChannel(stale.id)?.status, "active");
        assert.equal(store.listEpgProgrammes(savedProvider.id).length, 0);
    }
    finally {
        globalThis.fetch = originalFetch;
        store.close();
        cleanup(databasePath);
    }
});
test("M3U catalogue sync classifies safe metadata, is idempotent, and isolates providers", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    let streamSuffix = "one";
    const playlist = () => `#EXTM3U\n#EXTINF:-1 tvg-id="live-1" tvg-name="News" tvg-logo="https://images.example/news.png" group-title="Live",News\nhttps://provider.example/live/${streamSuffix}\n#EXTINF:-1 tvg-id="movie-1" tvg-name="Film One" tvg-logo="https://images.example/movie.png" group-title="Movies" tvg-type="movie",Film One\nhttps://provider.example/movie/${streamSuffix}?username=secret&password=secret\n#EXTINF:-1 tvg-id="series-1" tvg-name="Show One" group-title="Series" tvg-type="series" series-id="series-1" season-num="2" episode-num="3",Show One S02E03\nhttps://provider.example/series/${streamSuffix}?token=secret\n#EXTINF:-1 group-title="General",Ambiguous\nhttps://provider.example/live/ambiguous`;
    const mock = installM3uMock(playlist);
    try {
        const providerA = store.createProviderAccount({ name: "M3U A", type: "m3u", baseUrl: "https://user:password@playlist.example/list.m3u", credentialStoreRef: "m3u-a" });
        const providerB = store.createProviderAccount({ name: "M3U B", type: "m3u", baseUrl: "https://playlist.example/list-b.m3u", credentialStoreRef: "m3u-b" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        let operation = await runtime.startM3uCatalogueSync(providerA.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "completed");
        streamSuffix = "two";
        operation = await runtime.startM3uCatalogueSync(providerA.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "completed");
        operation = await runtime.startM3uCatalogueSync(providerB.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "completed");
        assert.equal(store.listCategories(providerA.id).length, 4);
        assert.equal(store.listMovies(providerA.id).length, 1);
        assert.equal(store.listSeries(providerA.id).length, 1);
        assert.equal(store.listSeasons(providerA.id).length, 1);
        assert.equal(store.listEpisodes(providerA.id).length, 1);
        assert.equal(store.listMovies(providerA.id)[0]?.externalReference, "movie-1");
        assert.equal(store.listEpisodes(providerA.id)[0]?.episodeNumber, 3);
        assert.equal(store.listMovies(providerB.id).length, 1);
        assert.notEqual(store.listMovies(providerA.id)[0]?.id, store.listMovies(providerB.id)[0]?.id);
        const catalogueJson = JSON.stringify([
            ...store.listCategories(providerA.id),
            ...store.listMovies(providerA.id),
            ...store.listSeries(providerA.id),
            ...store.listSeasons(providerA.id),
            ...store.listEpisodes(providerA.id)
        ]);
        assert.equal(catalogueJson.includes("provider.example"), false);
        assert.equal(catalogueJson.includes("secret"), false);
        assert.equal(catalogueJson.includes("user:password"), false);
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("M3U malformed or cancelled sync does not archive existing catalogue records", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    let playlist = "#EXTM3U\n#EXTINF:-1 group-title=Movies tvg-type=movie,Old Movie\nhttps://provider.example/movie/old";
    const mock = installM3uMock(() => playlist);
    try {
        const savedProvider = store.createProviderAccount({ name: "M3U Provider", type: "m3u", baseUrl: "https://playlist.example/list.m3u", credentialStoreRef: "m3u" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        let operation = await runtime.startM3uCatalogueSync(savedProvider.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "completed");
        const existing = store.listMovies(savedProvider.id)[0];
        playlist = "#EXTM3U\n#EXTINF:-1 group-title=Movies tvg-type=movie,New Movie\nnot-a-url";
        operation = await runtime.startM3uCatalogueSync(savedProvider.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "failed");
        assert.equal(store.getMovie(existing.id)?.status, "active");
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
test("cancelled M3U catalogue sync does not perform stale cleanup", async () => {
    const databasePath = temporaryDatabasePath();
    const store = new DesktopSqliteStore(databasePath);
    const credentials = new MemoryCredentialStore();
    const mock = installM3uMock(() => "#EXTM3U\n#EXTINF:-1 group-title=Movies tvg-type=movie,Movie\nhttps://provider.example/movie/1", { block: true });
    try {
        const savedProvider = store.createProviderAccount({ name: "M3U Provider", type: "m3u", baseUrl: "https://playlist.example/list.m3u", credentialStoreRef: "m3u" });
        const existing = store.upsertMovie({ providerAccountId: savedProvider.id, externalReference: "old", name: "Old Movie" });
        const runtime = new DesktopIptvRuntime(store, credentials);
        const operation = await runtime.startM3uCatalogueSync(savedProvider.id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await runtime.cancelOperation(operation.id);
        assert.equal((await waitForOperation(runtime, operation.id)).status, "cancelled");
        assert.equal(store.getMovie(existing.id)?.status, "active");
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    finally {
        mock.release();
        store.close();
        cleanup(databasePath);
    }
});
