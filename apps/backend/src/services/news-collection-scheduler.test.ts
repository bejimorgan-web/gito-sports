import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { NewsRepository } from "../repositories/news-repository.js";
import { NewsService } from "./news-service.js";
import { NewsCollectionScheduler } from "./news-collection-scheduler.js";

function createTestDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT NOT NULL, iso2_code TEXT, iso3_code TEXT, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE sport_countries (id TEXT PRIMARY KEY, sport_id TEXT, country_id TEXT);
    CREATE TABLE matches (id TEXT PRIMARY KEY, competition_id TEXT, home_team_id TEXT, away_team_id TEXT);
    CREATE TABLE news_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      summary TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sport_id TEXT,
      competition_id TEXT,
      team_id TEXT,
      country_id TEXT,
      match_id TEXT,
      source_id TEXT,
      source_name TEXT,
      source_url TEXT,
      author TEXT,
      categories_json TEXT,
      tags_json TEXT,
      content_availability TEXT,
      content_origin TEXT,
      fetched_body TEXT,
      fetched_at TEXT,
      fetch_status TEXT,
      fetch_error TEXT,
      created_by TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES news_sources(id) ON DELETE SET NULL
    );
    CREATE TABLE news_article_media (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE news_article_links (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE news_article_audit (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE news_article_research_results (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL UNIQUE,
      query TEXT NOT NULL,
      research_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE news_article_categories (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      category_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(article_id, category_type, entity_id)
    );
    CREATE TABLE news_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'external',
      base_url TEXT,
      feed_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      collection_interval_minutes INTEGER,
      last_collected_at TEXT,
      last_collection_message TEXT,
      last_collection_attempt_at TEXT,
      last_collection_succeeded_at TEXT,
      last_collection_status TEXT,
      last_collection_error TEXT,
      last_collection_discovered_count INTEGER,
      last_collection_new_count INTEGER,
      last_collection_duplicate_count INTEGER,
      rights_status TEXT DEFAULT 'unknown',
      rights_last_checked_at TEXT,
      rights_review_notes TEXT,
      rights_administrator_decision TEXT,
      rights_decision_at TEXT,
      rights_audit_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function createFeedXml(title: string, url: string, mediaMarkup = "", description = "Example summary") {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Example</title>
      <item>
        <title>${title}</title>
        <link>${url}</link>
        <guid isPermaLink="false">${url}</guid>
        <description>${description}</description>
        ${mediaMarkup}
      </item>
    </channel>
  </rss>`;
}

test("scheduler initializes successfully and skips disabled sources", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const scheduler = new NewsCollectionScheduler(service as any, db as any);

  repository.createSource({
    name: "Disabled source",
    feedUrl: "https://example.com/feed.xml",
    enabled: false,
    collectionIntervalMinutes: 60
  });

  await scheduler.initialize();
  await scheduler.runDueCollections();

  const sources = repository.listSources();
  assert.equal(sources.length, 1);
  assert.equal(sources[0]!.lastCollectionStatus, null);
});

test("scheduler respects intervals and creates draft articles for eligible sources", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const scheduler = new NewsCollectionScheduler(service as any, db as any);

  const source = repository.createSource({
    name: "Eligible source",
    feedUrl: "https://example.com/feed.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(createFeedXml("Fresh item", "https://example.com/fresh"), { status: 200, headers: { "content-type": "application/rss+xml" } });

  try {
    await scheduler.runDueCollections();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const articles = repository.listArticles({ sourceId: source.id });
  assert.equal(articles.length, 1);
  assert.equal(articles[0]!.status, "draft");
  assert.equal(articles[0]!.sourceId, source.id);
  assert.equal(source.lastCollectionStatus, null);
});

test("scheduler skips duplicate articles and continues after a failing source", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const scheduler = new NewsCollectionScheduler(service as any, db as any);

  const healthySource = repository.createSource({
    name: "Healthy source",
    feedUrl: "https://example.com/healthy.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });
  const failingSource = repository.createSource({
    name: "Failing source",
    feedUrl: "https://example.com/failing.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });

  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    callCount += 1;
    if (url.includes("failing")) {
      throw new Error("boom");
    }
    return new Response(createFeedXml("Same item", "https://example.com/same"), { status: 200, headers: { "content-type": "application/rss+xml" } });
  };

  try {
    await scheduler.runDueCollections();
    await scheduler.runDueCollections();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const articles = repository.listArticles();
  assert.equal(articles.length, 1);
  assert.equal(articles[0]!.status, "draft");
  assert.ok(callCount >= 2);

  const healthy = repository.getSourceById(healthySource.id);
  assert.ok(healthy);
  assert.equal(healthy.lastCollectionStatus, "success");

  const broken = repository.getSourceById(failingSource.id);
  assert.ok(broken);
  assert.equal(broken.lastCollectionStatus, "error");
});

test("manual collect still works independently from the scheduler", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const scheduler = new NewsCollectionScheduler(service as any, db as any);

  const source = repository.createSource({
    name: "Manual source",
    feedUrl: "https://example.com/manual.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(createFeedXml("Manual item", "https://example.com/manual"), { status: 200, headers: { "content-type": "application/rss+xml" } });

  try {
    await service.collectSource({ sourceId: source.id });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const articles = repository.listArticles({ sourceId: source.id });
  assert.equal(articles.length, 1);
  assert.equal(articles[0]!.status, "draft");
});

test("collection persists feed-provided image and video media", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const source = repository.createSource({
    name: "Media source",
    feedUrl: "https://example.com/media.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(createFeedXml(
    "Media item",
    "https://example.com/media-item",
    '<media:content url="https://cdn.example.com/photo.jpg" type="image/jpeg" /><enclosure url="https://cdn.example.com/video.mp4" type="video/mp4" />'
  ), { status: 200, headers: { "content-type": "application/rss+xml" } });

  try {
    await service.collectSource({ sourceId: source.id });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const article = repository.listArticles({ sourceId: source.id })[0];
  assert.ok(article);
  assert.deepEqual(article.media?.map((media) => ({ mediaType: media.mediaType, url: media.url })), [
    { mediaType: "image", url: "https://cdn.example.com/photo.jpg" },
    { mediaType: "video", url: "https://cdn.example.com/video.mp4" }
  ]);
});

test("editing an article preserves classification fields and avoids slug collisions", () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const first = repository.createArticle({ title: "Original title", status: "draft" });
  repository.createArticle({ title: "Updated title", status: "draft" });

  const updated = repository.updateArticle(first.id, {
    title: "Updated title",
    summary: "Edited summary",
    body: "Edited body",
    status: "review",
    sportId: "sport-1",
    competitionId: "competition-1",
    teamId: "team-1",
    countryId: "country-1",
    tags: ["editorial", "verified"]
  });

  assert.ok(updated);
  assert.equal(updated.status, "review");
  assert.equal(updated.summary, "Edited summary");
  assert.equal(updated.body, "Edited body");
  assert.equal(updated.sportId, "sport-1");
  assert.equal(updated.competitionId, "competition-1");
  assert.equal(updated.teamId, "team-1");
  assert.equal(updated.countryId, "country-1");
  assert.deepEqual(updated.tags, ["editorial", "verified"]);
  assert.notEqual(updated.slug, "updated-title");
});

test("source deletion preserves linked articles and nulls only their source reference", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const emptySource = repository.createSource({ name: "Empty source", enabled: true });
  assert.equal(repository.deleteSource(emptySource.id), true);
  assert.equal(repository.getSourceById(emptySource.id), null);

  const linkedSource = repository.createSource({ name: "Linked source", enabled: true });
  const draft = repository.createArticle({ title: "Linked draft", sourceId: linkedSource.id, sourceName: "Linked source", sourceUrl: "https://example.com/draft", status: "draft" });
  const published = repository.createArticle({ title: "Linked published", sourceId: linkedSource.id, sourceName: "Linked source", sourceUrl: "https://example.com/published", status: "published", publishedAt: new Date().toISOString() });
  repository.addMedia(draft.id, "https://cdn.example.com/image.jpg");
  repository.addLink(draft.id, "https://example.com/link", "Original link");

  assert.equal(repository.deleteSource(linkedSource.id), true);
  assert.equal(repository.getSourceById(linkedSource.id), null);

  const preservedDraft = repository.getArticleById(draft.id);
  const preservedPublished = repository.getArticleById(published.id);
  assert.ok(preservedDraft);
  assert.ok(preservedPublished);
  assert.equal(preservedDraft.sourceId, null);
  assert.equal(preservedDraft.sourceName, "Linked source");
  assert.equal(preservedDraft.sourceUrl, "https://example.com/draft");
  assert.equal(preservedDraft.status, "draft");
  assert.equal(preservedDraft.media?.length, 1);
  assert.equal(preservedDraft.links?.length, 1);
  assert.equal(preservedPublished.sourceId, null);
  assert.equal(preservedPublished.sourceName, "Linked source");
  assert.equal(preservedPublished.sourceUrl, "https://example.com/published");
  assert.equal(preservedPublished.status, "published");

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("deleted source should not be collected");
  };
  try {
    const scheduler = new NewsCollectionScheduler(new NewsService(repository as any), db as any);
    await scheduler.runDueCollections();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});

test("manual collection aborts when source is deleted after feed fetch", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const service = new NewsService(repository as any);
  const source = repository.createSource({
    name: "Transient source",
    feedUrl: "https://example.com/transient.xml",
    enabled: true,
    collectionIntervalMinutes: 60
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    repository.deleteSource(source.id);
    return new Response(createFeedXml("Transient item", "https://example.com/transient"), { status: 200, headers: { "content-type": "application/rss+xml" } });
  };

  try {
    await assert.rejects(async () => {
      await service.collectSource({ sourceId: source.id });
    }, { message: "source_not_available" });

    const articles = repository.listArticles({ sourceId: source.id });
    assert.equal(articles.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("article deletion removes related media, links, audit, and categories", () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  const article = repository.createArticle({ title: "Delete cleanup", status: "draft" });

  repository.addMedia(article.id, "https://cdn.example.com/image.jpg");
  repository.addLink(article.id, "https://example.com/link", "Original link");
  repository.addAuditEntry(article.id, "created", "operator-1", "Created article");
  db.prepare(`INSERT INTO news_article_categories (id, article_id, category_type, entity_id, created_at, updated_at) VALUES ('category-1', ?, 'sport', 'sport-1', ?, ?)`)
    .run(article.id, new Date().toISOString(), new Date().toISOString());

  assert.equal(repository.deleteArticle(article.id), true);
  assert.equal(repository.getArticleById(article.id), null);
  assert.equal(db.prepare("SELECT 1 FROM news_article_media WHERE article_id = ?").get(article.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM news_article_links WHERE article_id = ?").get(article.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM news_article_audit WHERE article_id = ?").get(article.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM news_article_categories WHERE article_id = ?").get(article.id), undefined);
});

test("collection applies confident catalog classification without publishing", async () => {
  const db = createTestDatabase();
  const repository = new NewsRepository(db as any);
  db.exec(`
    INSERT INTO sports (id, name, slug, status) VALUES ('sport-football', 'Football', 'football', 'active');
    INSERT INTO countries (id, name, status) VALUES ('country-england', 'England', 'active');
    INSERT INTO teams (id, name, short_name, sport_id, country_id, status) VALUES ('team-united', 'Manchester United', 'United', 'sport-football', 'country-england', 'active');
    INSERT INTO sport_countries (id, sport_id, country_id) VALUES ('sport-country-1', 'sport-football', 'country-england');
  `);
  const source = repository.createSource({ name: "Classified source", feedUrl: "https://example.com/classified.xml", enabled: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(createFeedXml("Manchester United report", "https://example.com/classified", "", "Football: England club Manchester United prepare for the weekend."), { status: 200 });
  try {
    await new NewsService(repository as any).collectSource({ sourceId: source.id });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const article = repository.listArticles({ sourceId: source.id })[0];
  assert.ok(article);
  assert.equal(article.status, "draft");
  assert.equal(article.sportId, "sport-football");
  assert.equal(article.teamId, "team-united");
  assert.equal(article.countryId, "country-england");
});
