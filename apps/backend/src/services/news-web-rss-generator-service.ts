import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { fetchPublicTextDocument, escapeXml, validateRssUrl } from "./news-rss-service.js";
import { normalizeNewsText } from "./news-content-normalizer.js";
import { createNewsBrowserRenderer, type BrowserRenderResult, type NewsBrowserRenderer } from "./news-browser-renderer.js";

const MAX_DISCOVERED_ARTICLES = 25;

export type GeneratedRssArticle = {
  id: string;
  externalId?: string;
  canonicalUrl: string;
  title: string;
  summary: string | null;
  articleUrl: string;
  publishedAt: string | null;
  discoveredAt: string;
  sourceName: string;
  sourceUrl: string;
  status: "discovered";
};

export type GeneratedRssFeed = {
  id: string;
  name: string;
  sourceUrl: string;
  feedToken: string;
  createdAt: string;
  updatedAt: string;
  lastFetchedAt: string | null;
  status: string;
  discoveredArticleCount: number;
  errorMessage: string | null;
  enabled: boolean;
  crawlerTier: "http" | "browser" | null;
  failureClassification: string | null;
  feedUrl?: string;
  articles?: GeneratedRssArticle[];
};

type DiscoveredArticle = Omit<GeneratedRssArticle, "id" | "discoveredAt" | "status">;

export function getWebRssUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "rss_fetch_failed_403") {
    return "This website blocks automated access. GiTO cannot create a feed from this page.";
  }
  if (message === "automated_access_blocked") return "This website blocks automated access. GiTO cannot create a feed from this page.";
  if (message === "browser_rendering_unavailable" || message === "browser_rendering_disabled_in_test_mode") return "This page needs browser rendering, which is not available in the current environment.";
  if (message === "browser_navigation_timeout") return "The browser-rendered page took too long to respond.";
  if (message === "browser_response_too_large") return "The browser-rendered page is too large for GiTO to analyze.";
  if (message === "rss_content_type_not_supported" || message === "webpage_content_type_not_supported") {
    return "This URL did not return an HTML webpage.";
  }
  if (message === "rss_response_too_large") {
    return "This webpage is too large for GiTO to analyze.";
  }
  if (message === "rss_url_private_network_not_allowed") {
    return "This URL points to a protected or internal address and cannot be crawled.";
  }
  if (message === "rss_url_scheme_not_allowed" || message === "rss_url_invalid") {
    return "Enter a valid public HTTP or HTTPS webpage URL.";
  }
  if (message === "no_articles_discovered") {
    return "No articles were found on this page.";
  }
  if (message === "rss_redirect_limit_exceeded") {
    return "GiTO could not follow this webpage's redirects safely.";
  }
  if (/abort|timeout/i.test(message)) {
    return "The webpage took too long to respond.";
  }
  return "GiTO could not access this webpage.";
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ");
}

function tagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i"));
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function canonicalUrl(html: string, pageUrl: string): string {
  const href = html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? metaContent(html, "og:url");
  try {
    return new URL(href ?? pageUrl, pageUrl).toString();
  } catch {
    return pageUrl;
  }
}

function publishedDate(html: string): string | null {
  const value = metaContent(html, "article:published_time") ?? metaContent(html, "datePublished") ?? tagText(html, "time");
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function sourceName(html: string, pageUrl: string): string {
  return normalizeNewsText(metaContent(html, "og:site_name") ?? metaContent(html, "application-name") ?? new URL(pageUrl).hostname) || new URL(pageUrl).hostname;
}

function cleanSummary(value: string | null): string | null {
  const text = normalizeNewsText(value);
  if (!text) return null;
  return text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 500);
}

function extractJsonLd(html: string): { title?: string; summary?: string; publishedAt?: string } {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1] ?? "{}");
      const values = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.itemListElement ?? [])];
      const article = values.find((value) => /article|newsarticle|blogposting/i.test(String(value?.["@type"] ?? "")));
      if (article) return { title: article.headline, summary: article.description, publishedAt: article.datePublished };
    } catch {
      continue;
    }
  }
  return {};
}

function normalizeUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

function likelyArticleUrl(url: string, anchorText: string, pageUrl: string): boolean {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (parsed.origin !== new URL(pageUrl).origin) return false;
  if (/\/(login|account|search|tag|category|author|privacy|terms|contact|about)(\/|$)/i.test(path)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|pdf)$/i.test(path)) return false;
  return /\/(article|story|news|sport|sports|202[0-9]|[a-z0-9-]+-[a-z0-9-]+)(\/|$)/i.test(path) || anchorText.trim().length > 25;
}

function extractLinks(html: string, pageUrl: string): string[] {
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(decodeHtml(match[2] ?? ""), pageUrl);
    const text = normalizeNewsText(match[3] ?? "");
    if (url && url !== pageUrl && likelyArticleUrl(url, text, pageUrl)) seen.add(url);
  }
  return Array.from(seen).slice(0, MAX_DISCOVERED_ARTICLES);
}

async function extractArticle(pageUrl: string, html: string): Promise<DiscoveredArticle> {
  const jsonLd = extractJsonLd(html);
  const title = normalizeNewsText(jsonLd.title ?? metaContent(html, "og:title") ?? tagText(html, "h1") ?? tagText(html, "title") ?? pageUrl) || pageUrl;
  const summary = cleanSummary(jsonLd.summary ?? metaContent(html, "og:description") ?? metaContent(html, "description") ?? tagText(html, "article") ?? tagText(html, "main"));
  return { canonicalUrl: canonicalUrl(html, pageUrl), title, summary, articleUrl: pageUrl, publishedAt: jsonLd.publishedAt ? (Date.parse(jsonLd.publishedAt) ? new Date(jsonLd.publishedAt).toISOString() : null) : publishedDate(html), sourceName: sourceName(html, pageUrl), sourceUrl: pageUrl };
}

export function isLikelyArticlePage(html: string, pageUrl: string): boolean {
  return Boolean(metaContent(html, "og:type")?.toLowerCase() === "article" || extractJsonLd(html).title || tagText(html, "article") || tagText(html, "h1")) && !extractLinks(html, pageUrl).length;
}

export class NewsWebRssGeneratorService {
  private readonly browserRenderer: NewsBrowserRenderer;

