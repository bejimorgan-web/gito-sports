import crypto from "node:crypto";

import type { ClubDetail, Competition, CreateTeamRequest, Season, Sport, Team } from "@gito/shared";
import { createSlug } from "@gito/shared";
import { deleteEntity } from "../services/entityDeleteService.js";
import { getDatabase } from "../db/connection.js";

interface TeamRow {
  id: string;
  sport_id: string;
  host_id: string | null;
  country_id: string | null;
  home_stadium_name: string | null;
  home_stadium_photo_url: string | null;
  name: string;
  short_name: string | null;
  slug: string | null;
  type: string;
  logo_url: string | null;
  status: "active" | "inactive" | "archived";
  created_at: string;
  updated_at: string;
}

function now() {
  return new Date().toISOString();
}

function countryIdForHost(database: ReturnType<typeof getDatabase>, host: { host_type: string; country_id: string | null; name?: string }) {
  if (host.host_type !== "country") return null;
  if (host.country_id) return host.country_id;
  if (!host.name) return null;
  const country = database.prepare("SELECT id FROM countries WHERE lower(name) = lower(?) AND status = 'active'").get(host.name) as { id: string } | undefined;
  return country?.id ?? null;
}

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    sportId: row.sport_id,
    ...(row.host_id ? { hostId: row.host_id } : {}),
    name: row.name,
    type: row.type as Team["type"],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.country_id ? { countryId: row.country_id } : {}),
    ...(row.home_stadium_name ? { homeStadiumName: row.home_stadium_name } : {}),
    ...(row.home_stadium_photo_url ? { homeStadiumPhotoUrl: row.home_stadium_photo_url } : {}),
    ...(row.short_name ? { shortName: row.short_name } : {}),
    ...(row.slug ? { slug: row.slug } : {}),
    ...(row.logo_url ? { logoUrl: row.logo_url } : {})
  };
}

