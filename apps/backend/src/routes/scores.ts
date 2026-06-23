import { Response, Router } from "express";

import { ScoreService } from "../services/score-service.js";

export const scoresRouter = Router();

function handleScoreError(error: unknown, response: Response) {
  const details = error as { statusCode?: number; code?: string; message?: string };
  response.status(details.statusCode ?? 500).json({
    error: details.code ?? "score_service_error",
    message: details.message ?? "Live score service failed."
  });
}

function buildScoreMeta(source: string, count: number, ageMs?: number, cachedAt?: string) {
  return {
    source: ["cache", "stale_cache"].includes(source) ? "cache" : "api",
    count,
    ageMs: ageMs ?? 0,
    cachedAt: cachedAt ?? new Date().toISOString()
  };
}

scoresRouter.get("/live", async (_request, response) => {
  try {
    const result = await ScoreService.listLiveScores();
    response.json({
      data: result.matches,
      meta: buildScoreMeta(result.source, result.matches.length, result.ageMs, result.cachedAt)
    });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/match/:id", async (request, response) => {
  try {
    const result = await ScoreService.getMatch(request.params.id);

    if (!result) {
      response.status(404).json({ error: "score_match_not_found" });
      return;
    }

    response.json({
      data: result.match,
      meta: {
        source: result.source,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
    });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/competitions", async (_request, response) => {
  try {
    response.json({ data: await ScoreService.listCompetitions() });
  } catch (error) {
    handleScoreError(error, response);
  }
});
