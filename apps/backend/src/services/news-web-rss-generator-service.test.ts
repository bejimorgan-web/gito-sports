import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getWebRssUserMessage, NewsWebRssGeneratorService } from "./news-web-rss-generator-service.js";
import type { NewsBrowserRenderer } from "./news-browser-renderer.js";

function createService(browserRenderer: NewsBrowserRenderer = { render: async () => { throw new Error("no_articles_discovered"); } }) {
  return new NewsWebRssGeneratorService(new Database(":memory:"), { browserRenderer });
}

test("article URL creates a stable feed with extracted metadata", async () => {
  const service = createService();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<!doctype html><html><head><title>Match report</title><link rel="canonical" href="https://example.com/articles/1"/><meta property="og:description" content="A short &amp; useful summary."/><meta property="og:site_name" content="Example Sports"/><meta property="article:published_time" content="2026-08-19T10:00:00Z"/></head><body><main><h1>Match report</h1></main></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  try {
    const feed = service.createFeed("Example Feed", "https://example.com/articles/1");
    const refreshed = await service.refreshFeed(feed.id);
    assert.equal(refreshed.status, "ready");
    assert.equal(refreshed.discoveredArticleCount, 1);
    const [article] = service.listArticles(feed.id);
    assert.ok(article);
    assert.equal(article.title, "Match report");
    assert.equal(article.summary, "A short & useful summary.");
    assert.equal(article.canonicalUrl, "https://example.com/articles/1");
    assert.equal(article.sourceName, "Example Sports");
    assert.equal(article.publishedAt, "2026-08-19T10:00:00.000Z");
    const xml = service.buildXml(feed.feedToken, "https://gito.example");
    assert.match(xml, /Source: Example Sports/);
    assert.match(xml, /A short &amp; useful summary/);
    assert.doesNotMatch(xml, /<main>|<h1>|full article body/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("section page discovers relative article links, removes duplicates, and refresh preserves entries", async () => {
  const service = createService();
  const originalFetch = globalThis.fetch;
  const pages: Record<string, string> = {
    "https://example.com/sports": `<html><head><title>Sports</title></head><body><nav><a href="/login">Login</a></nav><main><a href="/sports/article-1">First story</a><a href="/sports/article-1?utm_source=x">Duplicate story</a><a href="/sports/article-2">Second story</a></main></body></html>`,
    "https://example.com/sports/article-1": `<html><head><meta property="og:title" content="First story"/><meta name="description" content="First summary"/></head><body><h1>First story</h1></body></html>`,
    "https://example.com/sports/article-2": `<html><head><meta property="og:title" content="Second story"/></head><body><h1>Second story</h1></body></html>`,
    "https://example.com/sports/article-3": `<html><head><meta property="og:title" content="Third story"/></head><body><h1>Third story</h1></body></html>`
  };
  globalThis.fetch = async (input) => new Response(pages[String(input)] ?? "<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const feed = service.createFeed("Sports", "https://example.com/sports");
    await service.refreshFeed(feed.id);
    assert.equal(service.listArticles(feed.id).length, 2);
    pages["https://example.com/sports"] = `<main><a href="/sports/article-1">First story</a><a href="/sports/article-2">Second story</a><a href="/sports/article-3">Third story</a></main>`;
    await service.refreshFeed(feed.id);
    assert.equal(service.listArticles(feed.id).length, 3);
    assert.equal(service.getFeed(feed.id)?.discoveredArticleCount, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid protocols and private destinations are rejected before crawling", () => {
  const service = createService();
  assert.throws(() => service.createFeed("Bad", "file:///tmp/page"), /scheme_not_allowed/);
  assert.throws(() => service.createFeed("Bad", "http://localhost/page"), /private_network/);
  assert.throws(() => service.createFeed("Bad", "http://192.168.1.2/page"), /private_network/);
});

test("non-HTML response and no-article result are controlled failures", async () => {
  const service = createService();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not html", { status: 200, headers: { "content-type": "application/json" } });
  try {
    const feed = service.createFeed("Bad page", "https://example.com/page");
    await assert.rejects(() => service.refreshFeed(feed.id), /content_type_not_supported/);
    assert.equal(service.getFeed(feed.id)?.status, "failed");
  } finally { globalThis.fetch = originalFetch; }
});

test("HTML with no article candidates reports no articles discovered", async () => {
  const service = createService();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body><nav><a href='/login'>Login</a></nav><p>Welcome</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const feed = service.createFeed("Empty page", "https://example.com/");
    await assert.rejects(() => service.refreshFeed(feed.id), /no_articles_discovered/);
  } finally { globalThis.fetch = originalFetch; }
});

test("oversized responses and redirects to private addresses are rejected", async () => {
  const service = createService();
  const originalFetch = globalThis.fetch;
  let mode: "large" | "redirect" = "large";
  globalThis.fetch = async () => {
    if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } });
    return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const large = service.createFeed("Large", "https://example.com/large");
    await assert.rejects(() => service.refreshFeed(large.id), /response_too_large/);
    mode = "redirect";
    const redirect = service.createFeed("Redirect", "https://example.com/redirect");
    await assert.rejects(() => service.refreshFeed(redirect.id), /private_network/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Cloudflare 403 failures receive a safe browser-rendering limitation message", () => {
  assert.equal(
    getWebRssUserMessage(new Error("rss_fetch_failed_403")),
    "This website blocks automated access. GiTO cannot create a feed from this page."
  );
});

test("insufficient HTTP discovery falls back to a mocked browser renderer", async () => {
  let renderCalls = 0;
  const service = createService({
    render: async () => {
      renderCalls += 1;
      return { html: `<html><head><title>Rendered section</title></head><body><a href="https://example.com/rendered-story">Rendered story with enough text to be an article</a></body></html>`, finalUrl: "https://example.com/section", contentType: "text/html" };
    }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body><div id='app'></div></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const feed = service.createFeed("Rendered", "https://example.com/section");
    const result = await service.refreshFeed(feed.id);
    assert.ok(renderCalls >= 1);
    assert.equal(result.crawlerTier, "browser");
    assert.equal(result.status, "ready");
  } finally { globalThis.fetch = originalFetch; await service.close(); }
});

test("browser challenge is classified as automated access blocked and renderer closes", async () => {
  let closed = false;
  const service = createService({
    render: async () => { throw new Error("automated_access_blocked"); },
    close: async () => { closed = true; }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><body><div id='app'></div></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  try {
    const feed = service.createFeed("Blocked", "https://example.com/section");
    await assert.rejects(() => service.refreshFeed(feed.id), /automated_access_blocked/);
    assert.equal(service.getFeed(feed.id)?.failureClassification, "automated_access_blocked");
  } finally { globalThis.fetch = originalFetch; await service.close(); assert.equal(closed, true); }
});

test("generated feed tokens are trusted only for the configured backend origin and persisted feed", () => {
  const service = createService();
  const feed = service.createFeed("Trusted", "https://example.com/news");

  assert.equal(service.getTrustedFeedToken(`http://localhost:4100${feed.feedUrl}`, "http://localhost:4100"), feed.feedToken);
  assert.equal(service.getTrustedFeedToken(`https://gito-sports.onrender.com${feed.feedUrl}`, "https://gito-sports.onrender.com"), feed.feedToken);
  assert.equal(service.getTrustedFeedToken("http://localhost:3000/news/generated-rss/" + feed.feedToken + ".xml", "http://localhost:4100"), null);
  assert.equal(service.getTrustedFeedToken("http://127.0.0.1:4100/news/generated-rss/" + feed.feedToken + ".xml", "http://localhost:4100"), null);
  assert.equal(service.getTrustedFeedToken("http://localhost:4100/news/generated-rss/nonexistent.xml", "http://localhost:4100"), null);
});