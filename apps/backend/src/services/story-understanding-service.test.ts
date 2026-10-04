import assert from "node:assert/strict";
import { DatabaseSync, allowSqliteInstantiation } from "../db/sqlite.js";
import test from "node:test";
import type { NewsArticle } from "@gito/shared";
import { readAiNewsSchema } from "../db/schema.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiNewsTaskRunner, AiTaskProviderRegistry, type AiProviderConfiguration } from "./ai-news-provider.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { STORY_UNDERSTANDING_PROMPT_VERSION } from "./story-understanding-contract.js";
import { StoryUnderstandingService } from "./story-understanding-service.js";

const article = {
  id: "article-1", title: "City wins", slug: "city-wins", summary: null, body: "City beat United next weekend.", bodyBlocks: [], status: "draft",
  sportId: null, competitionId: null, teamId: null, countryId: null, matchId: null, sourceId: null, sourceName: "Example", sourceUrl: null,
  externalId: null, author: null, categories: [], tags: [], contentAvailability: "full", fetchedBody: null, publishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sport: null, competition: null, team: null, country: null, match: null, source: null,
  media: [], links: []
} as unknown as NewsArticle;
const config: AiProviderConfiguration = { provider: "mock", model: "mock-v1", baseUrl: "mock:", apiKey: "" };
function output() {
  return { schemaVersion: STORY_UNDERSTANDING_PROMPT_VERSION, subject: { primaryTopic: "City win", topicSummary: null, storyType: "result", basis: "directly_stated", confidence: 0.9 },
    intent: { value: "result_report", basis: "ai_interpretation", confidence: 0.8 }, entities: [],
    event: { eventType: "result", description: "City beat United", timeReference: "next weekend", location: null, participants: [], basis: "directly_stated", confidence: 0.9 },
    timeReferences: [{ text: "next weekend", type: "relative_date", normalizedIso: null, basis: "directly_stated", confidence: 1 }], keyClaims: [],
    uncertainty: { ambiguities: [], missingInformation: [], unresolvedEntities: [], internalConflicts: [], lowConfidenceInterpretations: [] } };
}
function setup(returnOutput: () => unknown) {
  const db = allowSqliteInstantiation(() => new DatabaseSync(":memory:")); db.exec("PRAGMA foreign_keys=ON;");
  (db as any).transaction = (callback: () => unknown) => () => { db.exec("BEGIN IMMEDIATE"); try { const v = callback(); db.exec("COMMIT"); return v; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  db.exec("CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT, body TEXT, summary TEXT, status TEXT NOT NULL DEFAULT 'draft'); INSERT INTO news_articles VALUES ('article-1','Original title','Original body','Original summary','draft');");
  db.exec(readAiNewsSchema());
  const tasks = new AiNewsTaskRepository(db as any); const taskService = new AiNewsTaskService(tasks);
  const registry = new AiTaskProviderRegistry(); registry.register({ provider: "mock", capabilities: { "text-generation": true, "structured-output": true }, async execute(req) { assert.equal(req.taskType, "story_understanding"); return { output: returnOutput(), usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }; } });
  const svc = new StoryUnderstandingService({ getArticleById: (id: string) => id === article.id ? article : null } as any, tasks, taskService, new AiNewsTaskRunner(tasks, registry, config), config);
  return { db, tasks, svc };
}

test("understands one canonical article with provenance, idempotency, owner scope, and no article mutation", async () => {
  const { db, tasks, svc } = setup(output);
  const request = { promptVersion: STORY_UNDERSTANDING_PROMPT_VERSION, correlationId: "corr-story", idempotencyKey: "same-request" };
  const first = await svc.understand(article.id, "operator-1", "editor", request);
  const replay = await svc.understand(article.id, "operator-1", "editor", request);
  assert.equal(first.task.id, replay.task.id); assert.equal(first.task.taskType, "story_understanding");
  assert.equal(first.task.articleId, article.id); assert.equal(first.task.provider, "mock"); assert.equal(first.task.model, "mock-v1");
  assert.equal(first.task.promptVersion, STORY_UNDERSTANDING_PROMPT_VERSION); assert.equal(first.task.correlationId, "corr-story");
  assert.equal(first.generation?.taskType, "story_understanding"); assert.equal(first.generation?.articleId, article.id);
  assert.equal(svc.getForActor(first.task.id, "operator-2"), null);
  assert.deepEqual({ ...db.prepare("SELECT title, body, summary, status FROM news_articles WHERE id='article-1'").get() }, { title: "Original title", body: "Original body", summary: "Original summary", status: "draft" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_tasks").get()?.n, 1);
  assert.equal(tasks.getGeneration(first.task.id)?.output && (tasks.getGeneration(first.task.id)?.output as any).uncertainty.ambiguities.length, 0);
  db.close();
});

test("invalid provider output fails safely without generation or article changes", async () => {
  const { db, tasks, svc } = setup(() => ({ ...output(), verificationStatus: "verified" }));
  const result = await svc.understand(article.id, "operator-1", "operator", { promptVersion: STORY_UNDERSTANDING_PROMPT_VERSION });
  assert.equal(result.task.status, "failed"); assert.equal(result.task.failureCode, "output_validation_failed"); assert.equal(result.generation, null);
  assert.deepEqual({ ...db.prepare("SELECT status FROM news_articles WHERE id='article-1'").get() }, { status: "draft" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_generations").get()?.n, 0);
  db.close();
});

test("provider failure leaves the canonical article unchanged", async () => {
  const { db, tasks, svc } = setup(() => { throw new Error("provider-secret"); });
  const result = await svc.understand(article.id, "operator-1", "operator", { promptVersion: STORY_UNDERSTANDING_PROMPT_VERSION });
  assert.equal(result.task.status, "failed"); assert.equal(result.task.failureCode, "provider_error"); assert.equal(result.task.failureMessage, "AI provider task failed");
  assert.equal(tasks.getGeneration(result.task.id), null);
  assert.deepEqual({ ...db.prepare("SELECT title, body, summary, status FROM news_articles WHERE id='article-1'").get() }, { title: "Original title", body: "Original body", summary: "Original summary", status: "draft" });
  db.close();
});
