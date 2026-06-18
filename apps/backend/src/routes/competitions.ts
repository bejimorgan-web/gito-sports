import { Router } from "express";

import type { AuthenticatedRequest } from "../middleware/protected";
import type { CreateCompetitionRequest, UpdateCompetitionRequest } from "@gito/shared";
import {
  createCompetition,
  deleteCompetition,
  getCompetitionById,
  listCompetitions,
  updateCompetition
} from "../repositories/competitions-repository";
import {
  assignTeamToCompetition,
  listTeamsForCompetition,
  removeTeamFromCompetition,
  teamAssignedToCompetition
} from "../repositories/competition-teams-repository";
import { listCatalogCompetitions, getCatalogCompetitionById } from "../repositories/catalog-shadow-repository";
import { normalizeCompetition } from "./asset-url";

export const competitionsRouter = Router();

competitionsRouter.get("/", (request, response) => {
  const filters: { sportId?: string; countryId?: string } = {};
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";

  if (typeof request.query.sportId === "string") {
    filters.sportId = request.query.sportId;
  }

  if (typeof request.query.countryId === "string") {
    filters.countryId = request.query.countryId;
  }

  const competitions = mode === "catalog" ? listCatalogCompetitions(filters) : listCompetitions(filters);
  response.json({ data: competitions.map((competition) => normalizeCompetition(request, competition)) });
});

competitionsRouter.get("/:competitionId", (request, response) => {
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";
  const competition = mode === "catalog" ? getCatalogCompetitionById(request.params.competitionId) : getCompetitionById(request.params.competitionId);

  if (!competition) {
    response.status(404).json({ error: "competition_not_found" });
    return;
  }

  response.json({ data: normalizeCompetition(request, competition) });
});

competitionsRouter.post("/", (request, response) => {
  const body = request.body as CreateCompetitionRequest;

  if (!body.sportId || !body.name || !body.scope || !body.type) {
    response.status(400).json({ error: "competition_sport_name_scope_and_type_required" });
    return;
  }

  const competition = createCompetition(body);
  response.status(201).json({ data: normalizeCompetition(request, competition) });
});

competitionsRouter.put("/:competitionId", (request, response) => {
  const body = request.body as UpdateCompetitionRequest;
  const updated = updateCompetition(request.params.competitionId, body);

  if (!updated) {
    response.status(404).json({ error: "competition_not_found" });
    return;
  }

  response.json({ data: normalizeCompetition(request, updated) });
});

competitionsRouter.delete("/:competitionId", (request, response) => {
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  const ok = deleteCompetition(request.params.competitionId, operatorId);

  if (!ok) {
    response.status(409).json({
      error: "competition_in_use_or_not_found",
      message: "Competition cannot be deleted while matches or team assignments reference it. Remove linked records first."
    });
    return;
  }

  response.status(204).send();
});

// Competition teams management
competitionsRouter.post("/:competitionId/teams", (request, response) => {
  const competitionId = request.params.competitionId;
  const { teamId } = request.body as { teamId?: string };

  if (!teamId) {
    response.status(400).json({ error: "team_id_required" });
    return;
  }

  // prevent duplicates
  if (teamAssignedToCompetition(competitionId, teamId)) {
    response.status(409).json({ error: "team_already_assigned" });
    return;
  }

  const ok = assignTeamToCompetition(competitionId, teamId);

  if (!ok) {
    response.status(500).json({ error: "assignment_failed" });
    return;
  }

  response.status(201).json({ data: { competitionId, teamId } });
});

competitionsRouter.get("/:competitionId/teams", (request, response) => {
  const teams = listTeamsForCompetition(request.params.competitionId);
  response.json({ data: teams });
});

competitionsRouter.delete("/:competitionId/teams/:teamId", (request, response) => {
  const ok = removeTeamFromCompetition(request.params.competitionId, request.params.teamId);

  if (!ok) {
    response.status(404).json({ error: "assignment_not_found" });
    return;
  }

  response.status(204).send();
});
