import crypto from "node:crypto";
import { Response, Router } from "express";

import { ScoreService } from "../services/score-service.js";
import { ensureDueManualScoreStartsAtKickoff, ensureManualScoreStartedAtKickoff } from "../services/manual-score-scheduler.js";
import { getDatabase } from "../db/connection.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { logOperationalEvent } from "../repositories/operational-log-repository.js";

export const scoresRouter = Router();

const manualScoreStatuses = new Set(["scheduled", "live", "paused", "ended", "postponed", "cancelled"]);
const manualMatchEventTypes = new Set(["note", "goal", "yellow_card", "red_card", "penalty_scored", "penalty_missed", "var_goal_disallowed", "injury", "substitution"]);

export type ManualScoreState = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  version: number;
  finalResultConfirmed: boolean;
  updatedByOperatorId: string | null;
  updatedAt: string;
  createdAt: string;
  lastConfirmedAt: string | null;
};

type ClockState = {
  matchId: string; phase: string; running: boolean; runningSince: string | null;
  elapsedSeconds: number; firstHalfAddedMinutes: number | null; secondHalfAddedMinutes: number | null;
  version: number; updatedAt: string;
};

type ManualScoreInput = {
  homeScore?: number | string;
  awayScore?: number | string;
  status?: string;
  version: number | string;
  reason?: string;
  operatorId: string;
};

type ManualScoreOperation = "start" | "update" | "confirm" | "correct" | "reopen";

function scoreError(message: string, statusCode: number, code: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeScoreValue(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  throw scoreError(`${fieldName} must be a non-negative safe integer.`, 400, `invalid_${fieldName}`);
}

function normalizeStatusValue(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!status || !manualScoreStatuses.has(status)) {
    throw scoreError("status is not supported for manual score updates.", 400, "invalid_status");
  }

  return status;
}

function normalizeExpectedVersion(value: unknown): number {
  const version = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw scoreError("version must be a non-negative integer.", 400, "invalid_version");
  }
  return version;
}

function readManualScoreState(matchId: string): ManualScoreState | null {
  const row = getDatabase().prepare(`
    SELECT match_id AS matchId,
           home_score AS homeScore,
           away_score AS awayScore,
           status,
           version,
           final_result_confirmed AS finalResultConfirmed,
           updated_by_operator_id AS updatedByOperatorId,
           updated_at AS updatedAt,
           created_at AS createdAt,
           last_confirmed_at AS lastConfirmedAt
    FROM match_score_state
    WHERE match_id = ?
  `).get(matchId) as {
    matchId: string;
    homeScore: number;
    awayScore: number;
    status: string;
    version: number;
    finalResultConfirmed: number;
    updatedByOperatorId: string | null;
    updatedAt: string;
    createdAt: string;
    lastConfirmedAt: string | null;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    matchId: row.matchId,
    homeScore: Number(row.homeScore),
    awayScore: Number(row.awayScore),
    status: row.status,
    version: Number(row.version),
    finalResultConfirmed: Number(row.finalResultConfirmed) === 1,
    updatedByOperatorId: row.updatedByOperatorId,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    lastConfirmedAt: row.lastConfirmedAt
  };
}

function readClockState(matchId: string): ClockState | null {
  const row = getDatabase().prepare(`SELECT match_id AS matchId, phase, is_running AS running,
    running_since AS runningSince, elapsed_seconds AS elapsedSeconds,
    first_half_added_minutes AS firstHalfAddedMinutes, second_half_added_minutes AS secondHalfAddedMinutes,
    version, updated_at AS updatedAt FROM match_score_clock_state WHERE match_id = ?`).get(matchId) as any;
  if (!row) return null;
  const elapsedSeconds = Number(row.elapsedSeconds) + (Number(row.running) === 1 && row.runningSince
    ? Math.max(0, Math.floor((Date.now() - new Date(row.runningSince).getTime()) / 1000)) : 0);
  const responseNow = new Date().toISOString();
  const responseRunningSince = Number(row.running) === 1 && row.runningSince && Date.parse(row.runningSince) > Date.now() ? row.runningSince : responseNow;
  return { ...row, running: Number(row.running) === 1, runningSince: Number(row.running) === 1 ? responseRunningSince : null, elapsedSeconds, version: Number(row.version) };
}

