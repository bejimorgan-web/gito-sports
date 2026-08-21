import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { NewsWorkspaceScreen } from "./NewsWorkspaceScreen";
import {
  filterNewsArticles,
  getNormalizedFetchedSourcePreview,
  isGiTOFactCheckRequired,
  isGiTOGeneratedArticle,
  isGiTOInsufficientSourceMaterial,
  shouldClearEditingArticleAfterDelete,
  shouldClearSelectedArticleAfterDelete
} from "./news-workspace-helpers";

function initializeDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const win = dom.window as unknown as Window;
  const globalAny = globalThis as any;

  Object.defineProperty(globalAny, "window", {
    value: win,
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(globalAny, "document", {
    value: win.document,
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(globalAny, "navigator", {
    value: win.navigator,
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(globalAny, "requestAnimationFrame", {
    value: typeof win.requestAnimationFrame === "function"
      ? win.requestAnimationFrame.bind(win)
      : (callback: FrameRequestCallback) => setTimeout(callback, 0),
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(globalAny, "cancelAnimationFrame", {
    value: typeof win.cancelAnimationFrame === "function"
      ? win.cancelAnimationFrame.bind(win)
      : (handle: number) => clearTimeout(handle),
    writable: true,
    configurable: true,
    enumerable: true
  });

  return dom;
}

function buildFetchMock(initialArticles: Array<any>, generatedCrawlerTier: "http" | "browser" = "http") {
  const articles = initialArticles.map((article) => ({ ...article }));
  const deleteRequests: string[][] = [];
  const researchRequests: string[] = [];
  let resolveResearchRequest: (() => void) | null = null;
  const generationRequests: Array<{ articleId: string; body: any }> = [];
  const publishRequests: string[] = [];
  let resolveGenerationRequest: (() => void) | null = null;
  const rssSources: any[] = [];
  const rssRequests: string[] = [];
  const generatedFeeds: any[] = [];
  let resolveGeneratedFeed: (() => void) | null = null;
  let generatedFeedError: string | null = null;
  const sources = [
    { id: "source-a", name: "Source Alpha", sourceType: "external", enabled: true, feedUrl: null },
    { id: "source-b", name: "Source Beta", sourceType: "external", enabled: true, feedUrl: null }
  ];

  const createJsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

  const fetchMock = async (input: RequestInfo, init?: RequestInit) => {
    const requestUrl = typeof input === "string" ? input : input.url;
    const url = new URL(requestUrl, "http://localhost");
    const pathname = url.pathname;
    const method = (init?.method ?? "GET").toString().toUpperCase();
    if (pathname === "/news/articles" && method === "GET") {
      return createJsonResponse(articles);
    }

    if (pathname === "/news/sources" && method === "GET") {
      return createJsonResponse(sources);
    }

    if (pathname === "/news/rss-sources" && method === "GET") {
      return createJsonResponse(rssSources);
    }

    if (pathname === "/news/rss-sources" && method === "POST") {
      rssRequests.push("create");
      const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const source = { id: "rss-1", name: payload.name, sourceType: "external", feedUrl: payload.feedUrl, enabled: true, createdAt: "2026-08-19", updatedAt: "2026-08-19" };
      rssSources.push(source);
      return createJsonResponse(source, 201);
    }

    if (pathname === "/news/rss-sources/rss-1/fetch" && method === "POST") {
      return createJsonResponse({ sourceId: "rss-1", fetchedItems: 12, importedItems: 4, skippedDuplicates: 8, failedItems: 0 });
    }

    if (pathname === "/news/rss-sources/rss-1" && method === "DELETE") {
      rssSources.splice(0, rssSources.length);
      return new Response(null, { status: 204 });
    }

    if (pathname === "/news/generated-rss-sources" && method === "GET") return createJsonResponse(generatedFeeds);
    if (pathname === "/news/generated-rss-sources" && method === "POST") {
      if (generatedFeedError) return createJsonResponse({ error: "rss_fetch_failed_403", message: generatedFeedError }, 400);
      const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const feed = { id: "web-feed-1", name: payload.name, sourceUrl: payload.sourceUrl, feedToken: "abc123", feedUrl: "/news/generated-rss/abc123.xml", status: "ready", discoveredArticleCount: 2, crawlerTier: generatedCrawlerTier, enabled: true };
      generatedFeeds.push(feed);
      return new Promise((resolve) => { resolveGeneratedFeed = () => resolve(createJsonResponse(feed, 201)); });
    }
    if (pathname === "/news/generated-rss-sources/web-feed-1/refresh" && method === "POST") return createJsonResponse({ ...generatedFeeds[0], status: "ready", discoveredArticleCount: 3 });
    if (pathname === "/news/generated-rss-sources/web-feed-1/articles" && method === "GET") return createJsonResponse([{ id: "web-article-1", title: "Discovered story", sourceName: "Example Sports", articleUrl: "https://example.com/story", publishedAt: "2026-08-19T10:00:00.000Z" }]);
    if (pathname === "/news/generated-rss-sources/web-feed-1" && method === "DELETE") { generatedFeeds.splice(0, generatedFeeds.length); return new Response(null, { status: 204 }); }

    if (pathname === "/news/articles/a1/research" && method === "GET") {
      return createJsonResponse({ error: "research_result_not_found" }, 404);
    }

    if (pathname === "/news/articles/a1/research" && method === "POST") {
      researchRequests.push("a1");
      return new Promise((resolve) => {
        resolveResearchRequest = () => resolve(createJsonResponse({
          query: "Club wins decisive match",
          researchedAt: "2026-08-18T12:00:00.000Z",
          sources: [{ id: "rs1", url: "https://club.example/statement", domain: "club.example", title: "Club statement", publisher: "Official club", sourceType: "official_organization", retrievedAt: "2026-08-18T12:00:00.000Z", relevance: 1, authorityLevel: 5, extractedFacts: [], evidenceSnippets: ["The club confirmed the transfer."], isPrimarySource: true }],
          verifiedFacts: [{ id: "f1", statement: "Club confirmed the player's transfer.", importance: "high", sources: ["club.example"], agreement: 1, confidence: "high", status: "verified" }],
          disputedFacts: [{ id: "f2", statement: "Transfer fee differs between reports.", importance: "medium", sources: ["club.example", "bbc.example"], agreement: 0.5, confidence: "low", status: "conflicting" }],
          unsupportedClaims: ["The fee requires confirmation before publication."],
          keyEvents: ["Transfer confirmed"],
          people: ["Player One"],
          organizations: ["Official club"],
          statistics: [],
          timeline: [],
          confidence: "high",
          researchStatus: "completed",
          summary: "The central transfer claim is supported by official evidence.",
          conflicts: []
        }))
      });
    }

    if (pathname === "/news/articles/a1/generate-original" && method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      generationRequests.push({ articleId: "a1", body: JSON.parse(bodyText) });
      const generatedArticle = { id: "g1", title: "GiTO original transfer story", summary: "GiTO summary from verified facts.", body: "GiTO body from verified facts.", status: "review", contentOrigin: "gito_ai", author: "GiTO News", tags: ["gito-generated", "gito-review-required", "gito-fact-check-needed"], sourceName: "Official club", sourceUrl: "https://club.example/statement", createdAt: "2026-08-18", updatedAt: "2026-08-18" };
      articles.push(generatedArticle);
      return new Promise((resolve) => {
        resolveGenerationRequest = () => resolve(createJsonResponse(generatedArticle));
      });
    }

    if (pathname === "/news/articles/g1/publish" && method === "POST") {
      publishRequests.push("g1");
      return createJsonResponse({ id: "g1", title: "GiTO original transfer story", status: "published", contentOrigin: "gito_ai", tags: ["gito-generated", "gito-review-required"], createdAt: "2026-08-18", updatedAt: "2026-08-18", publishedAt: "2026-08-19" });
    }

    if (pathname === "/sports" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/countries" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/competitions" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/teams" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/hosts" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/matches" && method === "GET") {
      return createJsonResponse([]);
    }

    if (pathname === "/news/articles/bulk-delete" && method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "";
      const payload = bodyText ? JSON.parse(bodyText) as { ids: string[] } : { ids: [] };
      deleteRequests.push(payload.ids);

      for (const id of payload.ids) {
        const index = articles.findIndex((article) => article.id === id);
        if (index !== -1) {
          articles.splice(index, 1);
        }
      }

      return createJsonResponse({ deletedCount: payload.ids.length });
    }

    return createJsonResponse({ error: "unmatched_news_test_request" }, 500);
  };

  const getDeleteRequests = () => deleteRequests;
  const getCurrentArticleIds = () => articles.map((article) => article.id);

  return {
    fetchMock,
    getDeleteRequests,
    getCurrentArticleIds,
    researchRequests,
    generationRequests,
    resolveResearchRequest: () => resolveResearchRequest?.(),
    resolveGenerationRequest: () => resolveGenerationRequest?.(),
    publishRequests,
    rssRequests,
    resolveGeneratedFeed: () => resolveGeneratedFeed?.()
    , setGeneratedFeedError: (message: string) => { generatedFeedError = message; }
  };
}

test("isGiTOGeneratedArticle returns false for null or non-AI articles", () => {
  assert.equal(isGiTOGeneratedArticle(null), false);
  assert.equal(isGiTOGeneratedArticle({ id: "1", title: "Test", status: "draft" } as any), false);
});

test("isGiTOGeneratedArticle returns true for explicit GiTO AI origin or author", () => {
  assert.equal(isGiTOGeneratedArticle({ id: "1", title: "AI Draft", status: "review", contentOrigin: "gito_ai" } as any), true);
  assert.equal(isGiTOGeneratedArticle({ id: "2", title: "AI Draft", status: "review", author: "GiTO News" } as any), true);
});

test("isGiTOFactCheckRequired recognizes gito-fact-check-needed tags", () => {
  assert.equal(isGiTOFactCheckRequired(null), false);
  assert.equal(isGiTOFactCheckRequired({ id: "1", title: "Test", status: "draft", tags: ["other-tag"] } as any), false);
  assert.equal(isGiTOFactCheckRequired({ id: "2", title: "Test", status: "review", tags: ["gito-fact-check-needed"] } as any), true);
});

test("getNormalizedFetchedSourcePreview returns readable text without raw HTML markup", () => {
  const article = {
    id: "1",
    title: "Test",
    status: "draft",
    fetchedBody: `<div><p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p><div class="promo">Sponsored content</div></div>`
  } as any;

  const preview = getNormalizedFetchedSourcePreview(article);
  assert.ok(preview);
  assert.equal(preview?.includes("<div>"), false);
  assert.equal(preview?.includes("<p>"), false);
  assert.equal(preview?.includes("Sponsored content"), true);
  assert.equal(preview?.includes("First paragraph."), true);
});

test("isGiTOInsufficientSourceMaterial recognizes insufficient-source metadata", () => {
  assert.equal(isGiTOInsufficientSourceMaterial(null), false);
  assert.equal(isGiTOInsufficientSourceMaterial({ id: "1", title: "Test", status: "review", tags: ["gito-fact-check-needed"] } as any), false);
  assert.equal(isGiTOInsufficientSourceMaterial({ id: "2", title: "Test", status: "review", tags: ["gito-insufficient-source-material"] } as any), true);
});

test("filterNewsArticles filters by search and special GiTO statuses", () => {
  const articles = [
    { id: "1", title: "Local match report", status: "review", source: { id: "source-a" }, tags: ["gito-fact-check-needed"] } as any,
    { id: "2", title: "GiTO AI Draft", status: "draft", source: { id: "source-b" }, contentOrigin: "gito_ai", tags: [] } as any,
    { id: "3", title: "Insufficient feed", status: "draft", source: { id: "source-a" }, tags: ["gito-insufficient-source-material"] } as any
  ];

  const searchFiltered = filterNewsArticles(articles, {
    sport: "",
    competition: "",
    team: "",
    status: "",
    source: "",
    search: "match",
    generatedOnly: false,
    factCheckOnly: false,
    insufficientOnly: false
  });
  assert.equal(searchFiltered.length, 1);
  const [searchResult] = searchFiltered;
  assert.ok(searchResult);
  assert.equal(searchResult?.id, "1");

  const generatedOnly = filterNewsArticles(articles, {
    sport: "",
    competition: "",
    team: "",
    status: "",
    source: "",
    search: "",
    generatedOnly: true,
    factCheckOnly: false,
    insufficientOnly: false
  });
  assert.equal(generatedOnly.length, 1);
  const [generatedResult] = generatedOnly;
  assert.ok(generatedResult);
  assert.equal(generatedResult?.id, "2");

  const factCheckOnly = filterNewsArticles(articles, {
    sport: "",
    competition: "",
    team: "",
    status: "",
    source: "",
    search: "",
    generatedOnly: false,
    factCheckOnly: true,
    insufficientOnly: false
  });
  assert.equal(factCheckOnly.length, 1);
  const [factCheckResult] = factCheckOnly;
  assert.ok(factCheckResult);
  assert.equal(factCheckResult?.id, "1");

  const insufficientOnly = filterNewsArticles(articles, {
    sport: "",
    competition: "",
    team: "",
    status: "",
    source: "",
    search: "",
    generatedOnly: false,
    factCheckOnly: false,
    insufficientOnly: true
  });
  assert.equal(insufficientOnly.length, 1);
  const [insufficientResult] = insufficientOnly;
  assert.ok(insufficientResult);
  assert.equal(insufficientResult?.id, "3");
});

test("shouldClear*AfterDelete helpers return true only when the relevant id is deleted", () => {
  assert.equal(shouldClearSelectedArticleAfterDelete("1", ["1", "2"]), true);
  assert.equal(shouldClearSelectedArticleAfterDelete("1", ["2"]), false);
  assert.equal(shouldClearEditingArticleAfterDelete("3", ["3"]), true);
  assert.equal(shouldClearEditingArticleAfterDelete("3", ["1", "2"]), false);
});

test("incoming News filters and Select visible bulk selection work together", async () => {
  const dom = initializeDom();
  globalThis.window.confirm = () => true;
  const { cleanup, fireEvent, render, screen, waitFor, within } = await import("@testing-library/react");
  const { fetchMock, getDeleteRequests, getCurrentArticleIds } = buildFetchMock([
    { id: "a1", title: "Search match report", status: "draft", source: { id: "source-a", name: "Source Alpha" }, tags: [], createdAt: "2026-01-01" },
    { id: "a2", title: "Review generated", status: "review", source: { id: "source-b", name: "Source Beta" }, contentOrigin: "gito_ai", tags: [], createdAt: "2026-01-02" },
    { id: "a3", title: "Fact-check soon", status: "review", source: { id: "source-a", name: "Source Alpha" }, tags: ["gito-fact-check-needed"], createdAt: "2026-01-03" },
    { id: "a4", title: "Insufficient source story", status: "draft", source: { id: "source-b", name: "Source Beta" }, tags: ["gito-insufficient-source-material"], createdAt: "2026-01-04" },
    { id: "a5", title: "Published hidden article", status: "published", source: { id: "source-a", name: "Source Alpha" }, tags: [], createdAt: "2026-01-05" }
  ]);

  const originalFetch = globalThis.fetch;
  const originalConfirm = globalThis.confirm;
  globalThis.fetch = fetchMock as typeof fetch;
  globalThis.confirm = () => true;

  try {
    render(<NewsWorkspaceScreen accessToken="dummy-token" />);

    fireEvent.click(screen.getByRole("button", { name: "Incoming News" }));
    await screen.findByPlaceholderText("Search titles");
    const incomingSection = screen.getByRole("heading", { name: "Incoming News" }).closest("section");
    assert.ok(incomingSection);
    const incoming = within(incomingSection as HTMLElement);

    await incoming.findByText("Search match report", { selector: "strong" });
    await incoming.findByText("Review generated", { selector: "strong" });
    await incoming.findByText("Fact-check soon", { selector: "strong" });
    await incoming.findByText("Insufficient source story", { selector: "strong" });

    // Search filter + select visible
    fireEvent.change(incoming.getByPlaceholderText("Search titles"), { target: { value: "Search" } });
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("1 article selected").textContent, "1 article selected");
    const searchInput = incoming.getByDisplayValue("Search") as HTMLInputElement;
    assert.equal(searchInput.value, "Search");
    assert.ok(incoming.getAllByText("Search match report", { selector: "strong" }).length > 0);
    assert.equal(incoming.queryAllByText("Review generated", { selector: "strong" }).length, 0);
    assert.equal(incoming.queryAllByText("Fact-check soon", { selector: "strong" }).length, 0);
    assert.equal(incoming.queryAllByText("Insufficient source story", { selector: "strong" }).length, 0);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));
    assert.equal(incoming.getByText("0 articles selected").textContent, "0 articles selected");

    // Status filter + select visible
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(incoming.getByRole("combobox", { name: /Filter by status/i }), { target: { value: "review" } });
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("2 articles selected").textContent, "2 articles selected");
    assert.ok(incoming.getByText("Review generated"));
    assert.ok(incoming.getByText("Fact-check soon"));
    assert.equal(incoming.queryByText("Search match report"), null);
    assert.equal(incoming.queryByText("Insufficient source story"), null);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));

    // Source filter + select visible
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(incoming.getByRole("combobox", { name: /Filter by source/i }), { target: { value: "source-a" } });
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("2 articles selected").textContent, "2 articles selected");
    assert.ok(incoming.getByText("Search match report"));
    assert.ok(incoming.getByText("Fact-check soon"));
    assert.equal(incoming.queryByText("Review generated"), null);
    assert.equal(incoming.queryByText("Insufficient source story"), null);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));

    // GiTO generated filter + select visible
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(incoming.getByLabelText(/GiTO generated/i));
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("1 article selected").textContent, "1 article selected");
    assert.ok(incoming.getByText("Review generated"));
    assert.equal(incoming.queryByText("Search match report"), null);
    assert.equal(incoming.queryByText("Fact-check soon"), null);
    assert.equal(incoming.queryByText("Insufficient source story"), null);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));

    // Fact-check filter + select visible
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(incoming.getByLabelText(/Fact-check only/i));
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("1 article selected").textContent, "1 article selected");
    assert.ok(incoming.getByText("Fact-check soon"));
    assert.equal(incoming.queryByText("Review generated"), null);
    assert.equal(incoming.queryByText("Search match report"), null);
    assert.equal(incoming.queryByText("Insufficient source story"), null);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));

    // Insufficient source filter + select visible
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.click(incoming.getByLabelText(/Insufficient source/i));
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("1 article selected").textContent, "1 article selected");
    assert.ok(incoming.getByText("Insufficient source story"));
    assert.equal(incoming.queryByText("Review generated"), null);
    assert.equal(incoming.queryByText("Search match report"), null);
    fireEvent.click(incoming.getByRole("button", { name: "Clear selection" }));

    // Verify bulk delete only removes selected visible IDs and preserves non-visible articles
    fireEvent.click(incoming.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(incoming.getByRole("combobox", { name: /Filter by status/i }), { target: { value: "draft" } });
    fireEvent.click(incoming.getByRole("button", { name: "Select visible" }));
    assert.equal(incoming.getByText("2 articles selected").textContent, "2 articles selected");
    fireEvent.click(incoming.getByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      assert.equal(getDeleteRequests().length, 1);
      const firstRequest = getDeleteRequests()[0] ?? [];
      assert.deepEqual(firstRequest.sort(), ["a1", "a4"].sort());
      assert.equal(incoming.queryByText("Search match report"), null);
      assert.equal(incoming.queryByText("Insufficient source story"), null);
    });

    assert.deepEqual(getCurrentArticleIds().sort(), ["a2", "a3", "a5"].sort());
    assert.equal(getCurrentArticleIds().includes("a1"), false);
    assert.equal(getCurrentArticleIds().includes("a4"), false);
    assert.equal(getCurrentArticleIds().includes("a2"), true);
    assert.equal(getCurrentArticleIds().includes("a3"), true);
    assert.equal(getCurrentArticleIds().includes("a5"), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.confirm = originalConfirm;
    cleanup();
    dom.window.close();
  }
});

