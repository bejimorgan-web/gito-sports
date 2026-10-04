import { Router } from "express";
import { getDatabase } from "../db/connection.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { AiNewsTaskService, parseCreateAiNewsTaskRequest } from "../services/ai-news-task-service.js";

export const aiNewsTaskRouter = Router();

function taskService() {
  return new AiNewsTaskService(new AiNewsTaskRepository(getDatabase()));
}

const createErrors = new Set([
  "ai_task_request_invalid", "ai_task_type_invalid", "ai_task_actor_required", "ai_prompt_version_invalid",
  "ai_task_article_invalid", "ai_task_article_not_found", "ai_correlation_id_invalid", "ai_idempotency_key_invalid",
  "ai_idempotency_key_conflict", "ai_idempotency_conflict"
]);

aiNewsTaskRouter.post("/", protectedRoute, (request, response) => {
  const operator = (request as AuthenticatedRequest).operator;
  const actorId = operator?.id ?? "";
  try {
    const input = parseCreateAiNewsTaskRequest(request.body, request.header("idempotency-key"));
    const task = taskService().create(input, actorId, undefined, operator?.role ?? "operator");
    response.status(202).json({ data: task });
  } catch (error) {
    const candidate = error instanceof Error ? error.message : "";
    const code = createErrors.has(candidate) ? candidate : "ai_task_create_failed";
    const status = code === "ai_task_article_not_found" ? 404 : code === "ai_idempotency_conflict" || code === "ai_idempotency_key_conflict" ? 409 : 400;
    response.status(status).json({ error: code });
  }
});

aiNewsTaskRouter.get("/:taskId", protectedRoute, (request, response) => {
  const actorId = (request as AuthenticatedRequest).operator?.id ?? "";
  const task = taskService().getForActor(String(request.params.taskId ?? ""), actorId);
  if (!task) {
    response.status(404).json({ error: "ai_task_not_found" });
    return;
  }
  response.json({ data: task });
});

aiNewsTaskRouter.post("/:taskId/cancel", protectedRoute, (request, response) => {
  const actorId = (request as AuthenticatedRequest).operator?.id ?? "";
  try {
    const task = taskService().cancelForActor(String(request.params.taskId ?? ""), actorId);
    if (!task) {
      response.status(404).json({ error: "ai_task_not_found" });
      return;
    }
    response.json({ data: task });
  } catch (error) {
    const code = error instanceof Error && error.message === "ai_task_invalid_transition" ? error.message : "ai_task_cancel_failed";
    response.status(code === "ai_task_invalid_transition" ? 409 : 400).json({ error: code });
  }
});
