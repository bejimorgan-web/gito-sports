import assert from "node:assert/strict";
import { DatabaseSync, allowSqliteInstantiation } from "../db/sqlite.js";
import test from "node:test";
import { readAiNewsSchema } from "../db/schema.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiNewsTaskRunner, AiTaskProviderRegistry, type AiProviderConfiguration, type AiTaskProviderAdapter } from "./ai-news-provider.js";
import { AiNewsTaskService, parseCreateAiNewsTaskRequest } from "./ai-news-task-service.js";

function setup() {
  const db = allowSqliteInstantiation(() => new DatabaseSync(":memory:"));
  db.exec("PRAGMA foreign_keys = ON;");
  (db as any).transaction = (callback: () => unknown) => () => {
    db.exec("BEGIN IMMEDIATE;");
    try { const result = callback(); db.exec("COMMIT;"); return result; }
    catch (error) { db.exec("ROLLBACK;"); throw error; }
  };
  db.exec("CREATE TABLE news_articles (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft');");
  db.exec(readAiNewsSchema());
  db.exec(readAiNewsSchema());
  const repository = new AiNewsTaskRepository(db as any);
  const service = new AiNewsTaskService(repository);
  return { db, repository, service };
}

const providerConfig: AiProviderConfiguration = {
  provider: "mock-provider",
  model: "mock-model-v1",
  baseUrl: "https://mock.invalid",
  apiKey: "server-only-test-secret"
};

test("creates a typed queued task with server-selected provenance", () => {
  const { db, service } = setup();
  const task = service.create({ taskType: "story_understanding", promptVersion: "story-understanding-v1", correlationId: "corr_123" }, "operator-1", providerConfig);
  assert.equal(task.status, "queued");
  assert.equal(task.provider, "mock-provider");
  assert.equal(task.model, "mock-model-v1");
  assert.equal(task.promptVersion, "story-understanding-v1");
  assert.equal(task.correlationId, "corr_123");
  assert.equal(task.actorId, "operator-1");
  assert.equal(task.actorRole, "operator");
  assert.equal(task.usage, null);
  db.close();
});

test("rejects unsupported task types and malformed prompt versions", () => {
  const { db, service } = setup();
  assert.throws(() => service.create({ taskType: "story_understanding" as any, promptVersion: "bad version" }, "operator-1", providerConfig), /ai_prompt_version_invalid/);
  assert.throws(() => service.create({ taskType: "publish" as any, promptVersion: "story-v1" }, "operator-1", providerConfig), /ai_task_type_invalid/);
  db.close();
});