test("rendered News research workflow produces a reviewed GiTO story and preserves incoming bulk controls", async () => {
  const dom = initializeDom();
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const { fetchMock, researchRequests, generationRequests, resolveResearchRequest, resolveGenerationRequest, publishRequests } = buildFetchMock([
    { id: "a1", title: "Club wins decisive match", summary: "The club confirmed a transfer.", body: "The club confirmed the player's transfer.", status: "draft", source: { id: "source-a", name: "Official club" }, sourceName: "Official club", sourceUrl: "https://club.example/statement", tags: [], createdAt: "2026-08-18" },
    { id: "a2", title: "Another incoming story", status: "draft", source: { id: "source-b", name: "Source Beta" }, tags: [], createdAt: "2026-08-17" }
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    fireEvent.click(view.getByRole("button", { name: "Incoming News" }));
    const incomingSection = await view.findByRole("heading", { name: "Incoming News" });
    const incoming = within(incomingSection.closest("section") as HTMLElement);

    fireEvent.click(await incoming.findByText("Club wins decisive match", { selector: "strong" }));
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Research this story" })));
    assert.equal(view.getByRole("button", { name: "Research this story" }).textContent, "Research this story");

    fireEvent.click(view.getByRole("button", { name: "Research this story" }));
    await waitFor(() => assert.ok(view.getByRole("status")));
    await waitFor(() => assert.equal(researchRequests.length, 1));
    assert.equal(view.queryByRole("button", { name: "Research this story" }), null);
    resolveResearchRequest();
    await view.findByText("Research complete");
    assert.ok(view.getByText("Verified facts: 1"));
    assert.ok(view.getByText("Conflicting facts: 1"));

    fireEvent.click(view.getByRole("button", { name: "View research" }));
    assert.ok(view.getByText("Club confirmed the player's transfer."));
    assert.ok(view.getByText("Sources consulted"));
    assert.ok(view.getAllByText("Official club").length >= 1);
    assert.ok(view.getByText("https://club.example/statement"));
    assert.ok(view.getByText(/Publisher rights have not been confirmed/));
    assert.equal(generationRequests.length, 0);
    fireEvent.click(view.getByRole("button", { name: "Generate GiTO Original Story" }));
    await waitFor(() => assert.ok(view.getByText("Generating original story…")));
    assert.equal(publishRequests.length, 0);
    resolveGenerationRequest();
    await waitFor(() => assert.equal(generationRequests.length, 1));

    const titleInput = await view.findByLabelText("Title") as HTMLInputElement;
    const summaryInput = view.getByLabelText("Summary") as HTMLTextAreaElement;
    const bodyInput = view.getByLabelText("Body") as HTMLTextAreaElement;
    assert.equal(titleInput.value, "GiTO original transfer story");
    assert.equal(summaryInput.value, "GiTO summary from verified facts.");
    assert.equal(bodyInput.value, "GiTO body from verified facts.");
    assert.ok(view.getByText("GiTO AI-ASSISTED"));
    assert.ok(view.getByText("REVIEW REQUIRED"));
    assert.ok(view.getByText("FACT-CHECK REQUIRED"));
    assert.ok(view.getByRole("button", { name: "Original source" }));
    assert.equal(generationRequests[0]?.body.researchResult.query, "Club wins decisive match");
    fireEvent.click(view.getByRole("button", { name: "Incoming News" }));
    const incomingAgain = within((await view.findByRole("heading", { name: "Incoming News" })).closest("section") as HTMLElement);
    fireEvent.change(incomingAgain.getByPlaceholderText("Search titles"), { target: { value: "Club" } });
    fireEvent.click(incomingAgain.getByRole("button", { name: "Select visible" }));
    assert.equal(incomingAgain.getByText("1 article selected").textContent, "1 article selected");
    assert.ok(incomingAgain.getByText("Club wins decisive match"));
    assert.equal(incomingAgain.queryByText("Another incoming story"), null);
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
    dom.window.close();
  }
});

test("rendered News RSS sources supports add, fetch, publisher URL, and delete", async () => {
  const dom = initializeDom();
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  const { fetchMock, rssRequests } = buildFetchMock([]);
  const originalFetch = globalThis.fetch;
  const originalConfirm = window.confirm;
  globalThis.fetch = fetchMock as typeof fetch;
  window.confirm = () => true;

  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    await waitFor(() => assert.ok(view.getByText("News data loaded.")));
    fireEvent.click(view.getByRole("button", { name: "RSS Sources" }));
    fireEvent.change(view.getByPlaceholderText("https://example.com/feed.xml"), { target: { value: "https://example.com/feed.xml" } });
    fireEvent.change(view.getByPlaceholderText("BBC Sport"), { target: { value: "Example Sport" } });
    fireEvent.submit(view.getByRole("button", { name: "Add source" }).closest("form") as HTMLFormElement);
    await waitFor(() => assert.equal(rssRequests.length, 1));
    await view.findByText("Example Sport");
    assert.ok(view.getByDisplayValue("http://localhost/news/rss.xml"));
    fireEvent.click(view.getByRole("button", { name: "Fetch now" }));
    await waitFor(() => assert.ok(view.getByText(/12 items found · 4 new · 8 already imported/)));
    fireEvent.click(view.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => assert.ok(view.getByText("No RSS sources configured.")));
  } finally {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
    cleanup();
    dom.window.close();
  }
});

