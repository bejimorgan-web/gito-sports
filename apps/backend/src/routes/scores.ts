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

scoresRouter.get("/live", async (_request, response) => {
  try {
    const result = await ScoreService.listLiveScores();
    response.json({
      data: result.matches,
      meta: {
        source: result.source === "cache" ? "cache" : "api",
        count: result.matches.length,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
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
