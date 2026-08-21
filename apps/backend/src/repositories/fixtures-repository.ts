import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import { listStreams } from "./streams-repository.js";

export interface CanonicalFixtureInput {
  competitionId: string;
  seasonId?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  startsAt: string;
  venueName?: string | null;
  status?: string;
  externalProvider?: string | null;
  externalMatchId?: string | null;
}

function validateFixtureInput(input: CanonicalFixtureInput) {
  const db = getDatabase();
  if (input.homeTeamId === input.awayTeamId) throw new Error("home_and_away_must_differ");
  const competition = db.prepare("SELECT id, sport_id FROM competitions WHERE id = ?").get(input.competitionId) as { id: string; sport_id: string | null } | undefined;
  if (!competition) throw new Error("competition_not_found");
  const teams = db.prepare("SELECT id, sport_id FROM teams WHERE id IN (?, ?)").all(input.homeTeamId, input.awayTeamId) as Array<{ id: string; sport_id: string | null }>;
  if (teams.length !== 2) throw new Error("team_not_found");
  if (competition.sport_id && teams.some((team) => team.sport_id !== competition.sport_id)) throw new Error("fixture_sport_mismatch");
  if (input.seasonId) {
    const season = db.prepare("SELECT id, competition_id FROM seasons WHERE id = ?").get(input.seasonId) as { id: string; competition_id: string } | undefined;
    if (!season) throw new Error("season_not_found");
    if (season.competition_id !== input.competitionId) throw new Error("competition_season_mismatch");
    const membershipCount = db.prepare("SELECT COUNT(*) AS count FROM competition_season_teams WHERE competition_id = ? AND season_id = ? AND team_id IN (?, ?)").get(input.competitionId, input.seasonId, input.homeTeamId, input.awayTeamId) as { count: number };
    if (Number(membershipCount.count) !== 2) throw new Error("season_team_membership_required");
  }
  if (Number.isNaN(Date.parse(input.startsAt))) throw new Error("invalid_starts_at");
}

