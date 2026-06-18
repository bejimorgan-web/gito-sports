import crypto from "node:crypto";

import type { CreateTeamRequest, Team } from "@gito/shared";
import { deleteEntity } from "../services/entityDeleteService.js";
import { getDatabase } from "../db/connection.js";

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

function now() {
  return new Date().toISOString();
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

export function listTeams(filters?: { sportId?: string; countryId?: string }): Team[] {
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
      `SELECT id, sport_id, country_id, name, short_name, type, logo_url, status, created_at, updated_at
       FROM teams ${where} ORDER BY name`
    )
    .all(...parameters) as TeamRow[];

  return rows.map(mapTeam);
}

export function getTeamById(teamId: string): Team | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, sport_id, country_id, name, short_name, type, logo_url, status, created_at, updated_at
       FROM teams WHERE id = ?`
    )
    .get(teamId) as TeamRow | undefined;

  return row ? mapTeam(row) : undefined;
}

export function createTeam(input: CreateTeamRequest): Team {
  const database = getDatabase();
  const id = crypto.randomUUID();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO teams (id, sport_id, country_id, name, short_name, type, logo_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(id, input.sportId, input.countryId ?? null, input.name, input.shortName ?? null, input.type, input.logoUrl ?? null, timestamp, timestamp);

  return {
    id,
    sportId: input.sportId,
    name: input.name,
    type: input.type,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(input.countryId ? { countryId: input.countryId } : {}),
    ...(input.shortName ? { shortName: input.shortName } : {}),
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {})
  };
}

export function updateTeam(teamId: string, input: Partial<CreateTeamRequest> & { status?: Team["status"] }): Team | undefined {
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT sport_id, country_id, name, short_name, type, logo_url, status
       FROM teams WHERE id = ?`
    )
    .get(teamId) as
    | {
        sport_id: string;
        country_id: string | null;
        name: string;
        short_name: string | null;
        type: string;
        logo_url: string | null;
        status: string;
      }
    | undefined;

  if (!existing) {
    return undefined;
  }

  const timestamp = now();

  database
    .prepare(
      `UPDATE teams SET sport_id = ?, country_id = ?, name = ?, short_name = ?, type = ?, logo_url = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.sportId ?? existing.sport_id,
      input.countryId ?? existing.country_id,
      input.name ?? existing.name,
      input.shortName ?? existing.short_name,
      input.type ?? existing.type,
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
