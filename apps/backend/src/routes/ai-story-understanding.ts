import { Router, type RequestHandler } from "express";
import { getDatabase } from "../db/connection.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { AiNewsTaskService } from "../services/ai-news-task-service.js";
import { AiNewsTaskRunner, createAiTaskProviderRegistry, getAiProviderConfiguration } from "../services/ai-news-provider.js";
import { StoryUnderstandingInputError, StoryUnderstandingService } from "../services/story-understanding-service.js";
import { STORY_UNDERSTANDING_PROMPT_VERSION } from "../services/story-understanding-contract.js";

export interface StoryUnderstandingRouteDependencies {
  service: StoryUnderstandingService;
}

export function createStoryUnderstandingRouter(dependencies?: StoryUnderstandingRouteDependencies) {
  const router = Router();
  const getService = () => dependencies?.service ?? (() => {
    const db = getDatabase();
    const tasks = new AiNewsTaskRepository(db);
    const config = getAiProviderConfiguration("story_understanding");
    const registry = createAiTaskProviderRegistry();
    return new StoryUnderstandingService(new NewsRepository(db), tasks, new AiNewsTaskService(tasks), new AiNewsTaskRunner(tasks, registry, config), config);
  })();

  router.post("/", protectedRoute, (async (request, response) => {
    const operator = (request as AuthenticatedRequest).operator;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["articleId", "promptVersion", "correlationId"].includes(key))) {
      response.status(400).json({ error: "story_understanding_request_invalid" }); return;
    }
    if (typeof body.articleId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.articleId)) { response.status(400).json({ error: "article_id_invalid" }); return; }
    if (body.promptVersion !== STORY_UNDERSTANDING_PROMPT_VERSION) { response.status(400).json({ error: "prompt_version_unsupported" }); return; }
    if (body.correlationId != null && typeof body.correlationId !== "string") { response.status(400).json({ error: "correlation_id_invalid" }); return; }
    const headerKey = request.header("idempotency-key");
    try {
      const result = await getService().understand(body.articleId, operator?.id ?? "", operator?.role ?? "operator", {
        promptVersion: body.promptVersion,
        correlationId: body.correlationId,
        idempotencyKey: headerKey
      });
      const status = result.task.status === "completed" ? 200 : result.task.status === "failed" ? 503 : 202;
      response.status(status).json({ data: result });
    } catch (error) {
      const code = error instanceof StoryUnderstandingInputError ? error.code : "story_understanding_failed";
      const status = code === "article_not_found" ? 404 : code === "article_input_too_large" ? 413 : code === "prompt_version_unsupported" ? 400 : 503;
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

export const aiStoryUnderstandingRouter = createStoryUnderstandingRouter();