function recordClockAction(matchId: string, operatorId: string, action: string, expectedVersion: unknown, value?: unknown) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const current = readClockState(matchId);
    if (!current) throw scoreError("match_clock_not_started", 409, "match_clock_not_started");
    if (normalizeExpectedVersion(expectedVersion) !== current.version) throw scoreError("stale_clock_version", 409, "stale_clock_version");
    const now = new Date().toISOString();
    let phase = current.phase; let running = current.running; let runningSince = current.runningSince;
    let elapsed = current.elapsedSeconds; let firstAdded = current.firstHalfAddedMinutes; let secondAdded = current.secondHalfAddedMinutes;
    const football = Boolean(db.prepare(`SELECT 1 FROM matches m JOIN competitions c ON c.id=m.competition_id JOIN sports s ON s.id=c.sport_id WHERE m.id=? AND lower(s.slug) IN ('football','soccer')`).get(matchId));
    const elapsedBefore = elapsed;
    if (action === "set_first_added" || action === "set_second_added") {
      if (!football) throw scoreError("added_time_is_only_supported_for_soccer", 422, "unsupported_clock_rule");
      const minutes = normalizeScoreValue(value, "addedMinutes");
      if (minutes > 30) throw scoreError("added_minutes_must_be_between_0_and_30", 400, "invalid_added_minutes");
      if (action === "set_first_added" && elapsed < 2700) throw scoreError("first_half_added_time_not_due", 409, "invalid_clock_transition");
      if (action === "set_second_added" && elapsed < 5400 + (firstAdded ?? 0) * 60) throw scoreError("second_half_added_time_not_due", 409, "invalid_clock_transition");
      if (action === "set_first_added") firstAdded = minutes; else secondAdded = minutes;
    } else if (action === "pause" && running) {
      phase = "paused"; running = false; runningSince = null;
    } else if (action === "resume" && !running && ["first_half", "second_half", "running", "paused"].includes(phase)) {
      phase = phase === "paused" ? (football ? (elapsed <= 2700 + (firstAdded ?? 0) * 60 ? "first_half" : "second_half") : "running") : phase;
      running = true; runningSince = now;
    } else if (action === "halftime" && football && running && elapsed >= 2700 + (firstAdded ?? 0) * 60) {
      phase = "halftime"; running = false; runningSince = null; elapsed = Math.max(elapsed, 2700 + (firstAdded ?? 0) * 60);
    } else if (action === "start_second_half" && football && phase === "halftime") {
      phase = "second_half"; running = true; runningSince = now;
    } else if (action === "end" && (football ? elapsed >= 5400 + ((firstAdded ?? 0) + (secondAdded ?? 0)) * 60 : running)) {
      phase = "ended"; running = false; runningSince = null;
    } else {
      throw scoreError("invalid_clock_transition", 409, "invalid_clock_transition");
    }
    const version = current.version + 1;
    if (running) runningSince = now;
    db.prepare(`UPDATE match_score_clock_state SET phase=?, is_running=?, running_since=?, elapsed_seconds=?, first_half_added_minutes=?, second_half_added_minutes=?, version=?, updated_by_operator_id=?, updated_at=? WHERE match_id=?`)
      .run(phase, running ? 1 : 0, runningSince, elapsed, firstAdded, secondAdded, version, operatorId, now, matchId);
    const next = { ...current, phase, running, runningSince, elapsedSeconds: elapsed, firstHalfAddedMinutes: firstAdded, secondHalfAddedMinutes: secondAdded, version, updatedAt: now };
    db.prepare(`INSERT INTO match_score_clock_audit (id,match_id,action,operator_id,previous_state,new_state,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), matchId, action, operatorId, JSON.stringify({ ...current, elapsedSeconds: elapsedBefore }), JSON.stringify(next), now);
    if (["pause", "resume", "halftime", "start_second_half", "end"].includes(action)) {
      const score = readManualScoreState(matchId);
      if (score && !score.finalResultConfirmed) {
        const status = action === "pause" || action === "halftime" ? "paused" : action === "end" ? "ended" : "live";
        const scoreVersion = score.version + 1;
        db.prepare("UPDATE match_score_state SET status=?, version=?, updated_by_operator_id=?, updated_at=? WHERE match_id=?")
          .run(status, scoreVersion, operatorId, now, matchId);
        db.prepare(`INSERT INTO match_score_audit (id,match_id,action,operator_id,previous_version,new_version,previous_home_score,previous_away_score,new_home_score,new_away_score,previous_status,new_status,previous_final_result_confirmed,new_final_result_confirmed,reason,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(crypto.randomUUID(), matchId, "score_updated", operatorId, score.version, scoreVersion, score.homeScore, score.awayScore, score.homeScore, score.awayScore, score.status, status, 0, 0, null, JSON.stringify({ operation: `clock_${action}`, operatorId }), now);
      }
    }
    db.exec("COMMIT;");
    return next;
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
}

