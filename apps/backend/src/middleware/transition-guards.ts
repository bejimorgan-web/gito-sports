import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Match, Stream } from "@gito/shared";

import { getDatabase } from "../db/connection.js";
import { assertMatchTransition, assertStreamTransition, WorkflowStateError } from "../services/workflow-state.js";

export function requireStreamTransition(nextStatus: Stream["status"]): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const streamId = request.params.streamId;

    if (!streamId) {
      response.status(400).json({ error: "stream_id_required" });
      return;
    }

    const row = getDatabase()
      .prepare(
      `SELECT s.status AS stream_status, m.status AS match_status
        FROM streams s
        JOIN matches m ON m.id = s.match_id
        LEFT JOIN channels c ON c.id = s.channel_id
        LEFT JOIN providers p ON p.id = c.provider_id
        WHERE s.id = ?`
      )
      .get(streamId) as
      | { stream_status: Stream["status"]; match_status: Match["status"] }
      | undefined;

    if (!row) {
      response.status(404).json({ error: "stream_not_found" });
      return;
    }

    assertStreamTransition(row.stream_status, nextStatus);

    if (nextStatus === "approved") {
      assertMatchTransition(row.match_status, "approved");
    }

    if (nextStatus === "active") {
      assertMatchTransition(row.match_status, "published");
    }

    next();
  };
}

export function requireMatchPublishable(
  request: Request,
  response: Response,
  next: NextFunction
) {
  const matchId = request.params.matchId;

  if (!matchId) {
    response.status(400).json({ error: "match_id_required" });
    return;
  }

  const row = getDatabase()
    .prepare(
      `SELECT m.status AS match_status, s.status AS stream_status
      FROM matches m
      JOIN streams s ON s.match_id = m.id
      LEFT JOIN channels c ON c.id = s.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE m.id = ? AND s.status = 'approved'
      ORDER BY s.updated_at DESC
      LIMIT 1`
    )
    .get(matchId) as
    | { match_status: Match["status"]; stream_status: Stream["status"] }
    | undefined;

  if (!row) {
    throw new WorkflowStateError(
      "Publishing requires an approved stream attached to the match.",
      "approved_stream_required"
    );
  }

  assertMatchTransition(row.match_status, "published");
  assertStreamTransition(row.stream_status, "active");
  next();
}
