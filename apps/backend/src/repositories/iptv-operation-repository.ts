import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import type { IptvOperation, IptvOperationProgress, IptvOperationStatus, IptvOperationType } from "../services/iptv-operation-manager.js";

type OperationRow = {
  operation_id: string;
  provider_id: string | null;
  operation_type: IptvOperationType;
  status: IptvOperationStatus;
  phase: string;
  current_message: string;
  total_count: number | null;
  processed_count: number;
  saved_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  checkpoint: string | null;
  cancellation_requested: number;
  error_summary: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS iptv_operations (
    operation_id TEXT PRIMARY KEY,
    provider_id TEXT,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout', 'cancelled', 'interrupted')),
    phase TEXT NOT NULL,
    current_message TEXT NOT NULL,
    total_count INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0,
    saved_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    checkpoint TEXT,
    cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_requested IN (0, 1)),
    error_summary TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_iptv_operations_status_updated ON iptv_operations(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_iptv_operations_provider_created ON iptv_operations(provider_id, created_at);
`;

let schemaReady = false;

function now() {
  return new Date().toISOString();
}

function ensureSchema() {
  if (schemaReady) return;
  getDatabase().exec(createTableSql);
  schemaReady = true;
}

function mapOperation(row: OperationRow): IptvOperation {
  return {
    id: row.operation_id,
    type: row.operation_type,
    status: row.status,
    startedAt: row.started_at ?? row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.total_count !== null ? { total: row.total_count } : {}),
    processed: row.processed_count,
    succeeded: row.saved_count,
    updated: row.updated_count,
    skipped: row.skipped_count,
    failed: row.failed_count,
    currentStage: row.phase,
    currentMessage: row.current_message,
    ...(row.checkpoint !== null ? { checkpoint: row.checkpoint } : {}),
    ...(row.error_summary ? { error: row.error_summary } : {}),
    cancelled: row.cancellation_requested === 1 || row.status === "cancelled",
    ...(row.created_by ? { createdBy: row.created_by } : {})
  };
}

export function createIptvOperation(input: {
  id?: string;
  providerId?: string;
  type: IptvOperationType;
  createdBy?: string;
  timeoutMs?: number;
}) {
  ensureSchema();
  const database = getDatabase();
  const timestamp = now();
  const id = input.id ?? `iptv_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO iptv_operations (
      operation_id, provider_id, operation_type, status, phase, current_message,
      total_count, processed_count, saved_count, updated_count, skipped_count, failed_count,
      cancellation_requested, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', 'queued', 'Operation queued.', NULL, 0, 0, 0, 0, 0, 0, ?, ?, ?)
  `).run(id, input.providerId ?? null, input.type, input.createdBy ?? null, timestamp, timestamp);
  return getIptvOperation(id)!;
}

export function getIptvOperation(id: string) {
  ensureSchema();
  const row = getDatabase().prepare("SELECT * FROM iptv_operations WHERE operation_id = ?").get(id) as OperationRow | undefined;
  return row ? mapOperation(row) : undefined;
}

export function updateIptvOperation(id: string, progress: IptvOperationProgress & { status?: IptvOperationStatus; checkpoint?: string | null; error?: string | null; startedAt?: string; completedAt?: string; cancelled?: boolean }) {
  ensureSchema();
  const current = getDatabase().prepare("SELECT * FROM iptv_operations WHERE operation_id = ?").get(id) as OperationRow | undefined;
  if (!current) return undefined;
  const timestamp = now();
  const status = progress.status ?? current.status;
  const phase = progress.currentStage ?? current.phase;
  const message = progress.currentMessage ?? current.current_message;
  const total = progress.total ?? current.total_count;
  const processed = progress.processed ?? current.processed_count;
  const saved = progress.succeeded ?? current.saved_count;
  const updated = progress.updated ?? current.updated_count;
  const skipped = progress.skipped ?? current.skipped_count;
  const failed = progress.failed ?? current.failed_count;
  const error = progress.error === undefined ? current.error_summary : progress.error;
  const completedAt = progress.completedAt ?? (status === "completed" || status === "failed" || status === "timeout" || status === "cancelled" || status === "interrupted" ? timestamp : current.completed_at);
  getDatabase().prepare(`
    UPDATE iptv_operations SET status = ?, phase = ?, current_message = ?, total_count = ?,
      processed_count = ?, saved_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?,
      checkpoint = ?, cancellation_requested = ?, error_summary = ?, started_at = COALESCE(?, started_at),
      updated_at = ?, completed_at = ? WHERE operation_id = ?
  `).run(status, phase, message, total, processed, saved, updated, skipped, failed, progress.checkpoint ?? current.checkpoint, progress.cancelled === true || current.cancellation_requested === 1 ? 1 : 0, error, progress.startedAt ?? null, timestamp, completedAt, id);
  return getIptvOperation(id);
}

export function requestIptvOperationCancellation(id: string) {
  ensureSchema();
  const result = getDatabase().prepare("UPDATE iptv_operations SET cancellation_requested = 1, updated_at = ?, current_message = ? WHERE operation_id = ? AND status IN ('queued', 'running')").run(now(), "Cancellation requested; finishing the current safe batch.", id);
  return result.changes > 0;
}

export function recoverRunningIptvOperations() {
  ensureSchema();
  const timestamp = now();
  return getDatabase().prepare("UPDATE iptv_operations SET status = 'interrupted', phase = 'interrupted', current_message = 'Operation interrupted by a process restart.', error_summary = 'operation_interrupted', updated_at = ?, completed_at = ? WHERE status = 'running'").run(timestamp, timestamp).changes;
}

export function resetIptvOperationRepositoryForTests() {
  schemaReady = false;
}