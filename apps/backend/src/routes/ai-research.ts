import { Router, type RequestHandler } from "express";
import { getDatabase } from "../db/connection.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { AiNewsTaskService } from "../services/ai-news-task-service.js";
import type { AiProviderConfiguration } from "../services/ai-news-provider.js";
import { AiResearchService, createResearchTaskRunner, RESEARCH_PROMPT_VERSION } from "../services/ai-research-service.js";

export interface AiResearchRouteDependencies { service: AiResearchService }

export function createAiResearchRouter(dependencies?: AiResearchRouteDependencies) {
  const router = Router();
  const getService = () => dependencies?.service ?? (() => {
    const db = getDatabase(); const tasks = new AiNewsTaskRepository(db);
    const configuration: AiProviderConfiguration = { provider: "deterministic-research", model: "research-pipeline-v1", baseUrl: "", apiKey: "" };
    const { runner } = createResearchTaskRunner(tasks, configuration);
    return new AiResearchService(new NewsRepository(db), db, tasks, new AiNewsTaskService(tasks), runner, configuration);
  })();

  router.post("/", protectedRoute, (async (request, response) => {
    const operator = (request as AuthenticatedRequest).operator;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["articleId", "promptVersion", "correlationId"].includes(key))) {
      response.status(400).json({ error: "research_request_invalid" }); return;
    }
    if (typeof body.articleId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.articleId)) { response.status(400).json({ error: "article_id_invalid" }); return; }
    if (body.promptVersion !== RESEARCH_PROMPT_VERSION) { response.status(400).json({ error: "research_prompt_version_unsupported" }); return; }
    if (body.correlationId != null && typeof body.correlationId !== "string") { response.status(400).json({ error: "correlation_id_invalid" }); return; }
    try {
      const result = await getService().research(body.articleId, operator?.id ?? "", operator?.role ?? "operator", {
        promptVersion: body.promptVersion, correlationId: body.correlationId, idempotencyKey: request.header("idempotency-key")
      });
      const taskStatus = (result.task as { status?: string }).status;
      const status = taskStatus === "completed" ? 200 : taskStatus === "failed" ? 503 : taskStatus === "cancelled" ? 409 : 202;
      response.status(status).json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "research_failed";
      const allowed = new Set(["article_not_found", "story_understanding_required", "research_prompt_version_unsupported", "ai_idempotency_conflict", "ai_idempotency_key_conflict", "ai_idempotency_key_invalid"]);
      const code = allowed.has(message) ? message : "research_failed";
      const status = code === "article_not_found" ? 404 : code === "story_understanding_required" ? 409 : code.includes("idempotency_conflict") ? 409 : code.includes("invalid") || code.includes("unsupported") ? 400 : 503;
      response.status(status).json({ error: code });
    }
  }) as RequestHandler);

  router.get("/:taskId", protectedRoute, (request, response) => {
    const actorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const result = getService().getForActor(String(request.params.taskId ?? ""), actorId);
    if (!result) { response.status(404).json({ error: "ai_task_not_found" }); return; }
    response.json({ data: result });
  });
  return router;
}

export const aiResearchRouter = createAiResearchRouter();
