import crypto from "node:crypto";

import type { CreateSportRequest, EntityId, Sport } from "@gito/shared";
import { createSlug } from "@gito/shared";

import { deleteEntity } from "../services/entityDeleteService.js";
import { getDatabase } from "../db/connection.js";

interface SportRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
}

interface SportCountryRow {
  country_id: string;
}

function now() {
  return new Date().toISOString();
}

function listSportCountryIds(database: ReturnType<typeof getDatabase>, sportId: string): EntityId[] {
  const rows = database
    .prepare("SELECT country_id FROM sport_countries WHERE sport_id = ? ORDER BY country_id")
    .all(sportId) as SportCountryRow[];
  return rows.map((row) => row.country_id);
}

function persistSportCountries(database: ReturnType<typeof getDatabase>, sportId: string, countryIds: EntityId[]) {
  database.prepare("DELETE FROM sport_countries WHERE sport_id = ?").run(sportId);

  if (!countryIds.length) {
    return;
  }

  const insertStatement = database.prepare(
    "INSERT INTO sport_countries (id, sport_id, country_id, created_at) VALUES (?, ?, ?, ?)"
  );

  const timestamp = now();
  for (const countryId of countryIds) {
    insertStatement.run(crypto.randomUUID(), sportId, countryId, timestamp);
  }
}

function mapSport(row: SportRow): Sport {
  const database = getDatabase();
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.logo_url ? { logoUrl: row.logo_url } : {}),
    countryIds: listSportCountryIds(database, row.id)
  };
}

export function listSports(): Sport[] {
  const rows = getDatabase()
    .prepare("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports ORDER BY name")
    .all() as SportRow[];

  return rows.map(mapSport);
}

export function getSportById(sportId: string): Sport | undefined {
  const row = getDatabase()
    .prepare("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports WHERE id = ?")
    .get(sportId) as SportRow | undefined;

  return row ? mapSport(row) : undefined;
}

export function getSportBySlug(slug: string): Sport | undefined {
  const row = getDatabase()
    .prepare("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports WHERE slug = ?")
    .get(slug) as SportRow | undefined;

  return row ? mapSport(row) : undefined;
}

export function createSport(input: CreateSportRequest): Sport {
  const database = getDatabase();
  const timestamp = now();
  const id = crypto.randomUUID();
  const slug = createSlug(input.name);

  database
    .prepare(
      `INSERT INTO sports (id, name, slug, logo_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(id, input.name, slug, input.logoUrl ?? null, timestamp, timestamp);

  if (input.countryIds && input.countryIds.length) {
    persistSportCountries(database, id, input.countryIds);
  }

  return {
    id,
    name: input.name,
    slug,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    ...(input.countryIds ? { countryIds: input.countryIds } : {})
  };
}

export function updateSport(sportId: string, input: Partial<CreateSportRequest> & { status?: Sport["status"] }): Sport | undefined {
  const database = getDatabase();
  const existing = database
    .prepare("SELECT name, slug, logo_url, status FROM sports WHERE id = ?")
    .get(sportId) as { name: string; slug: string; logo_url: string | null; status: string } | undefined;

  if (!existing) {
    return undefined;
  }

  const updatedName = input.name ?? existing.name;
  const updatedSlug = createSlug(updatedName);
  const timestamp = now();

  database
    .prepare(
      `UPDATE sports SET name = ?, slug = ?, logo_url = ?, status = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      updatedName,
      updatedSlug,
      input.logoUrl ?? existing.logo_url,
      input.status ?? existing.status,
      timestamp,
      sportId
    );

  if (input.countryIds) {
    persistSportCountries(database, sportId, input.countryIds);
  }

  return getSportById(sportId);
}

export function deleteSport(sportId: string, operatorId?: string): boolean {
  return deleteEntity("sport", sportId, operatorId);
}
