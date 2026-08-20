import test from "node:test";
import assert from "node:assert/strict";

process.env.GITO_NEWS_TEST_MODE = "true";

const { NewsService } = await import("./news-service.js");

test("news service can create and publish an article", () => {
  const service = new NewsService();

  const article = service.createArticle({
    title: "GiTO launches news module",
    summary: "Additive foundation for future content",
    body: "Initial news module scaffolding",
    status: "draft"
  });

  assert.ok(article.id);
  assert.equal(article.status, "draft");

  const published = service.publishArticle(article.id, "operator-1");
  assert.ok(published);
  assert.equal(published?.status, "published");
  assert.ok(published?.publishedAt);

  const fetched = service.getArticle(article.id);
  assert.equal(fetched?.status, "published");
});

test("news service preserves ordered inline body blocks and rejects unsafe block URLs", () => {
  const service = new NewsService();
  const article = service.createArticle({
    title: "Inline media article",
    bodyBlocks: [
      { type: "paragraph", text: "Before the image" },
      { type: "image", url: "https://cdn.example.com/image.jpg", caption: "Matchday" },
      { type: "video", url: "https://www.youtube.com/watch?v=abc", platform: "youtube" },
      { type: "social", url: "javascript:alert(1)", platform: "x" }
    ]
  });

  assert.deepEqual(article.bodyBlocks, [
    { type: "paragraph", text: "Before the image" },
    { type: "image", url: "https://cdn.example.com/image.jpg", caption: "Matchday" },
    { type: "video", url: "https://www.youtube.com/watch?v=abc", platform: "youtube" }
  ]);
});

