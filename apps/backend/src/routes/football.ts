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

function normalizeResponseSource(source: string) {
  return ["cache", "stale_cache"].includes(source) ? "cache" : "api";
}

function buildMeta(source: string, count: number, ageMs?: number, cachedAt?: string) {
  return {
    source: normalizeResponseSource(source),
    count,
    ageMs: ageMs ?? 0,
    cachedAt: cachedAt ?? new Date().toISOString()
  };
}

footballRouter.get("/live", async (_request, response) => {
  try {
    const result = await ScoreService.listLiveScores();
    response.json({
      data: result.matches,
      meta: buildMeta(result.source, result.matches.length, result.ageMs, result.cachedAt)
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
      meta: buildMeta(result.source, result.matches.length, result.ageMs, result.cachedAt)
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
      meta: buildMeta(result.source, result.matches.length, result.ageMs, result.cachedAt)
    });
  } catch (error) {
    handleFootballError(error, response);
  }
});

footballRouter.get("/status", async (_req, res) => {
  try {
    const status = typeof (ScoreService as any).getStatus === "function"
      ? (ScoreService as any).getStatus()
      : {
          footballApiEnabled: false,
          cacheInitialized: false,
          lastFetchTime: null,
          lastResponseCount: 0,
          cacheKeys: 0
        };

    res.json(status);
  } catch (error) {
    res.json({
      footballApiEnabled: false,
      cacheInitialized: false,
      lastFetchTime: null,
      lastResponseCount: 0,
      cacheKeys: 0
    });
  }
});

footballRouter.get("/debug", async (_req, res) => {
  try {
    const debug = typeof (ScoreService as any).getDebug === "function"
      ? (ScoreService as any).getDebug()
      : {
          enabled: false,
          cacheInitialized: false,
          lastFetchTime: null,
          lastResponseCount: 0,
          lastApiStatus: null,
          lastError: null,
          lastApiRequestAt: null,
          lastCompetitionQueried: null,
          lastMatchesReceived: 0,
          cachedKeys: 0
        };

    res.json(debug);
  } catch (error) {
    res.json({
      enabled: false,
      cacheInitialized: false,
      lastFetchTime: null,
      lastResponseCount: 0,
      lastApiStatus: null,
      lastError: null,
      lastApiRequestAt: null,
      lastCompetitionQueried: null,
      lastMatchesReceived: 0,
      cachedKeys: 0
    });
  }
});

footballRouter.post("/refresh", async (_req, res) => {
  try {
    (ScoreService as any).clearCache();
    const result = await (ScoreService as any).refreshAll();
    const status = (ScoreService as any).getStatus();
    res.json({
      success: true,
      liveCount: result.liveCount ?? 0,
      todayCount: result.todayCount ?? 0,
      upcomingCount: result.upcomingCount ?? 0,
      totalCount: (result.liveCount ?? 0) + (result.todayCount ?? 0) + (result.upcomingCount ?? 0),
      lastFetchTime: status.lastFetchTime
    });
  } catch (error) {
    handleFootballError(error, res);
  }
});
