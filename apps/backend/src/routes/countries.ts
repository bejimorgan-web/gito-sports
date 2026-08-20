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
import { protectedRoute } from "../middleware/protected.js";

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

countriesRouter.post("/", protectedRoute, (request, response) => {
  const body = request.body as CreateCountryRequest;

  if (!body.name || !body.iso2Code || !body.iso3Code) {
    response.status(400).json({ error: "country_name_iso_codes_required" });
    return;
  }

  try {
    const country = createCountry(body);
    response.status(201).json({ data: normalizeCountry(request, country) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code ?? "country_error";
    response.status(code === "country_already_exists" || code === "country_in_use" ? 409 : 400).json({
      error: code,
      message
    });
  }
});

countriesRouter.put("/:countryId", protectedRoute, (request, response) => {
  const body = request.body as UpdateCountryRequest;

  try {
    const updated = updateCountry(String(request.params.countryId ?? ""), body);

    if (!updated) {
      response.status(404).json({ error: "country_not_found" });
      return;
    }

    response.json({ data: normalizeCountry(request, updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code ?? "country_error";
    response.status(code === "country_already_exists" ? 409 : 400).json({
      error: code,
      message
    });
  }
});

countriesRouter.delete("/:countryId", protectedRoute, (request, response) => {
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  try {
    const ok = deleteCountry(String(request.params.countryId ?? ""), operatorId);
    if (!ok) {
      response.status(404).json({ error: "country_not_found", message: "Country not found." });
      return;
    }
    response.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code ?? "country_delete_failed";
    response.status(code === "country_in_use" ? 409 : 400).json({ error: code, message });
  }
});