test("news service can fetch article content from JSON-LD and preserve status", async () => {
  const originalFetch = globalThis.fetch;
  const service = new NewsService();
  const article = service.createArticle({
    title: "JSON-LD article",
    summary: "Summary only",
    sourceUrl: "https://example.com/article",
    status: "draft"
  });

  globalThis.fetch = async () => new Response(`<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Fresh body","articleBody":"<p>Full fetched body</p>","description":"Updated summary","author":{"@type":"Person","name":"Ada Reporter"},"datePublished":"2026-08-08T00:00:00Z","image":"https://cdn.example.com/hero.jpg"}</script></head><body></body></html>`, { status: 200, headers: { "content-type": "text/html" } });

  try {
    const result = await service.fetchArticleContent(article.id);
    assert.equal(result.success, true);
    assert.equal(result.contentOrigin, "fetched_page");
    assert.equal(result.body, "<p>Full fetched body</p>");
    assert.ok(result.fetchedAt);

    const updated = service.getArticle(article.id);
    assert.ok(updated);
    assert.equal(updated?.status, "draft");
    assert.equal(updated?.contentOrigin, "fetched_page");
    assert.equal(updated?.fetchStatus, "success");
    assert.equal(updated?.body, "<p>Full fetched body</p>");
    assert.equal(updated?.fetchedBody, "<p>Full fetched body</p>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news service does not overwrite an existing edited body when fetching content fails", async () => {
  const originalFetch = globalThis.fetch;
  const service = new NewsService();
  const article = service.createArticle({
    title: "Manual body",
    summary: "Original teaser",
    body: "Already edited by editor",
    sourceUrl: "https://example.com/edited",
    status: "review"
  });

  globalThis.fetch = async () => {
    throw new Error("blocked");
  };

  try {
    const result = await service.fetchArticleContent(article.id);
    assert.equal(result.success, false);
    assert.equal(result.contentOrigin, "rss_full");

    const updated = service.getArticle(article.id);
    assert.ok(updated);
    assert.equal(updated?.status, "review");
    assert.equal(updated?.body, "Already edited by editor");
    assert.equal(updated?.contentOrigin, "rss_full");
    assert.equal(updated?.fetchStatus, "failed");
    assert.match(updated?.fetchError ?? "", /blocked|failed/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news source rights audit records evidence and sets conservative status", async () => {
  const originalFetch = globalThis.fetch;
  const service = new NewsService();
  const source = service.createSource({
    name: "Example Rights Source",
    sourceType: "external",
    baseUrl: "https://example.com",
    feedUrl: "https://example.com/feed.xml",
    enabled: true
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/terms")) {
      return new Response("<html><head><title>Terms of use</title></head><body><p>We allow republication of articles with attribution and original URL links.</p></body></html>", { status: 200 });
    }
    return new Response("<html><head><title>Example</title></head><body><p>No rights language.</p></body></html>", { status: 404 });
  };

  try {
    const audit = await service.auditSourcePublishingRights(source.id);
    assert.equal(audit.status, "republication_permitted_with_conditions");
    assert.equal(audit.evidence.length > 0, true);
    assert.equal(audit.permissions.some((permission) => permission.permission === "summary_excerpt" && permission.allowed), true);
    assert.equal(audit.permissions.some((permission) => permission.permission === "original_link_reference" && permission.allowed), true);

    const updatedSource = service.getSource(source.id);
    assert.equal(updatedSource?.rightsStatus, "republication_permitted_with_conditions");
    assert.equal(updatedSource?.rightsReviewNotes?.toLowerCase().includes("conditions"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news source rights audit does not grant permissions from feed-host terms only for Sky Sports", async () => {
  const originalFetch = globalThis.fetch;
  const service = new NewsService();
  const source = service.createSource({
    name: "Sky Sports Feed Evidence",
    sourceType: "external",
    baseUrl: "https://www.skysports.com/football",
    feedUrl: "https://rss.app/feeds/skysports-football.xml",
    enabled: true
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://rss.app/feeds/")) {
      return new Response("<html><head><title>RSS terms</title></head><body><p>This feed host page says full articles can be redistributed.</p></body></html>", { status: 200 });
    }
    return new Response("<html><head><title>Sky Sports</title></head><body><p>No rights language found on the publisher site.</p></body></html>", { status: 404 });
  };

  try {
    const audit = await service.auditSourcePublishingRights(source.id);
    assert.equal(audit.status, "review_required");
    assert.equal(audit.evidence.some((item: { evidenceOrigin?: string | null }) => item.evidenceOrigin === "feed_host"), true);
    assert.equal(audit.evidence.some((item: { evidenceOrigin?: string | null }) => item.evidenceOrigin === "publisher"), false);
    assert.equal(audit.permissions.some((permission: { permission: string; allowed: boolean }) => permission.permission === "full_article_republication" && permission.allowed), false);
    assert.equal(audit.permissions.some((permission: { permission: string; allowed: boolean }) => permission.permission === "headline" && permission.allowed), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news source rights audit remains conservative for BBC if only feed-host evidence exists", async () => {
  const originalFetch = globalThis.fetch;
  const service = new NewsService();
  const source = service.createSource({
    name: "BBC Sport Feed Evidence",
    sourceType: "external",
    baseUrl: "https://www.bbc.co.uk/sport",
    feedUrl: "https://rss.app/feeds/bbc-sport.xml",
    enabled: true
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://rss.app/feeds/")) {
      return new Response("<html><head><title>Feed host terms</title></head><body><p>This feed host page says feeds may be redistributed.</p></body></html>", { status: 200 });
    }
    return new Response("<html><head><title>BBC Sport</title></head><body><p>Page not found.</p></body></html>", { status: 404 });
  };

  try {
    const audit = await service.auditSourcePublishingRights(source.id);
    assert.equal(audit.status, "review_required");
    assert.equal(audit.evidence.some((item: { evidenceOrigin?: string | null }) => item.evidenceOrigin === "feed_host"), true);
    assert.equal(audit.evidence.some((item: { evidenceOrigin?: string | null }) => item.evidenceOrigin === "publisher"), false);
    assert.equal(audit.permissions.some((permission: { permission: string; allowed: boolean }) => permission.permission === "headline" && permission.allowed), false);
    assert.equal(audit.permissions.some((permission: { permission: string; allowed: boolean }) => permission.permission === "summary_excerpt" && permission.allowed), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GiTO draft guard produces an original multi-paragraph story for substantial source material", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Team A wins decisive match",
    body: "Team A beat Team B 2-1 at home. Star player John Doe scored the decisive goal in stoppage time. The club said the win lifted momentum ahead of the next fixture.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/substantial",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.equal(draft?.contentOrigin, "gito_ai");
  assert.ok((draft?.tags ?? []).includes("gito-generated"));
  assert.ok((draft?.tags ?? []).includes("gito-review-required"));
  assert.ok(!(draft?.tags ?? []).includes("gito-fact-check-needed"));
  assert.ok((draft?.body ?? "").split(/\n\n/).length >= 3);
  assert.ok(!/According to|Coverage indicates|The report draws on|source attribution/i.test(`${draft?.summary}\n${draft?.body}`));
  assert.ok(!draft?.body?.includes("Team A beat Team B 2-1 at home."));
  assert.ok(!draft?.body?.includes("Star player John Doe scored the decisive goal in stoppage time."));
  assert.ok(!draft?.body?.includes("The club said the win lifted momentum ahead of the next fixture."));
  assert.ok(draft?.body?.includes("Source reference: Example News Feed"));
  assert.ok(draft?.body?.includes("https://example.com/article/substantial"));
  assert.ok(!/https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?[^\s]*)?/i.test(draft?.body ?? ""));
  assert.ok(!/<[^>]+>/.test(draft?.body ?? ""));
  assert.ok(!/(subscribe|click here|newsletter|advert|sponsored|promo|related)/i.test(draft?.body ?? ""));

  const source = service.getArticle(sourceArticle.id);
  assert.ok(source);
  assert.equal(source?.body, sourceArticle.body);
  assert.equal(source?.status, "draft");
});

test("GiTO draft guard keeps short source material concise and clearly fact-check required", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Team A wins at home",
    body: "Team A beat Team B 2-1 at home.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/short",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.equal(draft?.contentOrigin, "gito_ai");
  assert.ok((draft?.tags ?? []).includes("gito-generated"));
  assert.ok((draft?.tags ?? []).includes("gito-review-required"));
  assert.ok((draft?.tags ?? []).includes("gito-fact-check-needed"));
  assert.ok((draft?.body?.length ?? 0) < 240);
  assert.ok(!/According to|coverage indicates|The report draws on|The main story is about/i.test(`${draft?.summary}\n${draft?.body}`));
  assert.ok(draft?.body?.includes("Source reference: Example News Feed"));
  assert.ok(!/injury|transfer|date|contract|manager|championship|trophy/i.test(`${draft?.summary}\n${draft?.body}`));

  const original = service.getArticle(sourceArticle.id);
  assert.equal(original?.body, sourceArticle.body);
  assert.equal(original?.status, "draft");
});

test("short source produces a concise independent story and requires fact checking", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Team A wins at home",
    body: "Team A beat Team B 2-1 at home.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/short",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.equal(draft?.contentOrigin, "gito_ai");
  assert.equal(draft?.summary, "Team A secured a 2-1 home win over Team B.");
  assert.ok(!/According to|coverage indicates/i.test(`${draft?.summary}\n${draft?.body}`));
  assert.ok((draft?.tags ?? []).includes("gito-generated"));
  assert.ok((draft?.tags ?? []).includes("gito-review-required"));
  assert.ok((draft?.tags ?? []).includes("gito-fact-check-needed"));
  assert.ok((draft?.body?.length ?? 0) < 240);
  assert.ok(!draft?.body?.includes("Team A beat Team B 2-1 at home."));

  const original = service.getArticle(sourceArticle.id);
  assert.equal(original?.body, sourceArticle.body);
  assert.equal(original?.status, "draft");
});

test("substantial source is rephrased without copying source sentences or inventing facts", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Team A wins decisive match",
    body: "Team A beat Team B 2-1 at home. Star player John Doe scored the decisive goal in stoppage time.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/substantial",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.equal(draft?.contentOrigin, "gito_ai");
  assert.ok(!draft?.body?.includes("Team A beat Team B 2-1 at home."));
  assert.ok(!draft?.body?.includes("Star player John Doe scored the decisive goal in stoppage time."));
  assert.ok(draft?.body?.includes("Team A secured a 2-1 home win over Team B."));
  assert.ok(draft?.body?.includes("John Doe found the decisive moment with decisive goal in stoppage time."));
  assert.ok(draft?.body?.includes("Example News Feed"));
  assert.ok(draft?.body?.includes(sourceArticle.sourceUrl ?? ""));
  assert.ok(!(draft?.tags ?? []).includes("gito-fact-check-needed"));
});

test("insufficient source material is not expanded with invented facts", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Brief club statement",
    summary: "The club issued a brief statement.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/limited",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.ok((draft?.tags ?? []).includes("gito-fact-check-needed"));
  assert.ok(!/injury|transfer|score|date|manager|contract|championship/i.test(`${draft?.summary}\n${draft?.body}`));
  assert.ok(!/According to|coverage indicates/i.test(`${draft?.summary}\n${draft?.body}`));
});

test("news service generates a normalized GiTO draft from raw fetched HTML and preserves raw fetchedBody", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "<div>Breaking: Team wins</div>",
    summary: "<p>Latest <strong>match</strong> update.</p>",
    body: null,
    fetchedBody: `<div class="promo-banner">Sponsored content</div><article><p>The main story is about the team winning at home.</p><p>It was a strong performance.</p><img src="https://example.com/winner.jpg" /></article>`,
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/1",
    status: "draft"
  });

  const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-1");
  assert.ok(draft);
  assert.equal(draft?.status, "review");
  assert.ok((draft?.tags ?? []).includes("gito-generated"));
  assert.ok((draft?.tags ?? []).includes("gito-review-required"));
  assert.ok(!draft?.summary?.includes("<"));
  assert.ok(!draft?.summary?.includes(">"));
  assert.ok(!draft?.body?.includes("<"));
  assert.ok(!draft?.body?.includes(">"));
  assert.ok(!draft?.body?.includes("https://example.com/winner.jpg"));
  assert.ok(!draft?.body?.toLowerCase().includes("sponsored"));
  assert.ok(!draft?.body?.toLowerCase().includes("promo"));
  assert.notStrictEqual(draft?.body, sourceArticle.fetchedBody);

  const reloadedSource = service.getArticle(sourceArticle.id);
  assert.ok(reloadedSource);
  assert.equal(reloadedSource?.fetchedBody, sourceArticle.fetchedBody);
});

test("news service rejects GiTO draft generation from an already generated article", () => {
  const service = new NewsService();
  const generatedArticle = service.createArticle({
    title: "Generated story",
    summary: "Generated summary.",
    body: "Generated body content.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/2",
    author: "GiTO News",
    tags: ["gito-generated"],
    status: "review"
  });

  assert.throws(() => {
    service.generateGiTONewsDraft(generatedArticle.id, "operator-1");
  }, /cannot_generate_from_generated_article/);
});

test("news service can research an article and turn it into a reviewed original story", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "Club secures comfortable win",
    summary: "The club beat a rival in a decisive match.",
    body: "The club beat the rival 3-1 at home. A late goal sealed the points and the manager praised the display.",
    sourceName: "Example News Feed",
    sourceUrl: "https://example.com/article/research",
    status: "draft"
  });

  const research = service.researchArticle(sourceArticle.id);
  assert.equal(research.query.includes("Club secures comfortable win"), true);
  assert.equal(research.verifiedFacts.length > 0, true);
  assert.equal(research.researchStatus, "completed");

  const stored = service.getResearchResult(sourceArticle.id);
  assert.ok(stored);
  assert.equal(stored?.query, research.query);

  const originalStory = service.generateOriginalStoryFromResearch(sourceArticle.id, "operator-1", research);
  assert.ok(originalStory);
  assert.equal(originalStory?.status, "review");
  assert.equal(originalStory?.author, "GiTO News");
  assert.ok((originalStory?.tags ?? []).includes("gito-generated"));
  assert.ok((originalStory?.tags ?? []).includes("gito-review-required"));
  assert.ok(originalStory?.body?.includes("Source reference: Example News Feed"));
});

test("original story generation requires persisted research and never mutates the source article", () => {
  const service = new NewsService();
  const sourceArticle = service.createArticle({
    title: "RSS source title",
    summary: "RSS source summary",
    body: "RSS source body",
    fetchedBody: "<p>RSS source body</p>",
    sourceName: "Example RSS",
    sourceUrl: "https://example.com/rss/1",
    externalId: "feed-guid-1",
    status: "draft"
  });
  const before = service.getArticle(sourceArticle.id);
  const beforeArticleIds = new Set(service.listArticles().map((article) => article.id));
  assert.throws(() => service.generateOriginalStoryFromResearch(sourceArticle.id), /research_required/);
  assert.deepEqual(service.listArticles().map((article) => article.id).filter((id) => !beforeArticleIds.has(id)), []);

  const research = service.researchArticle(sourceArticle.id);
  const generated = service.generateOriginalStoryFromResearch(sourceArticle.id, "operator-1", research);
  assert.equal(generated?.status, "review");
  assert.equal(generated?.contentOrigin, "gito_ai");
  assert.ok(generated?.tags?.includes("gito-generated"));
  assert.ok(generated?.tags?.includes("gito-review-required"));
  const after = service.getArticle(sourceArticle.id);
  assert.deepEqual(after && {
    title: after.title,
    summary: after.summary,
    body: after.body,
    fetchedBody: after.fetchedBody,
    sourceUrl: after.sourceUrl,
    externalId: after.externalId,
    status: after.status
  }, before && {
    title: before.title,
    summary: before.summary,
    body: before.body,
    fetchedBody: before.fetchedBody,
    sourceUrl: before.sourceUrl,
    externalId: before.externalId,
    status: before.status
  });
});
