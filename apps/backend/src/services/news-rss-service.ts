import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import type { NewsArticle, NewsSource } from "@gito/shared";
import { NewsRepository } from "../repositories/news-repository.js";
import { NewsClassificationService } from "./news-classification-service.js";
import { normalizeNewsText } from "./news-content-normalizer.js";
import { parseFeedItems, type ParsedFeedItem } from "./news-collector.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type RssFetchResult = {
  sourceId: string;
  fetchedItems: number;
  importedItems: number;
  skippedDuplicates: number;
  failedItems: number;
};

export type RssFetchOptions = {
  fetchTrustedInternalFeed?: (feedUrl: string) => string | null;
};

export function validateRssUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("rss_url_invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("rss_url_scheme_not_allowed");
  }
  if (url.username || url.password) {
    throw new Error("rss_url_credentials_not_allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "ip6-localhost" || isPrivateIp(hostname)) {
    throw new Error("rss_url_private_network_not_allowed");
  }
  return url;
}

function isPrivateIp(hostname: string): boolean {
  if (net.isIP(hostname) === 4) {
    const [first, second] = hostname.split(".").map(Number);
    const secondOctet = second ?? -1;
    return first === 10 || first === 127 || (first === 172 && secondOctet >= 16 && secondOctet <= 31) || (first === 192 && secondOctet === 168) || (first === 169 && secondOctet === 254) || first === 0;
  }
  if (net.isIP(hostname) === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return false;
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  if (net.isIP(hostname)) return;
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("rss_url_private_network_not_allowed");
  }
}

export async function fetchPublicTextDocument(inputUrl: string, accept = "text/html, application/xhtml+xml;q=0.9") : Promise<{ text: string; contentType: string }> {
  let url = validateRssUrl(inputUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicHostname(url.hostname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("rss_redirect_limit_exceeded");
      url = validateRssUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`rss_fetch_failed_${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const allowsHtml = /html/i.test(accept);
    if (contentType && !(allowsHtml ? /(html|xhtml|text\/plain)/i.test(contentType) : /(xml|rss|atom|text\/plain)/i.test(contentType))) throw new Error("rss_content_type_not_supported");

    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("rss_response_too_large");
      return { text, contentType };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("rss_response_too_large");
      }
      chunks.push(Buffer.from(next.value));
    }
    return { text: Buffer.concat(chunks).toString("utf8"), contentType };
  }
  throw new Error("rss_redirect_limit_exceeded");
}

function feedName(xml: string, fallback: string): string {
  const title = xml.match(/<channel\b[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? xml.match(/<feed\b[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return normalizeNewsText(title ?? fallback) || fallback;
}

export function stableFeedItemId(sourceUrl: string, item: ParsedFeedItem): string {
  const parserFallbackId = `${item.title}:${sourceUrl}`;
  const raw = item.externalId && item.externalId !== "unknown" && item.externalId !== parserFallbackId
    ? item.externalId
    : `${sourceUrl}|${item.title}|${item.publishedAt ?? ""}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function escapeXml(value: string | null | undefined): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildNewsRssXml(articles: NewsArticle[], baseUrl: string): string {
  const origin = baseUrl.replace(/\/$/, "");
  const items = articles.map((article) => {
    const url = `${origin}/news/articles/${encodeURIComponent(article.id)}`;
    return `<item><title>${escapeXml(article.title)}</title><link>${escapeXml(url)}</link><guid isPermaLink="false">${escapeXml(article.id)}</guid><description>${escapeXml(article.summary ?? article.body ?? "")}</description>${article.author ? `<author>${escapeXml(article.author)}</author>` : ""}<pubDate>${escapeXml(article.publishedAt ?? article.createdAt)}</pubDate></item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>GiTO News</title><link>${escapeXml(origin)}</link><description>Published GiTO News articles</description>${items}</channel></rss>`;
}

export class NewsRssService {
  constructor(private readonly repository = new NewsRepository()) {}

  async fetchSource(source: NewsSource, options?: RssFetchOptions): Promise<RssFetchResult> {
    if (!source.feedUrl) throw new Error("rss_source_feed_url_missing");
    const trustedXml = options?.fetchTrustedInternalFeed?.(source.feedUrl);
    const xml = trustedXml ?? await fetchRssDocument(source.feedUrl);
    const parsedItems = parseFeedItems(xml, source.feedUrl);
    if (!/<(rss|feed)\b/i.test(xml) || !parsedItems.length && !/<(rss|feed)\b[\s\S]*<\/(rss|feed)>/i.test(xml)) {
      throw new Error("rss_document_malformed");
    }
    const classifier = new NewsClassificationService(this.repository.getDatabaseFromConstructor());
    let importedItems = 0;
    let skippedDuplicates = 0;
    let failedItems = 0;
    for (const item of parsedItems) {
      try {
        const externalId = stableFeedItemId(source.feedUrl, item);
        if (this.repository.findExistingArticleByFeedItem(source.id, externalId, item.url)) {
          skippedDuplicates += 1;
          continue;
        }
        const body = normalizeNewsText(item.body);
        const summary = normalizeNewsText(item.summary);
        const classification = classifier.classify({ title: normalizeNewsText(item.title), summary, body, sourceName: source.name, sourceUrl: item.url, categories: item.categories, author: item.author });
        const article = this.repository.createArticle({
          title: normalizeNewsText(item.title) || "Untitled feed item",
          summary: summary || null,
          body: body || null,
          status: "draft",
          sourceId: source.id,
          sourceName: source.name || feedName(xml, source.feedUrl),
          sourceUrl: item.url,
          externalId,
          publishedAt: item.publishedAt ?? null,
          author: normalizeNewsText(item.author) || null,
          categories: item.categories,
          sportId: classification.sportId,
          competitionId: classification.competitionId,
          teamId: classification.teamId,
          countryId: classification.countryId,
          matchId: classification.matchId,
          contentAvailability: item.contentAvailability,
          contentOrigin: body ? "rss_full" : "summary",
          classificationMode: "suggestion"
        });
        this.repository.saveClassificationSuggestions(article.id, classification.suggestions);
        this.repository.addAuditEntry(article.id, "collected", source.id, `Imported from RSS source ${source.name}`);
        for (const media of item.media) this.repository.addMedia(article.id, media.url, media.mediaType, media.altText ?? item.title);
        importedItems += 1;
      } catch {
        failedItems += 1;
      }
    }
    this.repository.updateSourceCollectionStatus(source.id, "success", `${parsedItems.length} items found · ${importedItems} new · ${skippedDuplicates} already imported`, new Date().toISOString());
    return { sourceId: source.id, fetchedItems: parsedItems.length, importedItems, skippedDuplicates, failedItems };
  }
}

async function fetchRssDocument(inputUrl: string): Promise<string> {
  const result = await fetchPublicTextDocument(inputUrl, "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.8");
  return result.text;
}