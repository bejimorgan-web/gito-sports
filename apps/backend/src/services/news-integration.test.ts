import test from "node:test";
import assert from "node:assert/strict";

process.env.GITO_NEWS_TEST_MODE = "true";

const { NewsService } = await import("./news-service.js");

test("news end-to-end fetch -> normalize -> generate integration", async () => {
  const service = new NewsService();

  // Create source article with fetchedBody fixture (realistic publisher HTML)
  const articleBodyFixture = `
    <article>
      <p>In a thrilling match, Team A beat Team B 2-1 at home.</p>
      <p>Star player John Doe scored the decisive goal in stoppage time.</p>
      <figure><img src="https://cdn.example.com/image1.jpg" /></figure>
      <div class="widgets">[interactive widget]</div>
      <aside class="related">Related stories</aside>
      <blockquote>"We came to win," said the captain.</blockquote>
      <div class="sponsored">Sponsored content</div>
    </article>
  `;
  const fixtureHtml = `
    <html>
      <head>
        <title>Match report</title>
        <script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          headline: "Team A beats Team B in stoppage time",
          description: "Team A won 2-1 at home.",
          articleBody: articleBodyFixture,
          image: "https://cdn.example.com/image1.jpg"
        })}</script>
      </head>
      <body>
        <div class="promo">Subscribe now</div>
        ${articleBodyFixture}
      </body>
    </html>
  `;

  const sourceArticle = service.createArticle({
    title: "",
    summary: "",
    body: null,
    fetchedBody: fixtureHtml,
    sourceName: "Example Publisher",
    sourceUrl: "https://example.com/match/1",
    status: "draft"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(fixtureHtml, {
    status: 200,
    headers: { "content-type": "text/html" }
  });

  try {
    const result = await service.fetchArticleContent(sourceArticle.id);
    assert.equal(result.success, true);
    assert.equal(result.contentOrigin, "fetched_page");
    assert.equal(result.fetchStatus, "success");
    assert.ok(result.fetchedAt);
    const afterFetch = service.getArticle(sourceArticle.id);
    assert.ok(afterFetch);
    assert.equal(afterFetch?.fetchedBody, articleBodyFixture.trim());
    assert.equal(afterFetch?.status, "draft");

    const draft = service.generateGiTONewsDraft(sourceArticle.id, "operator-test");
    assert.ok(draft);
    assert.equal(draft?.status, "review");
    assert.ok((draft?.tags ?? []).includes("gito-generated"));
    assert.ok((draft?.tags ?? []).includes("gito-review-required"));

    assert.ok(draft?.summary && !/<[^>]+>/.test(draft.summary));
    assert.ok(draft?.body && !/<[^>]+>/.test(draft.body));
    assert.ok(!/https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg)/i.test(draft?.body ?? ""));
    assert.ok(!/subscribe|promo|sponsored|related|widget/i.test(draft?.body ?? ""));

    assert.ok(/Example Publisher/.test(draft?.body ?? ""));
    assert.ok(draft?.body?.includes("https://example.com/match/1"));
    assert.ok(draft?.body?.includes("John Doe found the decisive moment"));
    assert.notEqual(draft?.body, fixtureHtml);

    const reloadedSource = service.getArticle(sourceArticle.id);
    assert.equal(reloadedSource?.status, sourceArticle.status);
    assert.equal(reloadedSource?.fetchedBody, articleBodyFixture.trim());
    assert.equal(reloadedSource?.contentOrigin, "fetched_page");
    assert.equal(reloadedSource?.fetchStatus, "success");
    assert.equal(reloadedSource?.publishedAt, null);

    const emptyArticle = service.createArticle({ title: "Empty", summary: "", body: null, fetchedBody: "", sourceName: "X", status: "draft" });
    const emptyDraft = service.generateGiTONewsDraft(emptyArticle.id, "operator-test");
    assert.equal(emptyDraft, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news integration preserves an RSS article when publisher fetch fails", async () => {
  const service = new NewsService();
  const article = service.createArticle({
    title: "Existing RSS title",
    summary: "Existing RSS summary",
    body: "Existing RSS body",
    sourceName: "Example Publisher",
    sourceUrl: "https://example.com/match/failed",
    status: "review"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fixture_fetch_failed"); };

  try {
    const result = await service.fetchArticleContent(article.id);
    assert.equal(result.success, false);
    assert.equal(result.fetchStatus, "failed");
    const preserved = service.getArticle(article.id);
    assert.equal(preserved?.status, "review");
    assert.equal(preserved?.title, article.title);
    assert.equal(preserved?.summary, article.summary);
    assert.equal(preserved?.body, article.body);
    assert.equal(preserved?.publishedAt, null);
    const reloaded = service.getArticle(article.id);
    assert.equal(reloaded?.id, article.id);
    assert.equal(service.getArticle(`${article.id}-generated`), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
