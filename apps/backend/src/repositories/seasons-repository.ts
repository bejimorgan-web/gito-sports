import crypto from "node:crypto";
import type { CreateSeasonRequest, Season, UpdateSeasonRequest } from "@gito/shared";
import { getDatabase } from "../db/connection.js";

function now() {
  return new Date().toISOString();
}

function validateDate(value: string | null | undefined, field: string) {
  if (value === undefined || value === null || value === "") return;
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field}_invalid`);
}

function assertSeasonDates(startsAt?: string | null, endsAt?: string | null) {
  validateDate(startsAt, "starts_at");
  validateDate(endsAt, "ends_at");
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) throw new Error("season_dates_invalid");
}

function mapSeason(row: any): Season {
  return {
    id: row.id,
    competitionId: row.competition_id,
    name: row.name,
    status: row.status,
    ...(row.starts_at ? { startsAt: row.starts_at } : {}),
    ...(row.ends_at ? { endsAt: row.ends_at } : {})
  };
}

function assertCompetition(competitionId: string) {
  const row = getDatabase().prepare("SELECT id FROM competitions WHERE id = ?").get(competitionId);
  if (!row) throw new Error("competition_not_found");
}

function assertUniqueSeason(competitionId: string, name: string, excludeId?: string) {
  const row = excludeId
    ? getDatabase().prepare("SELECT id FROM seasons WHERE competition_id = ? AND lower(name) = lower(?) AND id != ?").get(competitionId, name.trim(), excludeId)
    : getDatabase().prepare("SELECT id FROM seasons WHERE competition_id = ? AND lower(name) = lower(?)").get(competitionId, name.trim());
  if (row) throw new Error("season_duplicate");
}

export function listSeasons(competitionId?: string): Season[] {
  const database = getDatabase();
  const rows = competitionId
    ? database.prepare("SELECT id, competition_id, name, starts_at, ends_at, status FROM seasons WHERE competition_id = ? ORDER BY starts_at DESC, name").all(competitionId)
    : database.prepare("SELECT id, competition_id, name, starts_at, ends_at, status FROM seasons ORDER BY starts_at DESC, name").all();
  return (rows as any[]).map(mapSeason);
}

export function getSeasonById(seasonId: string): Season | undefined {
  const row = getDatabase().prepare("SELECT id, competition_id, name, starts_at, ends_at, status FROM seasons WHERE id = ?").get(seasonId);
  return row ? mapSeason(row) : undefined;
}

export function createSeason(competitionId: string, input: CreateSeasonRequest): Season {
  assertCompetition(competitionId);
  if (!input.name?.trim()) throw new Error("season_name_required");
  assertSeasonDates(input.startsAt, input.endsAt);
  assertUniqueSeason(competitionId, input.name);
  const id = crypto.randomUUID();
  const timestamp = now();
  getDatabase().prepare("INSERT INTO seasons (id, competition_id, name, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'active')").run(id, competitionId, input.name.trim(), input.startsAt ?? null, input.endsAt ?? null);
  return getSeasonById(id)!;
}

export function updateSeason(seasonId: string, input: UpdateSeasonRequest): Season | undefined {
  const database = getDatabase();
  const existing = database.prepare("SELECT id, competition_id, name, starts_at, ends_at, status FROM seasons WHERE id = ?").get(seasonId) as any;
  if (!existing) return undefined;
  const name = input.name ?? existing.name;
  if (!name.trim()) throw new Error("season_name_required");
  const startsAt = input.startsAt !== undefined ? input.startsAt : existing.starts_at;
  const endsAt = input.endsAt !== undefined ? input.endsAt : existing.ends_at;
  assertSeasonDates(startsAt, endsAt);
  assertUniqueSeason(existing.competition_id, name, seasonId);
  database.prepare("UPDATE seasons SET name = ?, starts_at = ?, ends_at = ?, status = ? WHERE id = ?").run(name.trim(), startsAt ?? null, endsAt ?? null, input.status ?? existing.status, seasonId);
  return getSeasonById(seasonId);
}