function ensureManualFootballMatch(matchId: string): { id: string; status: string } {
  const row = getDatabase().prepare(`
    SELECT m.id, m.status
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    JOIN sports s ON s.id = c.sport_id
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    LEFT JOIN seasons se ON se.id = m.season_id
    WHERE m.id = ?
      AND lower(s.slug) IN ('football', 'soccer')
      AND h.sport_id = c.sport_id
      AND a.sport_id = c.sport_id
      AND (m.season_id IS NULL OR se.competition_id = m.competition_id)
  `).get(matchId) as { id: string; status: string } | undefined;
  if (!row) {
    const exists = getDatabase().prepare("SELECT id FROM matches WHERE id = ?").get(matchId);
    if (!exists) {
      throw scoreError("match_not_found", 404, "match_not_found");
    }
    throw scoreError("match_is_not_a_valid_football_fixture", 422, "invalid_match_relationships");
  }
  return row;
}

function persistManualScoreChange(matchId: string, input: ManualScoreInput, operation: ManualScoreOperation) {
  const db = getDatabase();
  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE;");
    transactionOpen = true;
    const fixture = ensureManualFootballMatch(matchId);
    const current = readManualScoreState(matchId);
    const expectedVersion = normalizeExpectedVersion(input.version);
    if (expectedVersion !== (current?.version ?? 0)) {
      throw scoreError("stale_score_version", 409, "stale_score_version");
    }

    if (!input.operatorId) {
      throw scoreError("authenticated operator identity is required.", 401, "operator_identity_required");
    }

    let nextHomeScore = current?.homeScore ?? 0;
    let nextAwayScore = current?.awayScore ?? 0;
    let nextStatus = current?.status ?? "scheduled";
    let nextConfirmed = current?.finalResultConfirmed ?? false;
    let action: string;

    switch (operation) {
      case "start":
        if ((current && current.status !== "scheduled")
            || !["scheduled", "approved", "published"].includes(fixture.status)) {
          throw scoreError("only a scheduled match can be started.", 409, "invalid_match_transition");
        }
        nextHomeScore = normalizeScoreValue(input.homeScore ?? nextHomeScore, "homeScore");
        nextAwayScore = normalizeScoreValue(input.awayScore ?? nextAwayScore, "awayScore");
        nextStatus = "live";
        action = "score_updated";
        break;
      case "update":
        if (!current || current.finalResultConfirmed || !["live", "paused"].includes(current.status)) {
          throw scoreError("only an unconfirmed live or paused match can be updated.", 409, "invalid_match_transition");
        }
        nextHomeScore = normalizeScoreValue(input.homeScore ?? nextHomeScore, "homeScore");
        nextAwayScore = normalizeScoreValue(input.awayScore ?? nextAwayScore, "awayScore");
        nextStatus = normalizeStatusValue(input.status ?? nextStatus);
        if (nextStatus === "scheduled") {
          throw scoreError("a started match cannot return to scheduled.", 409, "invalid_match_transition");
        }
        action = "score_updated";
        break;
      case "confirm":
        if (!current || current.finalResultConfirmed || current.status !== "ended") {
          throw scoreError("only an ended, unconfirmed match can be finalized.", 409, "invalid_match_transition");
        }
        nextStatus = "ended";
        nextConfirmed = true;
        action = "final_result_confirmed";
        break;
      case "correct":
        if (!current?.finalResultConfirmed) {
          throw scoreError("only a confirmed final result can be corrected.", 409, "invalid_match_transition");
        }
        nextHomeScore = normalizeScoreValue(input.homeScore, "homeScore");
        nextAwayScore = normalizeScoreValue(input.awayScore, "awayScore");
        nextStatus = "ended";
        action = "score_corrected";
        break;
      case "reopen":
        if (!current?.finalResultConfirmed) {
          throw scoreError("only a confirmed final result can be reopened.", 409, "invalid_match_transition");
        }
        nextStatus = "live";
        nextConfirmed = false;
        action = "final_result_reopened";
        break;
    }

    const now = new Date().toISOString();
    const nextVersion = (current?.version ?? 0) + 1;
    const nextConfirmedAt = operation === "confirm" || operation === "correct"
      ? now
      : operation === "reopen" ? null : current?.lastConfirmedAt ?? null;
    if (current) {
      db.prepare(`
        UPDATE match_score_state
        SET home_score = ?, away_score = ?, status = ?, final_result_confirmed = ?,
            version = ?, updated_by_operator_id = ?, last_confirmed_at = ?, updated_at = ?
        WHERE match_id = ?
      `).run(nextHomeScore, nextAwayScore, nextStatus, nextConfirmed ? 1 : 0, nextVersion, input.operatorId, nextConfirmedAt, now, matchId);
    } else {
      db.prepare(`
        INSERT INTO match_score_state (
          id, match_id, home_score, away_score, status, version, final_result_confirmed,
          updated_by_operator_id, last_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), matchId, nextHomeScore, nextAwayScore, nextStatus, nextVersion, nextConfirmed ? 1 : 0, input.operatorId, nextConfirmedAt, now, now);
    }

    db.prepare(`
      INSERT INTO match_score_audit (
        id, match_id, action, operator_id, previous_version, new_version,
        previous_home_score, previous_away_score, new_home_score, new_away_score,
        previous_status, new_status, previous_final_result_confirmed, new_final_result_confirmed,
        reason, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      matchId,
      action,
      input.operatorId,
      current?.version ?? 0,
      nextVersion,
      current?.homeScore ?? null,
      current?.awayScore ?? null,
      nextHomeScore,
      nextAwayScore,
      current?.status ?? null,
      nextStatus,
      current?.finalResultConfirmed ? 1 : 0,
      nextConfirmed ? 1 : 0,
      input.reason ?? null,
      JSON.stringify({ operation, operatorId: input.operatorId }),
      now
    );

    logOperationalEvent({
      eventType: action,
      entityType: "match",
      entityId: matchId,
      message: `Manual score ${action} for match ${matchId}`,
      severity: operation === "reopen" ? "warning" : "info",
      metadata: {
        matchId,
        operatorId: input.operatorId,
        previousVersion: current?.version ?? 0,
        newVersion: nextVersion,
        previousHomeScore: current?.homeScore ?? null,
        previousAwayScore: current?.awayScore ?? null,
        homeScore: nextHomeScore,
        awayScore: nextAwayScore,
        status: nextStatus,
        finalResultConfirmed: nextConfirmed
      }
    });

    db.exec("COMMIT;");
    transactionOpen = false;
    return readManualScoreState(matchId)!;
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK;");
    }
    throw error;
  }
}

