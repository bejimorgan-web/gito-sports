import { randomUUID } from "node:crypto";
import type { AiNewsTask, CreateAiNewsTaskRequest } from "@gito/shared";
import type { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { getAiProviderConfiguration } from "./ai-news-provider.js";

const supportedTaskTypes = ["story_understanding", "story_clustering", "research", "claim_extraction", "claim_verification", "article_generation", "article_validation", "editor_assistance"] as const;

export class AiNewsTaskService {
  constructor(private readonly repository: AiNewsTaskRepository) {}

  create(input: CreateAiNewsTaskRequest, actorId: string, configuredProvider: ReturnType<typeof getAiProviderConfiguration> | undefined = undefined, actorRole = "operator"): AiNewsTask {
    configuredProvider ??= getAiProviderConfiguration(input.taskType);
    if (!(supportedTaskTypes as readonly string[]).includes(input.taskType)) throw new Error("ai_task_type_invalid");
    if (!actorId.trim()) throw new Error("ai_task_actor_required");
    if (!input.promptVersion || input.promptVersion.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.promptVersion)) throw new Error("ai_prompt_version_invalid");
    if (input.articleId != null && !this.repository.articleExists(input.articleId)) throw new Error("ai_task_article_not_found");
    const correlationId = input.correlationId?.trim() || randomUUID();
    if (correlationId.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(correlationId)) throw new Error("ai_correlation_id_invalid");
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey && (idempotencyKey.length > 200 || /[\r\n]/.test(idempotencyKey))) throw new Error("ai_idempotency_key_invalid");

    if (idempotencyKey) {
      const existing = this.repository.getByIdempotencyKey(actorId, idempotencyKey);
      if (existing) {
        if (existing.taskType !== input.taskType || existing.articleId !== (input.articleId ?? null) || existing.promptVersion !== input.promptVersion) {
          throw new Error("ai_idempotency_conflict");
        }
        return existing;
      }
    }

    try {
      return this.repository.create({
        taskType: input.taskType,
        articleId: input.articleId ?? null,
        actorId,
        actorRole,
        provider: configuredProvider.provider,
        model: configuredProvider.model,
        promptVersion: input.promptVersion,
        correlationId,
        idempotencyKey
      });
    } catch (error) {
      // The unique constraint is the concurrency-safe backstop for simultaneous retries.
      if (idempotencyKey) {
        const existing = this.repository.getByIdempotencyKey(actorId, idempotencyKey);
        if (existing && existing.taskType === input.taskType && existing.articleId === (input.articleId ?? null) && existing.promptVersion === input.promptVersion) return existing;
        if (existing) throw new Error("ai_idempotency_conflict");
      }
      throw error;
    }
  }

  getForActor(taskId: string, actorId: string): AiNewsTask | null {
    return this.repository.getByActorAndId(taskId, actorId);
  }

  cancelForActor(taskId: string, actorId: string): AiNewsTask | null {
    if (!this.repository.getByActorAndId(taskId, actorId)) return null;
    return this.repository.cancel(taskId);
  }
}

export function parseCreateAiNewsTaskRequest(value: unknown, idempotencyHeader?: string): CreateAiNewsTaskRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ai_task_request_invalid");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["taskType", "articleId", "promptVersion", "correlationId", "idempotencyKey"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("ai_task_request_invalid");
  if (typeof body.taskType !== "string" || !(supportedTaskTypes as readonly string[]).includes(body.taskType)) throw new Error("ai_task_type_invalid");
  if (typeof body.promptVersion !== "string") throw new Error("ai_prompt_version_invalid");
  if (body.articleId != null && typeof body.articleId !== "string") throw new Error("ai_task_article_invalid");
  if (body.correlationId != null && typeof body.correlationId !== "string") throw new Error("ai_correlation_id_invalid");
  if (body.idempotencyKey != null && typeof body.idempotencyKey !== "string") throw new Error("ai_idempotency_key_invalid");
  if (idempotencyHeader && body.idempotencyKey && idempotencyHeader !== body.idempotencyKey) throw new Error("ai_idempotency_key_conflict");
  return {
    taskType: body.taskType as CreateAiNewsTaskRequest["taskType"],
    articleId: body.articleId as string | null | undefined,
    promptVersion: body.promptVersion,
    correlationId: body.correlationId as string | undefined,
    idempotencyKey: idempotencyHeader || (body.idempotencyKey as string | null | undefined)
  };
}
