import { Router } from "express";

import { protectedRoute } from "../middleware/protected";
import { requireMatchPublishable } from "../middleware/transition-guards";
import { MatchService } from "../services/match-service";

export const liveMatchesRouter = Router();

liveMatchesRouter.get("/", protectedRoute, (_request, response) => {
  response.json({ data: MatchService.listPublishedLiveMatches() });
});

liveMatchesRouter.get("/feed", (_request, response) => {
  response.json({ data: MatchService.listPublishedLiveMatches() });
});

liveMatchesRouter.get("/current", (_request, response) => {
  response.json({ data: MatchService.listPublishedLiveMatches() });
});

/**
 * Enhanced feed endpoint with visibility context
 * Returns live matches plus information about degraded matches
 * Useful for debugging and status dashboards
 */
liveMatchesRouter.get("/status/health", (_request, response) => {
  const feed = MatchService.getEnhancedLiveMatchFeed();
  response.json({
    data: feed
  });
});

liveMatchesRouter.post("/:matchId/publish", protectedRoute, requireMatchPublishable, (request, response) => {
  const matchId = request.params.matchId;

  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }

  const stream = MatchService.publishApprovedStreamForMatch(matchId);

  if (!stream) {
    response.status(409).json({ error: "approved_stream_required" });
    return;
  }

  response.json({ data: stream });
});

liveMatchesRouter.post("/:matchId/unpublish", protectedRoute, (request, response) => {
  response.status(405).json({
    error: "unpublish_not_supported",
    message: "Rollback publishing is not supported in the MVP lifecycle."
  });
});
