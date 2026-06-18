import { getDatabase } from "../db/connection.js";
import type { Competition, Country, Team } from "@gito/shared";

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

interface TeamRow {
  id: string;
  sport_id: string;
  country_id: string | null;
  name: string;
  short_name: string | null;
  type: string;
  logo_url: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
}

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

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    sportId: row.sport_id,
    name: row.name,
    type: row.type as Team["type"],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.country_id ? { countryId: row.country_id } : {}),
    ...(row.short_name ? { shortName: row.short_name } : {}),
    ...(row.logo_url ? { logoUrl: row.logo_url } : {})
  };
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

export function listHostCatalog(): Country[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.id, c.name, c.iso2_code, c.iso3_code, c.region_id, c.flag_url, c.status, c.created_at, c.updated_at
       FROM entity_catalog_mapping m
       JOIN countries c ON c.id = m.legacy_id
       WHERE m.catalog_type = 'hosts'
       ORDER BY c.name`
    )
    .all() as CountryRow[];

  return rows.map(mapCountry);
}

export function getHostCatalogById(hostId: string): Country | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT c.id, c.name, c.iso2_code, c.iso3_code, c.region_id, c.flag_url, c.status, c.created_at, c.updated_at
       FROM entity_catalog_mapping m
       JOIN countries c ON c.id = m.legacy_id
       WHERE m.catalog_type = 'hosts' AND m.legacy_id = ?`
    )
    .get(hostId) as CountryRow | undefined;

  return row ? mapCountry(row) : undefined;
}

export function listCatalogTeams(filters?: { sportId?: string; countryId?: string }): Team[] {
  const conditions: string[] = ["m.catalog_type IN ('clubs','nationalTeams')"];
  const parameters: Array<string> = [];

  if (filters?.sportId) {
    conditions.push("t.sport_id = ?");
    parameters.push(filters.sportId);
  }

  if (filters?.countryId) {
    conditions.push("t.country_id = ?");
    parameters.push(filters.countryId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = getDatabase()
    .prepare(
      `SELECT t.id, t.sport_id, t.country_id, t.name, t.short_name, t.type, t.logo_url, t.status, t.created_at, t.updated_at
       FROM entity_catalog_mapping m
       JOIN teams t ON t.id = m.legacy_id
       ${where}
       ORDER BY t.name`
    )
    .all(...parameters) as TeamRow[];

  return rows.map(mapTeam);
}

export function getCatalogTeamById(teamId: string): Team | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT t.id, t.sport_id, t.country_id, t.name, t.short_name, t.type, t.logo_url, t.status, t.created_at, t.updated_at
       FROM entity_catalog_mapping m
       JOIN teams t ON t.id = m.legacy_id
       WHERE m.catalog_type IN ('clubs','nationalTeams') AND m.legacy_id = ?`
    )
    .get(teamId) as TeamRow | undefined;

  return row ? mapTeam(row) : undefined;
}

export function listCatalogCompetitions(filters?: { sportId?: string; countryId?: string }): Competition[] {
  const conditions: string[] = ["m.catalog_type = 'competitions'"];
  const parameters: Array<string> = [];

  if (filters?.sportId) {
    conditions.push("c.sport_id = ?");
    parameters.push(filters.sportId);
  }

  if (filters?.countryId) {
    conditions.push("c.country_id = ?");
    parameters.push(filters.countryId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = getDatabase()
    .prepare(
      `SELECT c.id, c.sport_id, c.country_id, c.region_id, c.name, c.slug, c.scope, c.competition_type, c.participant_type, c.logo_url, c.current_season_id, c.status, c.created_at, c.updated_at
       FROM entity_catalog_mapping m
       JOIN competitions c ON c.id = m.legacy_id
       ${where}
       ORDER BY c.name`
    )
    .all(...parameters) as CompetitionRow[];

  return rows.map(mapCompetition);
}

export function getCatalogCompetitionById(competitionId: string): Competition | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT c.id, c.sport_id, c.country_id, c.region_id, c.name, c.slug, c.scope, c.competition_type, c.participant_type, c.logo_url, c.current_season_id, c.status, c.created_at, c.updated_at
       FROM entity_catalog_mapping m
       JOIN competitions c ON c.id = m.legacy_id
       WHERE m.catalog_type = 'competitions' AND m.legacy_id = ?`
    )
    .get(competitionId) as CompetitionRow | undefined;

  return row ? mapCompetition(row) : undefined;
}