export function findEquivalentCanonicalFixtures(input: CanonicalFixtureInput) {
  validateFixtureInput(input);
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM matches WHERE competition_id = ? AND home_team_id = ? AND away_team_id = ? AND abs(strftime('%s', starts_at) - strftime('%s', ?)) <= 7200 ORDER BY abs(strftime('%s', starts_at) - strftime('%s', ?)) ASC`).all(input.competitionId, input.homeTeamId, input.awayTeamId, input.startsAt, input.startsAt) as any[];
  return rows;
}

export function createCanonicalFixture(input: CanonicalFixtureInput) {
  validateFixtureInput(input);
  const db = getDatabase();
  if (input.externalProvider && input.externalMatchId) {
    const external = db.prepare("SELECT id FROM matches WHERE external_provider = ? AND external_match_id = ?").get(input.externalProvider, input.externalMatchId);
    if (external) throw new Error("canonical_fixture_external_duplicate");
  }
  const equivalent = findEquivalentCanonicalFixtures(input);
  if (equivalent.length > 0) throw new Error("canonical_fixture_duplicate");
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO matches (id, competition_id, season_id, home_team_id, away_team_id, starts_at, venue_name, external_provider, external_match_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.competitionId, input.seasonId ?? null, input.homeTeamId, input.awayTeamId, input.startsAt, input.venueName ?? null, input.externalProvider ?? null, input.externalMatchId ?? null, input.status ?? "scheduled", timestamp, timestamp);
  return getCanonicalFixtureById(id);
}

export function updateCanonicalFixture(fixtureId: string, input: Partial<CanonicalFixtureInput>) {
  const existing = getDatabase().prepare("SELECT * FROM matches WHERE id = ?").get(fixtureId) as any;
  if (!existing) return undefined;
  const next = { competitionId: input.competitionId ?? existing.competition_id, seasonId: input.seasonId !== undefined ? input.seasonId : existing.season_id, homeTeamId: input.homeTeamId ?? existing.home_team_id, awayTeamId: input.awayTeamId ?? existing.away_team_id, startsAt: input.startsAt ?? existing.starts_at, venueName: input.venueName !== undefined ? input.venueName : existing.venue_name, status: input.status ?? existing.status, externalProvider: input.externalProvider !== undefined ? input.externalProvider : existing.external_provider, externalMatchId: input.externalMatchId !== undefined ? input.externalMatchId : existing.external_match_id };
  validateFixtureInput(next);
  getDatabase().prepare("UPDATE matches SET competition_id = ?, season_id = ?, home_team_id = ?, away_team_id = ?, starts_at = ?, venue_name = ?, external_provider = ?, external_match_id = ?, status = ?, updated_at = ? WHERE id = ?").run(next.competitionId, next.seasonId ?? null, next.homeTeamId, next.awayTeamId, next.startsAt, next.venueName ?? null, next.externalProvider ?? null, next.externalMatchId ?? null, next.status, new Date().toISOString(), fixtureId);
  return getCanonicalFixtureById(fixtureId);
}

export function listCanonicalFixturesForTeam(teamId: string, options?: { seasonId?: string; competitionId?: string }) {
  const conditions = ["(m.home_team_id = ? OR m.away_team_id = ?)"];
  const params: string[] = [teamId, teamId];
  if (options?.seasonId) { conditions.push("m.season_id = ?"); params.push(options.seasonId); }
  if (options?.competitionId) { conditions.push("m.competition_id = ?"); params.push(options.competitionId); }
  const rows = getDatabase().prepare(`SELECT m.id FROM matches m WHERE ${conditions.join(" AND ")} ORDER BY m.starts_at ASC`).all(...params) as Array<{ id: string }>;
  return rows.map((row) => getCanonicalFixtureById(row.id));
}

export function getCanonicalFixtureById(fixtureId: string) {
  const row = getDatabase().prepare(`
    SELECT m.id, m.competition_id, m.season_id, m.home_team_id, m.away_team_id,
           m.starts_at, m.venue_name, m.status, m.external_provider, m.external_match_id,
           m.created_at, m.updated_at,
           h.name AS home_team_name, h.short_name AS home_team_short_name, h.logo_url AS home_team_logo_url,
           a.name AS away_team_name, a.short_name AS away_team_short_name, a.logo_url AS away_team_logo_url,
           c.name AS competition_name, c.slug AS competition_slug,
           s.name AS season_name,
           sp.id AS sport_id, sp.name AS sport_name,
           co.id AS country_id, co.name AS country_name
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    JOIN competitions c ON c.id = m.competition_id
    LEFT JOIN seasons s ON s.id = m.season_id
    LEFT JOIN sports sp ON sp.id = c.sport_id
    LEFT JOIN countries co ON co.id = c.country_id
    WHERE m.id = ?
  `).get(fixtureId) as any;

  if (!row) return undefined;
  const streams = listStreams({ matchId: fixtureId });
  return {
    id: row.id,
    competitionId: row.competition_id,
    seasonId: row.season_id ?? null,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    startsAt: row.starts_at,
    venueName: row.venue_name ?? null,
    status: row.status,
    externalProvider: row.external_provider ?? null,
    externalMatchId: row.external_match_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sport: row.sport_id ? { id: row.sport_id, name: row.sport_name } : null,
    country: row.country_id ? { id: row.country_id, name: row.country_name } : null,
    competition: { id: row.competition_id, name: row.competition_name, slug: row.competition_slug },
    season: row.season_id ? { id: row.season_id, name: row.season_name } : null,
    homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logoUrl: row.home_team_logo_url },
    awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logoUrl: row.away_team_logo_url },
    streams
  };
}

export function listCanonicalFixtures(filters?: { competitionId?: string; seasonId?: string }) {
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (filters?.competitionId) { conditions.push("m.competition_id = ?"); parameters.push(filters.competitionId); }
  if (filters?.seasonId) { conditions.push("m.season_id = ?"); parameters.push(filters.seasonId); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDatabase().prepare(`SELECT m.id FROM matches m ${where} ORDER BY m.starts_at ASC`).all(...parameters) as Array<{ id: string }>;
  return rows.map((row) => getCanonicalFixtureById(row.id));
}

export function deleteCanonicalFixture(fixtureId: string): boolean {
  const database = getDatabase();
  if (!database.prepare("SELECT id FROM matches WHERE id = ?").get(fixtureId)) return false;
  const streamUsage = database.prepare("SELECT COUNT(*) AS count FROM streams WHERE match_id = ?").get(fixtureId) as { count: number };
  if (streamUsage.count > 0) throw Object.assign(new Error("fixture_in_use"), { count: streamUsage.count });

  database.exec("BEGIN TRANSACTION;");
  try {
    const result = database.prepare("DELETE FROM matches WHERE id = ?").run(fixtureId);
    database.exec("COMMIT;");
    return result.changes > 0;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}