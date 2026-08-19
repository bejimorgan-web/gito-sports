import { Router } from "express";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { FixtureReconciliationService } from "../services/fixture-reconciliation-service.js";
import { applyHighConfidenceLinks } from "../repositories/scheduling-match-links-repository.js";

export const fixtureReconciliationRouter = Router();

function requireAdmin(request: AuthenticatedRequest, response: any, next: () => void) {
  if (request.operator?.role !== "admin") {
    response.status(403).json({ error: "admin_required" });
    return;
  }
  next();
}

fixtureReconciliationRouter.post("/preview", protectedRoute, requireAdmin, (_request, response) => {
  response.json({ data: new FixtureReconciliationService().preview() });
});

fixtureReconciliationRouter.post("/apply", protectedRoute, requireAdmin, (_request, response) => {
  const service = new FixtureReconciliationService();
  const preview = service.preview();
  const result = applyHighConfidenceLinks(preview.decisions);
  response.json({ data: { ...result, preview: preview.summary } });
});