import crypto from "node:crypto";
import { Response, Router } from "express";

import { ScoreService } from "../services/score-service.js";
import { getDatabase } from "../db/connection.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { logOperationalEvent } from "../repositories/operational-log-repository.js";

export const scoresRouter = Router();

const manualScoreStatuses = new Set(["scheduled", "live", "paused", "ended", "postponed", "cancelled"]);

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

scoresRouter.post("/manual/:id/start", protectedRoute, requireAdmin, (request, response) => {
  runManualScoreOperation(request, response, startManualMatch);
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
