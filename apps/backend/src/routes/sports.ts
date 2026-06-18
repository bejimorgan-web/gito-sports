import { Router } from "express";

import type { CreateSportRequest, UpdateSportRequest } from "@gito/shared";
import type { AuthenticatedRequest } from "../middleware/protected.js";
import { normalizeSport } from "./asset-url.js";
import { CatalogService } from "../services/catalog-service.js";

export const sportsRouter = Router();

sportsRouter.get("/", (request, response) => {
  response.json({ data: CatalogService.listSports().map((sport) => normalizeSport(request, sport)) });
});

sportsRouter.get("/:sportId", (request, response) => {
  const sport = CatalogService.getSport(request.params.sportId);

  if (!sport) {
    response.status(404).json({ error: "sport_not_found" });
    return;
  }

  response.json({ data: normalizeSport(request, sport) });
});

sportsRouter.post("/", (request, response) => {
  const body = request.body as CreateSportRequest;

  if (!body.name) {
    response.status(400).json({ error: "sport_name_required" });
    return;
  }

  const sport = CatalogService.createSport(body);
  response.status(201).json({ data: normalizeSport(request, sport) });
});

sportsRouter.put("/:sportId", (request, response) => {
  const body = request.body as UpdateSportRequest;
  const updated = CatalogService.updateSport(request.params.sportId, body);

  if (!updated) {
    response.status(404).json({ error: "sport_not_found" });
    return;
  }

  response.json({ data: normalizeSport(request, updated) });
});

sportsRouter.delete("/:sportId", (request, response) => {
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  const ok = CatalogService.deleteSport(request.params.sportId, operatorId);

  if (!ok) {
    response.status(409).json({
      error: "sport_in_use_or_not_found",
      message: "Sport cannot be deleted while competitions still reference it or it does not exist. Remove related competitions first."
    });
    return;
  }

  response.status(204).send();
});
