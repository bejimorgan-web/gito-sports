import crypto from "node:crypto";
import type {
  PlayerImportMode,
  PlayerImportPreview,
  PlayerImportPreviewRow,
  PlayerImportRequest,
  PlayerImportResult,
  PlayerImportRow,
} from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import type { DatabaseSync } from "../db/sqlite.js";

const recognizedPositions = new Set([
  "goalkeeper", "defender", "midfielder", "forward", "winger", "striker", "fullback", "center-back", "attacking-midfielder", "defensive-midfielder", "custom",
  "GK", "LB", "CB", "RB", "LM", "CM", "RM", "ST", "DM", "LW", "AM", "RW", "LWB", "RWB"
]);

export class PlayerImportValidationError extends Error {
  constructor(public readonly preview: PlayerImportPreview) {
    super("player_import_validation_failed");
  }
}

interface ResolvedContext {
  teamId?: string;
  competitionId?: string;
  seasonId?: string;
  squadId?: string;
  countryId?: string;
}

function now() {
  return new Date().toISOString();
}

function text(value: unknown): string | undefined {
  const result = String(value ?? "").trim();
  return result ? result : undefined;
}

function identity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizePosition(value: unknown): string | undefined {
  const normalized = text(value)?.replace(/\s+/g, "-");
  if (!normalized) return undefined;
  const aliases: Record<string, string> = {
    "goal-keeper": "goalkeeper",
    "centre-back": "center-back",
    "right-back": "RB",
    "left-back": "LB",
    "center-back": "CB",
    "central-midfielder": "CM",
    "attacking-midfielder": "AM",
    "defensive-midfielder": "DM",
    "right-wing": "RW",
    "left-wing": "LW",
    "center-forward": "CF"
  };
  return aliases[normalized] ?? normalized;
}

function addMessage(row: PlayerImportPreviewRow, message: string, status: "warning" | "error") {
  if (!row.messages.includes(message)) row.messages.push(message);
  if (status === "error") row.status = "error";
  else if (row.status === "ready") row.status = "warning";
}