test("rendered Web Page RSS workflow supports deferred generate, preview, refresh, copy, and delete", async () => {
  const dom = initializeDom();
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  const { fetchMock, resolveGeneratedFeed } = buildFetchMock([]);
  const originalFetch = globalThis.fetch;
  const originalConfirm = window.confirm;
  let copiedText = "";
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (value: string) => { copiedText = value; } }, configurable: true });
  globalThis.fetch = fetchMock as typeof fetch;
  window.confirm = () => true;
  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    await waitFor(() => assert.ok(view.getByText("News data loaded.")));
    fireEvent.click(view.getByRole("button", { name: "Web Page → RSS" }));
    fireEvent.change(view.getByPlaceholderText("https://example.com/sports"), { target: { value: "https://example.com/sports" } });
    fireEvent.change(view.getByPlaceholderText("My Sports Feed"), { target: { value: "Example Sports Feed" } });
    fireEvent.submit(view.getByRole("button", { name: "Generate RSS Feed" }).closest("form") as HTMLFormElement);
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Analyzing webpage…" })));
    resolveGeneratedFeed();
    await waitFor(() => assert.ok(view.getByText("Example Sports Feed")));
    assert.ok(view.getByText("Articles discovered: 2"));
    assert.ok(view.getByText(/generated-rss\/abc123\.xml/));
    fireEvent.click(view.getByRole("button", { name: "Copy RSS URL" }));
    await waitFor(() => assert.match(copiedText, /generated-rss\/abc123\.xml/));
    fireEvent.click(view.getByRole("button", { name: "Preview articles" }));
    await waitFor(() => assert.ok(view.getByText("Discovered story")));
    fireEvent.click(view.getByRole("button", { name: "Refresh feed" }));
    await waitFor(() => assert.ok(view.getByText(/Feed refreshed successfully\./)));
    fireEvent.click(view.getByRole("button", { name: "Delete feed" }));
    await waitFor(() => assert.ok(view.getByText("No generated webpage feeds yet.")));
  } finally {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
    cleanup();
    dom.window.close();
  }
});

