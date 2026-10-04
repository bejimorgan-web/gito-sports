import { Router, type RequestHandler } from "express";
import { getDatabase } from "../db/connection.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiNewsTaskService } from "../services/ai-news-task-service.js";
import { getAiProviderConfiguration } from "../services/ai-news-provider.js";
import { ClaimVerificationService, createClaimVerificationRunner } from "../services/claim-verification-service.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";

export interface AiClaimsRouteDependencies { service: ClaimVerificationService }

export function createAiClaimsRouter(dependencies?: AiClaimsRouteDependencies) {
  const router = Router();
  const getService = () => dependencies?.service ?? (() => {
    const db = getDatabase(); const tasks = new AiNewsTaskRepository(db); const configuration = getAiProviderConfiguration("claim_verification");
    return new ClaimVerificationService(db, tasks, new AiNewsTaskService(tasks), (providerConfig) => createClaimVerificationRunner(tasks, providerConfig), configuration);
  })();

  router.post("/claims/extract", protectedRoute, (request, response) => {
    const operator = (request as AuthenticatedRequest).operator;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["articleId", "researchTaskId"].includes(key))) {
      response.status(400).json({ error: "claim_extraction_request_invalid" }); return;
    }
    if (typeof body.articleId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.articleId) || typeof body.researchTaskId !== "string") {
      response.status(400).json({ error: "claim_extraction_request_invalid" }); return;
    }
    try { response.json({ data: getService().extract(body.articleId, body.researchTaskId, operator?.id ?? "") }); }
    catch (error) {
      const message = error instanceof Error ? error.message : "claim_extraction_failed";
      const code = ["research_session_not_found", "story_understanding_not_found"].includes(message) ? message : "claim_extraction_failed";
      response.status(code.endsWith("not_found") ? 404 : 503).json({ error: code });
    }
  });

  router.post("/claims/verify", protectedRoute, (async (request, response) => {
    const operator = (request as AuthenticatedRequest).operator;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["claimId", "researchTaskId", "correlationId"].includes(key))) {
      response.status(400).json({ error: "claim_verification_request_invalid" }); return;
    }
    if (typeof body.claimId !== "string" || typeof body.researchTaskId !== "string" || (body.correlationId != null && typeof body.correlationId !== "string")) {
      response.status(400).json({ error: "claim_verification_request_invalid" }); return;
    }
    const idempotencyKey = request.header("idempotency-key");
    if (!idempotencyKey) { response.status(400).json({ error: "idempotency_key_required" }); return; }
    try {
      const result = await getService().verify(body.claimId, body.researchTaskId, operator?.id ?? "", operator?.role ?? "operator",
        { correlationId: body.correlationId, idempotencyKey });
      const status = result.task.status === "completed" ? 200 : result.task.status === "failed" ? 503 : result.task.status === "cancelled" ? 409 : 202;
      response.status(status).json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "claim_verification_failed";
      const known = new Set(["research_session_not_found", "claim_not_found", "ai_idempotency_conflict", "ai_idempotency_key_conflict", "ai_idempotency_key_invalid"]);
      const code = known.has(message) ? message : "claim_verification_failed";
      const status = code.endsWith("not_found") ? 404 : code.includes("idempotency") ? 409 : 503;
      response.status(status).json({ error: code });
    }
  }) as RequestHandler);

  router.get("/claims/:claimId", protectedRoute, (request, response) => {
    const operatorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const result = getService().getClaim(String(request.params.claimId ?? ""), operatorId);
    if (!result) { response.status(404).json({ error: "claim_not_found" }); return; }
    response.json({ data: result });
  });

  router.get("/research/:taskId/claims", protectedRoute, (request, response) => {
    const operatorId = (request as AuthenticatedRequest).operator?.id ?? "";
    const claims = getService().getClaimsForResearchTask(String(request.params.taskId ?? ""), operatorId);
    if (!claims) { response.status(404).json({ error: "research_session_not_found" }); return; }
    response.json({ data: claims });
  });

  return router;
}

export const aiClaimsRouter = createAiClaimsRouter();