  constructor(private readonly db: Database = getDatabase(), options?: { browserRenderer?: NewsBrowserRenderer }) {
    this.browserRenderer = options?.browserRenderer ?? createNewsBrowserRenderer();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS news_generated_rss_sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, source_url TEXT NOT NULL, feed_token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_fetched_at TEXT, status TEXT NOT NULL DEFAULT 'created',
        discovered_article_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, enabled INTEGER NOT NULL DEFAULT 1,
        crawler_tier TEXT NOT NULL DEFAULT 'http', failure_classification TEXT
      );
      CREATE TABLE IF NOT EXISTS news_generated_rss_articles (
        id TEXT PRIMARY KEY, generated_feed_id TEXT NOT NULL, external_id TEXT NOT NULL, canonical_url TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT, article_url TEXT NOT NULL, published_at TEXT, discovered_at TEXT NOT NULL,
        content_hash TEXT NOT NULL, source_name TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered',
        FOREIGN KEY (generated_feed_id) REFERENCES news_generated_rss_sources(id) ON DELETE CASCADE,
        UNIQUE(generated_feed_id, external_id)
      );
    `);
  }

  createFeed(name: string, sourceUrl: string): GeneratedRssFeed {
    const url = validateRssUrl(sourceUrl).toString();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(18).toString("base64url");
    this.db.prepare(`INSERT INTO news_generated_rss_sources (id, name, source_url, feed_token, created_at, updated_at, status, discovered_article_count, enabled) VALUES (?, ?, ?, ?, ?, ?, 'created', 0, 1)`).run(id, name.trim(), url, token, now, now);
    return this.getFeed(id)!;
  }

  listFeeds(): GeneratedRssFeed[] { return (this.db.prepare("SELECT * FROM news_generated_rss_sources ORDER BY created_at DESC").all() as any[]).map((row) => this.toFeed(row)); }
  getFeed(id: string): GeneratedRssFeed | null { const row = this.db.prepare("SELECT * FROM news_generated_rss_sources WHERE id = ?").get(id) as any; return row ? this.toFeed(row) : null; }
  getFeedByToken(token: string): GeneratedRssFeed | null { const row = this.db.prepare("SELECT * FROM news_generated_rss_sources WHERE feed_token = ? AND enabled = 1").get(token) as any; return row ? this.toFeed(row) : null; }
  getTrustedFeedToken(value: string, backendOrigin: string): string | null {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.origin !== backendOrigin.replace(/\/$/, "") || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/news\/generated-rss\/([^/]+)\.xml$/);
    if (!match?.[1] || !this.getFeedByToken(decodeURIComponent(match[1]))) return null;
    return decodeURIComponent(match[1]);
  }
  listArticles(feedId: string): GeneratedRssArticle[] { return (this.db.prepare("SELECT * FROM news_generated_rss_articles WHERE generated_feed_id = ? ORDER BY published_at DESC, discovered_at DESC").all(feedId) as any[]).map((row) => this.toArticle(row)); }
  deleteFeed(id: string): boolean { return this.db.prepare("DELETE FROM news_generated_rss_sources WHERE id = ?").run(id).changes > 0; }

  async close(): Promise<void> {
    const renderer = this.browserRenderer as { close?: () => Promise<void> };
    await renderer.close?.();
  }

  async refreshFeed(id: string): Promise<GeneratedRssFeed> {
    const feed = this.getFeed(id);
    if (!feed) throw new Error("generated_rss_feed_not_found");
    try {
      const page = await fetchPublicTextDocument(feed.sourceUrl);
      if (!page.contentType || !/(html|xhtml|text\/plain)/i.test(page.contentType)) throw new Error("webpage_content_type_not_supported");
      const rootUrl = validateRssUrl(feed.sourceUrl).toString();
      let crawlTier: "http" | "browser" = "http";
      let crawlPage: { text: string; contentType: string; finalUrl: string } = { text: page.text, contentType: page.contentType, finalUrl: rootUrl };
      let links = extractLinks(crawlPage.text, rootUrl);
      let candidates = isLikelyArticlePage(crawlPage.text, rootUrl) ? [rootUrl] : links;
      if (!candidates.length) {
        let browserPage: BrowserRenderResult;
        try {
          browserPage = await this.browserRenderer.render(rootUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : "browser_rendering_unavailable";
          throw new Error(message === "browser_rendering_disabled_in_test_mode" ? "browser_rendering_unavailable" : message);
        }
        crawlTier = "browser";
        crawlPage = { text: browserPage.html, contentType: browserPage.contentType, finalUrl: browserPage.finalUrl };
        links = extractLinks(crawlPage.text, crawlPage.finalUrl);
        candidates = isLikelyArticlePage(crawlPage.text, crawlPage.finalUrl) ? [crawlPage.finalUrl] : links;
        if (!candidates.length) throw new Error("no_articles_discovered");
      }
      let failed = 0;
      for (const candidate of candidates) {
        try {
          const articlePage = candidate === rootUrl || candidate === crawlPage.finalUrl
            ? crawlPage.text
            : (crawlTier === "browser" ? (await this.browserRenderer.render(candidate)).html : (await fetchPublicTextDocument(candidate)).text);
          const article = await extractArticle(candidate, articlePage);
          article.sourceUrl = feed.sourceUrl;
          const externalId = crypto.createHash("sha256").update(article.canonicalUrl).digest("hex");
          const existing = this.db.prepare("SELECT id FROM news_generated_rss_articles WHERE generated_feed_id = ? AND external_id = ?").get(id, externalId) as { id: string } | undefined;
          const now = new Date().toISOString();
          if (existing) {
            this.db.prepare("UPDATE news_generated_rss_articles SET title = ?, summary = ?, article_url = ?, published_at = ?, source_name = ?, source_url = ?, content_hash = ?, discovered_at = ? WHERE id = ?").run(article.title, article.summary, article.articleUrl, article.publishedAt, article.sourceName, article.sourceUrl, crypto.createHash("sha256").update(`${article.title}|${article.summary ?? ""}`).digest("hex"), now, existing.id);
          } else {
            this.db.prepare("INSERT INTO news_generated_rss_articles (id, generated_feed_id, external_id, canonical_url, title, summary, article_url, published_at, discovered_at, content_hash, source_name, source_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered')").run(crypto.randomUUID(), id, externalId, article.canonicalUrl, article.title, article.summary, article.articleUrl, article.publishedAt, now, crypto.createHash("sha256").update(`${article.title}|${article.summary ?? ""}`).digest("hex"), article.sourceName, article.sourceUrl);
          }
        } catch { failed += 1; }
      }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE news_generated_rss_sources SET updated_at = ?, last_fetched_at = ?, status = ?, discovered_article_count = (SELECT COUNT(*) FROM news_generated_rss_articles WHERE generated_feed_id = ?), error_message = NULL, crawler_tier = ?, failure_classification = NULL WHERE id = ?").run(now, now, failed ? "partial" : "ready", id, crawlTier, id);
      return this.getFeed(id)!;
    } catch (error) {
      const message = error instanceof Error ? error.message : "webpage_crawl_failed";
      const classification = message === "automated_access_blocked" || message === "rss_fetch_failed_403" ? "automated_access_blocked" : message === "browser_rendering_unavailable" ? "browser_render_required" : message === "no_articles_discovered" ? "unsupported_content" : "fetch_failed";
      this.db.prepare("UPDATE news_generated_rss_sources SET updated_at = ?, last_fetched_at = ?, status = 'failed', error_message = ?, failure_classification = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), message, classification, id);
      throw error;
    }
  }

  buildXml(token: string, baseUrl: string): string {
    const feed = this.getFeedByToken(token);
    if (!feed) throw new Error("generated_rss_feed_not_found");
    const articles = this.listArticles(feed.id);
    const feedUrl = `${baseUrl.replace(/\/$/, "")}/news/generated-rss/${encodeURIComponent(token)}.xml`;
    const items = articles.map((article) => `<item><title>${escapeXml(article.title)}</title><description>${escapeXml(`${article.summary ?? ""} Source: ${article.sourceName}`)}</description><link>${escapeXml(article.articleUrl)}</link><guid isPermaLink="false">${escapeXml(article.externalId)}</guid>${article.publishedAt ? `<pubDate>${escapeXml(article.publishedAt)}</pubDate>` : ""}</item>`).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(feed.name)}</title><description>Generated RSS from ${escapeXml(feed.sourceUrl)}</description><link>${escapeXml(feed.sourceUrl)}</link><docs>${escapeXml(feedUrl)}</docs>${items}</channel></rss>`;
  }

  private toFeed(row: any): GeneratedRssFeed { return { id: row.id, name: row.name, sourceUrl: row.source_url, feedToken: row.feed_token, createdAt: row.created_at, updatedAt: row.updated_at, lastFetchedAt: row.last_fetched_at ?? null, status: row.status, discoveredArticleCount: row.discovered_article_count ?? 0, errorMessage: row.error_message ?? null, enabled: Boolean(row.enabled), crawlerTier: row.crawler_tier ?? null, failureClassification: row.failure_classification ?? null, feedUrl: `/news/generated-rss/${row.feed_token}.xml` }; }
  private toArticle(row: any): GeneratedRssArticle { return { id: row.id, externalId: row.external_id, canonicalUrl: row.canonical_url, title: row.title, summary: row.summary ?? null, articleUrl: row.article_url, publishedAt: row.published_at ?? null, discoveredAt: row.discovered_at, sourceName: row.source_name, sourceUrl: row.source_url, status: row.status }; }
}