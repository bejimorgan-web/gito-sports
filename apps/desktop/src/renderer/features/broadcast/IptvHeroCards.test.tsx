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

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { IptvHeroCards } = await import("./IptvHeroCards");

const originalFetch = globalThis.fetch;
const originalGito = window.gito;

function installLocalStorage() {
  const calls: Array<{ method: string; providerId: string }> = [];
  window.gito = {
    ...(originalGito ?? {
      platform: "desktop" as const,
      onNavigateToScreen: () => () => {},
      sendRendererError: () => {},
      sendRendererConsoleError: () => {}
    }),
    desktopStorage: {
      channels: {
        list: async (providerId: string) => {
          calls.push({ method: "channels.list", providerId });
          return providerId === "provider-a"
            ? [
                { id: "live-a-1", providerAccountId: providerId, contentType: "live" },
                { id: "live-a-2", providerAccountId: providerId, contentType: "live" },
                { id: "movie-a-1", providerAccountId: providerId, contentType: "movie" }
              ]
            : providerId === "provider-b"
              ? [{ id: "live-b-1", providerAccountId: providerId, contentType: "live" }]
              : [];
        }
      },
      movies: {
        list: async (providerId: string) => {
          calls.push({ method: "movies.list", providerId });
          return providerId === "provider-a" ? [{ id: "movie-a-1" }, { id: "movie-a-2" }] : providerId === "provider-b" ? [{ id: "movie-b-1" }, { id: "movie-b-2" }, { id: "movie-b-3" }] : [];
        }
      },
      series: {
        list: async (providerId: string) => {
          calls.push({ method: "series.list", providerId });
          return providerId === "provider-a" ? [{ id: "series-a-1" }] : providerId === "provider-b" ? [{ id: "series-b-1" }, { id: "series-b-2" }] : [];
        }
      }
    } as any
  };
  return calls;
}

test("hero cards render provider-scoped Desktop local counts and never call backend IPTV APIs", async () => {
  const calls = installLocalStorage();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`backend IPTV request must not occur: ${String(input)}`);
  }) as typeof fetch;

  try {
    const { rerender } = render(<IptvHeroCards providerId="provider-a" selectedContentType="live" favoriteCount={4} onSelectContentType={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText("2 channels")));
    assert.ok(screen.getByText("2 movies"));
    assert.ok(screen.getByText("1 series"));
    assert.ok(screen.getByText("4 saved"));

    rerender(<IptvHeroCards providerId="provider-b" selectedContentType="live" favoriteCount={0} onSelectContentType={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText("1 channels")));
    assert.ok(screen.getByText("3 movies"));
    assert.ok(screen.getByText("2 series"));
    assert.deepEqual(calls.slice(-3).map((call) => call.providerId), ["provider-b", "provider-b", "provider-b"]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    if (originalGito) window.gito = originalGito;
    else delete window.gito;
  }
});

test("empty or missing provider-local data renders zero counts", async () => {
  installLocalStorage();
  try {
    render(<IptvHeroCards providerId="provider-empty" selectedContentType="live" favoriteCount={0} onSelectContentType={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText("0 channels")));
    assert.ok(screen.getByText("0 movies"));
    assert.ok(screen.getByText("0 series"));
  } finally {
    cleanup();
    if (originalGito) window.gito = originalGito;
    else delete window.gito;
  }
});
