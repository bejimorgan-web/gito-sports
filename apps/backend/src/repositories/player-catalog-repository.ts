import crypto from "node:crypto";
import type {
  CreateFormationTemplateRequest, CreatePlayerRequest, CreateSeasonSquadRequest, CreateSquadPlayerRequest,
  FormationTemplate, Player, SeasonSquad, SquadPlayer, UpdateFormationTemplateRequest, UpdatePlayerRequest,
  UpdateSeasonSquadRequest, UpdateSquadPlayerRequest
} from "@gito/shared";
import { getDatabase } from "../db/connection.js";

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function required(row: unknown, code: string) { if (!row) throw new Error(code); }

const standardFootballFormations: Array<{ name: string; positions: Array<{ x: number; y: number; label: string }> }> = [
  { name: "4-4-2", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 15, y: 45, label: "LM" }, { x: 38, y: 45, label: "CM" }, { x: 62, y: 45, label: "CM" }, { x: 85, y: 45, label: "RM" }, { x: 38, y: 20, label: "ST" }, { x: 62, y: 20, label: "ST" }] },
  { name: "4-3-3", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 30, y: 46, label: "CM" }, { x: 50, y: 46, label: "CM" }, { x: 70, y: 46, label: "CM" }, { x: 20, y: 20, label: "LW" }, { x: 50, y: 20, label: "ST" }, { x: 80, y: 20, label: "RW" }] },
  { name: "4-2-3-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 38, y: 52, label: "DM" }, { x: 62, y: 52, label: "DM" }, { x: 20, y: 32, label: "LW" }, { x: 50, y: 32, label: "AM" }, { x: 80, y: 32, label: "RW" }, { x: 50, y: 15, label: "ST" }] },
  { name: "4-1-4-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 50, y: 55, label: "DM" }, { x: 15, y: 35, label: "LM" }, { x: 38, y: 35, label: "CM" }, { x: 62, y: 35, label: "CM" }, { x: 85, y: 35, label: "RM" }, { x: 50, y: 15, label: "ST" }] },
  { name: "4-5-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 15, y: 43, label: "LM" }, { x: 35, y: 48, label: "CM" }, { x: 50, y: 43, label: "CM" }, { x: 65, y: 48, label: "CM" }, { x: 85, y: 43, label: "RM" }, { x: 50, y: 15, label: "ST" }] },
  { name: "4-4-1-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 15, y: 70, label: "LB" }, { x: 38, y: 70, label: "CB" }, { x: 62, y: 70, label: "CB" }, { x: 85, y: 70, label: "RB" }, { x: 15, y: 45, label: "LM" }, { x: 38, y: 45, label: "CM" }, { x: 62, y: 45, label: "CM" }, { x: 85, y: 45, label: "RM" }, { x: 50, y: 28, label: "AM" }, { x: 50, y: 15, label: "ST" }] },
  { name: "3-4-3", positions: [{ x: 50, y: 90, label: "GK" }, { x: 25, y: 70, label: "CB" }, { x: 50, y: 70, label: "CB" }, { x: 75, y: 70, label: "CB" }, { x: 15, y: 45, label: "LM" }, { x: 38, y: 45, label: "CM" }, { x: 62, y: 45, label: "CM" }, { x: 85, y: 45, label: "RM" }, { x: 20, y: 18, label: "LW" }, { x: 50, y: 18, label: "ST" }, { x: 80, y: 18, label: "RW" }] },
  { name: "3-5-2", positions: [{ x: 50, y: 90, label: "GK" }, { x: 25, y: 70, label: "CB" }, { x: 50, y: 70, label: "CB" }, { x: 75, y: 70, label: "CB" }, { x: 10, y: 45, label: "LWB" }, { x: 30, y: 45, label: "CM" }, { x: 50, y: 45, label: "CM" }, { x: 70, y: 45, label: "CM" }, { x: 90, y: 45, label: "RWB" }, { x: 38, y: 18, label: "ST" }, { x: 62, y: 18, label: "ST" }] },
  { name: "3-4-2-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 25, y: 70, label: "CB" }, { x: 50, y: 70, label: "CB" }, { x: 75, y: 70, label: "CB" }, { x: 15, y: 45, label: "LM" }, { x: 38, y: 45, label: "CM" }, { x: 62, y: 45, label: "CM" }, { x: 85, y: 45, label: "RM" }, { x: 35, y: 27, label: "AM" }, { x: 65, y: 27, label: "AM" }, { x: 50, y: 12, label: "ST" }] },
  { name: "5-3-2", positions: [{ x: 50, y: 90, label: "GK" }, { x: 10, y: 70, label: "LWB" }, { x: 30, y: 70, label: "CB" }, { x: 50, y: 70, label: "CB" }, { x: 70, y: 70, label: "CB" }, { x: 90, y: 70, label: "RWB" }, { x: 30, y: 45, label: "CM" }, { x: 50, y: 45, label: "CM" }, { x: 70, y: 45, label: "CM" }, { x: 38, y: 18, label: "ST" }, { x: 62, y: 18, label: "ST" }] },
  { name: "5-4-1", positions: [{ x: 50, y: 90, label: "GK" }, { x: 10, y: 70, label: "LWB" }, { x: 30, y: 70, label: "CB" }, { x: 50, y: 70, label: "CB" }, { x: 70, y: 70, label: "CB" }, { x: 90, y: 70, label: "RWB" }, { x: 15, y: 45, label: "LM" }, { x: 38, y: 45, label: "CM" }, { x: 62, y: 45, label: "CM" }, { x: 85, y: 45, label: "RM" }, { x: 50, y: 18, label: "ST" }] },
];

function ensureStandardFootballFormations(sportId: string) {
  const database = getDatabase();
  const timestamp = now();
  const insert = database.prepare("INSERT OR IGNORE INTO formation_templates (id, sport_id, name, key, formation, positions_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)");
  for (const preset of standardFootballFormations) insert.run(`standard-${sportId}-${preset.name}`, sportId, preset.name, preset.name, preset.name, JSON.stringify(preset.positions), timestamp, timestamp);
}

function player(row: any): Player {
  return { id: row.id, teamId: row.team_id, firstName: row.first_name, lastName: row.last_name, displayName: row.display_name,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
    ...(row.country_id ? { countryId: row.country_id } : {}), ...(row.position ? { position: row.position } : {}),
    ...(row.jersey_number !== null ? { jerseyNumber: row.jersey_number } : {}), ...(row.height_cm !== null ? { heightCm: row.height_cm } : {}),
    ...(row.weight_kg !== null ? { weightKg: row.weight_kg } : {}), ...(row.birth_date ? { birthDate: row.birth_date } : {}) };
}
function squad(row: any): SeasonSquad { return { id: row.id, teamId: row.team_id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.competition_id ? { competitionId: row.competition_id } : {}), ...(row.season_id ? { seasonId: row.season_id } : {}) }; }
function member(row: any): SquadPlayer { return { id: row.id, squadId: row.squad_id, playerId: row.player_id, role: row.role, isCaptain: Boolean(row.is_captain), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.position ? { position: row.position } : {}), ...(row.jersey_number !== null ? { jerseyNumber: row.jersey_number } : {}) }; }
function formation(row: any): FormationTemplate { return { id: row.id, sportId: row.sport_id, name: row.name, key: row.key, formation: row.formation, positions: JSON.parse(row.positions_json), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }

export function listPlayers(filters?: { teamId?: string; countryId?: string; status?: string }): Player[] {
  const conditions: string[] = []; const params: string[] = [];
  if (filters?.teamId) { conditions.push("team_id = ?"); params.push(filters.teamId); }
  if (filters?.countryId) { conditions.push("country_id = ?"); params.push(filters.countryId); }
  if (filters?.status) { conditions.push("status = ?"); params.push(filters.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return (getDatabase().prepare(`SELECT * FROM players ${where} ORDER BY last_name, first_name`).all(...params) as any[]).map(player);
}
export function getPlayerById(playerId: string): Player | undefined { const row = getDatabase().prepare("SELECT * FROM players WHERE id = ?").get(playerId); return row ? player(row) : undefined; }
export function createPlayer(input: CreatePlayerRequest): Player {
  const database = getDatabase(); required(database.prepare("SELECT id FROM teams WHERE id = ?").get(input.teamId), "team_not_found");
  const playerId = id(); const timestamp = now(); const firstName = input.firstName.trim(); const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new Error("player_name_required");
  database.prepare("INSERT INTO players (id, team_id, country_id, first_name, last_name, display_name, photo_url, position, jersey_number, height_cm, weight_kg, birth_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(playerId, input.teamId, input.countryId ?? null, firstName, lastName, input.displayName?.trim() || `${firstName} ${lastName}`, input.photoUrl ?? null, input.position ?? null, input.jerseyNumber ?? null, input.heightCm ?? null, input.weightKg ?? null, input.birthDate ?? null, timestamp, timestamp);
  return getPlayerById(playerId)!;
}
export function updatePlayer(playerId: string, input: UpdatePlayerRequest): Player | undefined {
  const database = getDatabase(); const existing = database.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as any; if (!existing) return undefined;
  if (input.teamId) required(database.prepare("SELECT id FROM teams WHERE id = ?").get(input.teamId), "team_not_found");
  const firstName = (input.firstName ?? existing.first_name).trim(); const lastName = (input.lastName ?? existing.last_name).trim();
  database.prepare("UPDATE players SET team_id = ?, country_id = ?, first_name = ?, last_name = ?, display_name = ?, photo_url = ?, position = ?, jersey_number = ?, height_cm = ?, weight_kg = ?, birth_date = ?, status = ?, updated_at = ? WHERE id = ?").run(input.teamId ?? existing.team_id, input.countryId !== undefined ? input.countryId : existing.country_id, firstName, lastName, input.displayName?.trim() || `${firstName} ${lastName}`, input.photoUrl !== undefined ? input.photoUrl : existing.photo_url, input.position ?? existing.position, input.jerseyNumber !== undefined ? input.jerseyNumber : existing.jersey_number, input.heightCm !== undefined ? input.heightCm : existing.height_cm, input.weightKg !== undefined ? input.weightKg : existing.weight_kg, input.birthDate !== undefined ? input.birthDate : existing.birth_date, input.status ?? existing.status, now(), playerId);
  return getPlayerById(playerId);
}

export function listSeasonSquads(filters?: { teamId?: string; competitionId?: string; seasonId?: string; status?: string }): SeasonSquad[] {
  const conditions: string[] = []; const params: string[] = [];
  for (const [field, value] of [["team_id", filters?.teamId], ["competition_id", filters?.competitionId], ["season_id", filters?.seasonId], ["status", filters?.status]] as const) { if (value) { conditions.push(`${field} = ?`); params.push(value); } }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return (getDatabase().prepare(`SELECT * FROM season_squads ${where} ORDER BY name`).all(...params) as any[]).map(squad);
}
export function getSeasonSquadById(squadId: string): SeasonSquad | undefined { const row = getDatabase().prepare("SELECT * FROM season_squads WHERE id = ?").get(squadId); return row ? squad(row) : undefined; }
export function createSeasonSquad(input: CreateSeasonSquadRequest): SeasonSquad {
  const database = getDatabase(); required(database.prepare("SELECT id FROM teams WHERE id = ?").get(input.teamId), "team_not_found"); if (!input.name.trim()) throw new Error("season_squad_name_required");
  const squadId = id(); const timestamp = now(); database.prepare("INSERT INTO season_squads (id, team_id, competition_id, season_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)").run(squadId, input.teamId, input.competitionId ?? null, input.seasonId ?? null, input.name.trim(), timestamp, timestamp); return getSeasonSquadById(squadId)!;
}
export function updateSeasonSquad(squadId: string, input: UpdateSeasonSquadRequest): SeasonSquad | undefined { const database = getDatabase(); const existing = database.prepare("SELECT * FROM season_squads WHERE id = ?").get(squadId) as any; if (!existing) return undefined; database.prepare("UPDATE season_squads SET team_id = ?, competition_id = ?, season_id = ?, name = ?, status = ?, updated_at = ? WHERE id = ?").run(input.teamId ?? existing.team_id, input.competitionId !== undefined ? input.competitionId : existing.competition_id, input.seasonId !== undefined ? input.seasonId : existing.season_id, (input.name ?? existing.name).trim(), input.status ?? existing.status, now(), squadId); return getSeasonSquadById(squadId); }

export function listSquadPlayers(squadId: string): SquadPlayer[] { return (getDatabase().prepare("SELECT * FROM squad_players WHERE squad_id = ? ORDER BY jersey_number, created_at").all(squadId) as any[]).map(member); }
export function getSquadPlayerById(memberId: string): SquadPlayer | undefined { const row = getDatabase().prepare("SELECT * FROM squad_players WHERE id = ?").get(memberId); return row ? member(row) : undefined; }
export function createSquadPlayer(input: CreateSquadPlayerRequest): SquadPlayer { const database = getDatabase(); required(database.prepare("SELECT id FROM season_squads WHERE id = ?").get(input.squadId), "season_squad_not_found"); required(database.prepare("SELECT id FROM players WHERE id = ?").get(input.playerId), "player_not_found"); if (database.prepare("SELECT id FROM squad_players WHERE squad_id = ? AND player_id = ?").get(input.squadId, input.playerId)) throw new Error("squad_player_duplicate"); const memberId = id(); const timestamp = now(); database.prepare("INSERT INTO squad_players (id, squad_id, player_id, role, position, jersey_number, is_captain, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(memberId, input.squadId, input.playerId, input.role ?? "starter", input.position ?? null, input.jerseyNumber ?? null, input.isCaptain ? 1 : 0, timestamp, timestamp); return getSquadPlayerById(memberId)!; }
export function updateSquadPlayer(memberId: string, input: UpdateSquadPlayerRequest): SquadPlayer | undefined { const database = getDatabase(); const existing = database.prepare("SELECT * FROM squad_players WHERE id = ?").get(memberId) as any; if (!existing) return undefined; database.prepare("UPDATE squad_players SET squad_id = ?, player_id = ?, role = ?, position = ?, jersey_number = ?, is_captain = ?, status = ?, updated_at = ? WHERE id = ?").run(input.squadId ?? existing.squad_id, input.playerId ?? existing.player_id, input.role ?? existing.role, input.position !== undefined ? input.position : existing.position, input.jerseyNumber !== undefined ? input.jerseyNumber : existing.jersey_number, input.isCaptain !== undefined ? (input.isCaptain ? 1 : 0) : existing.is_captain, input.status ?? existing.status, now(), memberId); return getSquadPlayerById(memberId); }
export function removeSquadPlayer(memberId: string): SquadPlayer | undefined { return updateSquadPlayer(memberId, { status: "inactive" }); }

export function listFormationTemplates(filters?: { sportId?: string; status?: string }): FormationTemplate[] { const database = getDatabase(); if (filters?.sportId) { const sport = database.prepare("SELECT slug FROM sports WHERE id = ?").get(filters.sportId) as { slug: string } | undefined; if (sport?.slug === "football") ensureStandardFootballFormations(filters.sportId); } const conditions: string[] = []; const params: string[] = []; if (filters?.sportId) { conditions.push("sport_id = ?"); params.push(filters.sportId); } if (filters?.status) { conditions.push("status = ?"); params.push(filters.status); } const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""; return (database.prepare(`SELECT * FROM formation_templates ${where} ORDER BY name`).all(...params) as any[]).map(formation); }
export function getFormationTemplateById(templateId: string): FormationTemplate | undefined { const row = getDatabase().prepare("SELECT * FROM formation_templates WHERE id = ?").get(templateId); return row ? formation(row) : undefined; }
export function createFormationTemplate(input: CreateFormationTemplateRequest): FormationTemplate { const database = getDatabase(); const templateKey = (input.key ?? input.name).trim(); if (!templateKey) throw new Error("formation_template_key_required"); if (database.prepare("SELECT id FROM formation_templates WHERE sport_id = ? AND key = ?").get(input.sportId, templateKey)) throw new Error("formation_template_duplicate"); const templateId = id(); const timestamp = now(); database.prepare("INSERT INTO formation_templates (id, sport_id, name, key, formation, positions_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(templateId, input.sportId, input.name.trim(), templateKey, input.formation.trim(), JSON.stringify(input.positions), timestamp, timestamp); return getFormationTemplateById(templateId)!; }
export function updateFormationTemplate(templateId: string, input: UpdateFormationTemplateRequest): FormationTemplate | undefined { const database = getDatabase(); const existing = database.prepare("SELECT * FROM formation_templates WHERE id = ?").get(templateId) as any; if (!existing) return undefined; database.prepare("UPDATE formation_templates SET sport_id = ?, name = ?, key = ?, formation = ?, positions_json = ?, status = ?, updated_at = ? WHERE id = ?").run(input.sportId ?? existing.sport_id, (input.name ?? existing.name).trim(), (input.key ?? existing.key).trim(), (input.formation ?? existing.formation).trim(), input.positions ? JSON.stringify(input.positions) : existing.positions_json, input.status ?? existing.status, now(), templateId); return getFormationTemplateById(templateId); }