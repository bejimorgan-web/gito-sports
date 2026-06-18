import crypto from "node:crypto";

import type { Team } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { getTeamById } from "./teams-repository.js";

export function assignTeamToCompetition(competitionId: string, teamId: string) {
  const db = getDatabase();

  // Prevent duplicate assignment
  const exists = db
    .prepare("SELECT COUNT(1) AS count FROM competition_teams WHERE competition_id = ? AND team_id = ?")
    .get(competitionId, teamId) as { count: number };

  if (exists.count > 0) {
    return false;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare("INSERT INTO competition_teams (id, competition_id, team_id, created_at) VALUES (?, ?, ?, ?)").run(id, competitionId, teamId, now);

  return true;
}

export function listTeamsForCompetition(competitionId: string): Team[] {
  const db = getDatabase();

  const rows = db
    .prepare(
      `SELECT t.id, t.sport_id, t.country_id, t.name, t.short_name, t.type, t.logo_url, t.status, t.created_at, t.updated_at
       FROM teams t JOIN competition_teams ct ON ct.team_id = t.id
       WHERE ct.competition_id = ? ORDER BY t.name`
    )
    .all(competitionId) as any[];

  return rows.map((row) => ({
    id: row.id,
    sportId: row.sport_id,
    countryId: row.country_id ?? undefined,
    name: row.name,
    shortName: row.short_name ?? undefined,
    type: row.type,
    logoUrl: row.logo_url ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })) as Team[];
}

export function removeTeamFromCompetition(competitionId: string, teamId: string) {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM competition_teams WHERE competition_id = ? AND team_id = ?").run(competitionId, teamId);
  return result.changes > 0;
}

export function teamAssignedToCompetition(competitionId: string, teamId: string) {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(1) AS count FROM competition_teams WHERE competition_id = ? AND team_id = ?").get(competitionId, teamId) as { count: number };
  return row.count > 0;
}
