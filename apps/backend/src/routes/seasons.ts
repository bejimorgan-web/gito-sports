import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/protected.js";
import { protectedRoute } from "../middleware/protected.js";
import { createSeason, getSeasonById, listSeasons, updateSeason } from "../repositories/seasons-repository.js";
import { createSeasonTeamMembership, deleteSeasonTeamMembership, listSeasonTeamMemberships } from "../repositories/competition-season-teams-repository.js";

function handleError(error: unknown, response: any) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.endsWith("_not_found") ? 404 : message.includes("duplicate") || message.includes("mismatch") ? 409 : 400;
  response.status(status).json({ error: message });
}

export const seasonsRouter = Router();
export const competitionSeasonsRouter = Router({ mergeParams: true });

competitionSeasonsRouter.get("/", (request, response) => {
  response.json({ data: listSeasons(String((request.params as any).competitionId ?? "")) });
});

competitionSeasonsRouter.post("/", protectedRoute, (request, response) => {
  try {
    const season = createSeason(String(request.params.competitionId ?? ""), request.body);
    response.status(201).json({ data: season });
  } catch (error) { handleError(error, response); }
});

competitionSeasonsRouter.get("/:seasonId/teams", (request, response) => {
  try { response.json({ data: listSeasonTeamMemberships(String((request.params as any).competitionId ?? ""), String(request.params.seasonId ?? "")) }); }
  catch (error) { handleError(error, response); }
});

competitionSeasonsRouter.post("/:seasonId/teams", protectedRoute, (request, response) => {
  try {
    const membership = createSeasonTeamMembership(String(request.params.competitionId ?? ""), String(request.params.seasonId ?? ""), String(request.body?.teamId ?? ""));
    response.status(201).json({ data: membership });
  } catch (error) { handleError(error, response); }
});

competitionSeasonsRouter.delete("/:seasonId/teams/:teamId", protectedRoute, (request, response) => {
  try {
    if (!deleteSeasonTeamMembership(String(request.params.competitionId ?? ""), String(request.params.seasonId ?? ""), String(request.params.teamId ?? ""))) {
      response.status(404).json({ error: "season_team_membership_not_found" });
      return;
    }
    response.status(204).send();
  } catch (error) { handleError(error, response); }
});

seasonsRouter.get("/:seasonId", (request, response) => {
  const season = getSeasonById(String(request.params.seasonId ?? ""));
  if (!season) { response.status(404).json({ error: "season_not_found" }); return; }
  response.json({ data: season });
});

seasonsRouter.put("/:seasonId", protectedRoute, (request, response) => {
  try {
    const season = updateSeason(String(request.params.seasonId ?? ""), request.body);
    if (!season) { response.status(404).json({ error: "season_not_found" }); return; }
    response.json({ data: season });
  } catch (error) { handleError(error, response); }
});
