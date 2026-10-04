import { Router, type RequestHandler } from "express";
import { getDatabase } from "../db/connection.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiNewsTaskService } from "../services/ai-news-task-service.js";
import { createArticleGenerationRunner, AiArticleGenerationService, parseArticleGenerationIntent } from "../services/ai-article-generation-service.js";
import { getAiProviderConfiguration } from "../services/ai-news-provider.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";

export interface AiArticleGenerationRouteDependencies { service: AiArticleGenerationService }

export function createAiArticleGenerationRouter(dependencies?: AiArticleGenerationRouteDependencies) {
  const router = Router();
  const getService = () => dependencies?.service ?? (() => {
    const db = getDatabase(); const tasks = new AiNewsTaskRepository(db); const configuration = getAiProviderConfiguration("article_generation");
    return new AiArticleGenerationService(db, tasks, new AiNewsTaskService(tasks), (providerConfig) => createArticleGenerationRunner(tasks, providerConfig), configuration);
  })();

  router.get("/workflow/:articleId", protectedRoute, (request, response) => {
    const actorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const articleId = String(request.params.articleId ?? "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(articleId)) { response.status(400).json({ error: "article_id_invalid" }); return; }
    const state = getService().getWorkflowState(articleId, actorId);
    if (!state.articleExists) { response.status(404).json({ error: "generation_article_not_found" }); return; }
    response.json({ data: state });
  });

  router.post("/generate-article", protectedRoute, (async (request, response) => {
    let parsed: ReturnType<typeof parseArticleGenerationIntent>;
    try { parsed = parseArticleGenerationIntent(request.body); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "generation_request_invalid" }); return; }
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey) { response.status(400).json({ error: "idempotency_key_required" }); return; }
    const operator = (request as AuthenticatedRequest).operator;
    try {
      const result = await getService().generate(parsed.articleId, operator?.id ?? "", operator?.role ?? "operator", parsed.intent,
        { correlationId: parsed.correlationId, idempotencyKey });
      const status = result.task.status === "completed" ? 200 : result.task.status === "failed" ? 503 : result.task.status === "cancelled" ? 409 : 202;
      response.status(status).json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "article_generation_failed";
      const notFound = new Set(["generation_article_not_found", "generation_story_understanding_not_found", "generation_research_session_not_found", "ai_task_article_not_found"]);
      const conflict = new Set(["ai_idempotency_conflict", "ai_idempotency_key_conflict", "ai_idempotency_key_invalid"]);
      const code = [...notFound, ...conflict, "generation_context_too_large", "generation_story_context_too_large"].includes(message) ? message : "article_generation_failed";
      response.status(notFound.has(code) ? 404 : conflict.has(code) ? 409 : code.startsWith("generation_context") ? 413 : 503).json({ error: code });
    }
  }) as RequestHandler);

  router.get("/generate-article/:taskId", protectedRoute, (request, response) => {
    const operatorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const result = getService().getTask(String(request.params.taskId ?? ""), operatorId);
    if (!result) { response.status(404).json({ error: "article_generation_task_not_found" }); return; }
    response.json({ data: result });
  });

  router.get("/articles/:articleId/generations", protectedRoute, (request, response) => {
    const operatorId = (request as AuthenticatedRequest).operator?.id ?? "";
    response.json({ data: getService().listVersions(String(request.params.articleId ?? ""), operatorId) });
  });

  router.get("/articles/:articleId/generations/:generationId", protectedRoute, (request, response) => {
    const operatorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const version = getService().getVersion(String(request.params.articleId ?? ""), String(request.params.generationId ?? ""), operatorId);
    if (!version) { response.status(404).json({ error: "article_generation_not_found" }); return; }
    response.json({ data: version });
  });

  return router;
}

export const aiArticleGenerationRouter = createAiArticleGenerationRouter();
