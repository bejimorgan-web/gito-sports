import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
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

const originalGito = window.gito;
const originalLiveBackend = {
  categories: apiClient.listIptvCatalogueCategories,
  channels: apiClient.listIptvChannels,
  movies: apiClient.listIptvMovies,
  series: apiClient.listIptvSeries,
  seasons: apiClient.listIptvSeasons,
  episodes: apiClient.listIptvEpisodes,
  epgChannels: apiClient.listIptvEpgChannels,
  epgProgrammes: apiClient.listIptvEpgProgrammes
};

function restoreWindowGito() {
  if (originalGito) {
    window.gito = originalGito;
  } else {
    delete window.gito;
  }
}

function restoreApiClient() {
  apiClient.listIptvCatalogueCategories = originalLiveBackend.categories;
  apiClient.listIptvChannels = originalLiveBackend.channels;
  apiClient.listIptvMovies = originalLiveBackend.movies;
  apiClient.listIptvSeries = originalLiveBackend.series;
  apiClient.listIptvSeasons = originalLiveBackend.seasons;
  apiClient.listIptvEpisodes = originalLiveBackend.episodes;
  apiClient.listIptvEpgChannels = originalLiveBackend.epgChannels;
  apiClient.listIptvEpgProgrammes = originalLiveBackend.epgProgrammes;
}

function installDesktopStorage(storage: any) {
  window.gito = {
    ...(originalGito ?? {
      platform: "desktop" as const,
      onNavigateToScreen: () => () => {},
      sendRendererError: () => {},
      sendRendererConsoleError: () => {}
    }),
    desktopStorage: storage
  };
}

function blockBackendLiveReads() {
  apiClient.listIptvCatalogueCategories = (() => {
    throw new Error("backend listIptvCatalogueCategories should not be called in the active Content Browser path");
  }) as typeof apiClient.listIptvCatalogueCategories;

  apiClient.listIptvChannels = (() => {
    throw new Error("backend listIptvChannels should not be called in the active Content Browser path");
  }) as typeof apiClient.listIptvChannels;
}

test("live categories and channels are read from Desktop local storage", async () => {
  const localCalls: Array<{ method: string; providerId?: string; contentType?: string }> = [];
  installDesktopStorage({
    categories: {
      list: async (providerId?: string, contentType?: string) => {
        localCalls.push({ method: "categories.list", ...(providerId ? { providerId } : {}), ...(contentType ? { contentType } : {}) });
        if (contentType === "live") {
          return [{ id: "live-category", providerAccountId: providerId!, externalReference: "group-1", name: "News", contentType: "live", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }];
        }
        return [];
      }
    },
    channels: {
      list: async (providerId?: string) => {
        localCalls.push({ method: "channels.list", ...(providerId ? { providerId } : {}) });
        return [
          { id: "local-live-channel", providerAccountId: providerId!, externalReference: "channel-1", name: "Local News", groupName: "News", logoUrl: null, playbackUrl: "https://example.test/news.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" }
        ];
      }
    },
    movies: { list: async () => [] },
    series: { list: async () => [] },
    seasons: { list: async () => [] },
    episodes: { list: async () => [] },
    epgChannels: { list: async () => [] },
    epgProgrammes: { list: async () => [] }
  });

  blockBackendLiveReads();

  try {
    render(<IptvCatalogueScreen providerId="provider-local" />);

    await waitFor(() => assert.ok(screen.getByText("News")));
    await waitFor(() => assert.ok(screen.getByText("Local News")));
    assert.deepEqual(localCalls.filter((call) => call.method === "categories.list").map((call) => ({ providerId: call.providerId, contentType: call.contentType })), [
      { providerId: "provider-local", contentType: "live" },
      { providerId: "provider-local", contentType: "movie" },
      { providerId: "provider-local", contentType: "series" }
    ]);
    assert.deepEqual(localCalls.filter((call) => call.method === "channels.list").map((call) => call.providerId), ["provider-local", "provider-local"]);
  } finally {
    cleanup();
    restoreApiClient();
    restoreWindowGito();
  }
});

