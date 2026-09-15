import { Router } from "express";
import type { CreateMatchRequest, UpdateMatchRequest } from "@gito/shared";
import { teamAssignedToCompetition } from "../repositories/competition-teams-repository.js";
import { MatchService } from "../services/match-service.js";
import { protectedRoute } from "../middleware/protected.js";

/** Sports fixture CRUD only. Playback is publication-delivery state, never a channel assignment. */
export const matchesRouter = Router();
const validTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

matchesRouter.get("/", (request, response) => {
  const competitionId = typeof request.query.competitionId === "string" ? request.query.competitionId : undefined;
  response.json({ data: MatchService.listMatches(competitionId ? { competitionId } : undefined) });
});
matchesRouter.post("/", (request, response) => {
  const body = request.body as CreateMatchRequest;
  if (!body.competitionId || !body.homeTeamId || !body.awayTeamId || !body.kickoffTime) { response.status(400).json({ error: "competition_home_away_kickoff_required" }); return; }
  if (body.homeTeamId === body.awayTeamId || !validTime(body.kickoffTime)) { response.status(400).json({ error: "invalid_match_request" }); return; }
  if (!teamAssignedToCompetition(body.competitionId, body.homeTeamId) || !teamAssignedToCompetition(body.competitionId, body.awayTeamId)) { response.status(400).json({ error: "team_not_assigned_to_competition" }); return; }
  response.status(201).json({ data: MatchService.createMatch({ competitionId: body.competitionId, homeTeamId: body.homeTeamId, awayTeamId: body.awayTeamId, kickoffTime: body.kickoffTime, ...(body.countryId ? { countryId: body.countryId } : {}), ...(body.sportId ? { sportId: body.sportId } : {}) }) });
});
matchesRouter.get("/:matchId", (request, response) => { const match = MatchService.getMatchById(request.params.matchId); if (!match) { response.status(404).json({ error: "match_not_found" }); return; } response.json({ data: match }); });
matchesRouter.put("/:matchId", (request, response) => { const body = request.body as UpdateMatchRequest; if (body.kickoffTime && !validTime(body.kickoffTime)) { response.status(400).json({ error: "invalid_kickoff_time" }); return; } const updated = MatchService.updateMatch(request.params.matchId, { ...(body.kickoffTime ? { kickoffTime: body.kickoffTime } : {}), ...(body.status ? { status: body.status } : {}) }); if (!updated) { response.status(404).json({ error: "match_not_found" }); return; } response.json({ data: updated }); });
matchesRouter.delete("/:matchId", protectedRoute, (request, response) => { if (!MatchService.deleteMatch(String(request.params.matchId ?? ""))) { response.status(404).json({ error: "match_not_found" }); return; } response.status(204).send(); });
