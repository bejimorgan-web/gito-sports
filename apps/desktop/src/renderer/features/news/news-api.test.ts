import test from "node:test";
import assert from "node:assert/strict";
import * as newsApi from "./news-api";

test("bulkDeleteNewsArticles sends a POST request with JSON ids payload", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? undefined;
    return new Response(JSON.stringify({ deletedCount: 2 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await newsApi.bulkDeleteNewsArticles(["article-1", "article-2"], "dummy-token");

    assert.deepEqual(result, { deletedCount: 2 });
    assert.ok(capturedUrl.endsWith("/news/articles/bulk-delete"), `unexpected URL: ${capturedUrl}`);
    const init = capturedInit as RequestInit | null;
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer dummy-token");
    assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
    assert.equal(init?.body, JSON.stringify({ ids: ["article-1", "article-2"] }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("researchNewsArticle sends an authenticated POST request", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? undefined;
    return new Response(JSON.stringify({ query: "story", sources: [], verifiedFacts: [], disputedFacts: [], unsupportedClaims: [], confidence: "low", researchStatus: "insufficient_evidence", keyEvents: [], people: [], organizations: [], statistics: [], timeline: [], summary: "", conflicts: [], researchedAt: "2026-08-18" }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await newsApi.researchNewsArticle("article-1", "dummy-token");
    assert.ok(capturedUrl.endsWith("/news/articles/article-1/research"));
    assert.equal(capturedInit?.method, "POST");
    assert.equal((capturedInit?.headers as Record<string, string>)?.authorization, "Bearer dummy-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateGiTOOriginalStory sends an authenticated POST with research evidence", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const researchResult = { query: "story", sources: [], verifiedFacts: [], disputedFacts: [], unsupportedClaims: [], confidence: "high", researchStatus: "completed", keyEvents: [], people: [], organizations: [], statistics: [], timeline: [], summary: "", conflicts: [], researchedAt: "2026-08-18" } as any;
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? undefined;
    return new Response(JSON.stringify({ id: "draft-1", title: "Draft", status: "review" }), { status: 201, headers: { "content-type": "application/json" } });
  };

  try {
    await newsApi.generateGiTOOriginalStory("article-1", researchResult, "dummy-token");
    assert.ok(capturedUrl.endsWith("/news/articles/article-1/generate-original"));
    assert.equal(capturedInit?.method, "POST");
    assert.equal((capturedInit?.headers as Record<string, string>)?.authorization, "Bearer dummy-token");
    assert.equal(capturedInit?.body, JSON.stringify({ researchResult }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
