import { Router } from "express";
import { protectedRoute } from "../middleware/protected.js";
import {
  executePlayerImport,
  PlayerImportValidationError,
  previewPlayerImport,
} from "../services/player-import-service.js";
import type { PlayerImportRequest } from "@gito/shared";
import {
  createFormationTemplate,
  createPlayer,
  createSeasonSquad,
  createSquadPlayer,
  getFormationTemplateById,
  getPlayerById,
  getSeasonSquadById,
  getSquadPlayerById,
  listFormationTemplates,
  listPlayers,
  listSeasonSquads,
  listSquadPlayers,
  removeSquadPlayer,
  updateFormationTemplate,
  updatePlayer,
  updateSeasonSquad,
  updateSquadPlayer,
} from "../repositories/player-catalog-repository.js";

export const playerCatalogRouter = Router();

function importRequest(value: unknown): PlayerImportRequest {
  if (!value || typeof value !== "object") throw new Error("player_import_request_invalid");
  const request = value as Partial<PlayerImportRequest>;
  if (!["create", "update", "create-update"].includes(String(request.mode))) throw new Error("player_import_mode_invalid");
  if (!Array.isArray(request.rows) || request.rows.length === 0) throw new Error("player_import_rows_required");
  if (request.rows.length > 10_000) throw new Error("player_import_row_limit_exceeded");
  return request as PlayerImportRequest;
}

playerCatalogRouter.post("/player-import/preview", protectedRoute, (request, response) => {
  try {
    response.json({ data: previewPlayerImport(importRequest(request.body)) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

playerCatalogRouter.post("/player-import/execute", protectedRoute, (request, response) => {
  try {
    response.status(201).json({ data: executePlayerImport(importRequest(request.body)) });
  } catch (error) {
    if (error instanceof PlayerImportValidationError) {
      response.status(400).json({ error: error.message, preview: error.preview });
      return;
    }
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

playerCatalogRouter.get("/players", (request, response) => {
  response.json({ data: listPlayers({
    teamId: typeof request.query.teamId === "string" ? request.query.teamId : undefined,
    countryId: typeof request.query.countryId === "string" ? request.query.countryId : undefined,
    status: typeof request.query.status === "string" ? request.query.status : undefined,
  }) });
});
playerCatalogRouter.get("/players/:playerId", (request, response) => {
  const result = getPlayerById(request.params.playerId);
  if (!result) return response.status(404).json({ error: "player_not_found" });
  return response.json({ data: result });
});
playerCatalogRouter.post("/players", protectedRoute, (request, response) => response.status(201).json({ data: createPlayer(request.body) }));
playerCatalogRouter.put("/players/:playerId", protectedRoute, (request, response) => {
  const result = updatePlayer(String(request.params.playerId ?? ""), request.body);
  if (!result) return response.status(404).json({ error: "player_not_found" });
  return response.json({ data: result });
});

playerCatalogRouter.get("/season-squads", (request, response) => response.json({ data: listSeasonSquads({
  teamId: typeof request.query.teamId === "string" ? request.query.teamId : undefined,
  competitionId: typeof request.query.competitionId === "string" ? request.query.competitionId : undefined,
  seasonId: typeof request.query.seasonId === "string" ? request.query.seasonId : undefined,
  status: typeof request.query.status === "string" ? request.query.status : undefined,
}) }));
playerCatalogRouter.get("/season-squads/:squadId", (request, response) => {
  const result = getSeasonSquadById(request.params.squadId);
  if (!result) return response.status(404).json({ error: "season_squad_not_found" });
  return response.json({ data: result, players: listSquadPlayers(request.params.squadId) });
});
playerCatalogRouter.post("/season-squads", protectedRoute, (request, response) => response.status(201).json({ data: createSeasonSquad(request.body) }));
playerCatalogRouter.put("/season-squads/:squadId", protectedRoute, (request, response) => {
  const result = updateSeasonSquad(String(request.params.squadId ?? ""), request.body);
  if (!result) return response.status(404).json({ error: "season_squad_not_found" });
  return response.json({ data: result });
});
playerCatalogRouter.get("/season-squads/:squadId/players", (request, response) => response.json({ data: listSquadPlayers(request.params.squadId) }));
playerCatalogRouter.post("/season-squads/:squadId/players", protectedRoute, (request, response) => response.status(201).json({ data: createSquadPlayer({ ...request.body, squadId: request.params.squadId }) }));
playerCatalogRouter.put("/season-squad-players/:memberId", protectedRoute, (request, response) => {
  const result = updateSquadPlayer(String(request.params.memberId ?? ""), request.body);
  if (!result) return response.status(404).json({ error: "squad_player_not_found" });
  return response.json({ data: result });
});
playerCatalogRouter.delete("/season-squad-players/:memberId", protectedRoute, (request, response) => {
  const result = removeSquadPlayer(String(request.params.memberId ?? ""));
  if (!result) return response.status(404).json({ error: "squad_player_not_found" });
  return response.json({ data: result });
});

playerCatalogRouter.get("/formation-templates", (request, response) => response.json({ data: listFormationTemplates({
  sportId: typeof request.query.sportId === "string" ? request.query.sportId : undefined,
  status: typeof request.query.status === "string" ? request.query.status : undefined,
}) }));
playerCatalogRouter.get("/formation-templates/:templateId", (request, response) => {
  const result = getFormationTemplateById(request.params.templateId);
  if (!result) return response.status(404).json({ error: "formation_template_not_found" });
  return response.json({ data: result });
});
playerCatalogRouter.post("/formation-templates", protectedRoute, (request, response) => response.status(201).json({ data: createFormationTemplate(request.body) }));
playerCatalogRouter.put("/formation-templates/:templateId", protectedRoute, (request, response) => {
  const result = updateFormationTemplate(String(request.params.templateId ?? ""), request.body);
  if (!result) return response.status(404).json({ error: "formation_template_not_found" });
  return response.json({ data: result });
});
