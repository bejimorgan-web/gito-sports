import test from "node:test";
import assert from "node:assert/strict";
import * as newsApi from "./news-api";
test("bulkDeleteNewsArticles sends a POST request with JSON ids payload", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedInit;
    globalThis.fetch = async (url, init) => {
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
        const init = capturedInit;
        assert.equal(init?.method, "POST");
        assert.equal(init?.headers?.authorization, "Bearer dummy-token");
        assert.equal((init?.headers)["content-type"], "application/json");
        assert.equal(init?.body, JSON.stringify({ ids: ["article-1", "article-2"] }));
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test("researchNewsArticle sends an authenticated POST request", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedInit;
    globalThis.fetch = async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init ?? undefined;
        return new Response(JSON.stringify({ query: "story", sources: [], verifiedFacts: [], disputedFacts: [], unsupportedClaims: [], confidence: "low", researchStatus: "insufficient_evidence", keyEvents: [], people: [], organizations: [], statistics: [], timeline: [], summary: "", conflicts: [], researchedAt: "2026-08-18" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
        await newsApi.researchNewsArticle("article-1", "dummy-token");
        assert.ok(capturedUrl.endsWith("/news/articles/article-1/research"));
        assert.equal(capturedInit?.method, "POST");
        assert.equal(capturedInit?.headers?.authorization, "Bearer dummy-token");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test("generateGiTOOriginalStory sends an authenticated POST with research evidence", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedInit;
    const researchResult = { query: "story", sources: [], verifiedFacts: [], disputedFacts: [], unsupportedClaims: [], confidence: "high", researchStatus: "completed", keyEvents: [], people: [], organizations: [], statistics: [], timeline: [], summary: "", conflicts: [], researchedAt: "2026-08-18" };
    globalThis.fetch = async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init ?? undefined;
        return new Response(JSON.stringify({ id: "draft-1", title: "Draft", status: "review" }), { status: 201, headers: { "content-type": "application/json" } });
    };
    try {
        await newsApi.generateGiTOOriginalStory("article-1", researchResult, "dummy-token");
        assert.ok(capturedUrl.endsWith("/news/articles/article-1/generate-original"));
        assert.equal(capturedInit?.method, "POST");
        assert.equal(capturedInit?.headers?.authorization, "Bearer dummy-token");
        assert.equal(capturedInit?.body, JSON.stringify({ researchResult }));
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
