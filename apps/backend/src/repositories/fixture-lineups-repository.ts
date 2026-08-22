import crypto from "node:crypto";
import type { FixtureLineup, LineupPlayerAssignment, LineupStatus, SaveFixtureLineupRequest } from "@gito/shared";
import { getDatabase } from "../db/connection.js";

type LineupRow = { id: string; fixture_id: string; team_id: string; season_squad_id: string; formation_id: string; status: LineupStatus; captain_player_id: string | null; created_at: string; updated_at: string };
type AssignmentRow = { player_id: string; role: "starter" | "substitute"; slot_index: number | null; order_index: number };

function validateInput(fixtureId: string, input: SaveFixtureLineupRequest) {
  const database = getDatabase();
  const fixture = database.prepare("SELECT competition_id, season_id, home_team_id, away_team_id FROM matches WHERE id = ?").get(fixtureId) as any;
  if (!fixture) throw new Error("fixture_not_found");
  if (![fixture.home_team_id, fixture.away_team_id].includes(input.teamId)) throw new Error("lineup_team_not_in_fixture");
  const squad = database.prepare("SELECT id, team_id, season_id FROM season_squads WHERE id = ? AND status != 'archived'").get(input.seasonSquadId) as any;
  if (!squad) throw new Error("season_squad_not_found");
  if (squad.team_id !== input.teamId) throw new Error("lineup_squad_team_mismatch");
  if (fixture.season_id && squad.season_id && fixture.season_id !== squad.season_id) throw new Error("lineup_season_mismatch");
  const formation = database.prepare("SELECT id, sport_id, positions_json FROM formation_templates WHERE id = ? AND status != 'archived'").get(input.formationId) as any;
  if (!formation) throw new Error("formation_template_not_found");
  const competition = database.prepare("SELECT sport_id FROM competitions WHERE id = ?").get(fixture.competition_id) as any;
  if (competition?.sport_id && formation.sport_id !== competition.sport_id) throw new Error("formation_sport_mismatch");
  const positions = JSON.parse(formation.positions_json) as unknown[];
  const starterSlots = input.starters.map((starter) => starter.slotIndex);
  if (new Set(starterSlots).size !== starterSlots.length || starterSlots.some((slot) => slot < 0 || slot >= positions.length)) throw new Error("lineup_slot_invalid");
  const allPlayers = [...input.starters.map((item) => item.playerId), ...input.substitutes];
  if (new Set(allPlayers).size !== allPlayers.length) throw new Error("lineup_player_duplicate");
  if (input.status === "confirmed" && input.starters.length !== positions.length) throw new Error("lineup_starting_xi_incomplete");
  if (input.captainPlayerId && !input.starters.some((item) => item.playerId === input.captainPlayerId)) throw new Error("lineup_captain_must_start");
  for (const playerId of allPlayers) {
    const player = database.prepare("SELECT p.id, p.availability_status FROM players p JOIN season_squads ss ON ss.team_id = p.team_id WHERE p.id = ? AND p.team_id = ? AND ss.id = ? AND p.status = 'active'").get(playerId, input.teamId, input.seasonSquadId) as { id: string; availability_status: string } | undefined;
    if (!player) throw new Error("lineup_player_not_in_squad");
    if (input.status === "confirmed" && player.availability_status !== "available") throw new Error(`lineup_player_${player.availability_status}_cannot_confirm`);
  }
}

function mapLineup(row: LineupRow, assignments: AssignmentRow[]): FixtureLineup {
  const players: LineupPlayerAssignment[] = assignments.map((assignment) => ({ playerId: assignment.player_id, role: assignment.role, orderIndex: assignment.order_index, ...(assignment.slot_index !== null ? { slotIndex: assignment.slot_index } : {}) }));
  return { id: row.id, fixtureId: row.fixture_id, teamId: row.team_id, seasonSquadId: row.season_squad_id, formationId: row.formation_id, status: row.status, players, ...(row.captain_player_id ? { captainPlayerId: row.captain_player_id } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function getFixtureLineups(fixtureId: string): FixtureLineup[] {
  const database = getDatabase();
  const rows = database.prepare("SELECT * FROM fixture_lineups WHERE fixture_id = ? ORDER BY team_id").all(fixtureId) as LineupRow[];
  const assignments = database.prepare("SELECT player_id, role, slot_index, order_index FROM lineup_player_assignments WHERE lineup_id = ? ORDER BY order_index");
  return rows.map((row) => mapLineup(row, assignments.all(row.id) as AssignmentRow[]));
}

export function getFixtureLineup(fixtureId: string, teamId: string) { return getFixtureLineups(fixtureId).find((lineup) => lineup.teamId === teamId); }

export function saveFixtureLineup(fixtureId: string, input: SaveFixtureLineupRequest): FixtureLineup {
  validateInput(fixtureId, input);
  const database = getDatabase();
  const existing = database.prepare("SELECT * FROM fixture_lineups WHERE fixture_id = ? AND team_id = ?").get(fixtureId, input.teamId) as LineupRow | undefined;
  const lineupId = existing?.id ?? crypto.randomUUID(); const timestamp = new Date().toISOString();
  database.transaction(() => {
    database.prepare("INSERT INTO fixture_lineups (id, fixture_id, team_id, season_squad_id, formation_id, status, captain_player_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(fixture_id, team_id) DO UPDATE SET season_squad_id = excluded.season_squad_id, formation_id = excluded.formation_id, status = excluded.status, captain_player_id = excluded.captain_player_id, updated_at = excluded.updated_at").run(lineupId, fixtureId, input.teamId, input.seasonSquadId, input.formationId, input.status, input.captainPlayerId ?? null, existing?.created_at ?? timestamp, timestamp);
    const current = database.prepare("SELECT id FROM fixture_lineups WHERE fixture_id = ? AND team_id = ?").get(fixtureId, input.teamId) as { id: string };
    database.prepare("DELETE FROM lineup_player_assignments WHERE lineup_id = ?").run(current.id);
    const insert = database.prepare("INSERT INTO lineup_player_assignments (id, lineup_id, player_id, role, slot_index, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    input.starters.forEach((item, index) => insert.run(crypto.randomUUID(), current.id, item.playerId, "starter", item.slotIndex, index, timestamp, timestamp));
    input.substitutes.forEach((playerId, index) => insert.run(crypto.randomUUID(), current.id, playerId, "substitute", null, input.starters.length + index, timestamp, timestamp));
  })();
  return getFixtureLineup(fixtureId, input.teamId)!;
}

export function clearFixtureLineup(fixtureId: string, teamId: string): boolean {
  const result = getDatabase().prepare("DELETE FROM fixture_lineups WHERE fixture_id = ? AND team_id = ?").run(fixtureId, teamId);
  return result.changes > 0;
}