import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/protected.js";
import { protectedRoute } from "../middleware/protected.js";
import { createTeam, getClubDetailById, getTeamById, listTeams, updateTeam } from "../repositories/teams-repository.js";
import { listCanonicalFixturesForTeam } from "../repositories/fixtures-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { getDatabase } from "../db/connection.js";

export const clubsRouter = Router();

clubsRouter.get("/", (request, response) => {
  const sportId = typeof request.query.sportId === "string" ? request.query.sportId : undefined;
  const countryId = typeof request.query.countryId === "string" ? request.query.countryId : undefined;
  response.json({ data: listTeams({ sportId, countryId }).filter((team) => team.type === "club") });
});

clubsRouter.get("/:clubId", (request, response) => {
  const clubId = String(request.params.clubId ?? "");
  const club = getClubDetailById(clubId);
  if (!club || club.type !== "club") { response.status(404).json({ error: "club_not_found" }); return; }
  const fixtures = listCanonicalFixturesForTeam(clubId);
  const news = new NewsRepository().listArticles({ status: "published", teamId: clubId });
  const live = fixtures.filter((fixture: any) => fixture?.status === "live");
  const streams = fixtures.flatMap((fixture: any) => fixture?.streams ?? []);
  response.json({ data: { club, competitions: club.competitions, seasons: club.seasons, fixtures, results: fixtures.filter((fixture: any) => ["ended", "completed"].includes(fixture?.status)), news, live, streams } });
});

clubsRouter.post("/", protectedRoute, (request, response) => {
  try {
    const body = request.body;
    if (!body?.sportId || !body?.name) { response.status(400).json({ error: "club_sport_and_name_required" }); return; }
    const club = createTeam({ ...body, type: "club" });
    response.status(201).json({ data: club });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("constraint") ? 409 : 400).json({ error: message });
  }
});

clubsRouter.put("/:clubId", protectedRoute, (request, response) => {
  try {
    const existing = getTeamById(String(request.params.clubId ?? ""));
    if (!existing || existing.type !== "club") { response.status(404).json({ error: "club_not_found" }); return; }
    const club = updateTeam(String(request.params.clubId ?? ""), { ...request.body, type: "club" });
    response.json({ data: club });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("constraint") ? 409 : 400).json({ error: message });
  }
});
