import { jsx as _jsx } from "react/jsx-runtime";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Event: { configurable: true, value: dom.window.Event },
    Node: { configurable: true, value: dom.window.Node }
});
const { apiClient } = await import("../../services/api-client");
const { IptvCatalogueScreen } = await import("./IptvCatalogueScreen");
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const emptyPage = { items: [], total: 0 };
function mockCatalogueApi() {
    const calls = [];
    const deferred = new Map();
    const request = (method, providerId) => {
        calls.push({ method, providerId });
        return new Promise((resolve) => {
            const pending = deferred.get(`${method}:${providerId}`) ?? [];
            pending.push(resolve);
            deferred.set(`${method}:${providerId}`, pending);
        });
    };
    const resolve = (method, providerId, value) => {
        for (const resolver of deferred.get(`${method}:${providerId}`) ?? [])
            resolver(value);
        deferred.delete(`${method}:${providerId}`);
    };
    const original = {
        categories: apiClient.listIptvCatalogueCategories,
        channels: apiClient.listIptvChannels,
        movies: apiClient.listIptvMovies,
        series: apiClient.listIptvSeries
    };
    const originalGito = window.gito;
    window.gito = {
        ...(originalGito ?? { platform: "desktop", onNavigateToScreen: () => () => { }, sendRendererError: () => { }, sendRendererConsoleError: () => { } }),
        desktopStorage: {
            categories: { list: async () => [] },
            movies: { list: async () => [] },
            series: { list: async () => [] },
            seasons: { list: async () => [] },
            episodes: { list: async () => [] },
            epgChannels: { list: async () => [] },
            epgProgrammes: { list: async () => [] }
        }
    };
    apiClient.listIptvCatalogueCategories = ((providerId) => request("categories", providerId));
    apiClient.listIptvChannels = ((providerId) => request("channels", providerId));
    apiClient.listIptvMovies = ((providerId) => request("movies", providerId));
    apiClient.listIptvSeries = ((providerId) => request("series", providerId));
    return {
        calls,
        resolve,
        restore() {
            apiClient.listIptvCatalogueCategories = original.categories;
            apiClient.listIptvChannels = original.channels;
            apiClient.listIptvMovies = original.movies;
            apiClient.listIptvSeries = original.series;
            if (originalGito)
                window.gito = originalGito;
            else
                delete window.gito;
        }
    };
}
function resolveProvider(providerId, channelName) {
    const category = { items: [{ id: `${providerId}-category`, providerId, contentType: "live", name: `${providerId} Group` }], total: 1 };
    return (api) => {
        api.resolve("categories", providerId, category);
        api.resolve("channels", providerId, { items: [{ id: `${providerId}-channel`, providerId, name: channelName, playbackReference: `https://example.test/${providerId}.m3u8`, status: "active" }], total: 1 });
        api.resolve("movies", providerId, emptyPage);
        api.resolve("series", providerId, emptyPage);
    };
}
test("empty provider state does not request catalogue data", async () => {
    const api = mockCatalogueApi();
    try {
        render(_jsx(IptvCatalogueScreen, { providerId: "" }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(api.calls, []);
    }
    finally {
        cleanup();
        api.restore();
    }
});
test("catalogue requests use the current provider and stale responses cannot populate the next provider", async () => {
    const api = mockCatalogueApi();
    try {
        const view = render(_jsx(IptvCatalogueScreen, { providerId: "provider-a" }));
        await waitFor(() => assert.equal(api.calls.length, 2));
        assert.deepEqual(new Set(api.calls.map((call) => call.providerId)), new Set(["provider-a"]));
        view.rerender(_jsx(IptvCatalogueScreen, { providerId: "provider-b" }));
        await waitFor(() => assert.ok(api.calls.length >= 4));
        assert.deepEqual(new Set(api.calls.slice(2).map((call) => call.providerId)), new Set(["provider-b"]));
        resolveProvider("provider-b", "Provider B Channel")(api);
        resolveProvider("provider-a", "Provider A Channel")(api);
        await waitFor(() => assert.ok(api.calls.filter((call) => call.providerId === "provider-b").length >= 3));
        resolveProvider("provider-b", "Provider B Channel")(api);
        await waitFor(() => assert.match(document.body.textContent ?? "", /Provider B Channel/));
        assert.doesNotMatch(document.body.textContent ?? "", /Provider A Channel/);
    }
    finally {
        cleanup();
        api.restore();
    }
});
test("M3U group metadata renders content and selects the provider-scoped preview channel", async () => {
    const api = mockCatalogueApi();
    const selected = [];
    try {
        render(_jsx(IptvCatalogueScreen, { providerId: "m3u-provider", onSelectChannel: (channel) => selected.push(channel) }));
        await waitFor(() => assert.equal(api.calls.length, 2));
        api.resolve("categories", "m3u-provider", { items: [{ id: "canonical-group", providerId: "m3u-provider", providerCategoryId: "provider-group", contentType: "live", name: "Entertainment;Family;General" }], total: 1 });
        api.resolve("channels", "m3u-provider", { items: [{ id: "m3u-channel", providerId: "m3u-provider", name: "M3U News", categoryId: "provider-group", category: { name: "Entertainment;Family;General" }, playbackReference: "https://example.test/m3u-channel.m3u8", status: "active" }], total: 1 });
        api.resolve("movies", "m3u-provider", emptyPage);
        api.resolve("series", "m3u-provider", emptyPage);
        await waitFor(() => assert.ok(screen.getByText("Entertainment;Family;General")));
        await waitFor(() => assert.ok(api.calls.some((call) => call.method === "channels" && call.providerId === "m3u-provider")));
        api.resolve("channels", "m3u-provider", { items: [{ id: "m3u-channel", providerId: "m3u-provider", name: "M3U News", categoryId: "provider-group", category: { name: "Entertainment;Family;General" }, playbackReference: "https://example.test/m3u-channel.m3u8", status: "active" }], total: 1 });
        await waitFor(() => assert.ok(screen.getByText("M3U News")));
        fireEvent.click(screen.getByText("M3U News"));
        assert.deepEqual(selected[0], {
            id: "m3u-channel",
            providerId: "m3u-provider",
            name: "M3U News",
            url: "https://example.test/m3u-channel.m3u8",
            contentType: "live",
            status: "active",
            createdAt: "",
            updatedAt: "",
            categoryId: "provider-group",
            groupName: "Entertainment;Family;General"
        });
    }
    finally {
        cleanup();
        api.restore();
    }
});
test("Xtream one-category response renders one group containing four live channels", async () => {
    const api = mockCatalogueApi();
    try {
        render(_jsx(IptvCatalogueScreen, { providerId: "xtream-provider" }));
        await waitFor(() => assert.equal(api.calls.length, 2));
        const category = { id: "live_category_42", providerId: "xtream-provider", providerCategoryId: "42", contentType: "live", name: "Sports" };
        const channels = [1, 2, 3, 4].map((number) => ({
            id: `channel-${number}`,
            providerId: "xtream-provider",
            name: `Live ${number}`,
            categoryId: category.id,
            category: { id: category.id, name: category.name },
            playbackReference: `https://example.test/live/${number}.m3u8`,
            status: "active"
        }));
        api.resolve("categories", "xtream-provider", { items: [category], total: 1 });
        api.resolve("channels", "xtream-provider", { items: channels, total: 4 });
        api.resolve("movies", "xtream-provider", emptyPage);
        api.resolve("series", "xtream-provider", emptyPage);
        await waitFor(() => assert.ok(api.calls.filter((call) => call.method === "channels" && call.providerId === "xtream-provider").length >= 2));
        api.resolve("channels", "xtream-provider", { items: channels, total: 4 });
        await waitFor(() => assert.ok(screen.getByRole("heading", { name: "Sports · 4 channels" })));
        assert.equal(screen.getAllByText("Sports").filter((element) => element.tagName === "SPAN").length, 1);
        assert.equal(screen.getAllByRole("button", { name: /Live [1-4]/ }).length, 4);
    }
    finally {
        cleanup();
        api.restore();
    }
});
test("EPG guide reads provider-scoped Desktop records without backend EPG calls", async () => {
    const api = mockCatalogueApi();
    const originalEpgChannels = apiClient.listIptvEpgChannels;
    const originalEpgProgrammes = apiClient.listIptvEpgProgrammes;
    const originalGito = window.gito;
    const future = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 120_000).toISOString();
    const localEpgCalls = [];
    const previewMetadata = [];
    window.gito = {
        ...(originalGito ?? { platform: "desktop", onNavigateToScreen: () => () => { }, sendRendererError: () => { }, sendRendererConsoleError: () => { } }),
        desktopStorage: {
            ...originalGito?.desktopStorage,
            epgChannels: {
                list: async (providerId) => {
                    localEpgCalls.push(`channels:${providerId}`);
                    return [{ id: "local-epg-channel", providerAccountId: providerId ?? "", externalReference: "epg-1", channelId: "local-live-channel", name: "Local News", logoUrl: null, status: "active", createdAt: "", updatedAt: "" }];
                }
            },
            epgProgrammes: {
                list: async (providerId, epgChannelId) => {
                    localEpgCalls.push(`programmes:${providerId}:${epgChannelId}`);
                    return [{ id: "local-programme", providerAccountId: providerId ?? "", externalReference: "programme-1", epgChannelId: epgChannelId ?? "", title: "Local Programme", description: "Local description", startAt: future, endAt: later, metadataJson: null, status: "active", createdAt: "", updatedAt: "" }];
                }
            }
        }
    };
    apiClient.listIptvEpgChannels = (() => { throw new Error("backend EPG channel API invoked"); });
    apiClient.listIptvEpgProgrammes = (() => { throw new Error("backend EPG programme API invoked"); });
    try {
        render(_jsx(IptvCatalogueScreen, { providerId: "provider-local", onPreviewMetadataChange: (metadata) => previewMetadata.push(metadata) }));
        await waitFor(() => assert.equal(api.calls.length, 2));
        const category = { id: "local-category", providerId: "provider-local", providerCategoryId: "group-1", contentType: "live", name: "News" };
        const channel = { id: "local-live-channel", providerId: "provider-local", name: "Local News", categoryId: category.id, category: { name: category.name }, playbackReference: "https://example.test/local.m3u8", status: "active" };
        api.resolve("categories", "provider-local", { items: [category], total: 1 });
        api.resolve("channels", "provider-local", { items: [channel], total: 1 });
        api.resolve("movies", "provider-local", emptyPage);
        api.resolve("series", "provider-local", emptyPage);
        await waitFor(() => assert.ok(api.calls.filter((call) => call.method === "channels" && call.providerId === "provider-local").length >= 2));
        api.resolve("channels", "provider-local", { items: [channel], total: 1 });
        await waitFor(() => screen.getByText("Local News"));
        fireEvent.click(screen.getByText("Local News"));
        await waitFor(() => assert.equal(previewMetadata.at(-1)?.guide?.[0]?.title, "Local Programme"));
        assert.deepEqual(localEpgCalls, ["channels:provider-local", "programmes:provider-local:local-epg-channel"]);
        assert.equal(previewMetadata.at(-1)?.guide?.[0]?.externalProgrammeId, "programme-1");
    }
    finally {
        cleanup();
        api.restore();
        apiClient.listIptvEpgChannels = originalEpgChannels;
        apiClient.listIptvEpgProgrammes = originalEpgProgrammes;
        if (originalGito)
            window.gito = originalGito;
        else
            delete window.gito;
    }
});
test("Movie and Episode selections emit local identities without playback URLs", async () => {
    const api = mockCatalogueApi();
    const originalGito = window.gito;
    const originalMovies = apiClient.listIptvMovies;
    const originalSeries = apiClient.listIptvSeries;
    const originalSeasons = apiClient.listIptvSeasons;
    const originalEpisodes = apiClient.listIptvEpisodes;
    const selected = [];
    window.gito = {
        ...(originalGito ?? { platform: "desktop", onNavigateToScreen: () => () => { }, sendRendererError: () => { }, sendRendererConsoleError: () => { } }),
        desktopStorage: {
            categories: { list: async (_providerId, contentType) => [{ id: `${contentType}-category`, providerAccountId: "provider-local", externalReference: `${contentType}-group`, name: `${contentType} group`, contentType, sortOrder: null, status: "active", createdAt: "", updatedAt: "" }] },
            movies: { list: async () => [{ id: "movie-local", providerAccountId: "provider-local", externalReference: "movie-1", categoryId: "movie-category", name: "Local Movie", description: "Safe metadata", logoUrl: null, posterUrl: null, contentType: "movie", status: "active", createdAt: "", updatedAt: "" }] },
            series: { list: async () => [{ id: "series-local", providerAccountId: "provider-local", externalReference: "series-1", categoryId: "series-category", name: "Local Series", description: null, logoUrl: null, posterUrl: null, status: "active", createdAt: "", updatedAt: "" }] },
            seasons: { list: async () => [{ id: "season-local", providerAccountId: "provider-local", seriesId: "series-local", externalReference: "season-1", seasonNumber: 1, name: "Season 1", status: "active", createdAt: "", updatedAt: "" }] },
            episodes: { list: async () => [{ id: "episode-local", providerAccountId: "provider-local", seriesId: "series-local", seasonId: "season-local", externalReference: "episode-1", episodeNumber: 1, name: "Episode 1", description: null, logoUrl: null, status: "active", createdAt: "", updatedAt: "" }] }
        }
    };
    apiClient.listIptvMovies = (() => { throw new Error("backend movie playback/catalogue helper invoked"); });
    apiClient.listIptvSeries = (() => { throw new Error("backend series helper invoked"); });
    apiClient.listIptvSeasons = (() => { throw new Error("backend season helper invoked"); });
    apiClient.listIptvEpisodes = (() => { throw new Error("backend episode helper invoked"); });
    try {
        render(_jsx(IptvCatalogueScreen, { providerId: "provider-local", contentType: "movies", onSelectPlaybackEntity: (entity) => selected.push(entity) }));
        await waitFor(() => assert.equal(api.calls.length, 2));
        api.resolve("categories", "provider-local", { items: [], total: 0 });
        api.resolve("channels", "provider-local", { items: [], total: 0 });
        await waitFor(() => assert.ok(screen.getByText("Local Movie")));
        fireEvent.click(screen.getByText("Local Movie"));
        assert.deepEqual(selected[0], { entityType: "movie", entityId: "movie-local" });
        assert.equal(JSON.stringify(selected).includes("http"), false);
        cleanup();
        render(_jsx(IptvCatalogueScreen, { providerId: "provider-local", contentType: "series", onSelectPlaybackEntity: (entity) => selected.push(entity) }));
        await waitFor(() => assert.equal(api.calls.length, 4));
        api.resolve("categories", "provider-local", { items: [], total: 0 });
        api.resolve("channels", "provider-local", { items: [], total: 0 });
        await waitFor(() => assert.ok(screen.getByText("Local Series")));
        fireEvent.click(screen.getByText("Local Series"));
        await waitFor(() => assert.ok(screen.getByRole("option", { name: "Season 1" })));
        await waitFor(() => assert.ok(screen.getByRole("button", { name: /Episode 1/ })));
        fireEvent.click(screen.getByRole("button", { name: /Episode 1/ }));
        assert.deepEqual(selected[1], { entityType: "episode", entityId: "episode-local" });
    }
    finally {
        cleanup();
        api.restore();
        apiClient.listIptvMovies = originalMovies;
        apiClient.listIptvSeries = originalSeries;
        apiClient.listIptvSeasons = originalSeasons;
        apiClient.listIptvEpisodes = originalEpisodes;
        if (originalGito)
            window.gito = originalGito;
        else
            delete window.gito;
    }
});