test("rendered Web Page RSS shows the safe anti-bot failure reason", async () => {
  const dom = initializeDom();
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  const { fetchMock, setGeneratedFeedError } = buildFetchMock([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  setGeneratedFeedError("This website blocks automated access. GiTO cannot create a feed from this page.");
  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    await waitFor(() => assert.ok(view.getByText("News data loaded.")));
    fireEvent.click(view.getByRole("button", { name: "Web Page → RSS" }));
    fireEvent.change(view.getByPlaceholderText("https://example.com/sports"), { target: { value: "https://tribuna.com/en/clubs/bayern-munchen/" } });
    fireEvent.change(view.getByPlaceholderText("My Sports Feed"), { target: { value: "Tribuna Bayern" } });
    fireEvent.submit(view.getByRole("button", { name: "Generate RSS Feed" }).closest("form") as HTMLFormElement);
    await waitFor(() => assert.ok(view.getByText("This website blocks automated access. GiTO cannot create a feed from this page.")));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
    dom.window.close();
  }
});

test("rendered Web Page RSS shows the browser-rendered crawler tier", async () => {
  const dom = initializeDom();
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  const { fetchMock, resolveGeneratedFeed } = buildFetchMock([], "browser");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    await waitFor(() => assert.ok(view.getByText("News data loaded.")));
    fireEvent.click(view.getByRole("button", { name: "Web Page → RSS" }));
    fireEvent.change(view.getByPlaceholderText("https://example.com/sports"), { target: { value: "https://example.com/javascript-page" } });
    fireEvent.change(view.getByPlaceholderText("My Sports Feed"), { target: { value: "Rendered Feed" } });
    fireEvent.submit(view.getByRole("button", { name: "Generate RSS Feed" }).closest("form") as HTMLFormElement);
    await waitFor(() => assert.ok(view.getByRole("button", { name: "Analyzing webpage…" })));
    resolveGeneratedFeed();
    await waitFor(() => assert.ok(view.getByText("Crawler method: Browser-rendered")));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
    dom.window.close();
  }
});