export function updateManualMatchScore(matchId: string, input: ManualScoreInput) {
  return persistManualScoreChange(matchId, input, "update");
}

export function startManualMatch(matchId: string, input: ManualScoreInput) {
  return persistManualScoreChange(matchId, input, "start");
}

export function confirmManualMatchResult(matchId: string, input: ManualScoreInput) {
  return persistManualScoreChange(matchId, input, "confirm");
}

export function correctManualMatchResult(matchId: string, input: ManualScoreInput) {
  return persistManualScoreChange(matchId, input, "correct");
}

export function reopenManualMatchResult(matchId: string, input: ManualScoreInput) {
  return persistManualScoreChange(matchId, input, "reopen");
}

export function getManualMatchScoreState(matchId: string) {
  return readManualScoreState(matchId);
}

function requireAdmin(request: AuthenticatedRequest, response: Response, next: () => void) {
  if (request.operator?.role !== "admin") {
    response.status(403).json({ error: "admin_required" });
    return;
  }
  next();
}

function readManualScoreInput(request: AuthenticatedRequest, response: Response, requireScores = false): ManualScoreInput | null {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "invalid_payload" });
    return null;
  }
  const { version, homeScore, awayScore, status, reason } = body as Record<string, unknown>;
  if (version === undefined
      || (requireScores && (homeScore === undefined || awayScore === undefined))
      || (reason !== undefined && (typeof reason !== "string" || reason.length > 500))
      || (status !== undefined && typeof status !== "string")) {
    response.status(400).json({ error: "invalid_payload" });
    return null;
  }
  return {
    version: version as number | string,
    ...(homeScore !== undefined ? { homeScore: homeScore as number | string } : {}),
    ...(awayScore !== undefined ? { awayScore: awayScore as number | string } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(reason !== undefined ? { reason } : {}),
    operatorId: request.operator!.id
  };
}

function runManualScoreOperation(
  request: AuthenticatedRequest,
  response: Response,
  operation: (matchId: string, input: ManualScoreInput) => ManualScoreState,
  requireScores = false
) {
  if (ScoreService.getSourceMode().mode !== "manual") {
    response.status(409).json({ error: "score_source_is_api", message: "Switch score source to Manual before changing scores." });
    return;
  }
  const matchId = request.params.id;
  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }
  const input = readManualScoreInput(request, response, requireScores);
  if (!input) return;
  try {
    const state = operation(matchId, input);
    ScoreService.notifyManualScoreUpdate(matchId, state.version);
    response.json({ data: state });
  } catch (error) {
    handleScoreError(error, response);
  }
}

scoresRouter.get("/source-mode", protectedRoute, requireAdmin, (_request, response) => {
  response.json({ data: ScoreService.getSourceMode() });
});