test("live category filtering uses local channel data", async () => {
  installDesktopStorage({
    categories: {
      list: async (providerId?: string, contentType?: string) => {
        if (contentType === "live") {
          return [
            { id: "news-category", providerAccountId: providerId!, externalReference: "news-group", name: "News", contentType: "live", sortOrder: 1, status: "active", createdAt: "", updatedAt: "" },
            { id: "sports-category", providerAccountId: providerId!, externalReference: "sports-group", name: "Sports", contentType: "live", sortOrder: 2, status: "active", createdAt: "", updatedAt: "" }
          ];
        }
        return [];
      }
    },
    channels: {
      list: async (providerId?: string) => {
        return [
          { id: "channel-news", providerAccountId: providerId!, externalReference: "channel-news", name: "Local News", groupName: "News", logoUrl: null, playbackUrl: "https://example.test/news.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" },
          { id: "channel-sports", providerAccountId: providerId!, externalReference: "channel-sports", name: "Sports Feed", groupName: "Sports", logoUrl: null, playbackUrl: "https://example.test/sports.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" }
        ];
      }
    },
    movies: { list: async () => [] },
    series: { list: async () => [] },
    seasons: { list: async () => [] },
    episodes: { list: async () => [] },
    epgChannels: { list: async () => [] },
    epgProgrammes: { list: async () => [] }
  });

  blockBackendLiveReads();

  try {
    render(<IptvCatalogueScreen providerId="provider-local" />);

    await waitFor(() => assert.ok(screen.getByRole("button", { name: /News/ })));
    assert.ok(screen.getByRole("button", { name: /Sports/ }));

    fireEvent.click(screen.getByRole("button", { name: /Sports/ }));

    await waitFor(() => assert.ok(screen.getByText("Sports Feed")));
    assert.equal(screen.queryByText("Local News"), null);
  } finally {
    cleanup();
    restoreApiClient();
    restoreWindowGito();
  }
});

test("provider isolation is preserved for local live reads", async () => {
  installDesktopStorage({
    categories: {
      list: async (providerId?: string, contentType?: string) => {
        if (contentType === "live") {
          return providerId === "provider-a"
            ? [{ id: "a-category", providerAccountId: providerId!, externalReference: "group-a", name: "Alpha", contentType: "live", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }]
            : [{ id: "b-category", providerAccountId: providerId!, externalReference: "group-b", name: "Bravo", contentType: "live", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }];
        }
        return [];
      }
    },
    channels: {
      list: async (providerId?: string) => providerId === "provider-a"
        ? [{ id: "channel-a", providerAccountId: providerId!, externalReference: "channel-a", name: "Alpha Channel", groupName: "Alpha", logoUrl: null, playbackUrl: "https://example.test/a.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" }]
        : [{ id: "channel-b", providerAccountId: providerId!, externalReference: "channel-b", name: "Bravo Channel", groupName: "Bravo", logoUrl: null, playbackUrl: "https://example.test/b.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" }]
    },
    movies: { list: async () => [] },
    series: { list: async () => [] },
    seasons: { list: async () => [] },
    episodes: { list: async () => [] },
    epgChannels: { list: async () => [] },
    epgProgrammes: { list: async () => [] }
  });

  blockBackendLiveReads();

  try {
    render(<IptvCatalogueScreen providerId="provider-b" />);

    await waitFor(() => assert.ok(screen.getByText("Bravo Channel")));
    assert.equal(screen.queryByText("Alpha Channel"), null);
    assert.ok(screen.getAllByText("Bravo").length >= 1);
  } finally {
    cleanup();
    restoreApiClient();
    restoreWindowGito();
  }
});

