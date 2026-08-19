import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { NewsWorkspaceScreen } from "./NewsWorkspaceScreen";

function initializeDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const win = dom.window as unknown as Window;
  const globalAny = globalThis as any;

  Object.defineProperty(globalAny, "window", { value: win, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(globalAny, "document", { value: win.document, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(globalAny, "navigator", { value: win.navigator, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(globalAny, "requestAnimationFrame", {
    value: typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame.bind(win) : (callback: FrameRequestCallback) => setTimeout(callback, 0),
    writable: true,
    configurable: true,
    enumerable: true
  });
  Object.defineProperty(globalAny, "cancelAnimationFrame", {
    value: typeof win.cancelAnimationFrame === "function" ? win.cancelAnimationFrame.bind(win) : (handle: number) => clearTimeout(handle),
    writable: true,
    configurable: true,
    enumerable: true
  });

  return dom;
}

function buildFetchMock() {
  const articles: any[] = [
    { id: "a1", title: "Club wins decisive match", summary: "The club confirmed a transfer.", body: "The club confirmed the player's transfer.", status: "draft", source: { id: "source-a", name: "Official club" }, sourceName: "Official club", sourceUrl: "https://club.example/statement", tags: [], createdAt: "2026-08-18" },
    { id: "a2", title: "Another incoming story", status: "draft", source: { id: "source-b", name: "Source Beta" }, tags: [], createdAt: "2026-08-17" }
  ];
  const researchRequests: string[] = [];
  const generationRequests: Array<{ articleId: string; body: any }> = [];
  const sources = [
    { id: "source-a", name: "Source Alpha", sourceType: "external", enabled: true, feedUrl: null },
    { id: "source-b", name: "Source Beta", sourceType: "external", enabled: true, feedUrl: null }
  ];
  const createJsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchMock = async (input: RequestInfo, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.url, "http://localhost");
    const pathname = url.pathname;
    const method = (init?.method ?? "GET").toString().toUpperCase();
    if (pathname === "/news/articles" && method === "GET") return createJsonResponse(articles);
    if (pathname === "/news/sources" && method === "GET") return createJsonResponse(sources);
    if (pathname === "/news/articles/a1/research" && method === "GET") return createJsonResponse({ error: "research_result_not_found" }, 404);
    if (pathname === "/news/articles/a1/research" && method === "POST") {
      researchRequests.push("a1");
      return createJsonResponse({
        query: "Club wins decisive match",
        researchedAt: "2026-08-18T12:00:00.000Z",
        sources: [{ id: "rs1", url: "https://club.example/statement", domain: "club.example", title: "Club statement", publisher: "Official club", sourceType: "official_organization", retrievedAt: "2026-08-18T12:00:00.000Z", relevance: 1, authorityLevel: 5, extractedFacts: [], evidenceSnippets: ["The club confirmed the transfer."], isPrimarySource: true }],
        verifiedFacts: [{ id: "f1", statement: "Club confirmed the player's transfer.", importance: "high", sources: ["club.example"], agreement: 1, confidence: "high", status: "verified" }],
        disputedFacts: [{ id: "f2", statement: "Transfer fee differs between reports.", importance: "medium", sources: ["club.example", "bbc.example"], agreement: 0.5, confidence: "low", status: "conflicting" }],
        unsupportedClaims: ["The fee requires confirmation before publication."],
        keyEvents: ["Transfer confirmed"], people: ["Player One"], organizations: ["Official club"], statistics: [], timeline: [], confidence: "high", researchStatus: "completed", summary: "The central transfer claim is supported by official evidence.", conflicts: []
      });
    }
    if (pathname === "/news/articles/a1/generate-original" && method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      generationRequests.push({ articleId: "a1", body: JSON.parse(bodyText) });
      const generatedArticle = { id: "g1", title: "GiTO original transfer story", summary: "GiTO summary from verified facts.", body: "GiTO body from verified facts.", status: "review", contentOrigin: "gito_ai", author: "GiTO News", tags: ["gito-generated", "gito-review-required", "gito-fact-check-needed"], sourceName: "Official club", sourceUrl: "https://club.example/statement", createdAt: "2026-08-18", updatedAt: "2026-08-18" };
      articles.push(generatedArticle);
      return createJsonResponse(generatedArticle);
    }
    if (pathname === "/sports" && method === "GET") return createJsonResponse([]);
    if (pathname === "/countries" && method === "GET") return createJsonResponse([]);
    if (pathname === "/competitions" && method === "GET") return createJsonResponse([]);
    if (pathname === "/teams" && method === "GET") return createJsonResponse([]);
    if (pathname === "/matches" && method === "GET") return createJsonResponse([]);
    return createJsonResponse({ error: "unmatched_news_isolation_request", pathname, method }, 500);
  };
  return { fetchMock, researchRequests, generationRequests };
}

test("isolated rendered News research workflow", async () => {
  const { cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
  const dom = initializeDom();
  console.log("[NEWS-ISO] STEP 01 DOM");
  const { fetchMock, researchRequests, generationRequests } = buildFetchMock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  console.log("[NEWS-ISO] STEP 02 FETCH");

  try {
    const view = render(<NewsWorkspaceScreen accessToken="dummy-token" />);
    console.log("[NEWS-ISO] STEP 03 RENDER");
    fireEvent.click(view.getByRole("button", { name: "Incoming News" }));
    const incomingSection = await view.findByRole("heading", { name: "Incoming News" });
    console.log("[NEWS-ISO] STEP 04 INCOMING");
    const incoming = within(incomingSection.closest("section") as HTMLElement);
    await incoming.findByText("Club wins decisive match", { selector: "strong" });
    console.log("[NEWS-ISO] STEP 05 ARTICLE");
    fireEvent.click(incoming.getByText("Club wins decisive match", { selector: "strong" }));
    console.log("[NEWS-ISO] STEP 06 SELECTED");
    await waitFor(() => assert.ok(incoming.getByRole("button", { name: "Research this story" })));
    console.log("[NEWS-ISO] STEP 07 RESEARCH BUTTON");
    fireEvent.click(incoming.getByRole("button", { name: "Research this story" }));
    console.log("[NEWS-ISO] STEP 08 RESEARCH CLICK");
    await waitFor(() => assert.equal(researchRequests.length, 1));
    await incoming.findByText("Research complete");
    console.log("[NEWS-ISO] STEP 09 RESEARCH RESULT");
    fireEvent.click(incoming.getByRole("button", { name: "View research" }));
    console.log("[NEWS-ISO] STEP 10 VIEW RESEARCH");
    assert.ok(incoming.getByText("Club confirmed the player's transfer."));
    assert.ok(incoming.getByText("Transfer fee differs between reports."));
    assert.ok(incoming.getByText("https://club.example/statement"));
    fireEvent.click(incoming.getByRole("button", { name: "Generate GiTO Original Story" }));
    console.log("[NEWS-ISO] STEP 11 GENERATE CLICK");
    await waitFor(() => assert.equal(generationRequests.length, 1));
    const titleInput = await view.findByLabelText("Title") as HTMLInputElement;
    const bodyInput = view.getByLabelText("Body") as HTMLTextAreaElement;
    console.log("[NEWS-ISO] STEP 12 GENERATED");
    assert.equal(titleInput.value, "GiTO original transfer story");
    assert.equal(bodyInput.value, "GiTO body from verified facts.");
    assert.ok(view.getByText("GiTO AI-ASSISTED"));
    assert.ok(view.getByText("REVIEW REQUIRED"));
    assert.ok(view.getByText("FACT-CHECK REQUIRED"));
    console.log("[NEWS-ISO] STEP 13 ASSERTIONS");
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
    dom.window.close();
  }
});