scoresRouter.put("/source-mode", protectedRoute, requireAdmin, (request, response) => {
  const mode = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>).mode : undefined;
  if (mode !== "manual" && mode !== "api") {
    response.status(400).json({ error: "invalid_score_source_mode" });
    return;
  }
  try {
    response.json({ data: ScoreService.setSourceMode(mode) });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/manual/:id", protectedRoute, requireAdmin, (request, response) => {
  const matchId = request.params.id;
  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }
  try {
    ensureManualScoreStartedAtKickoff(matchId);
    const state = getManualMatchScoreState(matchId);
    if (!state) {
      response.status(404).json({ error: "manual_score_not_found" });
      return;
    }
    response.json({ data: state });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/manual/:id/events", protectedRoute, requireAdmin, (request, response) => {
  const id = request.params.id;
  if (!id) return response.status(400).json({ error: "match_id_required" });
  const rows = getDatabase().prepare(`SELECT id, minute, description, event_type AS eventType,
      team_id AS teamId, player_id AS playerId, related_player_id AS relatedPlayerId,
      home_score AS homeScore, away_score AS awayScore, created_at AS createdAt, updated_at AS updatedAt
    FROM match_score_timeline WHERE match_id=? ORDER BY minute, created_at`).all(id);
  response.json({ data: rows });
});

scoresRouter.get("/manual/:id/players", protectedRoute, requireAdmin, (request, response) => {
  const matchId = request.params.id;
  if (!matchId) return response.status(400).json({ error: "match_id_required" });
  const players = getDatabase().prepare(`
    SELECT DISTINCT p.id, COALESCE(NULLIF(p.display_name, ''), p.first_name || ' ' || p.last_name) AS name,
      t.id AS teamId, t.name AS teamName, member.jersey_number AS jerseyNumber
    FROM matches m
    JOIN teams t ON t.id IN (m.home_team_id, m.away_team_id)
    JOIN season_squads squad ON squad.team_id=t.id AND squad.status='active'
      AND (squad.competition_id IS NULL OR squad.competition_id=m.competition_id)
      AND (m.season_id IS NULL OR squad.season_id IS NULL OR squad.season_id=m.season_id)
    JOIN squad_players member ON member.squad_id=squad.id AND member.status='active'
    JOIN players p ON p.id=member.player_id AND p.status='active'
    WHERE m.id=? ORDER BY t.name, member.jersey_number, name
  `).all(matchId);
  response.json({ data: players });
});

