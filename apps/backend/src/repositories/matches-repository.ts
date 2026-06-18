import crypto from "node:crypto";

import type { Match } from "@gito/shared";
import { getDatabase } from "../db/connection";
import { getTeamById } from "./teams-repository";
import { getCompetitionById } from "./competitions-repository";

function mapMatchRow(row: any): Match {
  const home = getTeamById(row.home_team_id);
  const away = getTeamById(row.away_team_id);
  const competition = getCompetitionById(row.competition_id);

  return {
    id: row.id,
    competitionId: row.competition_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    startsAt: row.kickoff_time,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(competition ? { competition } : {}),
    ...(home ? { homeTeam: home } : {}),
    ...(away ? { awayTeam: away } : {})
  } as Match;
}

export function listMatches(filters?: { competitionId?: string }): Match[] {
  const db = getDatabase();
  const params: string[] = [];
  const where: string[] = [];

  if (filters?.competitionId) {
    where.push("competition_id = ?");
    params.push(filters.competitionId);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(`SELECT id, competition_id, home_team_id, away_team_id, country_id, sport_id, kickoff_time, status, created_at, updated_at FROM scheduling_matches ${whereClause} ORDER BY kickoff_time DESC`)
    .all(...params) as any[];

  return rows.map(mapMatchRow);
}

export function getMatchById(matchId: string): Match | undefined {
  const row = getDatabase()
    .prepare("SELECT id, competition_id, home_team_id, away_team_id, country_id, sport_id, kickoff_time, status, created_at, updated_at FROM scheduling_matches WHERE id = ?")
    .get(matchId) as any | undefined;

  return row ? mapMatchRow(row) : undefined;
}

export function createMatch(input: { competitionId: string; homeTeamId: string; awayTeamId: string; kickoffTime: string; countryId?: string; sportId?: string; }): Match {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO scheduling_matches (id, competition_id, home_team_id, away_team_id, country_id, sport_id, kickoff_time, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
  ).run(id, input.competitionId, input.homeTeamId, input.awayTeamId, input.countryId ?? null, input.sportId ?? null, input.kickoffTime, now, now);

  return getMatchById(id)!;
}

export function updateMatch(matchId: string, input: { kickoffTime?: string; status?: string; }): Match | undefined {
  const db = getDatabase();
  const existing = db.prepare("SELECT kickoff_time, status FROM scheduling_matches WHERE id = ?").get(matchId) as any | undefined;

  if (!existing) return undefined;

  const kickoff = input.kickoffTime ?? existing.kickoff_time;
  const status = input.status ?? existing.status;
  const now = new Date().toISOString();

  db.prepare("UPDATE scheduling_matches SET kickoff_time = ?, status = ?, updated_at = ? WHERE id = ?").run(kickoff, status, now, matchId);

  return getMatchById(matchId);
}

export function deleteMatch(matchId: string) {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM scheduling_matches WHERE id = ?").run(matchId);
  return result.changes > 0;
}
