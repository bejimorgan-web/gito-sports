import { Router } from "express";

import {
  getMobileAnalyticsSummary,
  listActiveMobileAdPromotions,
  logMobileAdEvent,
  logMobileAnalyticsEvent
} from "../repositories/analytics-repository.js";

export const analyticsRouter = Router();

function parseRequestBody(requestBody: unknown) {
  if (typeof requestBody !== "object" || requestBody === null) {
    return {};
  }

  return requestBody as Record<string, unknown>;
}

analyticsRouter.get("/promotions", (_request, response) => {
  response.json({ data: listActiveMobileAdPromotions() });
});

analyticsRouter.get("/overview", (_request, response) => {
  response.json(getMobileAnalyticsSummary());
});

analyticsRouter.get("/streams", (_request, response) => {
  response.json(getMobileAnalyticsSummary());
});

analyticsRouter.get("/users", (_request, response) => {
  response.json(getMobileAnalyticsSummary());
});

analyticsRouter.get("/ads", (_request, response) => {
  response.json(getMobileAnalyticsSummary());
});

analyticsRouter.post("/event", (request, response) => {
  const body = parseRequestBody(request.body);
  const eventType = body.eventType?.toString().trim();

  if (!eventType) {
    response.status(400).json({ error: "event_type_required" });
    return;
  }

  logMobileAnalyticsEvent({
    eventType,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    matchId: typeof body.matchId === "string" ? body.matchId : undefined,
    payload: typeof body.payload === "object" && body.payload !== null ? body.payload as Record<string, unknown> : undefined,
    userAgent: request.headers["user-agent"]?.toString() ?? undefined,
    ipAddress: request.ip ?? undefined
  });

  response.json({ success: true });
});

analyticsRouter.post("/ad-event", (request, response) => {
  const body = parseRequestBody(request.body);
  const eventType = body.eventType?.toString().trim();

  if (!eventType) {
    response.status(400).json({ error: "event_type_required" });
    return;
  }

  logMobileAdEvent({
    promotionId: typeof body.promotionId === "string" ? body.promotionId : undefined,
    eventType,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    matchId: typeof body.matchId === "string" ? body.matchId : undefined,
    metadata: typeof body.metadata === "object" && body.metadata !== null ? body.metadata as Record<string, unknown> : undefined
  });

  response.json({ success: true });
});