test("movies, series, seasons, episodes, and EPG remain local reads", async () => {
  const selected: Array<{ entityType: "movie" | "episode"; entityId: string }> = [];
  const previewMetadata: Array<{ guide?: Array<{ title?: string }> }> = [];
  const localEpgCalls: string[] = [];

  installDesktopStorage({
    categories: {
      list: async (_providerId?: string, contentType?: string) => {
        if (contentType === "movie") {
          return [{ id: "movie-category", providerAccountId: "provider-local", externalReference: "movie-group", name: "Movies", contentType: "movie", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }];
        }
        if (contentType === "series") {
          return [{ id: "series-category", providerAccountId: "provider-local", externalReference: "series-group", name: "Series", contentType: "series", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }];
        }
        if (contentType === "live") {
          return [{ id: "live-category", providerAccountId: "provider-local", externalReference: "group-1", name: "News", contentType: "live", sortOrder: null, status: "active", createdAt: "", updatedAt: "" }];
        }
        return [];
      }
    },
    channels: {
      list: async () => [
        { id: "local-live-channel", providerAccountId: "provider-local", externalReference: "channel-1", name: "Local News", groupName: "News", logoUrl: null, playbackUrl: "https://example.test/local.m3u8", contentType: "live", status: "active", createdAt: "", updatedAt: "" }
      ]
    },
    movies: {
      list: async () => [{ id: "movie-local", providerAccountId: "provider-local", externalReference: "movie-1", categoryId: "movie-category", name: "Local Movie", description: "Safe metadata", logoUrl: null, posterUrl: null, contentType: "movie", status: "active", createdAt: "", updatedAt: "" }]
    },
    series: {
      list: async () => [
        { id: "series-local", providerAccountId: "provider-local", externalReference: "series-1", categoryId: "series-category", name: "Local Series", description: null, logoUrl: null, posterUrl: null, status: "active", createdAt: "", updatedAt: "" },
        { id: "series-uncategorized", providerAccountId: "provider-local", externalReference: "series-2", categoryId: null, name: "Uncategorized Series", description: null, logoUrl: null, posterUrl: null, status: "active", createdAt: "", updatedAt: "" }
      ]
    },
    seasons: {
      list: async () => [{ id: "season-local", providerAccountId: "provider-local", seriesId: "series-local", externalReference: "season-1", seasonNumber: 1, name: "Season 1", status: "active", createdAt: "", updatedAt: "" }]
    },
    episodes: {
      list: async () => [{ id: "episode-local", providerAccountId: "provider-local", seriesId: "series-local", seasonId: "season-local", externalReference: "episode-1", episodeNumber: 1, name: "Episode 1", description: null, logoUrl: null, status: "active", createdAt: "", updatedAt: "" }]
    },
    epgChannels: {
      list: async (providerId?: string) => {
        localEpgCalls.push(`channels:${providerId}`);
        return [{ id: "local-epg-channel", providerAccountId: providerId!, externalReference: "epg-1", channelId: "local-live-channel", name: "Local News", logoUrl: null, status: "active", createdAt: "", updatedAt: "" }];
      }
    },
    epgProgrammes: {
      list: async (providerId?: string, epgChannelId?: string) => {
        localEpgCalls.push(`programmes:${providerId}:${epgChannelId}`);
        const now = Date.now();
        return [{ id: "local-programme", providerAccountId: providerId!, externalReference: "programme-1", epgChannelId: epgChannelId ?? "", title: "Local Programme", description: "Local description", startAt: new Date(now + 60_000).toISOString(), endAt: new Date(now + 120_000).toISOString(), metadataJson: null, status: "active", createdAt: "", updatedAt: "" }];
      }
    }
  });

  blockBackendLiveReads();

  try {
    render(<IptvCatalogueScreen providerId="provider-local" contentType="movies" onSelectPlaybackEntity={(entity) => selected.push(entity)} />);

    await waitFor(() => assert.ok(screen.getByText("Local Movie")));
    fireEvent.click(screen.getByText("Local Movie"));
    assert.deepEqual(selected.at(-1), { entityType: "movie", entityId: "movie-local" });

    cleanup();

    render(<IptvCatalogueScreen providerId="provider-local" contentType="series" onSelectPlaybackEntity={(entity) => selected.push(entity)} onPreviewMetadataChange={(metadata) => previewMetadata.push(metadata)} />);

    await waitFor(() => assert.ok(screen.getByText("Local Series")));
    fireEvent.click(screen.getByText("Local Series"));
    await waitFor(() => assert.ok(screen.getByRole("option", { name: "Season 1" })));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: /Episode 1/ })));
    fireEvent.click(screen.getByRole("button", { name: /Episode 1/ }));
    assert.deepEqual(selected.at(-1), { entityType: "episode", entityId: "episode-local" });

    fireEvent.click(screen.getByRole("button", { name: /Uncategorized/ }));
    await waitFor(() => assert.ok(screen.getByText("Uncategorized Series")));

    cleanup();

    render(<IptvCatalogueScreen providerId="provider-local" onPreviewMetadataChange={(metadata) => previewMetadata.push(metadata)} />);
    await waitFor(() => assert.ok(screen.getByText("Local News")));
    fireEvent.click(screen.getByText("Local News"));
    await waitFor(() => assert.equal(previewMetadata.at(-1)?.guide?.[0]?.title, "Local Programme"));
    assert.deepEqual(localEpgCalls, ["channels:provider-local", "programmes:provider-local:local-epg-channel"]);
  } finally {
    cleanup();
    restoreApiClient();
    restoreWindowGito();
  }
});
