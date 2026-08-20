import crypto from "node:crypto";

import type { Country, CreateCountryRequest } from "@gito/shared";
import { deleteEntity } from "../services/entityDeleteService.js";
import { getDatabase } from "../db/connection.js";

interface CountryRow {
  id: string;
  name: string;
  iso2_code: string;
  iso3_code: string;
  region_id: string | null;
  flag_url: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
}

type CountryConflictError = Error & { code?: string; field?: string };

function normalizeCountryCode(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = value.trim();
  return normalized ? normalized.toUpperCase() : undefined;
}

function normalizeCountryName(value: string): string {
  return value.trim();
}

function validateCountryCodes(iso2Code: string | undefined, iso3Code: string | undefined) {
  if (!iso2Code || !/^[A-Z]{2}$/.test(iso2Code)) {
    throw Object.assign(new Error("ISO2 must be exactly 2 uppercase letters."), { code: "country_iso2_invalid" });
  }

  if (!iso3Code || !/^[A-Z]{3}$/.test(iso3Code)) {
    throw Object.assign(new Error("ISO3 must be exactly 3 uppercase letters."), { code: "country_iso3_invalid" });
  }

  if (iso2Code === "XX") {
    throw Object.assign(new Error("ISO2 XX is reserved and cannot be used as a country code."), { code: "country_iso2_reserved" });
  }
}

function findCountryConflict(
  database: ReturnType<typeof getDatabase>,
  payload: { iso2Code?: string; iso3Code?: string },
  excludeId?: string
): { id: string; name: string; iso2_code: string; iso3_code: string } | undefined {
  const iso2Code = normalizeCountryCode(payload.iso2Code);
  const iso3Code = normalizeCountryCode(payload.iso3Code);

  if (!iso2Code && !iso3Code) {
    return undefined;
  }

  const params: string[] = [];
  const clauses: string[] = [];

  if (iso2Code) {
    params.push(iso2Code);
    clauses.push("UPPER(TRIM(iso2_code)) = ?");
  }

  if (iso3Code) {
    params.push(iso3Code);
    clauses.push("UPPER(TRIM(iso3_code)) = ?");
  }

  if (excludeId) {
    params.push(excludeId);
  }

  const where = clauses.length === 0 ? "1 = 0" : `(${clauses.join(" OR ")})`;
  const extra = excludeId ? "AND id != ?" : "";

  return database
    .prepare(
      `SELECT id, name, iso2_code, iso3_code FROM countries WHERE ${where} ${extra}`.trim()
    )
    .get(...params) as { id: string; name: string; iso2_code: string; iso3_code: string } | undefined;
}

function buildCountryConflictError(existing: { name: string }, field: "iso2Code" | "iso3Code", value: string): CountryConflictError {
  const label = field === "iso2Code" ? "ISO2" : "ISO3";
  const error = new Error(`${existing.name} already exists for ${label} ${value}.`) as CountryConflictError;
  error.code = "country_already_exists";
  error.field = field;
  return error;
}

function now() {
  return new Date().toISOString();
}

function mapCountry(row: CountryRow): Country {
  return {
    id: row.id,
    name: row.name,
    iso2Code: row.iso2_code,
    iso3Code: row.iso3_code,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.region_id ? { regionId: row.region_id } : {}),
    ...(row.flag_url ? { flagUrl: row.flag_url } : {})
  };
}

export function listCountries(): Country[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, iso2_code, iso3_code, region_id, flag_url, status, created_at, updated_at
       FROM countries ORDER BY name`
    )
    .all() as CountryRow[];

  return rows.map(mapCountry);
}

export function getCountryById(countryId: string): Country | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, name, iso2_code, iso3_code, region_id, flag_url, status, created_at, updated_at
       FROM countries WHERE id = ?`
    )
    .get(countryId) as CountryRow | undefined;

  return row ? mapCountry(row) : undefined;
}

export function createCountry(input: CreateCountryRequest): Country {
  const database = getDatabase();
  const normalizedName = normalizeCountryName(input.name);
  const iso2Code = normalizeCountryCode(input.iso2Code);
  const iso3Code = normalizeCountryCode(input.iso3Code);

  if (!normalizedName || !iso2Code || !iso3Code) {
    throw Object.assign(new Error("Country name and ISO codes are required."), { code: "country_validation_failed" });
  }
  validateCountryCodes(iso2Code, iso3Code);

  const conflict = findCountryConflict(database, { iso2Code, iso3Code });
  if (conflict) {
    const duplicateField = iso2Code && conflict.iso2_code && iso2Code === conflict.iso2_code.toUpperCase() ? "iso2Code" : "iso3Code";
    throw buildCountryConflictError(conflict, duplicateField, duplicateField === "iso2Code" ? iso2Code : iso3Code);
  }

  const id = crypto.randomUUID();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO countries (id, name, iso2_code, iso3_code, region_id, flag_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(id, normalizedName, iso2Code, iso3Code, input.regionId ?? null, input.flagUrl ?? null, timestamp, timestamp);

  return {
    id,
    name: normalizedName,
    iso2Code,
    iso3Code,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.regionId ? { regionId: input.regionId } : {}),
    ...(input.flagUrl ? { flagUrl: input.flagUrl } : {})
  };
}

export function updateCountry(countryId: string, input: Partial<CreateCountryRequest> & { status?: Country["status"] }): Country | undefined {
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT name, iso2_code, iso3_code, region_id, flag_url, status FROM countries WHERE id = ?`
    )
    .get(countryId) as { name: string; iso2_code: string; iso3_code: string; region_id: string | null; flag_url: string | null; status: string } | undefined;

  if (!existing) {
    return undefined;
  }

  const nextName = input.name ? normalizeCountryName(input.name) : existing.name;
  const nextIso2Code = normalizeCountryCode(input.iso2Code ?? existing.iso2_code);
  const nextIso3Code = normalizeCountryCode(input.iso3Code ?? existing.iso3_code);

  if (!nextName || !nextIso2Code || !nextIso3Code) {
    throw Object.assign(new Error("Country name and ISO codes are required."), { code: "country_validation_failed" });
  }
  validateCountryCodes(nextIso2Code, nextIso3Code);

  const conflict = findCountryConflict(database, { iso2Code: nextIso2Code, iso3Code: nextIso3Code }, countryId);
  if (conflict) {
    const duplicateField = nextIso2Code && conflict.iso2_code && nextIso2Code === conflict.iso2_code.toUpperCase() ? "iso2Code" : "iso3Code";
    throw buildCountryConflictError(conflict, duplicateField, duplicateField === "iso2Code" ? nextIso2Code : nextIso3Code);
  }

  const timestamp = now();

  database
    .prepare(
      `UPDATE countries SET name = ?, iso2_code = ?, iso3_code = ?, region_id = ?, flag_url = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextName,
      nextIso2Code,
      nextIso3Code,
      input.regionId ?? existing.region_id,
      input.flagUrl ?? existing.flag_url,
      input.status ?? existing.status,
      timestamp,
      countryId
    );

  return getCountryById(countryId);
}

export function deleteCountry(countryId: string, operatorId?: string): boolean {
  return deleteEntity("country", countryId, operatorId);
}
