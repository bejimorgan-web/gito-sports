import crypto from "node:crypto";

import type { Competition, CreateCompetitionRequest } from "@gito/shared";
import { createSlug } from "@gito/shared";

import { deleteEntity } from "../services/entityDeleteService.js";
import { getDatabase } from "../db/connection.js";

interface CompetitionRow {
  id: string;
  sport_id: string;
  country_id: string | null;
  region_id: string | null;
  name: string;
  slug: string;
  scope: string;
  competition_type: string;
  participant_type: string;
  logo_url: string | null;
  current_season_id: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
}

function now() {
  return new Date().toISOString();
}

function createUniqueCompetitionSlug(database: ReturnType<typeof getDatabase>, baseSlug: string, excludeId?: string): string {
  let slug = baseSlug || "competition";
  let suffix = 1;
  let existing;

  if (excludeId) {
    existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ? AND id != ?").get(slug, excludeId);
  } else {
    existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ?").get(slug);
  }

  while (existing) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
    if (excludeId) {
      existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ? AND id != ?").get(slug, excludeId);
    } else {
      existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ?").get(slug);
    }
  }

  return slug;
}

function mapCompetition(row: CompetitionRow): Competition {
  return {
    id: row.id,
    sportId: row.sport_id,
    name: row.name,
    slug: row.slug,
    scope: row.scope as Competition["scope"],
    type: row.competition_type as Competition["type"],
    participantType: (row.participant_type ?? "clubs") as Competition["participantType"],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.country_id ? { countryId: row.country_id } : {}),
    ...(row.region_id ? { regionId: row.region_id } : {}),
    ...(row.current_season_id ? { currentSeasonId: row.current_season_id } : {}),
    ...(row.logo_url ? { logoUrl: row.logo_url } : {})
  };
}

export function listCompetitions(filters?: { sportId?: string; countryId?: string }): Competition[] {
  const database = getDatabase();
  const conditions: string[] = [];
  const parameters: Array<string> = [];

  if (filters?.sportId) {
    conditions.push("sport_id = ?");
    parameters.push(filters.sportId);
  }

  if (filters?.countryId) {
    conditions.push("country_id = ?");
    parameters.push(filters.countryId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = database
    .prepare(
      `SELECT id, sport_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status, created_at, updated_at
       FROM competitions ${where} ORDER BY name`
    )
    .all(...parameters) as CompetitionRow[];

  return rows.map(mapCompetition);
}

export function getCompetitionById(competitionId: string): Competition | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, sport_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status, created_at, updated_at
       FROM competitions WHERE id = ?`
    )
    .get(competitionId) as CompetitionRow | undefined;

  return row ? mapCompetition(row) : undefined;
}

export function createCompetition(input: CreateCompetitionRequest): Competition {
  const database = getDatabase();
  const id = crypto.randomUUID();
  const timestamp = now();
  const baseSlug = createSlug(input.name);
  const slug = createUniqueCompetitionSlug(database, baseSlug);

  database
    .prepare(
      `INSERT INTO competitions (id, sport_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      id,
      input.sportId,
      input.countryId ?? null,
      input.regionId ?? null,
      input.name,
      slug,
      input.scope,
      input.type,
      input.participantType ?? 'clubs',
      input.logoUrl ?? null,
      input.currentSeasonId ?? null,
      timestamp,
      timestamp
    );

  return {
    id,
    sportId: input.sportId,
    name: input.name,
    slug,
    scope: input.scope,
    type: input.type,
    participantType: input.participantType ?? "clubs",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.countryId ? { countryId: input.countryId } : {}),
    ...(input.regionId ? { regionId: input.regionId } : {}),
    ...(input.currentSeasonId ? { currentSeasonId: input.currentSeasonId } : {}),
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {})
  };
}

export function updateCompetition(
  competitionId: string,
  input: Partial<CreateCompetitionRequest> & { status?: Competition["status"] }
): Competition | undefined {
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT sport_id, country_id, region_id, name, slug, scope, competition_type, participant_type, logo_url, current_season_id, status
       FROM competitions WHERE id = ?`
    )
    .get(competitionId) as
    | {
        sport_id: string;
        country_id: string | null;
        region_id: string | null;
        name: string;
        slug: string;
        scope: string;
        competition_type: string;
        participant_type: string;
        logo_url: string | null;
        current_season_id: string | null;
        status: string;
      }
    | undefined;

  if (!existing) {
    return undefined;
  }

  const updatedName = input.name ?? existing.name;
  const baseSlug = createSlug(updatedName);
  const updatedSlug = createUniqueCompetitionSlug(database, baseSlug, competitionId);
  const timestamp = now();

  database
    .prepare(
      `UPDATE competitions SET sport_id = ?, country_id = ?, region_id = ?, name = ?, slug = ?, scope = ?, competition_type = ?, participant_type = ?, logo_url = ?, current_season_id = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.sportId ?? existing.sport_id,
      input.countryId ?? existing.country_id,
      input.regionId ?? existing.region_id,
      updatedName,
      updatedSlug,
      input.scope ?? existing.scope,
      input.type ?? existing.competition_type,
      input.participantType ?? existing.participant_type,
      input.logoUrl ?? existing.logo_url,
      input.currentSeasonId ?? existing.current_season_id,
      input.status ?? existing.status,
      timestamp,
      competitionId
    );

  return getCompetitionById(competitionId);
}

export function deleteCompetition(competitionId: string, operatorId?: string): boolean {
  return deleteEntity("competition", competitionId, operatorId);
}
