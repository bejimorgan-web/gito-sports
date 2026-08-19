import type { Stream } from "@gito/shared";
import crypto from "node:crypto";

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

function assertCanonicalFixture(fixtureId: string) {
  const row = getDatabase().prepare("SELECT id FROM matches WHERE id = ?").get(fixtureId);
  if (!row) throw new Error("fixture_not_found");
}

function getValidChannel(channelId: string) {
  const row = getDatabase().prepare(`
    SELECT c.id, c.provider_id, c.status, p.id AS provider_id_check, p.deleted
    FROM channels c JOIN providers p ON p.id = c.provider_id
    WHERE c.id = ?
  `).get(channelId) as { id: string; provider_id: string; status: string; provider_id_check: string; deleted: number } | undefined;
  if (!row || row.status === "archived" || row.deleted === 1) throw new Error("channel_not_found");
  if (!row.provider_id_check) throw new Error("provider_not_found");
  return row;
}

export function createCanonicalStream(fixtureId: string, channelId: string, protocol: Stream["protocol"] = "hls"): Stream {
  assertCanonicalFixture(fixtureId);
  const channel = getValidChannel(channelId);
  const database = getDatabase();
  const duplicate = database.prepare("SELECT id FROM streams WHERE match_id = ? AND channel_id = ?").get(fixtureId, channel.id);
  if (duplicate) throw new Error("stream_already_assigned");
  const timestamp = new Date().toISOString();
  const streamId = crypto.randomUUID();
  database.prepare(`
    INSERT INTO streams (id, match_id, channel_id, protocol, status, approval_status, health_status, failure_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'assigned', 'assigned', 'unknown', 0, ?, ?)
  `).run(streamId, fixtureId, channel.id, protocol, timestamp, timestamp);
  return getStreamById(streamId)!;
}

export function updateCanonicalStream(fixtureId: string, streamId: string, input: { channelId?: string; protocol?: Stream["protocol"] }): Stream | undefined {
  assertCanonicalFixture(fixtureId);
  const database = getDatabase();
  const existing = database.prepare("SELECT * FROM streams WHERE id = ? AND match_id = ?").get(streamId, fixtureId) as any;
  if (!existing) return undefined;
  const channelId = input.channelId ?? existing.channel_id;
  const channel = getValidChannel(channelId);
  const duplicate = database.prepare("SELECT id FROM streams WHERE match_id = ? AND channel_id = ? AND id != ?").get(fixtureId, channel.id, streamId);
  if (duplicate) throw new Error("stream_already_assigned");
  database.prepare("UPDATE streams SET channel_id = ?, protocol = ?, updated_at = ? WHERE id = ? AND match_id = ?").run(channel.id, input.protocol ?? existing.protocol, new Date().toISOString(), streamId, fixtureId);
  return getStreamById(streamId);
}

export function deleteCanonicalStream(fixtureId: string, streamId: string): boolean {
  assertCanonicalFixture(fixtureId);
  return getDatabase().prepare("DELETE FROM streams WHERE id = ? AND match_id = ?").run(streamId, fixtureId).changes > 0;
}
