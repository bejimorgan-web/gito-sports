import test from "node:test";
import assert from "node:assert/strict";
import { buildNewsRssXml, escapeXml, stableFeedItemId, validateRssUrl } from "./news-rss-service.js";
import { parseFeedItems } from "./news-collector.js";
import { normalizeNewsText } from "./news-content-normalizer.js";

test("RSS 2.0 parsing extracts title, summary, URL, date, author, and GUID", () => {
  const [item] = parseFeedItems(`<rss version="2.0"><channel><title>Sports Feed</title><item><title>AT&amp;T wins &lt;final&gt;</title><link>https://example.com/story/1</link><guid>guid-1</guid><description><![CDATA[<p>Summary &amp; details.</p>]]></description><pubDate>Tue, 19 Aug 2026 10:00:00 GMT</pubDate><dc:creator>Reporter</dc:creator></item></channel></rss>`, "https://example.com/feed.xml");
  assert.ok(item);
  assert.equal(item.title, "AT&T wins <final>");
  assert.equal(item.url, "https://example.com/story/1");
  assert.equal(item.externalId, "guid-1");
  assert.equal(item.publishedAt, "2026-08-19T10:00:00.000Z");
  assert.equal(item.author, "Reporter");
  assert.equal(normalizeNewsText(item.summary), "Summary & details.");
});

test("Atom parsing extracts alternate link, content, and published date", () => {
  const [item] = parseFeedItems(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Sports</title><entry><id>tag:example.com,2026:1</id><title>Atom story</title><link rel="alternate" href="https://example.com/atom/1"/><summary>Atom summary</summary><content type="html"><![CDATA[<p>Atom body</p>]]></content><published>2026-08-19T12:00:00Z</published><author><name>Atom Reporter</name></author></entry></feed>`, "https://example.com/atom.xml");
  assert.ok(item);
  assert.equal(item.url, "https://example.com/atom/1");
  assert.equal(item.body, "<p>Atom body</p>");
  assert.equal(item.publishedAt, "2026-08-19T12:00:00.000Z");
});

test("stable feed IDs support GUID, URL, and deterministic fallback deduplication", () => {
  const guid = { title: "Story", externalId: "guid", url: "https://example.com/1", publishedAt: null } as any;
  const url = { title: "Story", externalId: "https://example.com/1", url: "https://example.com/1", publishedAt: null } as any;
  const fallback = { title: "Story", externalId: "Story:https://example.com/feed", url: "https://example.com/feed", publishedAt: "2026-08-19T00:00:00.000Z" } as any;
  assert.equal(stableFeedItemId("https://example.com/feed", guid), stableFeedItemId("https://example.com/feed", guid));
  assert.equal(stableFeedItemId("https://example.com/feed", url), stableFeedItemId("https://example.com/feed", url));
  assert.equal(stableFeedItemId("https://example.com/feed", fallback), stableFeedItemId("https://example.com/feed", { ...fallback }));
  assert.notEqual(stableFeedItemId("https://example.com/feed", fallback), stableFeedItemId("https://example.com/feed", { ...fallback, publishedAt: "2026-08-20T00:00:00.000Z" }));
});

test("RSS URL validation rejects unsupported, loopback, and private destinations", () => {
  assert.throws(() => validateRssUrl("file:///tmp/feed.xml"), /scheme_not_allowed/);
  assert.throws(() => validateRssUrl("http://localhost/feed.xml"), /private_network/);
  assert.throws(() => validateRssUrl("http://127.0.0.1/feed.xml"), /private_network/);
  assert.throws(() => validateRssUrl("http://192.168.1.20/feed.xml"), /private_network/);
  assert.equal(validateRssUrl("https://example.com/feed.xml").protocol, "https:");
});

test("public RSS XML includes published articles and escapes XML characters", () => {
  const xml = buildNewsRssXml([
    { id: "published-1", title: "A & B <final>", summary: "Quotes \"and\" <details>", status: "published", createdAt: "2026-08-19", updatedAt: "2026-08-19", publishedAt: "2026-08-19" } as any
  ], "https://gito.example");
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /A &amp; B &lt;final&gt;/);
  assert.match(xml, /Quotes &quot;and&quot; &lt;details&gt;/);
  assert.equal(escapeXml("'"), "&apos;");
});

test("trusted generated feed handling remains separate from public URL validation", () => {
  assert.throws(() => validateRssUrl("http://localhost:4100/news/generated-rss/token.xml"), /private_network/);
});