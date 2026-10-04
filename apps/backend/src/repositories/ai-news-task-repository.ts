import { randomUUID } from "node:crypto";
import type { AiNewsGeneration, AiNewsTask, AiNewsTaskStatus, AiNewsTaskType, AiNewsUsageMetadata } from "@gito/shared";
import type { DatabaseSync } from "../db/sqlite.js";

export interface NewAiNewsTask {
  taskType: AiNewsTaskType;
  articleId?: string | null;
  actorId: string;
  actorRole: string;
  provider: string;
  model: string;
  promptVersion: string;
  correlationId: string;
  idempotencyKey?: string | null;
}

function parseUsage(row: any): AiNewsUsageMetadata | null {
  if (row.input_tokens == null && row.output_tokens == null && row.total_tokens == null && row.estimated_cost == null && row.currency == null && row.provider_usage_json == null) return null;
  let providerReported: Record<string, unknown> | null = null;
  if (row.provider_usage_json) {
    try { providerReported = JSON.parse(row.provider_usage_json) as Record<string, unknown>; } catch { providerReported = null; }
  }
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    estimatedCost: row.estimated_cost,
    currency: row.currency,
    providerReported
  };
}

function toTask(row: any): AiNewsTask {
  return {
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    articleId: row.news_article_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    usage: parseUsage(row)
  };
}

export class AiNewsTaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  articleExists(articleId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM news_articles WHERE id = ? LIMIT 1").get(articleId));
  }

  create(input: NewAiNewsTask): AiNewsTask {
    const task: AiNewsTask = {
      id: randomUUID(),
      taskType: input.taskType,
      status: "queued",
      articleId: input.articleId ?? null,
      actorId: input.actorId,
      actorRole: input.actorRole,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      failureCode: null,
      failureMessage: null,
      usage: null
    };
    this.db.prepare(`
      INSERT INTO ai_tasks (id, task_type, status, news_article_id, actor_id, actor_role, provider, model, prompt_version,
        correlation_id, idempotency_key, created_at)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.taskType, task.articleId ?? null, task.actorId, task.actorRole, task.provider, task.model, task.promptVersion, task.correlationId, task.idempotencyKey ?? null, task.createdAt);
    return task;
  }

  getById(taskId: string): AiNewsTask | null {
    const row = this.db.prepare("SELECT * FROM ai_tasks WHERE id = ?").get(taskId);
    return row ? toTask(row) : null;
  }

  getByActorAndId(taskId: string, actorId: string): AiNewsTask | null {
    const row = this.db.prepare("SELECT * FROM ai_tasks WHERE id = ? AND actor_id = ?").get(taskId, actorId);
    return row ? toTask(row) : null;
  }

  getByIdempotencyKey(actorId: string, key: string): AiNewsTask | null {
    const row = this.db.prepare("SELECT * FROM ai_tasks WHERE actor_id = ? AND idempotency_key = ?").get(actorId, key);
    return row ? toTask(row) : null;
  }

  start(taskId: string): AiNewsTask {
    const result = this.db.prepare(`UPDATE ai_tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`)
      .run(new Date().toISOString(), taskId);
    if (Number(result.changes) !== 1) throw new Error("ai_task_invalid_transition");
    return this.requireTask(taskId);
  }

  complete(taskId: string, output: unknown, usage?: AiNewsUsageMetadata | null, persistValidatedOutput?: () => void, actualProvider?: { provider: string; model: string }): AiNewsTask {
    const outputJson = JSON.stringify(output);
    if (outputJson === undefined) throw new Error("ai_task_output_not_serializable");
    for (const [field, value] of Object.entries({ inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, totalTokens: usage?.totalTokens })) {
      if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`ai_usage_${field}_invalid`);
    }
    if (usage?.estimatedCost != null && (!Number.isFinite(usage.estimatedCost) || usage.estimatedCost < 0)) throw new Error("ai_usage_cost_invalid");
    if (usage?.currency != null && !/^[A-Z]{3}$/.test(usage.currency)) throw new Error("ai_usage_currency_invalid");
    const providerUsageJson = usage?.providerReported == null ? null : JSON.stringify(usage.providerReported);
    if (providerUsageJson === undefined) throw new Error("ai_usage_not_serializable");
    const task = this.requireTask(taskId);
    const completedAt = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE ai_tasks SET status = 'completed', completed_at = ?, failure_code = NULL,
        provider = COALESCE(?, provider), model = COALESCE(?, model),
        failure_message = NULL, input_tokens = ?, output_tokens = ?, total_tokens = ?, estimated_cost = ?, currency = ?, provider_usage_json = ?
        WHERE id = ? AND status = 'running'`).run(
        completedAt, actualProvider?.provider ?? null, actualProvider?.model ?? null, usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.totalTokens ?? null,
        usage?.estimatedCost ?? null, usage?.currency ?? null,
        providerUsageJson, taskId
      );
      if (Number(result.changes) !== 1) throw new Error("ai_task_invalid_transition");
      this.db.prepare(`INSERT INTO ai_generations (id, task_id, news_article_id, provider, model, prompt_version, correlation_id, output_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), taskId, task.articleId ?? null, actualProvider?.provider ?? task.provider, actualProvider?.model ?? task.model, task.promptVersion, task.correlationId, outputJson, completedAt);
      persistValidatedOutput?.();
    });
    transaction();
    return this.requireTask(taskId);
  }

  fail(taskId: string, code = "provider_error"): AiNewsTask {
    const failure = code === "output_validation_failed"
      ? { code, message: "AI output failed contract validation" }
      : code === "persistence_error"
        ? { code, message: "AI result could not be safely persisted" }
        : code === "capability_unsupported"
          ? { code: "provider_capability_unsupported", message: "The selected AI provider lacks a required capability" }
        : { code: "provider_error", message: "AI provider task failed" };
    const result = this.db.prepare(`UPDATE ai_tasks SET status = 'failed', completed_at = ?, failure_code = ?, failure_message = ?
      WHERE id = ? AND status = 'running'`).run(new Date().toISOString(), failure.code, failure.message, taskId);
    if (Number(result.changes) !== 1) throw new Error("ai_task_invalid_transition");
    return this.requireTask(taskId);
  }

  cancel(taskId: string): AiNewsTask {
    const result = this.db.prepare(`UPDATE ai_tasks SET status = 'cancelled', completed_at = ?
      WHERE id = ? AND status IN ('queued', 'running')`).run(new Date().toISOString(), taskId);
    if (Number(result.changes) !== 1) throw new Error("ai_task_invalid_transition");
    this.db.prepare("UPDATE ai_research_sessions SET status = 'cancelled', completed_at = ?, failure_code = 'cancelled', failure_message = 'Research task was cancelled' WHERE task_id = ? AND status = 'running'")
      .run(new Date().toISOString(), taskId);
    return this.requireTask(taskId);
  }

  getGeneration(taskId: string): AiNewsGeneration | null {
    const row = this.db.prepare(`SELECT g.*, t.task_type FROM ai_generations g
      JOIN ai_tasks t ON t.id = g.task_id WHERE g.task_id = ?`).get(taskId) as any;
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      taskType: row.task_type,
      articleId: row.news_article_id,
      provider: row.provider,
      model: row.model,
      promptVersion: row.prompt_version,
      correlationId: row.correlation_id,
      output: JSON.parse(row.output_json),
      createdAt: row.created_at
    };
  }

  private requireTask(taskId: string): AiNewsTask {
    const task = this.getById(taskId);
    if (!task) throw new Error("ai_task_not_found");
    return task;
  }
}
