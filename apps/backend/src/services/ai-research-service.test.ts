import assert from "node:assert/strict";
import { DatabaseSync, allowSqliteInstantiation } from "../db/sqlite.js";
import test from "node:test";
import type { NewsArticle } from "@gito/shared";
import { readAiNewsSchema } from "../db/schema.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { createResearchTaskRunner, AiResearchService, SafeWebpageResearchRetriever, type ResearchDiscoveryProvider, type ResearchSourceRetriever } from "./ai-research-service.js";
import { fetchPublicTextDocumentDetailed } from "./news-rss-service.js";

const article = { id: "article-1", title: "Original article", summary: "Original summary", body: "Original body", status: "draft", sourceUrl: "https://source.example/story?utm_source=feed", createdAt: "2025-01-01T00:00:00.000Z" } as NewsArticle;
const providerConfig = { provider: "deterministic-research", model: "research-pipeline-v1", baseUrl: "", apiKey: "" };
function setup(discovery: ResearchDiscoveryProvider, retriever: ResearchSourceRetriever) {
  const db = allowSqliteInstantiation(() => new DatabaseSync(":memory:")); db.exec("PRAGMA foreign_keys=ON;");
  (db as any).transaction = (callback: () => unknown) => () => { db.exec("BEGIN IMMEDIATE"); try { const result = callback(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  db.exec("CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT, body TEXT, summary TEXT, status TEXT NOT NULL, published_at TEXT); INSERT INTO news_articles VALUES ('article-1','Original article','Original body','Original summary','draft',NULL);");
  db.exec(readAiNewsSchema());
  const tasks = new AiNewsTaskRepository(db as any); const taskService = new AiNewsTaskService(tasks);
  const storyTask = taskService.create({ taskType: "story_understanding", articleId: "article-1", promptVersion: "story-understanding-v1" }, "operator-1", providerConfig);
  tasks.start(storyTask.id); tasks.complete(storyTask.id, { subject: { primaryTopic: "Cup final" }, event: { description: "The final" }, entities: [{ name: "City" }], timeReferences: [{ text: "Saturday" }], keyClaims: [{ text: "City won" }], uncertainty: { unresolvedEntities: ["United"] } });
  const { runner, configuration } = createResearchTaskRunner(tasks, providerConfig);
  const service = new AiResearchService({ getArticleById: (id) => id === article.id ? article : null }, db as any, tasks, taskService, runner, configuration, discovery, retriever);
  return { db, tasks, service };
}

test("research persists separate sources and traceable passages; deduplicates and preserves partial failures", async () => {
  let discoveries = 0; let fetches = 0;
  const discovery: ResearchDiscoveryProvider = { name: "mock-search", async discover(request) {
    discoveries += 1; assert.match(request.query, /Cup final/); assert.match(request.query, /City won/);
    return [{ url: "https://news.example/story?utm_source=a", sourceType: "news" }, { url: "https://news.example/story?utm_source=b", sourceType: "news" }, { url: "https://failed.example/story" }];
  } };
  const retriever: ResearchSourceRetriever = { name: "mock-fetch", async retrieve(url) {
    fetches += 1; if (url.includes("failed.example")) throw new Error("private detail must not leak");
    const snapshotText = "City won the final on Saturday after scoring twice.\n\nThe match report describes the decisive goal in the second half.";
    return { url, canonicalUrl: url, title: "Match report", publisher: "Example News", author: null, publishedAt: null, httpStatus: 200,
      contentType: "text/html; charset=utf-8", retrievedAt: "2026-01-01T12:00:00.000Z", snapshotText,
      contentHash: "sha256-test", metadata: { method: "mock" } };
  } };
  const { db, service } = setup(discovery, retriever);
  const result = await service.research("article-1", "operator-1", "editor", { promptVersion: "research-v1", correlationId: "research-corr", idempotencyKey: "same" });
  assert.equal((result.task as any).taskType, "research"); assert.equal((result.task as any).articleId, "article-1");
  assert.equal((result.task as any).correlationId, "research-corr"); assert.equal((result.task as any).status, "completed");
  assert.equal(discoveries, 1); assert.equal(fetches, 2);
  const records = result.session as any; assert.equal(records.session.status, "completed_with_source_failures");
  assert.equal(records.sources.length, 2); assert.equal(records.evidence.length, 2);
  const details = new AiResearchRepository(db as any).getForActor((result.task as any).id, "operator-1") as any;
  assert.equal(details.sources.length, 2); assert.equal(details.evidence.length, 2);
  assert.equal(details.sources[0].retrievalStatus, "retrieved"); assert.equal(details.sources[0].publisher, "Example News");
  assert.equal(details.evidence[0].sourceId, details.sources[0].id);
  assert.deepEqual(details.evidence[0].location, { paragraphIndex: 0, characterStart: 0, characterEnd: "City won the final on Saturday after scoring twice.".length });
  assert.equal((result.result as any).schemaVersion, "research-v1"); assert.equal("verified" in (result.result as any), false);
  const replay = await service.research("article-1", "operator-1", "editor", { promptVersion: "research-v1", idempotencyKey: "same" });
  assert.equal((replay.task as any).id, (result.task as any).id); assert.equal(discoveries, 1);
  assert.equal(service.getForActor((result.task as any).id, "operator-2"), null);
  assert.deepEqual({ ...db.prepare("SELECT title, body, summary, status, published_at FROM news_articles WHERE id='article-1'").get() },
    { title: "Original article", body: "Original body", summary: "Original summary", status: "draft", published_at: null });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_research_sources").get()?.n, 2);
  const fresh = await service.research("article-1", "operator-1", "editor", { promptVersion: "research-v1", idempotencyKey: "fresh-session" });
  assert.notEqual((fresh.task as any).id, (result.task as any).id); assert.equal(discoveries, 2);
  db.close();
});

test("evidence extraction persistence failure is partial and does not invalidate retrieval", async () => {
  const discovery: ResearchDiscoveryProvider = { name: "mock-search", async discover() { return [{ url: "https://news.example/story" }]; } };
  const retriever: ResearchSourceRetriever = { name: "mock-fetch", async retrieve(url) { const snapshotText = "A sufficiently detailed paragraph that can be linked to the retrieved source and its exact location."; return {
    url, canonicalUrl: url, title: null, publisher: null, author: null, publishedAt: null, httpStatus: 200, contentType: "text/html", retrievedAt: "2026-01-01T00:00:00Z",
    snapshotText, contentHash: "hash", metadata: {} }; } };
  const { db, service } = setup(discovery, retriever);
  db.exec("CREATE TRIGGER fail_evidence BEFORE INSERT ON ai_research_evidence BEGIN SELECT RAISE(FAIL, 'test-only'); END;");
  const result = await service.research("article-1", "operator-1", "editor", { promptVersion: "research-v1" });
  assert.equal((result.session as any).session.status, "completed_with_source_failures");
  const details = new AiResearchRepository(db as any).getForActor((result.task as any).id, "operator-1") as any;
  assert.equal(details.sources[0].retrievalStatus, "retrieved");
  assert.equal(details.sources[0].retrievalMetadata.evidenceExtractionStatus, "failed");
  assert.equal(details.evidence.length, 0);
  db.close();
});

test("Phase 1 cancellation updates the linked research session", () => {
  const discovery: ResearchDiscoveryProvider = { name: "mock-search", async discover() { return []; } };
  const retriever: ResearchSourceRetriever = { name: "mock-fetch", async retrieve(url) { throw new Error(url); } };
  const { db, tasks } = setup(discovery, retriever);
  const taskService = new AiNewsTaskService(tasks);
  const task = taskService.create({ taskType: "research", articleId: "article-1", promptVersion: "research-v1" }, "operator-1", providerConfig);
  const researchRepo = new AiResearchRepository(db as any);
  const sessionId = researchRepo.createSession({ taskId: task.id, articleId: "article-1", actorId: "operator-1", correlationId: task.correlationId,
    promptVersion: "research-v1", querySummary: "cancel test", discoveryProvider: "mock-search", retrievalProvider: "mock-fetch" });
  tasks.cancel(task.id);
  assert.equal((researchRepo.getForActor(task.id, "operator-1")?.session as any).id, sessionId);
  assert.equal((researchRepo.getForActor(task.id, "operator-1")?.session as any).status, "cancelled");
  db.close();
});

test("retrieval rejects local, loopback, private, metadata and unsupported URLs; redirects are revalidated", async () => {
  for (const url of ["http://localhost/a", "http://127.0.0.1/a", "http://192.168.1.9/a", "http://169.254.169.254/latest/meta-data", "http://[::1]/a", "http://[fd00::1]/a", "http://[::ffff:7f00:1]/a", "file:///etc/passwd"]) {
    await assert.rejects(fetchPublicTextDocumentDetailed(url), /rss_url_(?:private_network_not_allowed|scheme_not_allowed)/);
  }
  let fetchCount = 0;
  const redirectFetcher: typeof fetch = async () => { fetchCount += 1; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); };
  await assert.rejects(fetchPublicTextDocumentDetailed("https://8.8.8.8/source", undefined, redirectFetcher), /rss_url_private_network_not_allowed/);
  assert.equal(fetchCount, 1);
  await assert.rejects(fetchPublicTextDocumentDetailed("https://8.8.8.8/source", undefined, async () => new Response("down", { status: 502 })), /rss_fetch_failed_502/);
  await assert.rejects(fetchPublicTextDocumentDetailed("https://8.8.8.8/source", undefined, async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })), /rss_content_type_not_supported/);
  await assert.rejects(fetchPublicTextDocumentDetailed("https://8.8.8.8/source", undefined, async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "text/html" } })), /rss_response_too_large/);
});

test("safe retriever preserves retrieved metadata and a bounded normalized snapshot", async () => {
  const html = `<html><head><title>Final report</title><meta property="og:site_name" content="Sports Desk"><meta name="author" content="A. Writer"><meta property="article:published_time" content="2026-02-03T09:00:00Z"><link rel="canonical" href="/canonical-report"></head><body><p>${"The report states the team won its match. ".repeat(10)}</p></body></html>`;
  const fetcher: typeof fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const result = await new SafeWebpageResearchRetriever(fetcher).retrieve("https://8.8.8.8/report?utm_medium=test");
  assert.equal(result.title, "Final report"); assert.equal(result.publisher, "Sports Desk"); assert.equal(result.author, "A. Writer");
  assert.equal(result.publishedAt, "2026-02-03T09:00:00.000Z"); assert.match(result.canonicalUrl, /canonical-report/);
  assert.equal(result.httpStatus, 200); assert.equal(result.contentType, "text/html; charset=utf-8");
  assert.match(result.snapshotText, /team won its match/); assert.equal(result.contentHash.length, 64);
});
