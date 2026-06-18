import { Router } from "express";

import type { AuthenticatedRequest } from "../middleware/protected.js";
import type { CreateCountryRequest, UpdateCountryRequest } from "@gito/shared";
import {
  createCountry,
  deleteCountry,
  getCountryById,
  listCountries,
  updateCountry
} from "../repositories/countries-repository.js";
import { getHostCatalogById, listHostCatalog } from "../repositories/catalog-shadow-repository.js";
import { normalizeCountry } from "./asset-url.js";

export const countriesRouter = Router();

countriesRouter.get("/", (request, response) => {
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";

  if (mode === "catalog") {
    response.json({ data: listHostCatalog().map((country) => normalizeCountry(request, country)) });
    return;
  }

  response.json({ data: listCountries().map((country) => normalizeCountry(request, country)) });
});

countriesRouter.get("/:countryId", (request, response) => {
  const mode = request.query.mode === "catalog" ? "catalog" : "legacy";
  const country = mode === "catalog" ? getHostCatalogById(request.params.countryId) : getCountryById(request.params.countryId);

  if (!country) {
    response.status(404).json({ error: "country_not_found" });
    return;
  }

  response.json({ data: normalizeCountry(request, country) });
});

countriesRouter.post("/", (request, response) => {
  const body = request.body as CreateCountryRequest;

  if (!body.name || !body.iso2Code || !body.iso3Code) {
    response.status(400).json({ error: "country_name_iso_codes_required" });
    return;
  }

  const country = createCountry(body);
  response.status(201).json({ data: normalizeCountry(request, country) });
});

countriesRouter.put("/:countryId", (request, response) => {
  const body = request.body as UpdateCountryRequest;
  const updated = updateCountry(request.params.countryId, body);

  if (!updated) {
    response.status(404).json({ error: "country_not_found" });
    return;
  }

  response.json({ data: normalizeCountry(request, updated) });
});

countriesRouter.delete("/:countryId", (request, response) => {
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  const ok = deleteCountry(request.params.countryId, operatorId);

  if (!ok) {
    response.status(409).json({
      error: "country_in_use_or_not_found",
      message: "Country cannot be deleted while competitions, teams, or matches reference it. Remove linked entities first."
    });
    return;
  }

  response.status(204).send();
});
