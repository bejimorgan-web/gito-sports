import { Router } from "express";

import type { AuthenticatedRequest } from "../middleware/protected.js";
import type { CreateTeamRequest, UpdateTeamRequest } from "@gito/shared";
import { createTeam, deleteTeam, getTeamById, listTeams, updateTeam } from "../repositories/teams-repository.js";
import { getCatalogTeamById, listCatalogTeams } from "../repositories/catalog-shadow-repository.js";
import { normalizeTeam } from "./asset-url.js";

export const teamsRouter = Router();

teamsRouter.get("/", (request, response) => {
  const filters: { sportId?: string; countryId?: string } = {};
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";

  if (typeof request.query.sportId === "string") {
    filters.sportId = request.query.sportId;
  }

  if (typeof request.query.countryId === "string") {
    filters.countryId = request.query.countryId;
  }

  const teams = mode === "catalog" ? listCatalogTeams(filters) : listTeams(filters);
  response.json({ data: teams.map((team) => normalizeTeam(request, team)) });
});

teamsRouter.get("/:teamId", (request, response) => {
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";
  const team = mode === "catalog" ? getCatalogTeamById(request.params.teamId) : getTeamById(request.params.teamId);

  if (!team) {
    response.status(404).json({ error: "team_not_found" });
    return;
  }

  response.json({ data: normalizeTeam(request, team) });
});

teamsRouter.post("/", (request, response) => {
  const body = request.body as CreateTeamRequest;

  if (!body.sportId || !body.name || !body.type) {
    response.status(400).json({ error: "team_sport_name_and_type_required" });
    return;
  }

  const team = createTeam(body);
  response.status(201).json({ data: normalizeTeam(request, team) });
});

teamsRouter.put("/:teamId", (request, response) => {
  const body = request.body as UpdateTeamRequest;
  const updated = updateTeam(request.params.teamId, body);

  if (!updated) {
    response.status(404).json({ error: "team_not_found" });
    return;
  }

  response.json({ data: normalizeTeam(request, updated) });
});

teamsRouter.delete("/:teamId", (request, response) => {
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  const ok = deleteTeam(request.params.teamId, operatorId);

  if (!ok) {
    response.status(409).json({
      error: "team_in_use_or_not_found",
      message: "Team cannot be deleted while matches or competitions reference it. Remove dependent references before deleting."
    });
    return;
  }

  response.status(204).send();
});