scoresRouter.post("/manual/:id/events", protectedRoute, requireAdmin, (request: AuthenticatedRequest, response) => {
  const matchId = request.params.id;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : {};
  const eventType = typeof body.eventType === "string" ? body.eventType : "note";
  if (!matchId || !Number.isSafeInteger(body.minute) || Number(body.minute) < 0 || Number(body.minute) > 150
    || !manualMatchEventTypes.has(eventType) || body.version === undefined
    || (eventType === "note" && (typeof body.description !== "string" || !body.description.trim() || body.description.trim().length > 240))
    || (eventType === "note" && (body.homeScore === undefined || body.awayScore === undefined))
    || (eventType !== "note" && (typeof body.teamId !== "string" || !body.teamId || typeof body.playerId !== "string" || !body.playerId))
    || (eventType === "substitution" && (typeof body.relatedPlayerId !== "string" || !body.relatedPlayerId))) {
    return response.status(400).json({ error: "invalid_event_payload" });
  }
  if (ScoreService.getSourceMode().mode !== "manual") return response.status(409).json({ error: "score_source_is_api" });
  const db = getDatabase();
  try {
    db.exec("BEGIN IMMEDIATE;");
    const current = readManualScoreState(matchId);
    if (!current || current.finalResultConfirmed || !["live", "paused"].includes(current.status)) {
      throw scoreError("only a live or paused match can receive events", 409, "invalid_match_transition");
    }
    if (normalizeExpectedVersion(body.version) !== current.version) throw scoreError("stale_score_version", 409, "stale_score_version");
    const fixture = db.prepare("SELECT home_team_id AS homeTeamId, away_team_id AS awayTeamId FROM matches WHERE id=?").get(matchId) as { homeTeamId: string; awayTeamId: string } | undefined;
    if (!fixture) throw scoreError("match_not_found", 404, "match_not_found");
    const teamId = eventType === "note" ? null : String(body.teamId);
    let player: { id: string; name: string; teamId: string } | undefined;
    let relatedPlayer: { id: string; name: string; teamId: string } | undefined;
    let description = typeof body.description === "string" ? body.description.trim() : "";
    if (eventType !== "note") {
      if (![fixture.homeTeamId, fixture.awayTeamId].includes(teamId!)) throw scoreError("event_team_not_in_fixture", 422, "event_team_not_in_fixture");
      const findRosterPlayer = (playerId: string) => db.prepare(`
        SELECT p.id, COALESCE(NULLIF(p.display_name, ''), p.first_name || ' ' || p.last_name) AS name, p.team_id AS teamId
        FROM players p JOIN squad_players member ON member.player_id=p.id AND member.status='active'
        JOIN season_squads squad ON squad.id=member.squad_id AND squad.team_id=p.team_id AND squad.status='active'
        JOIN matches m ON m.id=?
        WHERE p.id=? AND p.team_id=? AND p.status='active'
          AND (squad.competition_id IS NULL OR squad.competition_id=m.competition_id)
          AND (m.season_id IS NULL OR squad.season_id IS NULL OR squad.season_id=m.season_id)
        LIMIT 1
      `).get(matchId, playerId, teamId!) as { id: string; name: string; teamId: string } | undefined;
      player = findRosterPlayer(String(body.playerId));
      if (!player) throw scoreError("event_player_not_in_fixture_squad", 422, "event_player_not_in_fixture_squad");
      if (body.relatedPlayerId !== undefined && body.relatedPlayerId !== null && body.relatedPlayerId !== "") {
        relatedPlayer = findRosterPlayer(String(body.relatedPlayerId));
        if (!relatedPlayer) throw scoreError("related_event_player_not_in_fixture_squad", 422, "related_event_player_not_in_fixture_squad");
        if (relatedPlayer.id === player.id) throw scoreError("event_players_must_be_different", 422, "event_players_must_be_different");
      }
      if (["goal", "penalty_scored"].includes(eventType) && relatedPlayer) description = `${player.name} · Assist: ${relatedPlayer.name}`;
      else if (eventType === "substitution" && relatedPlayer) description = `${player.name} off · ${relatedPlayer.name} on`;
      else description = `${player.name} · ${({ yellow_card: "Yellow card", red_card: "Red card", penalty_missed: "Penalty missed", var_goal_disallowed: "Goal disallowed by VAR", injury: "Injury", goal: "Goal", penalty_scored: "Penalty scored" } as Record<string, string>)[eventType] ?? eventType}`;
    }
    const homeScore = eventType === "note"
      ? normalizeScoreValue(body.homeScore, "homeScore")
      : current.homeScore + (teamId === fixture.homeTeamId && ["goal", "penalty_scored"].includes(eventType) ? 1 : 0);
    const awayScore = eventType === "note"
      ? normalizeScoreValue(body.awayScore, "awayScore")
      : current.awayScore + (teamId === fixture.awayTeamId && ["goal", "penalty_scored"].includes(eventType) ? 1 : 0);
    const now = new Date().toISOString();
    const version = current.version + 1;
    const eventId = crypto.randomUUID();
    db.prepare(`UPDATE match_score_state SET home_score=?, away_score=?, version=?, updated_by_operator_id=?, updated_at=? WHERE match_id=?`)
      .run(homeScore, awayScore, version, request.operator!.id, now, matchId);
    db.prepare(`INSERT INTO match_score_audit (id,match_id,action,operator_id,previous_version,new_version,previous_home_score,previous_away_score,new_home_score,new_away_score,previous_status,new_status,previous_final_result_confirmed,new_final_result_confirmed,reason,metadata,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), matchId, "score_updated", request.operator!.id, current.version, version, current.homeScore, current.awayScore,
        homeScore, awayScore, current.status, current.status, 0, 0, null,
        JSON.stringify({ operation: "record_match_event", eventId, eventType, minute: body.minute, description }), now);
    db.prepare(`INSERT INTO match_score_timeline (id,match_id,minute,description,event_type,team_id,player_id,related_player_id,home_score,away_score,operator_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(eventId, matchId, body.minute, description, eventType, teamId, player?.id ?? null, relatedPlayer?.id ?? null, homeScore, awayScore, request.operator!.id, now, now);
    db.exec("COMMIT;");
    const state = readManualScoreState(matchId)!;
    ScoreService.notifyManualScoreUpdate(matchId, version);
    response.status(201).json({ data: { id: eventId, minute: Number(body.minute), description, eventType, teamId, playerId: player?.id ?? null, relatedPlayerId: relatedPlayer?.id ?? null, homeScore, awayScore, createdAt: now, updatedAt: now, scoreState: state } });
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch { /* transaction may already be committed */ }
    handleScoreError(error, response);
  }
});

scoresRouter.patch("/manual/:id/events/:eventId", protectedRoute, requireAdmin, (request: AuthenticatedRequest, response) => {
  const matchId = request.params.id;
  const eventId = request.params.eventId;
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  if (!matchId || !eventId || !Number.isSafeInteger(body.minute) || Number(body.minute) < 0 || Number(body.minute) > 150 || body.version === undefined) {
    return response.status(400).json({ error: "invalid_event_payload" });
  }
  if (ScoreService.getSourceMode().mode !== "manual") return response.status(409).json({ error: "score_source_is_api" });
  const db = getDatabase();
  try {
    db.exec("BEGIN IMMEDIATE;");
    const current = readManualScoreState(matchId);
    if (!current || current.finalResultConfirmed || !["live", "paused"].includes(current.status)) throw scoreError("only a live or paused match can edit events", 409, "invalid_match_transition");
    if (normalizeExpectedVersion(body.version) !== current.version) throw scoreError("stale_score_version", 409, "stale_score_version");
    const event = db.prepare("SELECT id, minute, description FROM match_score_timeline WHERE id=? AND match_id=?").get(eventId, matchId) as { id: string; minute: number; description: string } | undefined;
    if (!event) throw scoreError("match_event_not_found", 404, "match_event_not_found");
    const updatedAt = new Date().toISOString();
    db.prepare("UPDATE match_score_timeline SET minute=?, updated_at=? WHERE id=? AND match_id=?").run(body.minute, updatedAt, eventId, matchId);
    db.exec("COMMIT;");
    ScoreService.notifyManualScoreUpdate(matchId, current.version);
    response.json({ data: { id: event.id, minute: Number(body.minute), description: event.description, updatedAt } });
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch { /* transaction may already be committed */ }
    handleScoreError(error, response);
  }
});

scoresRouter.post("/manual/:id/start", protectedRoute, requireAdmin, (request, response) => {
  runManualScoreOperation(request, response, (matchId, input) => {
    const state = startManualMatch(matchId, input);
    const now = new Date().toISOString();
    const db = getDatabase();
    const fixtureTime = db.prepare("SELECT starts_at AS startsAt FROM matches WHERE id=?").get(matchId) as { startsAt: string } | undefined;
    const clockStart = fixtureTime?.startsAt && String(fixtureTime.startsAt).includes("T") ? fixtureTime.startsAt : now;
    db.prepare(`INSERT OR IGNORE INTO match_score_clock_state (match_id,phase,is_running,running_since,elapsed_seconds,version,updated_by_operator_id,created_at,updated_at) VALUES (?,'first_half',1,?,0,1,?,?,?)`)
      .run(matchId, clockStart, input.operatorId, now, now);
    db.prepare(`INSERT INTO match_score_clock_audit (id,match_id,action,operator_id,previous_state,new_state,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), matchId, "start_first_half", input.operatorId, null, JSON.stringify({ phase: "first_half", running: true, runningSince: clockStart, elapsedSeconds: 0 }), now);
    return state;
  });
});

scoresRouter.get("/manual/:id/clock", protectedRoute, requireAdmin, (request, response) => {
  const id = request.params.id;
  if (!id) return response.status(400).json({ error: "match_id_required" });
  const clock = readClockState(id);
  if (!clock) return response.status(404).json({ error: "match_clock_not_started" });
  const fixture = getDatabase().prepare("SELECT starts_at AS startsAt FROM matches WHERE id=?").get(id) as { startsAt: string } | undefined;
  response.json({ data: { ...clock, startsAt: fixture?.startsAt ?? null } });
});

scoresRouter.post("/manual/:id/clock", protectedRoute, requireAdmin, (request: AuthenticatedRequest, response) => {
  const id = request.params.id;
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  if (!id || typeof body.action !== "string" || body.version === undefined) return response.status(400).json({ error: "invalid_payload" });
  if (ScoreService.getSourceMode().mode !== "manual") return response.status(409).json({ error: "score_source_is_api", message: "Switch score source to Manual before changing match clocks." });
  try {
    if (body.action === "initialize") {
      const db = getDatabase();
      db.exec("BEGIN IMMEDIATE;");
      try {
        const score = readManualScoreState(id);
        if (!score || score.finalResultConfirmed || !["live", "paused"].includes(score.status)) throw scoreError("manual_score_not_started", 409, "manual_score_not_started");
        const fixture = db.prepare("SELECT starts_at AS startsAt FROM matches WHERE id=?").get(id) as { startsAt: string } | undefined;
        const now = new Date().toISOString();
        const scheduled = fixture?.startsAt && String(fixture.startsAt).includes("T") && Date.parse(fixture.startsAt) <= Date.now() ? fixture.startsAt : now;
        db.prepare(`INSERT INTO match_score_clock_state (match_id,phase,is_running,running_since,elapsed_seconds,version,updated_by_operator_id,created_at,updated_at) VALUES (?,'first_half',1,?,0,1,?,?,?)`)
          .run(id, scheduled, request.operator!.id, now, now);
        db.prepare(`INSERT INTO match_score_clock_audit (id,match_id,action,operator_id,previous_state,new_state,created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(crypto.randomUUID(), id, "initialize_clock", request.operator!.id, null, JSON.stringify({ phase: "first_half", running: true, runningSince: scheduled }), now);
        db.exec("COMMIT;");
      } catch (error) { db.exec("ROLLBACK;"); throw error; }
      response.json({ data: readClockState(id) });
      return;
    }
    const clock = recordClockAction(id, request.operator!.id, body.action, body.version, body.minutes);
    if (["pause", "resume", "halftime", "start_second_half", "end"].includes(body.action)) {
      const score = readManualScoreState(id);
      if (score) ScoreService.notifyManualScoreUpdate(id, score.version);
    }
    response.json({ data: clock });
  } catch (error) { handleScoreError(error, response); }
});

scoresRouter.patch("/manual/:id", protectedRoute, requireAdmin, (request, response) => {
  runManualScoreOperation(request, response, updateManualMatchScore);
});

scoresRouter.post("/manual/:id/confirm", protectedRoute, requireAdmin, (request, response) => {
  runManualScoreOperation(request, response, confirmManualMatchResult);
});

scoresRouter.post("/manual/:id/correct", protectedRoute, requireAdmin, (request, response) => {
  const matchId = request.params.id;
  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }
  const input = readManualScoreInput(request, response, true);
  if (!input) return;
  if (!input.reason?.trim()) {
    response.status(400).json({ error: "correction_reason_required" });
    return;
  }
  try {
    const state = correctManualMatchResult(matchId, input);
    ScoreService.notifyManualScoreUpdate(matchId, state.version);
    response.json({ data: state });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.post("/manual/:id/reopen", protectedRoute, requireAdmin, (request, response) => {
  const matchId = request.params.id;
  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }
  const input = readManualScoreInput(request, response);
  if (!input) return;
  if (!input.reason?.trim()) {
    response.status(400).json({ error: "reopen_reason_required" });
    return;
  }
  try {
    const state = reopenManualMatchResult(matchId, input);
    ScoreService.notifyManualScoreUpdate(matchId, state.version);
    response.json({ data: state });
  } catch (error) {
    handleScoreError(error, response);
  }
});
function attachVenueImage<T extends { id: string; homeTeam?: { name?: string }; awayTeam?: { name?: string } }>(match: T): T & { venueImageUrl: string | null } {
  const rows = getDatabase().prepare(`
    SELECT m.venue_image_url, m.venue_name, h.name AS home_name, a.name AS away_name,
           h.home_stadium_name, h.home_stadium_photo_url
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE m.external_match_id = ?
  `).all(match.id) as Array<{ venue_image_url: string | null; venue_name: string | null; home_name: string; away_name: string; home_stadium_name: string | null; home_stadium_photo_url: string | null }>;
  const candidates = rows.filter((row) =>
    row.home_name.trim().toLowerCase() === match.homeTeam?.name?.trim().toLowerCase()
    && row.away_name.trim().toLowerCase() === match.awayTeam?.name?.trim().toLowerCase());
  const fixture = candidates.length === 1 ? candidates[0] : rows.length === 1 ? rows[0] : undefined;
  const venueImageUrl = fixture?.venue_image_url
    ?? (fixture && (!fixture.venue_name || fixture.venue_name === fixture.home_stadium_name) ? fixture.home_stadium_photo_url : null)
    ?? null;
  return { ...match, venueImageUrl };
}

function handleScoreError(error: unknown, response: Response) {
  const details = error as { statusCode?: number; code?: string; message?: string };
  response.status(details.statusCode ?? 500).json({
    error: details.code ?? "score_service_error",
    message: details.message ?? "Live score service failed."
  });
}

function buildScoreMeta(source: string, count: number, ageMs?: number, cachedAt?: string) {
  return {
    source: source === "manual" ? "manual" : ["cache", "stale_cache"].includes(source) ? "cache" : "api",
    count,
    ageMs: ageMs ?? 0,
    cachedAt: cachedAt ?? new Date().toISOString()
  };
}

scoresRouter.get("/live", async (_request, response) => {
  try {
    ensureDueManualScoreStartsAtKickoff();
    const result = await ScoreService.listLiveScores();
    response.json({
      data: result.matches.map(attachVenueImage),
      meta: buildScoreMeta(result.source, result.matches.length, result.ageMs, result.cachedAt)
    });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/match/:id", async (request, response) => {
  try {
    const result = await ScoreService.getMatch(request.params.id);

    if (!result) {
      response.status(404).json({ error: "score_match_not_found" });
      return;
    }

    response.json({
      data: attachVenueImage(result.match),
      meta: {
        source: result.source,
        ageMs: result.ageMs,
        cachedAt: result.cachedAt
      }
    });
  } catch (error) {
    handleScoreError(error, response);
  }
});

scoresRouter.get("/competitions", async (_request, response) => {
  try {
    response.json({ data: await ScoreService.listCompetitions() });
  } catch (error) {
    handleScoreError(error, response);
  }
});
