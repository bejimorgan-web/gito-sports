import type { Stream } from "@gito/shared";

import { getDatabase } from "../db/connection.js";

function mapStream(row: Record<string, string | number | null>): Stream {
  const status = (row.status ?? row.approval_status ?? "idle") as Stream["status"];

  return {
    id: row.id as string,
    matchId: row.match_id as string,
    channelId: row.channel_id as string,
    protocol: (row.protocol as Stream["protocol"] | null) ?? "hls",
    status,
    approvalStatus: ((row.approval_status as Stream["approvalStatus"] | null) ?? status),
    healthStatus: ((row.health_status as Stream["healthStatus"] | null) ?? "unknown"),
    failureCount: Number(row.failure_count ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ...(row.health_reason ? { healthReason: row.health_reason as string } : {}),
    ...(row.last_health_at ? { lastHealthAt: row.last_health_at as string } : {}),
    ...(row.approved_by_user_id ? { approvedByUserId: row.approved_by_user_id as string } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at as string } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason as string } : {}),
    ...(row.published_at ? { publishedAt: row.published_at as string } : {})
  };
}

export function listStreams(filters?: { matchId?: string }): Stream[] {
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters?.matchId) {
    conditions.push("match_id = ?");
    params.push(filters.matchId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT id, match_id, channel_id, protocol, status, approval_status, approved_by_user_id,
        approved_at, rejection_reason, published_at, health_status, health_reason, failure_count,
        last_health_at, created_at, updated_at
       FROM streams ${where}
       ORDER BY updated_at DESC`
    )
    .all(...params) as Record<string, string | number | null>[];

  return rows.map(mapStream);
}

export function getStreamById(streamId: string): Stream | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, match_id, channel_id, protocol, status, approval_status, approved_by_user_id,
        approved_at, rejection_reason, published_at, health_status, health_reason, failure_count,
        last_health_at, created_at, updated_at
       FROM streams WHERE id = ?`
    )
    .get(streamId) as Record<string, string | number | null> | undefined;

  return row ? mapStream(row) : undefined;
}