test("enforces lifecycle transitions and persists successful generation provenance and nullable usage", () => {
  const { db, repository, service } = setup();
  const task = service.create({ taskType: "article_generation", promptVersion: "article-generation-v2" }, "operator-1", providerConfig);
  const running = repository.start(task.id);
  assert.equal(running.status, "running");
  const completed = repository.complete(task.id, { draft: "suggested copy" }, {
    inputTokens: 12,
    outputTokens: null,
    totalTokens: 12,
    estimatedCost: null,
    currency: null,
    providerReported: { source: "mock" }
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.usage?.inputTokens, 12);
  assert.equal(completed.usage?.outputTokens, null);
  assert.equal(repository.getGeneration(task.id)?.provider, "mock-provider");
  assert.equal(repository.getGeneration(task.id)?.promptVersion, "article-generation-v2");
  assert.equal(repository.getGeneration(task.id)?.correlationId, task.correlationId);
  assert.throws(() => repository.start(task.id), /ai_task_invalid_transition/);
  assert.throws(() => repository.cancel(task.id), /ai_task_invalid_transition/);
  db.close();
});

test("idempotency returns the existing matching task and rejects key reuse for another request", () => {
  const { db, service } = setup();
  const first = service.create({ taskType: "research", promptVersion: "research-v1", idempotencyKey: "request-001" }, "operator-1", providerConfig);
  const replay = service.create({ taskType: "research", promptVersion: "research-v1", idempotencyKey: "request-001", correlationId: "different-correlation" }, "operator-1", providerConfig);
  assert.equal(replay.id, first.id);
  assert.equal(replay.correlationId, first.correlationId);
  assert.throws(() => service.create({ taskType: "claim_extraction", promptVersion: "research-v1", idempotencyKey: "request-001" }, "operator-1", providerConfig), /ai_idempotency_conflict/);
  db.close();
});

test("task reads and cancellation are scoped to the requesting operator", () => {
  const { db, service } = setup();
  const task = service.create({ taskType: "research", promptVersion: "research-v1" }, "operator-1", providerConfig);
  assert.equal(service.getForActor(task.id, "operator-2"), null);
  assert.equal(service.cancelForActor(task.id, "operator-2"), null);
  assert.equal(service.getForActor(task.id, "operator-1")?.actorRole, "operator");
  db.close();
});

test("mock provider succeeds and provider failures leave a failed task without a generation", async () => {
  const { db, repository, service } = setup();
  const registry = new AiTaskProviderRegistry();
  const mock: AiTaskProviderAdapter = {
    provider: "mock-provider",
    capabilities: { "text-generation": true, "structured-output": true },
    async execute(_request, config) {
      assert.equal(config.apiKey, "server-only-test-secret");
      return { output: { ok: true }, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    }
  };
  registry.register(mock);
  const runner = new AiNewsTaskRunner(repository, registry, providerConfig);
  db.prepare("INSERT INTO news_articles (id, status) VALUES ('article-1', 'draft')").run();
  const successful = service.create({ taskType: "article_generation", articleId: "article-1", promptVersion: "generation-v1" }, "operator-1", providerConfig);
  assert.equal((await runner.run(successful, { candidate: "local test input" })).status, "completed");
  assert.equal(repository.getGeneration(successful.id)?.provider, "mock-provider");
  assert.equal(repository.getGeneration(successful.id)?.taskType, "article_generation");
  assert.equal(db.prepare("SELECT status FROM news_articles WHERE id = 'article-1'").get()?.status, "draft");

  const failingRegistry = new AiTaskProviderRegistry();
  failingRegistry.register({ provider: "mock-provider", capabilities: { "text-generation": true, "structured-output": true }, async execute() { throw new Error("provider secret must not persist"); } });
  const failingRunner = new AiNewsTaskRunner(repository, failingRegistry, providerConfig);
  const failed = service.create({ taskType: "editor_assistance", promptVersion: "assist-v1" }, "operator-1", providerConfig);
  const failureResult = await failingRunner.run(failed, {});
  assert.equal(failureResult.status, "failed");
  assert.equal(failureResult.failureCode, "provider_error");
  assert.equal(failureResult.failureMessage, "AI provider task failed");
  assert.equal(repository.getGeneration(failed.id), null);

  const invalidRegistry = new AiTaskProviderRegistry();
  invalidRegistry.register({ provider: "mock-provider", capabilities: { "text-generation": true, "structured-output": true }, async execute() { return { output: { malformed: true } }; } });
  const invalidRunner = new AiNewsTaskRunner(repository, invalidRegistry, providerConfig);
  const invalid = service.create({ taskType: "story_understanding", promptVersion: "story-understanding-v1" }, "operator-1", providerConfig);
  const invalidResult = await invalidRunner.run(invalid, {}, () => { throw new Error("invalid contract"); });
  assert.equal(invalidResult.status, "failed");
  assert.equal(invalidResult.failureCode, "output_validation_failed");
  assert.equal(repository.getGeneration(invalid.id), null);
  db.close();
});

test("AI task request schema rejects published status and other unsupported fields", () => {
  assert.throws(() => parseCreateAiNewsTaskRequest({ taskType: "article_generation", promptVersion: "generation-v1", status: "published" }), /ai_task_request_invalid/);
  assert.throws(() => parseCreateAiNewsTaskRequest({ taskType: "article_generation", promptVersion: "generation-v1", apiKey: "secret" }), /ai_task_request_invalid/);
  assert.equal(parseCreateAiNewsTaskRequest({ taskType: "article_generation", promptVersion: "generation-v1" }).taskType, "article_generation");
});

test("configured fallback is validated by the same task contract and provenance records the provider that succeeded", async () => {
  const { db, repository, service } = setup();
  let primaryValidated = 0; let fallbackValidated = 0;
  const primary: AiTaskProviderAdapter = { provider: "primary-protocol", capabilities: { "text-generation": true, "structured-output": true }, async execute() { return { output: { valid: false } }; } };
  const fallback: AiTaskProviderAdapter = { provider: "fallback-protocol", capabilities: { "text-generation": true, "structured-output": true }, async execute() { return { output: { valid: true }, latencyMs: 12 }; } };
  const registry = new AiTaskProviderRegistry(); registry.register(primary); registry.register(fallback);
  const config: AiProviderConfiguration = { provider: "primary-profile", adapterType: primary.provider, model: "primary-model", baseUrl: "https://primary.invalid", apiKey: "server-only-test-secret",
    fallbacks: [{ provider: "fallback-profile", adapterType: fallback.provider, model: "fallback-model", baseUrl: "https://fallback.invalid", apiKey: "fallback-secret" }] };
  const task = service.create({ taskType: "story_understanding", promptVersion: "story-understanding-v1" }, "operator-1", config);
  const runner = new AiNewsTaskRunner(repository, registry, config);
  const completed = await runner.run(task, {}, (output) => {
    if ((output as any).valid === false) { primaryValidated++; throw new Error("invalid task contract"); }
    fallbackValidated++; return output;
  });
  assert.equal(completed.status, "completed"); assert.equal(primaryValidated, 1); assert.equal(fallbackValidated, 1);
  assert.equal(completed.provider, "fallback-profile"); assert.equal(completed.model, "fallback-model");
  assert.doesNotMatch(JSON.stringify(completed), /server-only-test-secret|fallback-secret/);
  assert.equal(completed.usage?.providerReported?.latencyMs, 12);
  db.close();
});

test("rejects invalid provider usage metadata", () => {
  const { db, repository, service } = setup();
  const task = service.create({ taskType: "research", promptVersion: "research-v1" }, "operator-1", providerConfig);
  repository.start(task.id);
  assert.throws(() => repository.complete(task.id, {}, { inputTokens: -1 }), /ai_usage_inputTokens_invalid/);
  db.close();
});
