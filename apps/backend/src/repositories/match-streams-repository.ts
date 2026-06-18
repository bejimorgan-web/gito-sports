import crypto from "node:crypto";

import type { Channel, Match, MatchStreamAssignment, MatchStreamAssignmentRequest, MatchStreamAssignmentResult } from "@gito/shared";

import { getDatabase } from "../db/connection";
import { getMatchById } from "./matches-repository";
import { validateHttpStreamUrl } from "../services/url-validation";
import { WorkflowStateError } from "../services/workflow-state";

function mapMatchStreamAssignmentRow(row: Record<string, string | number>): MatchStreamAssignment {
  return {
    id: row.id as string,
    matchId: row.match_id as string,
    channelId: row.channel_id as string,
    providerId: row.provider_id as string,
    streamUrl: row.stream_url as string,
    priority: Number(row.priority ?? 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

function mapChannelRow(row: Record<string, any>): Channel {
  return {
    id: (row.channel_id ?? row.id) as string,
    providerId: row.provider_id as string,
    name: row.name as string,
    url: row.url as string,
    status: row.status as Channel["status"],
    createdAt: (row.channel_created_at ?? row.created_at) as string,
    updatedAt: (row.channel_updated_at ?? row.updated_at) as string,
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    ...(row.group_name ? { groupName: row.group_name } : {})
  };
}

export function listMatchStreamAssignments(matchId: string): Array<{ assignment: MatchStreamAssignment; channel: Channel }> {
  const rows = getDatabase()
    .prepare(
      `SELECT ms.*, c.id AS channel_id, c.provider_id, c.name, c.url, c.status, c.external_ref, c.group_name, c.created_at AS channel_created_at, c.updated_at AS channel_updated_at
       FROM match_streams ms
       JOIN channels c ON c.id = ms.channel_id
       JOIN providers p ON p.id = c.provider_id
       WHERE ms.match_id = ?
         AND c.status != 'archived'
         AND p.deleted = 0
       ORDER BY ms.priority DESC, ms.created_at ASC`
    )
    .all(matchId) as Record<string, string | number | null>[];

  return rows.map((row) => ({
    assignment: mapMatchStreamAssignmentRow(row as Record<string, string | number>),
    channel: mapChannelRow(row as Record<string, string | null>)
  }));
}

export function getMatchStreamAssignmentById(assignmentId: string): { assignment: MatchStreamAssignment; channel: Channel } | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT ms.*, c.id AS channel_id, c.provider_id, c.name, c.url, c.status, c.external_ref, c.group_name, c.created_at AS channel_created_at, c.updated_at AS channel_updated_at
       FROM match_streams ms
       JOIN channels c ON c.id = ms.channel_id
       JOIN providers p ON p.id = c.provider_id
       WHERE ms.id = ?
         AND c.status != 'archived'
         AND p.deleted = 0`
    )
    .get(assignmentId) as Record<string, string | number | null> | undefined;

  return row
    ? {
        assignment: mapMatchStreamAssignmentRow(row as Record<string, string | number>),
        channel: mapChannelRow(row as Record<string, string | null>)
      }
    : undefined;
}

export function assignChannelToSchedulingMatch(
  matchId: string,
  input: MatchStreamAssignmentRequest
): MatchStreamAssignmentResult {
  const database = getDatabase();
  const match = getMatchById(matchId);

  if (!match) {
    throw new WorkflowStateError("Match not found.", "match_not_found", 404);
  }

  const existingAssignment = database
    .prepare("SELECT id FROM match_streams WHERE match_id = ? AND channel_id = ?")
    .get(matchId, input.channelId) as { id: string } | undefined;

  if (existingAssignment) {
    throw new WorkflowStateError("Channel is already assigned to this match.", "match_stream_channel_conflict", 409);
  }

  const channelRow = database
    .prepare(
      `SELECT c.id, c.provider_id, c.name, c.url, c.status, p.status AS provider_status, p.deleted
       FROM channels c
       LEFT JOIN providers p ON p.id = c.provider_id
       WHERE c.id = ?`
    )
    .get(input.channelId) as
    | { id: string; provider_id: string; name: string; url: string; status: string; provider_status: string; deleted: number }
    | undefined;

  if (!channelRow || channelRow.status === 'archived' || channelRow.deleted === 1) {
    throw new WorkflowStateError("Channel not available for assignment.", "channel_required", 400);
  }

  const streamUrlError = validateHttpStreamUrl(channelRow.url);
  if (streamUrlError) {
    throw new WorkflowStateError("Stream metadata assignment requires a valid HTTP or HTTPS stream URL.", streamUrlError, 400);
  }

  const assignmentId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const priority = Number(input.priority ?? 0);
  const isActive = input.isActive === false ? 0 : 1;

  database
    .prepare(
      `INSERT INTO match_streams (
        id, match_id, provider_id, channel_id, stream_url, priority, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(assignmentId, matchId, channelRow.provider_id, input.channelId, channelRow.url, priority, isActive, timestamp, timestamp);

  return {
    match,
    channel: mapChannelRow(channelRow as Record<string, any>),
    assignment: {
      id: assignmentId,
      matchId,
      channelId: input.channelId,
      providerId: channelRow.provider_id,
      streamUrl: channelRow.url,
      priority,
      isActive: Boolean(isActive),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
}

export function updateMatchStreamAssignment(
  assignmentId: string,
  input: { priority?: number; isActive?: boolean }
): MatchStreamAssignment | null {
  const database = getDatabase();
  const existing = database
    .prepare("SELECT priority, is_active FROM match_streams WHERE id = ?")
    .get(assignmentId) as { priority: number; is_active: number } | undefined;

  if (!existing) {
    return null;
  }

  const priority = input.priority ?? existing.priority;
  const isActive = input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0;
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `UPDATE match_streams SET priority = ?, is_active = ?, updated_at = ? WHERE id = ?`
    )
    .run(priority, isActive, timestamp, assignmentId);

  return mapMatchStreamAssignmentRow(
    database.prepare("SELECT * FROM match_streams WHERE id = ?").get(assignmentId) as Record<string, string | number>
  );
}

export function deleteMatchStreamAssignment(assignmentId: string): boolean {
  const result = getDatabase().prepare("DELETE FROM match_streams WHERE id = ?").run(assignmentId);
  return result.changes > 0;
}