export function listTeams(filters?: { sportId?: string; hostId?: string; countryId?: string; type?: string; status?: string }): Team[] {
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
  if (filters?.hostId) { conditions.push("host_id = ?"); parameters.push(filters.hostId); }
  if (filters?.type) { conditions.push("type = ?"); parameters.push(filters.type); }
  if (filters?.status) { conditions.push("status = ?"); parameters.push(filters.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = database
    .prepare(
      `SELECT id, sport_id, host_id, country_id, home_stadium_name, home_stadium_photo_url, name, short_name, slug, type, logo_url, status, created_at, updated_at
       FROM teams ${where} ORDER BY name`
    )
    .all(...parameters) as TeamRow[];

  return rows.map(mapTeam);
}

export function getTeamById(teamId: string): Team | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, sport_id, host_id, country_id, home_stadium_name, home_stadium_photo_url, name, short_name, slug, type, logo_url, status, created_at, updated_at
       FROM teams WHERE id = ?`
    )
    .get(teamId) as TeamRow | undefined;

  return row ? mapTeam(row) : undefined;
}

export function createTeam(input: CreateTeamRequest): Team {
  const database = getDatabase();
  const id = crypto.randomUUID();
  const timestamp = now();
  const host = input.hostId ? database.prepare("SELECT sport_id, host_type, country_id, name FROM hosts WHERE id = ? AND status = 'active'").get(input.hostId) as { sport_id: string; host_type: string; country_id: string | null; name: string } | undefined : undefined;
  if (input.hostId && (!host || host.sport_id !== input.sportId)) throw new Error("team_host_sport_mismatch");
  if ((input.type === "club" || input.type === "national") && (!host || host.host_type !== "country")) throw new Error("team_country_host_required");
  if (input.countryId && host?.host_type === "country" && input.countryId !== host.country_id) throw new Error("team_country_host_mismatch");
  const countryId = host ? countryIdForHost(database, host) : input.countryId;
  const slug = getUniqueTeamSlug(database, input.slug ?? input.name, input.sportId, countryId ?? undefined);

  database
    .prepare(
      `INSERT INTO teams (id, sport_id, host_id, country_id, home_stadium_name, home_stadium_photo_url, name, short_name, slug, type, logo_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
     .run(id, input.sportId, input.hostId ?? null, countryId ?? null, input.homeStadiumName?.trim() || null, input.homeStadiumPhotoUrl?.trim() || null, input.name, input.shortName ?? null, slug, input.type, input.logoUrl ?? null, timestamp, timestamp);

  return {
    id,
    sportId: input.sportId,
    ...(input.hostId ? { hostId: input.hostId } : {}),
    name: input.name,
    type: input.type,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(countryId ? { countryId } : {}),
    ...(input.homeStadiumName?.trim() ? { homeStadiumName: input.homeStadiumName.trim() } : {}),
    ...(input.homeStadiumPhotoUrl?.trim() ? { homeStadiumPhotoUrl: input.homeStadiumPhotoUrl.trim() } : {}),
    ...(input.shortName ? { shortName: input.shortName } : {}),
    slug,
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {})
  };
}

export interface HostClubImportRow {
  teamId?: string;
  teamName?: string;
  sportId?: string;
  hostId?: string;
  teamType?: string;
  shortName?: string;
  slug?: string;
  homeStadiumName?: string;
  homeStadiumPhotoUrl?: string;
  logoUrl?: string;
}

/** Add only new clubs from a host roster file. Existing exported rows are inert. */
export function importHostClubs(hostId: string, rows: HostClubImportRow[]) {
  const database = getDatabase();
  const host = database.prepare("SELECT id, sport_id, host_type FROM hosts WHERE id = ? AND status = 'active'").get(hostId) as { id: string; sport_id: string; host_type: string } | undefined;
  if (!host) throw new Error("host_not_found");
  if (host.host_type !== "country") throw new Error("team_country_host_required");
  if (!Array.isArray(rows) || rows.length > 2000) throw new Error("invalid_club_import_rows");

  const created: Team[] = [];
  const skipped = new Set<string>();
  const seen = new Set<string>();
  const importRows = database.transaction(() => {
    for (const row of rows) {
      const name = String(row.teamName ?? "").trim();
      if ((row.hostId && row.hostId !== hostId) || (row.sportId && row.sportId !== host.sport_id)) throw new Error("club_import_host_or_sport_mismatch");
      if (row.teamId) {
        const exportedTeam = database.prepare("SELECT id, host_id FROM teams WHERE id = ?").get(row.teamId) as { id: string; host_id: string | null } | undefined;
        if (!exportedTeam || exportedTeam.host_id !== hostId) throw new Error("club_import_team_id_mismatch");
        skipped.add(row.teamId);
        continue;
      }
      const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
      if (!name) throw new Error("club_name_required");
      if (seen.has(normalizedName)) { skipped.add(name); continue; }
      seen.add(normalizedName);
      const existing = database.prepare("SELECT id FROM teams WHERE host_id = ? AND lower(name) = lower(?) LIMIT 1").get(hostId, name) as { id: string } | undefined;
      if (existing) { skipped.add(existing.id); continue; }
      if (row.hostId !== hostId || row.sportId !== host.sport_id) throw new Error("club_import_host_or_sport_required");
      const type = row.teamType;
      if (type !== "club" && type !== "national") throw new Error("club_type_must_be_club_or_national");
      created.push(createTeam({
        sportId: host.sport_id,
        hostId,
        name,
        type,
        ...(row.shortName?.trim() ? { shortName: row.shortName.trim() } : {}),
        ...(row.slug?.trim() ? { slug: row.slug.trim() } : {}),
        ...(row.homeStadiumName?.trim() ? { homeStadiumName: row.homeStadiumName.trim() } : {}),
        ...(row.homeStadiumPhotoUrl?.trim() ? { homeStadiumPhotoUrl: row.homeStadiumPhotoUrl.trim() } : {}),
        ...(row.logoUrl?.trim() ? { logoUrl: row.logoUrl.trim() } : {})
      }));
    }
  });
  importRows();
  return { created, createdCount: created.length, skippedCount: skipped.size };
}

export function updateTeam(teamId: string, input: Partial<CreateTeamRequest> & { status?: Team["status"] }): Team | undefined {
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT sport_id, host_id, country_id, home_stadium_name, home_stadium_photo_url, name, short_name, slug, type, logo_url, status
       FROM teams WHERE id = ?`
    )
    .get(teamId) as
    | {
        sport_id: string;
        host_id: string | null;
        country_id: string | null;
        home_stadium_name: string | null;
        home_stadium_photo_url: string | null;
        name: string;
        short_name: string | null;
        slug: string | null;
        type: string;
        logo_url: string | null;
        status: string;
      }
    | undefined;

  if (!existing) {
    return undefined;
  }

  const timestamp = now();
  const sportId = input.sportId ?? existing.sport_id;
  const hostId = input.hostId ?? existing.host_id;
  const host = hostId ? database.prepare("SELECT sport_id, host_type, country_id, name FROM hosts WHERE id = ? AND status = 'active'").get(hostId) as { sport_id: string; host_type: string; country_id: string | null; name: string } | undefined : undefined;
  if (hostId && (!host || host.sport_id !== sportId)) throw new Error("team_host_sport_mismatch");
  const type = input.type ?? existing.type;
  if ((type === "club" || type === "national") && (!host || host.host_type !== "country")) throw new Error("team_country_host_required");
  if (input.countryId && host?.host_type === "country" && input.countryId !== host.country_id) throw new Error("team_country_host_mismatch");
  const countryId = host ? countryIdForHost(database, host) : input.countryId ?? existing.country_id;
  const name = input.name ?? existing.name;
  const slug = getUniqueTeamSlug(database, input.slug ?? name, sportId, countryId ?? undefined, teamId);

  database
    .prepare(
      `UPDATE teams SET sport_id = ?, host_id = ?, country_id = ?, home_stadium_name = ?, home_stadium_photo_url = ?, name = ?, short_name = ?, slug = ?, type = ?, logo_url = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      sportId,
      hostId,
      countryId,
      input.homeStadiumName !== undefined ? input.homeStadiumName.trim() || null : existing.home_stadium_name,
      input.homeStadiumPhotoUrl !== undefined ? input.homeStadiumPhotoUrl.trim() || null : existing.home_stadium_photo_url,
      name,
      input.shortName ?? existing.short_name,
      slug,
      type,
      input.logoUrl ?? existing.logo_url,
      input.status ?? existing.status,
      timestamp,
      teamId
    );

  return getTeamById(teamId);
}

