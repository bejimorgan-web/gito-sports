import { Response, Router } from "express";

import { ScoreService } from "../services/score-service.js";

export const footballRouter = Router();

function handleFootballError(error: unknown, response: Response) {
  const details = error as { statusCode?: number; code?: string; message?: string };
  response.status(details.statusCode ?? 500).json({
    error: details.code ?? "football_service_error",
    message: details.message ?? "Football service failed."
  });
}

footballRouter.get("/live", async (_request, response) => {
  try {
    const result = await ScoreService.listLiveScores();
    response.json({
      data: result.matches,
      meta: {
        source: result.source,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
    });
  } catch (error) {
    handleFootballError(error, response);
  }
});

footballRouter.get("/today", async (_request, response) => {
  try {
    const result = await ScoreService.listTodayMatches();
    response.json({
      data: result.matches,
      meta: {
        source: result.source,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
    });
  } catch (error) {
    handleFootballError(error, response);
  }
});

footballRouter.get("/upcoming", async (_request, response) => {
  try {
    const result = await ScoreService.listUpcomingMatches();
    response.json({
      data: result.matches,
      meta: {
        source: "football-data.org",
        count: result.matches.length,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
    });
  } catch (error) {
    handleFootballError(error, response);
  }
});

footballRouter.get("/status", async (_req, res) => {
  try {
    const status = (ScoreService as any).getStatus();
    res.json(status);
  } catch (error) {
    handleFootballError(error, res);
  }
});

footballRouter.post("/refresh", async (_req, res) => {
  try {
    (ScoreService as any).clearCache();
    const result = await (ScoreService as any).refreshAll();
    const status = (ScoreService as any).getStatus();
    res.json({ success: true, refreshed: result, status });
  } catch (error) {
    handleFootballError(error, res);
  }
});
