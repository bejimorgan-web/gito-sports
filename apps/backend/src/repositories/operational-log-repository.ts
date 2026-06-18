import crypto from "node:crypto";

import type { OperationalLogEntry } from "@gito/shared";

import { getDatabase } from "../db/connection";

function now() {
  return new Date().toISOString();
}

export function logOperationalEvent(input: {
  eventType: string;
  entityType: string;
  entityId?: string;
  message: string;
  severity?: OperationalLogEntry["severity"];
  metadata?: Record<string, unknown>;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO operational_logs (
        id, event_type, entity_type, entity_id, severity, message, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      input.eventType,
      input.entityType,
      input.entityId ?? null,
      input.severity ?? "info",
      input.message,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now()
    );
}

export function shouldLogOperationalEvent(input: {
  eventType: string;
  entityId?: string;
  minimumIntervalSeconds: number;
}): boolean {
  if (!input.entityId) {
    return true;
  }

  const row = getDatabase()
    .prepare(
      `SELECT created_at
      FROM operational_logs
      WHERE event_type = ? AND entity_id = ?
      ORDER BY created_at DESC
      LIMIT 1`
    )
    .get(input.eventType, input.entityId) as { created_at: string } | undefined;

  if (!row) {
    return true;
  }

  const lastLoggedAt = Date.parse(row.created_at);

  if (Number.isNaN(lastLoggedAt)) {
    return true;
  }

  return Date.now() - lastLoggedAt >= input.minimumIntervalSeconds * 1000;
}

export function listOperationalLogs(limit = 100): OperationalLogEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, event_type, entity_type, entity_id, severity, message, created_at
      FROM operational_logs
      ORDER BY created_at DESC
      LIMIT ?`
    )
    .all(limit) as {
    id: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    severity: OperationalLogEntry["severity"];
    message: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    message: row.message,
    severity: row.severity,
    createdAt: row.created_at,
    ...(row.entity_id ? { entityId: row.entity_id } : {})
  }));
}
