import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedItems } from "./news-collector.js";

test("parseFeedItems extracts RSS items and preserves stable identifiers", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Example Sports</title>
      <item>
        <title>Local team wins</title>
        <link>https://example.com/articles/1</link>
        <guid isPermaLink="false">article-1</guid>
        <description>First item</description>
      </item>
      <item>
        <title>Local team wins</title>
        <link>https://example.com/articles/1</link>
        <guid isPermaLink="false">article-1</guid>
        <description>First item</description>
      </item>
    </channel>
  </rss>`;

  const items = parseFeedItems(xml, "https://example.com/feed");

  assert.equal(items.length, 1);
  assert.ok(items[0]);
  assert.equal(items[0].title, "Local team wins");
  assert.equal(items[0].externalId, "article-1");
  assert.equal(items[0].url, "https://example.com/articles/1");
});

test("parseFeedItems extracts feed metadata and image/video media without scraping", () => {

  test("parseFeedItems classifies content:encoded as full feed content", () => {
    const [item] = parseFeedItems(`<rss><item><title>Full</title><description>Teaser</description><content:encoded><![CDATA[<p>Full article body</p>]]></content:encoded></item></rss>`, "https://example.com/feed");
    assert.ok(item);
    assert.equal(item.body, "<p>Full article body</p>");
    assert.equal(item.summary, "Teaser");
    assert.equal(item.contentAvailability, "full_feed_content");
  });

  test("parseFeedItems classifies description-only content as summary only", () => {
    const [item] = parseFeedItems(`<rss><item><title>Summary</title><description><![CDATA[Short summary]]></description></item></rss>`, "https://example.com/feed");
    assert.ok(item);
    assert.equal(item.summary, "Short summary");
    assert.equal(item.body, null);
    assert.equal(item.contentAvailability, "summary_only");
  });

  test("parseFeedItems classifies summary with thumbnail as summary only", () => {
    const [item] = parseFeedItems(`<rss><item><title>Image summary</title><description>Short summary</description><media:thumbnail url="https://cdn.example.com/thumb.jpg" /></item></rss>`, "https://example.com/feed");
    assert.ok(item);
    assert.equal(item.summary, "Short summary");
    assert.equal(item.contentAvailability, "summary_only");
    assert.deepEqual(item.media, [{ mediaType: "image", url: "https://cdn.example.com/thumb.jpg" }]);
  });

  test("parseFeedItems stores full content with image and video media", () => {
    const [item] = parseFeedItems(`<rss><item><title>Full media</title><content:encoded>Full body</content:encoded><media:image url="https://cdn.example.com/image.jpg" /><enclosure url="https://cdn.example.com/video.mp4" type="video/mp4" /></item></rss>`, "https://example.com/feed");
    assert.ok(item);
    assert.equal(item.body, "Full body");
    assert.equal(item.contentAvailability, "full_feed_content");
    assert.deepEqual(item.media, [
      { mediaType: "image", url: "https://cdn.example.com/image.jpg" },
      { mediaType: "video", url: "https://cdn.example.com/video.mp4" }
    ]);
  });
  const xml = `<rss><channel><item>
    <title>Enriched item</title>
    <link>https://example.com/articles/2</link>
    <dc:creator><![CDATA[Reporter]]></dc:creator>
    <category>Football</category><category>Premier League</category>
    <media:content url="https://cdn.example.com/photo.jpg" type="image/jpeg" />
    <media:thumbnail url="https://cdn.example.com/thumb.jpg" />
    <enclosure url="https://cdn.example.com/video.mp4" type="video/mp4" />
  </item></channel></rss>`;

  const [item] = parseFeedItems(xml, "https://example.com/feed");

  assert.ok(item);
  assert.equal(item.author, "Reporter");
  assert.deepEqual(item.categories, ["Football", "Premier League"]);
  assert.deepEqual(item.media, [
    { mediaType: "image", url: "https://cdn.example.com/photo.jpg" },
    { mediaType: "image", url: "https://cdn.example.com/thumb.jpg" },
    { mediaType: "video", url: "https://cdn.example.com/video.mp4" }
  ]);
});
