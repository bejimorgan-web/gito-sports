import { Response, Router } from "express";

import { ScoreService } from "../services/score-service.js";
import { getDatabase } from "../db/connection.js";

export const scoresRouter = Router();

function attachVenueImage<T extends { id: string; homeTeam?: { name?: string }; awayTeam?: { name?: string } }>(match: T): T & { venueImageUrl: string | null } {
  const rows = getDatabase().prepare(`
    SELECT m.venue_image_url, m.venue_name, h.name AS home_name, a.name AS away_name,
           h.home_stadium_name, h.home_stadium_photo_url
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE m.external_match_id = ?
  `).all(match.id) as Array<{ venue_image_url: string | null; venue_name: string | null; home_name: string; away_name: string; home_stadium_name: string | null; home_stadium_photo_url: string | null }>;
  const candidates = rows.filter((row) =>
    row.home_name.trim().toLowerCase() === match.homeTeam?.name?.trim().toLowerCase()
    && row.away_name.trim().toLowerCase() === match.awayTeam?.name?.trim().toLowerCase());
  const fixture = candidates.length === 1 ? candidates[0] : rows.length === 1 ? rows[0] : undefined;
  const venueImageUrl = fixture?.venue_image_url
    ?? (fixture && (!fixture.venue_name || fixture.venue_name === fixture.home_stadium_name) ? fixture.home_stadium_photo_url : null)
    ?? null;
  return { ...match, venueImageUrl };
}

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
      data: result.matches.map(attachVenueImage),
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
      data: attachVenueImage(result.match),
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
