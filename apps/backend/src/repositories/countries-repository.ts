import crypto from "node:crypto";

import type { Country, CreateCountryRequest } from "@gito/shared";
import { deleteEntity } from "../services/entityDeleteService";
import { getDatabase } from "../db/connection";

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
  const id = crypto.randomUUID();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO countries (id, name, iso2_code, iso3_code, region_id, flag_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(id, input.name, input.iso2Code, input.iso3Code, input.regionId ?? null, input.flagUrl ?? null, timestamp, timestamp);

  return {
    id,
    name: input.name,
    iso2Code: input.iso2Code,
    iso3Code: input.iso3Code,
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

  const timestamp = now();

  database
    .prepare(
      `UPDATE countries SET name = ?, iso2_code = ?, iso3_code = ?, region_id = ?, flag_url = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.name ?? existing.name,
      input.iso2Code ?? existing.iso2_code,
      input.iso3Code ?? existing.iso3_code,
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