export function deleteTeam(teamId: string, operatorId?: string): boolean {
  return deleteEntity("team", teamId, operatorId);
}

function getUniqueTeamSlug(database: ReturnType<typeof getDatabase>, value: string, sportId: string, countryId?: string, excludeId?: string): string {
  const baseSlug = createSlug(value) || "team";
  let slug = baseSlug;
  let suffix = 1;
  while (database.prepare("SELECT 1 FROM teams WHERE sport_id IS ? AND country_id IS ? AND slug = ? AND id != COALESCE(?, '')").get(sportId, countryId ?? null, slug, excludeId ?? null)) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }
  return slug;
}

export function getClubDetailById(teamId: string): ClubDetail | undefined {
  const database = getDatabase();
  const team = getTeamById(teamId);
  if (!team) return undefined;

  const countryRow = team.countryId ? database.prepare("SELECT id, name, iso2_code, iso3_code, region_id, flag_url, status, created_at, updated_at FROM countries WHERE id = ?").get(team.countryId) as any : undefined;
  const sportRow = database.prepare("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports WHERE id = ?").get(team.sportId) as any;
  const competitions = database.prepare(`
    SELECT DISTINCT c.id, c.sport_id, c.host_id, c.country_id, c.region_id, c.name, c.slug, c.scope, c.competition_type, c.participant_type, c.logo_url, c.current_season_id, c.status, c.created_at, c.updated_at
    FROM competitions c
    LEFT JOIN competition_teams ct ON ct.competition_id = c.id AND ct.team_id = ?
    LEFT JOIN competition_season_teams cst ON cst.competition_id = c.id AND cst.team_id = ?
    WHERE ct.team_id IS NOT NULL OR cst.team_id IS NOT NULL
    ORDER BY c.name
  `).all(teamId, teamId) as any[];
  const seasons = database.prepare(`
    SELECT DISTINCT s.id, s.competition_id, s.name, s.starts_at, s.ends_at, s.status
    FROM seasons s JOIN competition_season_teams cst ON cst.season_id = s.id
    WHERE cst.team_id = ? ORDER BY s.starts_at DESC, s.name
  `).all(teamId) as any[];

  const country = countryRow ? {
    id: countryRow.id, name: countryRow.name, iso2Code: countryRow.iso2_code, iso3Code: countryRow.iso3_code,
    status: countryRow.status, createdAt: countryRow.created_at, updatedAt: countryRow.updated_at,
    ...(countryRow.region_id ? { regionId: countryRow.region_id } : {}), ...(countryRow.flag_url ? { flagUrl: countryRow.flag_url } : {})
  } : undefined;
  const sport: Sport | undefined = sportRow ? { id: sportRow.id, name: sportRow.name, slug: sportRow.slug, status: sportRow.status, createdAt: sportRow.created_at, updatedAt: sportRow.updated_at, ...(sportRow.logo_url ? { logoUrl: sportRow.logo_url } : {}) } : undefined;
  const mappedCompetitions: Competition[] = competitions.map((row) => ({ id: row.id, sportId: row.sport_id, name: row.name, slug: row.slug, scope: row.scope, type: row.competition_type, participantType: row.participant_type, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.host_id ? { hostId: row.host_id } : {}), ...(row.country_id ? { countryId: row.country_id } : {}), ...(row.region_id ? { regionId: row.region_id } : {}), ...(row.current_season_id ? { currentSeasonId: row.current_season_id } : {}), ...(row.logo_url ? { logoUrl: row.logo_url } : {}) }));
  const mappedSeasons: Season[] = seasons.map((row) => ({ id: row.id, competitionId: row.competition_id, name: row.name, status: row.status, ...(row.starts_at ? { startsAt: row.starts_at } : {}), ...(row.ends_at ? { endsAt: row.ends_at } : {}) }));

  return { ...team, ...(country ? { country } : {}), ...(sport ? { sport } : {}), competitions: mappedCompetitions, seasons: mappedSeasons };
}

export function getClubCatalogData(teamId: string) {
  const club = getClubDetailById(teamId);
  if (!club) return undefined;
  return club;
}
