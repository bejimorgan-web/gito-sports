import crypto from "node:crypto";
import type { CompetitionSeasonTeam, Team } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { getSeasonById } from "./seasons-repository.js";
import { getTeamById } from "./teams-repository.js";

function now() { return new Date().toISOString(); }

function mapMembership(row: any): CompetitionSeasonTeam {
  return { id: row.id, competitionId: row.competition_id, seasonId: row.season_id, teamId: row.team_id, membershipStatus: row.membership_status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function assertCompetitionSeason(competitionId: string, seasonId: string) {
  const season = getSeasonById(seasonId);
  if (!season) throw new Error("season_not_found");
  if (season.competitionId !== competitionId) throw new Error("competition_season_mismatch");
  const competition = getDatabase().prepare("SELECT id FROM competitions WHERE id = ?").get(competitionId);
  if (!competition) throw new Error("competition_not_found");
}

export function listSeasonTeamMemberships(competitionId: string, seasonId: string): Array<CompetitionSeasonTeam & { team?: Team }> {
  assertCompetitionSeason(competitionId, seasonId);
  const rows = getDatabase().prepare("SELECT cst.*, t.id AS team_id, t.sport_id, t.country_id, t.name, t.short_name, t.slug, t.type, t.logo_url, t.status, t.created_at AS team_created_at, t.updated_at AS team_updated_at FROM competition_season_teams cst JOIN teams t ON t.id = cst.team_id WHERE cst.competition_id = ? AND cst.season_id = ? ORDER BY t.name").all(competitionId, seasonId) as any[];
  return rows.map((row) => ({ ...mapMembership(row), team: getTeamById(row.team_id) }));
}

export function createSeasonTeamMembership(competitionId: string, seasonId: string, teamId: string): CompetitionSeasonTeam {
  assertCompetitionSeason(competitionId, seasonId);
  if (!getTeamById(teamId)) throw new Error("team_not_found");
  const existing = getDatabase().prepare("SELECT id FROM competition_season_teams WHERE competition_id = ? AND season_id = ? AND team_id = ?").get(competitionId, seasonId, teamId);
  if (existing) throw new Error("season_team_duplicate");
  const id = crypto.randomUUID();
  const timestamp = now();
  getDatabase().prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(id, competitionId, seasonId, teamId, timestamp, timestamp);
  return mapMembership(getDatabase().prepare("SELECT * FROM competition_season_teams WHERE id = ?").get(id));
}

export function deleteSeasonTeamMembership(competitionId: string, seasonId: string, teamId: string): boolean {
  assertCompetitionSeason(competitionId, seasonId);
  return getDatabase().prepare("DELETE FROM competition_season_teams WHERE competition_id = ? AND season_id = ? AND team_id = ?").run(competitionId, seasonId, teamId).changes > 0;
}

export function listSeasonMembershipsForTeam(teamId: string): CompetitionSeasonTeam[] {
  return (getDatabase().prepare("SELECT * FROM competition_season_teams WHERE team_id = ? ORDER BY created_at DESC").all(teamId) as any[]).map(mapMembership);
}