function rowIdentity(row: PlayerImportRow): string {
  return identity(row.stablePlayerId ?? row.displayName ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`);
}

function chooseUnique<T>(items: T[], label: string): T | undefined {
  if (items.length > 1) throw new Error(`${label}_ambiguous`);
  return items[0];
}

function findTeam(database: DatabaseSync, row: PlayerImportRow, inheritedTeamId?: string): string | undefined {
  if (row.teamId ?? inheritedTeamId) {
    const id = row.teamId ?? inheritedTeamId;
    const result = database.prepare("SELECT id FROM teams WHERE id = ? AND status = 'active'").get(id) as { id: string } | undefined;
    if (!result) throw new Error("team_not_found");
    return result.id;
  }
  const name = text(row.teamName) ?? text(row.teamShortName);
  if (!name) throw new Error("team_required");
  const exact = database.prepare("SELECT id FROM teams WHERE status = 'active' AND (lower(name) = lower(?) OR lower(COALESCE(short_name, '')) = lower(?))").all(name, name) as Array<{ id: string }>;
  if (exact.length) {
    const match = chooseUnique(exact, "team");
    if (match) return match.id;
  }
  const target = identity(name);
  const candidates = (database.prepare("SELECT id, name, short_name FROM teams WHERE status = 'active'").all() as Array<{ id: string; name: string; short_name: string | null }>).filter((team) => identity(team.name) === target || identity(team.short_name) === target);
  const match = chooseUnique(candidates, "team");
  if (!match) throw new Error("team_not_found");
  return match.id;
}

function findCompetition(database: DatabaseSync, row: PlayerImportRow, inheritedCompetitionId?: string): string | undefined {
  const id = row.competitionId ?? inheritedCompetitionId;
  if (id) {
    const result = database.prepare("SELECT id FROM competitions WHERE id = ? AND status = 'active'").get(id) as { id: string } | undefined;
    if (!result) throw new Error("competition_not_found");
    return result.id;
  }
  const name = text(row.competitionName);
  if (!name) return undefined;
  const exact = database.prepare("SELECT id FROM competitions WHERE status = 'active' AND lower(name) = lower(?)").all(name) as Array<{ id: string }>;
  if (exact.length) {
    const match = chooseUnique(exact, "competition");
    if (match) return match.id;
  }
  const target = identity(name);
  const candidates = (database.prepare("SELECT id, name FROM competitions WHERE status = 'active'").all() as Array<{ id: string; name: string }>).filter((item) => identity(item.name) === target);
  const match = chooseUnique(candidates, "competition");
  if (!match) throw new Error("competition_not_found");
  return match.id;
}

function findSeason(database: DatabaseSync, row: PlayerImportRow, competitionId?: string, inheritedSeasonId?: string): string | undefined {
  const id = row.seasonId ?? inheritedSeasonId;
  if (id) {
    const result = database.prepare("SELECT id, competition_id FROM seasons WHERE id = ? AND status = 'active'").get(id) as { id: string; competition_id: string } | undefined;
    if (!result) throw new Error("season_not_found");
    if (competitionId && result.competition_id !== competitionId) throw new Error("competition_season_mismatch");
    return result.id;
  }
  const name = text(row.seasonName);
  if (!name || !competitionId) return undefined;
  const exact = database.prepare("SELECT id FROM seasons WHERE competition_id = ? AND status = 'active' AND lower(name) = lower(?)").all(competitionId, name) as Array<{ id: string }>;
  if (exact.length) {
    const match = chooseUnique(exact, "season");
    if (match) return match.id;
  }
  throw new Error("season_not_found");
}

function findCountry(database: DatabaseSync, row: PlayerImportRow): string | undefined {
  if (row.countryId) {
    const result = database.prepare("SELECT id FROM countries WHERE id = ? AND status = 'active'").get(row.countryId) as { id: string } | undefined;
    if (!result) throw new Error("country_not_found");
    return result.id;
  }
  const name = text(row.countryName);
  if (!name) return undefined;
  const exact = database.prepare("SELECT id FROM countries WHERE status = 'active' AND lower(name) = lower(?)").all(name) as Array<{ id: string }>;
  if (exact.length) {
    const match = chooseUnique(exact, "country");
    if (match) return match.id;
  }
  const target = identity(name);
  const candidates = (database.prepare("SELECT id, name FROM countries WHERE status = 'active'").all() as Array<{ id: string; name: string }>).filter((item) => identity(item.name) === target);
  const match = chooseUnique(candidates, "country");
  return match?.id;
}

function resolveContext(database: DatabaseSync, row: PlayerImportRow, request: PlayerImportRequest): ResolvedContext {
  const explicitSquadId = row.squadId ?? request.defaultSquadId;
  let squad: { id: string; team_id: string; competition_id: string | null; season_id: string | null } | undefined;
  if (explicitSquadId) {
    squad = database.prepare("SELECT id, team_id, competition_id, season_id FROM season_squads WHERE id = ? AND status = 'active'").get(explicitSquadId) as typeof squad;
    if (!squad) throw new Error("season_squad_not_found");
  }
  const teamId = findTeam(database, row, squad?.team_id);
  const competitionId = findCompetition(database, row, squad?.competition_id ?? request.defaultCompetitionId);
  const seasonId = findSeason(database, row, competitionId, squad?.season_id ?? request.defaultSeasonId);
  if (squad && (squad.team_id !== teamId || (competitionId && squad.competition_id !== competitionId) || (seasonId && squad.season_id !== seasonId))) {
    throw new Error("season_squad_context_mismatch");
  }
  let squadId = squad?.id;
  if (!squadId) {
    if (!teamId || !competitionId || !seasonId) throw new Error("competition_season_squad_required");
    const squads = database.prepare("SELECT id FROM season_squads WHERE team_id = ? AND competition_id = ? AND season_id = ? AND status = 'active'").all(teamId, competitionId, seasonId) as Array<{ id: string }>;
    squadId = chooseUnique(squads, "season_squad")?.id;
    if (!squadId) throw new Error("season_squad_not_found");
  }
  return { teamId, competitionId, seasonId, squadId, countryId: findCountry(database, row) };
}

function resolvePlayer(database: DatabaseSync, row: PlayerImportRow, teamId: string): { id?: string; warning?: string } {
  if (row.stablePlayerId) {
    const player = database.prepare("SELECT id, team_id FROM players WHERE id = ?").get(row.stablePlayerId) as { id: string; team_id: string } | undefined;
    if (!player) throw new Error("player_id_not_found");
    if (player.team_id !== teamId) throw new Error("player_team_mismatch");
    return { id: player.id };
  }
  const nameKey = identity(row.displayName || `${row.firstName ?? ""} ${row.lastName ?? ""}`);
  const candidates = (database.prepare("SELECT id, team_id, display_name, first_name, last_name, birth_date FROM players WHERE team_id = ? AND status != 'archived'").all(teamId) as Array<{ id: string; team_id: string; display_name: string; first_name: string; last_name: string; birth_date: string | null }>).filter((player) => identity(player.display_name || `${player.first_name} ${player.last_name}`) === nameKey);
  if (!candidates.length) return {};
  if (row.birthDate) {
    const byBirth = candidates.filter((player) => player.birth_date === row.birthDate);
    if (byBirth.length === 1) return { id: byBirth[0]!.id };
    if (byBirth.length === 0) throw new Error("player_identity_conflict");
  }
  if (candidates.length > 1) throw new Error("player_identity_ambiguous");
  return { id: candidates[0]!.id, warning: row.birthDate ? "Existing player matched by name; birth date was not stored identically." : "Existing player matched by normalized name only." };
}

function previewRow(database: DatabaseSync, row: PlayerImportRow, request: PlayerImportRequest): PlayerImportPreviewRow {
  const result: PlayerImportPreviewRow = { ...row, status: "ready", messages: [] };
  if (!row.displayName.trim()) addMessage(result, "Player name is required.", "error");
  if (row.unmappedColumns.length) addMessage(result, `Unmapped columns: ${row.unmappedColumns.join(", ")}`, "warning");
  if (row.primaryPosition && !recognizedPositions.has(normalizePosition(row.primaryPosition) ?? "")) addMessage(result, `Position is not in the current GiTO position set: ${row.primaryPosition}`, "warning");
  for (const position of row.secondaryPositions) if (!recognizedPositions.has(normalizePosition(position) ?? "")) addMessage(result, `Secondary position is not in the current GiTO position set: ${position}`, "warning");
  try {
    const context = resolveContext(database, row, request);
    result.matchedTeamId = context.teamId;
    result.matchedCompetitionId = context.competitionId;
    result.matchedSeasonId = context.seasonId;
    result.matchedSquadId = context.squadId;
    const countryId = context.countryId;
    if (row.countryName && !countryId) addMessage(result, "Country could not be matched; player will keep its existing country or remain unset.", "warning");
    const matched = resolvePlayer(database, row, context.teamId!);
    result.matchedPlayerId = matched.id;
    if (matched.warning) addMessage(result, matched.warning, "warning");
    if (request.mode === "create" && matched.id) addMessage(result, "Player already exists in this club.", "error");
    if (request.mode === "update" && !matched.id) addMessage(result, "Player does not already exist in this club.", "error");
  } catch (error) {
    addMessage(result, error instanceof Error ? error.message : String(error), "error");
  }
  return result;
}

export function previewPlayerImport(request: PlayerImportRequest): PlayerImportPreview {
  const database = getDatabase();
  const rows: PlayerImportPreviewRow[] = [];
  const seen = new Map<string, PlayerImportPreviewRow>();
  for (const row of request.rows) {
    const preview = previewRow(database, row, request);
    const duplicateKey = `${identity(row.teamId ?? row.teamName)}:${rowIdentity(row)}`;
    const previous = seen.get(duplicateKey);
    if (previous) {
      if (previous.birthDate !== row.birthDate) {
        addMessage(preview, `Conflicts with workbook row ${previous.sourceRow}: date of birth differs.`, "error");
        addMessage(previous, `Conflicts with workbook row ${row.sourceRow}: date of birth differs.`, "error");
      } else {
        addMessage(preview, `Duplicate workbook row for ${row.displayName}; no duplicate player will be created.`, "error");
      }
    } else seen.set(duplicateKey, preview);
    rows.push(preview);
  }
  const creates = rows.filter((row) => row.status !== "error" && !row.matchedPlayerId).length;
  const updates = rows.filter((row) => row.status !== "error" && Boolean(row.matchedPlayerId)).length;
  return {
    mode: request.mode,
    rows,
    sheets: request.sheets ?? [...new Set(request.rows.map((row) => row.sourceSheet))],
    recognizedSheets: request.recognizedSheets ?? [...new Set(request.rows.map((row) => row.sourceSheet))],
    unmappedColumns: request.unmappedColumns ?? [...new Set(request.rows.flatMap((row) => row.unmappedColumns))],
    summary: {
      rowsDetected: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      warnings: rows.filter((row) => row.status === "warning").length,
      errors: rows.filter((row) => row.status === "error").length,
      creates,
      updates,
      unchanged: 0,
      clubs: new Set(rows.map((row) => row.matchedTeamId).filter(Boolean)).size
    }
  };
}

function writePlayer(database: DatabaseSync, row: PlayerImportRow, context: ResolvedContext, playerId?: string): { id: string; changed: boolean } {
  const timestamp = now();
  const firstName = text(row.firstName) ?? row.displayName.trim().split(/\s+/)[0] ?? row.displayName.trim();
  const derivedLastName = row.displayName.trim().split(/\s+/).slice(1).join(" ");
  const lastName = text(row.lastName) ?? (derivedLastName || firstName);
  if (!firstName || !lastName) throw new Error("player_name_required");
  const position = normalizePosition(row.primaryPosition);
  const secondary = row.secondaryPositions.map(normalizePosition).filter((value): value is string => Boolean(value && value !== position));
  if (!playerId) {
    const id = crypto.randomUUID();
    database.prepare("INSERT INTO players (id, team_id, country_id, first_name, last_name, display_name, photo_url, availability_status, position, secondary_positions_json, jersey_number, height_cm, weight_kg, birth_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(id, context.teamId, context.countryId ?? null, firstName, lastName, row.displayName.trim(), row.photoUrl ?? null, position ?? null, JSON.stringify(secondary), row.jerseyNumber ?? null, row.heightCm ?? null, row.weightKg ?? null, row.birthDate ?? null, timestamp, timestamp);
    return { id, changed: true };
  }
  const existing = database.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as Record<string, unknown>;
  const fields: string[] = ["team_id = ?", "first_name = ?", "last_name = ?", "display_name = ?", "updated_at = ?"];
  const values: unknown[] = [context.teamId, firstName, lastName, row.displayName.trim(), timestamp];
  if (context.countryId) { fields.push("country_id = ?"); values.push(context.countryId); }
  if (row.photoUrl !== undefined) { fields.push("photo_url = ?"); values.push(row.photoUrl); }
  if (position !== undefined) { fields.push("position = ?"); values.push(position); }
  if (row.secondaryPositionsProvided) { fields.push("secondary_positions_json = ?"); values.push(JSON.stringify(secondary)); }
  if (row.jerseyNumber !== undefined) { fields.push("jersey_number = ?"); values.push(row.jerseyNumber); }
  if (row.heightCm !== undefined) { fields.push("height_cm = ?"); values.push(row.heightCm); }
  if (row.weightKg !== undefined) { fields.push("weight_kg = ?"); values.push(row.weightKg); }
  if (row.birthDate !== undefined) { fields.push("birth_date = ?"); values.push(row.birthDate); }
  values.push(playerId);
  database.prepare(`UPDATE players SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  const changed = fields.length > 5 || existing.display_name !== row.displayName.trim() || existing.team_id !== context.teamId;
  return { id: playerId, changed };
}

export function executePlayerImport(request: PlayerImportRequest): PlayerImportResult {
  const preview = previewPlayerImport(request);
  if (preview.summary.errors > 0) throw new PlayerImportValidationError(preview);
  const database = getDatabase();
  let playersCreated = 0;
  let playersUpdated = 0;
  let playersUnchanged = 0;
  let squadMembershipsCreated = 0;
  const warnings = preview.rows.flatMap((row) => row.messages.filter((message) => row.status === "warning" ? true : message.startsWith("Unmapped")));
  database.transaction(() => {
    for (const row of preview.rows) {
      const context = resolveContext(database, row, request);
      const written = writePlayer(database, row, context, row.matchedPlayerId);
      if (row.matchedPlayerId) {
        if (written.changed) playersUpdated += 1;
        else playersUnchanged += 1;
      } else playersCreated += 1;
      const membership = database.prepare("SELECT id FROM squad_players WHERE squad_id = ? AND player_id = ?").get(context.squadId, written.id);
      if (!membership) {
        database.prepare("INSERT INTO squad_players (id, squad_id, player_id, role, position, jersey_number, is_captain, status, created_at, updated_at) VALUES (?, ?, ?, 'starter', ?, ?, 0, 'active', ?, ?)").run(crypto.randomUUID(), context.squadId, written.id, normalizePosition(row.primaryPosition) ?? null, row.jerseyNumber ?? null, now(), now());
        squadMembershipsCreated += 1;
      }
    }
  })();
  return { rowsProcessed: request.rows.length, playersCreated, playersUpdated, playersUnchanged, squadMembershipsCreated, warnings, errors: [] };
}
