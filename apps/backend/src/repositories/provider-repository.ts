import crypto from "node:crypto";
import { EventBus } from "../events/event-bus.js";

import type { Channel, CreateProviderRequest, IPTVProvider, ParsedChannel } from "@gito/shared";

type ProviderSyncMode = "partial" | "full";

import { getDatabase } from "../db/connection.js";
import { logChannelSyncTrace } from "../services/iptv-trace.js";

// In-memory ingestion report storage (last report per provider)
const latestIngestionReports = new Map<string, IngestionReport>();

export interface IngestionReport {
  providerId: string;
  providerMode: ProviderSyncMode;
  totalIncoming: number;
  parsed: number;
  inserted: number;
  updated: number;
  rejected: number;
  duplicates: number;
  inactiveMarked: number;
  timestamp: string;
  rejections: Array<{
    channel: ParsedChannel;
    reason: string;
  }>;
  duplicateDetections: Array<{
    channel: ParsedChannel;
    reason: "duplicate_externalRef" | "duplicate_url" | "duplicate_in_payload";
  }>;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  type: "manual" | "m3u" | "xtream";
  auth_type: "none" | "basic" | "token";
  sync_mode: "partial" | "full";
  status: "active" | "pending" | "failed" | "invalid" | "inactive";
  availability_status: "online" | "offline" | "degraded" | "unknown";
  failed_channel_loads: number;
  health_score: number;
  last_successful_stream_load_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ChannelRow {
  id: string;
  provider_id: string;
  name: string;
  external_ref: string | null;
  group_name: string | null;
  url: string;
  status: "active" | "inactive" | "archived" | "stale";
  created_at: string;
  updated_at: string;
}

function now() {
  return new Date().toISOString();
}

function mapProvider(row: ProviderRow): IPTVProvider & { syncMode?: ProviderSyncMode } {
  const base: IPTVProvider = {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    type: row.type,
    authType: row.auth_type,
    status: row.status as any,
    availabilityStatus: row.availability_status,
    failedChannelLoads: row.failed_channel_loads,
    healthScore: row.health_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_successful_stream_load_at ? { lastSuccessfulStreamLoadAt: row.last_successful_stream_load_at } : {})
  };

  return {
    ...base,
    ...(row.sync_mode ? { syncMode: row.sync_mode as ProviderSyncMode } : {})
  };
}

function mapChannel(row: ChannelRow): Channel {
  const channel: Channel = {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    url: row.url,
    status: row.status as any,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (row.external_ref) {
    channel.externalRef = row.external_ref;
  }

  if (row.group_name) {
    channel.groupName = row.group_name;
  }

  return channel;
}

export function listProviders(): IPTVProvider[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, base_url, type, auth_type, sync_mode, status, availability_status,
        failed_channel_loads, health_score, last_successful_stream_load_at, created_at, updated_at
      FROM providers WHERE deleted = 0 ORDER BY name`
    )
    .all() as ProviderRow[];

  return rows.map(mapProvider);
}

export function createProvider(input: CreateProviderRequest): IPTVProvider {
  const timestamp = now();
  const id = crypto.randomUUID();

  getDatabase()
    .prepare(
      `INSERT INTO providers (
        id, name, base_url, type, auth_type, sync_mode, credential_username, credential_password,
        availability_status, failed_channel_loads, health_score, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 0, 100, 'pending', ?, ?)`
    )
    .run(
      id,
      input.name,
      input.baseUrl,
      input.type,
      input.authType ?? "none",
      "partial",
      input.username ?? null,
      input.password ?? null,
      timestamp,
      timestamp
    );

  return {
    id,
    name: input.name,
    baseUrl: input.baseUrl,
    type: input.type,
    authType: input.authType ?? "none",
    status: "pending",
    availabilityStatus: "unknown",
    failedChannelLoads: 0,
    healthScore: 100,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function getProviderById(providerId: string): IPTVProvider | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, name, base_url, type, auth_type, sync_mode, status, availability_status,
        failed_channel_loads, health_score, last_successful_stream_load_at, created_at, updated_at
      FROM providers WHERE id = ? AND deleted = 0`
    )
    .get(providerId) as ProviderRow | undefined;

  return row ? mapProvider(row) : undefined;
}

export function updateProvider(providerId: string, input: Partial<CreateProviderRequest>): IPTVProvider | undefined {
  const database = getDatabase();
  const timestamp = now();

  const existing = database
    .prepare(
      `SELECT auth_type, credential_username, credential_password
      FROM providers WHERE id = ? AND deleted = 0`
    )
    .get(providerId) as { auth_type: string; credential_username: string | null; credential_password: string | null } | undefined;

  if (!existing) return undefined;

  database
    .prepare(
      `UPDATE providers SET
        name = COALESCE(?, name),
        base_url = COALESCE(?, base_url),
        type = COALESCE(?, type),
        auth_type = COALESCE(?, auth_type),
        sync_mode = COALESCE(?, sync_mode),
        credential_username = COALESCE(?, credential_username),
        credential_password = COALESCE(?, credential_password),
        status = 'pending',
        updated_at = ?
      WHERE id = ?`
    )
    .run(
      input.name ?? null,
      input.baseUrl ?? null,
      input.type ?? null,
      input.authType ?? null,
      null,
      input.username ?? existing.credential_username,
      input.password ?? existing.credential_password,
      timestamp,
      providerId
    );

  const updated = getProviderById(providerId);
  if (updated) {
    EventBus.emit("iptv:provider:updated", { providerId, changes: input });
  }

  return updated;
}

export function softDeleteProvider(providerId: string): boolean {
  const database = getDatabase();
  const timestamp = now();

  const res = database
    .prepare("UPDATE providers SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0")
    .run(timestamp, providerId);

  if (res.changes > 0) {
    // Archive any channels belonging to this provider so they no longer appear
    // in regular channel listings. Use 'archived' status to allow recovery if needed.
    database.prepare("UPDATE channels SET status = 'archived', updated_at = ? WHERE provider_id = ?").run(timestamp, providerId);
    EventBus.emit("iptv:provider:updated", { providerId, deleted: true });
    return true;
  }

  return false;
}

export function getProviderCredentials(providerId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, name, base_url, type, auth_type, sync_mode, credential_username, credential_password,
        status, availability_status, failed_channel_loads, health_score, last_successful_stream_load_at,
        created_at, updated_at
      FROM providers WHERE id = ? AND deleted = 0`
    )
    .get(providerId) as
    | (ProviderRow & { credential_username: string | null; credential_password: string | null })
    | undefined;
}

export function setProviderStatus(providerId: string, status: 'active' | 'failed' | 'pending' | 'invalid' | 'inactive') {
  const db = getDatabase();
  const timestamp = now();
  db.prepare('UPDATE providers SET status = ?, updated_at = ? WHERE id = ? AND deleted = 0').run(status, timestamp, providerId);
}

export function updateProviderHealth(input: {
  providerId: string;
  success: boolean;
  failureReason?: string;
  impact?: "success" | "degraded" | "failure";
}) {
  const database = getDatabase();
  const timestamp = now();
  const row = database
    .prepare("SELECT failed_channel_loads, health_score FROM providers WHERE id = ?")
    .get(input.providerId) as { failed_channel_loads: number; health_score: number } | undefined;

  if (!row) {
    return;
  }

  const impact = input.impact ?? (input.success ? "success" : "failure");
  const failedChannelLoads = impact === "success" ? row.failed_channel_loads : row.failed_channel_loads + 1;
  const healthScore = impact === "success"
    ? Math.min(100, row.health_score + 5)
    : Math.max(0, row.health_score - (impact === "degraded" ? 1 : 4));
  const availabilityStatus =
    healthScore >= 80 ? "online" : healthScore >= 40 ? "degraded" : "offline";
  const providerStatus = input.impact === "failure"
    ? "failed"
    : "active";

  database
    .prepare(
      `UPDATE providers
      SET status = ?, availability_status = ?, failed_channel_loads = ?, health_score = ?,
        last_successful_stream_load_at = CASE WHEN ? THEN ? ELSE last_successful_stream_load_at END,
        updated_at = ?
      WHERE id = ?`
    )
    .run(
      providerStatus,
      availabilityStatus,
      failedChannelLoads,
      healthScore,
      input.success ? 1 : 0,
      timestamp,
      timestamp,
      input.providerId
    );
}

export function syncProviderChannels(providerId: string, channels: ParsedChannel[]): Channel[] {
  const database = getDatabase();
  const timestamp = now();

  const provider = database
    .prepare("SELECT sync_mode FROM providers WHERE id = ? AND deleted = 0")
    .get(providerId) as { sync_mode?: ProviderSyncMode } | undefined;

  const providerMode: ProviderSyncMode = provider?.sync_mode ?? "partial";

  const existingRows = database
    .prepare("SELECT id, external_ref, url, name, group_name, status FROM channels WHERE provider_id = ?")
    .all(providerId) as { id: string; external_ref: string | null; url: string; name: string; group_name: string | null; status: "active" | "inactive" | "archived" | "stale" }[];

  function normalizeUrl(u: string | null | undefined) {
    if (!u) return "";
    try {
      // remove surrounding whitespace and trailing slash for matching
      const trimmed = u.trim();
      return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    } catch {
      return (u || "").trim();
    }
  }

  function normalizeRef(r: string | null | undefined) {
    return r ? String(r).trim() : "";
  }

  function traceChannelSync(
    channel: ParsedChannel | { name: string; url: string; externalRef?: string | null; groupName?: string | null },
    action: "insert" | "update" | "skip" | "reject" | "stale" | "complete",
    reason: string | null,
    syncPhase: "parse" | "dedupe" | "persist" | "finalize"
  ) {
    logChannelSyncTrace({
      providerId,
      providerMode,
      syncPhase,
      action,
      reason,
      channel: {
        externalRef: channel.externalRef ?? null,
        normalizedUrl: normalizeUrl(channel.url),
        originalName: channel.name,
        groupName: channel.groupName ?? null
      }
    });
  }

  const byExternal = new Map<string, { id: string; url: string }>();

  for (const r of existingRows) {
    const ext = normalizeRef(r.external_ref);
    if (ext) byExternal.set(ext, { id: r.id, url: r.url });
  }

  const processedIds = new Set<string>();
  const results: Channel[] = [];
  let channelInserts = 0;
  let channelUpdates = 0;
  let channelInactives = 0;
  const rejections: Array<{ channel: ParsedChannel; reason: string }> = [];
  const duplicateDetections: Array<{ channel: ParsedChannel; reason: "duplicate_externalRef" | "duplicate_url" | "duplicate_in_payload" }> = [];

  const insertStmt = database.prepare(
    `INSERT INTO channels (id, provider_id, name, external_ref, group_name, url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  );

  const updateStmt = database.prepare(
    `UPDATE channels SET name = ?, external_ref = ?, group_name = ?, url = ?, status = 'active', updated_at = ? WHERE id = ?`
  );

  // De-duplicate incoming channels by normalized externalRef or normalized URL within the incoming payload only
  const seen = new Map<string, ParsedChannel>();
  const seenByUrl = new Map<string, ParsedChannel>();

  for (const ch of channels) {
    const normExt = normalizeRef(ch.externalRef);
    const normUrl = normalizeUrl(ch.url);

    // Check for duplicate by externalRef
    if (normExt && seen.has(normExt)) {
      traceChannelSync(ch, "skip", "duplicate_externalRef_in_payload", "dedupe");
      duplicateDetections.push({ channel: ch, reason: "duplicate_externalRef" });
      EventBus.emit("iptv:channel:duplicate_detected", {
        providerId,
        channel: ch,
        reason: "duplicate_externalRef_in_payload"
      });
      continue;
    }

    // Check for duplicate by URL
    if (normUrl && seenByUrl.has(normUrl)) {
      traceChannelSync(ch, "skip", "duplicate_url_in_payload", "dedupe");
      duplicateDetections.push({ channel: ch, reason: "duplicate_url" });
      EventBus.emit("iptv:channel:duplicate_detected", {
        providerId,
        channel: ch,
        reason: "duplicate_url_in_payload"
      });
      continue;
    }

    // Add to seen sets
    if (normExt) seen.set(normExt, ch);
    if (normUrl) seenByUrl.set(normUrl, ch);
    traceChannelSync(ch, "insert", "added_to_processing_set", "dedupe");

    const existingByExt = normExt ? byExternal.get(normExt) : undefined;
    let channelId: string;

    if (existingByExt) {
      channelId = existingByExt.id;
      updateStmt.run(ch.name, ch.externalRef ?? null, ch.groupName ?? null, ch.url, timestamp, channelId);
      traceChannelSync(ch, "update", "matched_existing_channel_by_external_ref", "persist");
      channelUpdates += 1;
      EventBus.emit("iptv:channel:updated", { providerId, channelId, externalRef: ch.externalRef ?? null });
    } else {
      channelId = crypto.randomUUID();
      insertStmt.run(channelId, providerId, ch.name, ch.externalRef ?? null, ch.groupName ?? null, ch.url, timestamp, timestamp);
      traceChannelSync(ch, "insert", "created_new_channel_record", "persist");
      channelInserts += 1;
      EventBus.emit("iptv:channel:inserted", { providerId, channelId, externalRef: ch.externalRef ?? null });
    }

    processedIds.add(channelId);

    results.push({
      id: channelId,
      providerId,
      name: ch.name,
      url: ch.url,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(ch.externalRef ? { externalRef: ch.externalRef } : {}),
      ...(ch.groupName ? { groupName: ch.groupName } : {})
    });
  }

  // Any existing channel for this provider not in the incoming set should be adjusted according to provider sync mode
  for (const r of existingRows) {
    if (!processedIds.has(r.id)) {
      if (providerMode === "full") {
        database.prepare("UPDATE channels SET status = 'inactive', updated_at = ? WHERE id = ?").run(timestamp, r.id);
        traceChannelSync(
          {
            name: r.name,
            url: r.url,
            externalRef: r.external_ref,
            groupName: r.group_name ?? null
          },
          "stale",
          "provider_full_sync_missing_channel_set_inactive",
          "finalize"
        );
        channelInactives += 1;
        EventBus.emit("iptv:channel:inactive", { providerId, channelId: r.id, reason: "provider_full_sync_missing_channel_set_inactive" });
      } else if (r.status === "active") {
        database.prepare("UPDATE channels SET status = 'stale', updated_at = ? WHERE id = ?").run(timestamp, r.id);
        traceChannelSync(
          {
            name: r.name,
            url: r.url,
            externalRef: r.external_ref,
            groupName: r.group_name ?? null
          },
          "stale",
          "provider_partial_sync_missing_channel_set_stale",
          "finalize"
        );
      } else {
        traceChannelSync(
          {
            name: r.name,
            url: r.url,
            externalRef: r.external_ref,
            groupName: r.group_name ?? null
          },
          "skip",
          "provider_partial_sync_existing_non_active_channel_unchanged",
          "finalize"
        );
      }
    }
  }

  const report: IngestionReport = {
    providerId,
    providerMode,
    totalIncoming: channels.length,
    parsed: channels.length,
    inserted: channelInserts,
    updated: channelUpdates,
    rejected: rejections.length,
    duplicates: duplicateDetections.length,
    inactiveMarked: channelInactives,
    timestamp,
    rejections,
    duplicateDetections
  };

  // Store latest ingestion report for parity diagnostics
  latestIngestionReports.set(providerId, report);

  EventBus.emit("iptv:ingestion:completed", report);

  EventBus.emit("iptv:sync:completed", {
    providerId,
    providerMode,
    counts: {
      inserted: channelInserts,
      updated: channelUpdates,
      inactive: channelInactives,
      total: results.length
    }
  });

  return results;
}


function buildChannelFilterClauses(opts?: { providerId?: string; q?: string; category?: string }) {
  const clauses: string[] = [];
  const params: any[] = [];

  if (opts?.providerId) {
    clauses.push("c.provider_id = ?");
    params.push(opts.providerId);
  }

  if (opts?.category) {
    clauses.push("c.group_name = ?");
    params.push(opts.category);
  }

  if (opts?.q) {
    clauses.push("(c.name LIKE ? OR c.external_ref LIKE ? OR c.url LIKE ?)");
    const like = `%${opts.q.replace(/%/g, "\\%")}%`;
    params.push(like, like, like);
  }

  return { clauses, params };
}

type ChannelExcludedReason = "provider_deleted" | "archived" | "inactive" | "stale" | null;
interface ChannelDebugLocal extends Channel {
  excludedReason: ChannelExcludedReason;
}

function mapChannelDebug(row: ChannelRow & { provider_deleted: number }): ChannelDebugLocal {
  const channel = mapChannel(row);
  const excludedReason: ChannelExcludedReason = row.provider_deleted
    ? "provider_deleted"
    : row.status === "archived"
    ? "archived"
    : row.status === "inactive"
    ? "inactive"
    : row.status === "stale"
    ? "stale"
    : null;

  return {
    ...channel,
    excludedReason
  };
}

export function listProviderChannels(mode: "debug", opts?: { providerId?: string; q?: string; category?: string }): ChannelDebugLocal[];
export function listProviderChannels(mode: "active" | "includeInactive" | "raw", opts?: { providerId?: string; q?: string; category?: string }): Channel[];
export function listProviderChannels(mode: "active" | "includeInactive" | "debug" | "raw" = "active", opts?: { providerId?: string; q?: string; category?: string }): Channel[] | ChannelDebugLocal[] {
  const db = getDatabase();
  const { clauses, params } = buildChannelFilterClauses(opts);
  const baseWhere = clauses.length > 0 ? `${clauses.join(" AND ")}` : "1=1";

  if (mode === "debug") {
    const sql = `SELECT c.*, p.deleted AS provider_deleted
      FROM channels c JOIN providers p ON p.id = c.provider_id
      WHERE (${baseWhere})
      ORDER BY c.group_name, c.name`;
    const rows = db.prepare(sql).all(...params) as (ChannelRow & { provider_deleted: number })[];
    return rows.map(mapChannelDebug);
  }

  let statusFilter: string;
  if (mode === "raw") {
    statusFilter = "1=1";
  } else if (mode === "includeInactive") {
    statusFilter = "c.status != 'archived'";
  } else {
    statusFilter = "c.status = 'active'";
  }

  const sql = `SELECT c.* FROM channels c JOIN providers p ON p.id = c.provider_id
    WHERE (${baseWhere}) AND ${statusFilter} AND p.deleted = 0
    ORDER BY c.group_name, c.name`;
  const rows = db.prepare(sql).all(...params) as ChannelRow[];
  return rows.map(mapChannel);
}

export function listChannelsDebug(opts?: { providerId?: string; q?: string; category?: string }): ChannelDebugLocal[] {
  return listProviderChannels("debug", opts);
}

export function listChannels(opts?: { providerId?: string; q?: string; category?: string }): Channel[] {
  return listProviderChannels("active", opts);
}

export function getProviderChannelDiagnostics(providerId: string) {
  const db = getDatabase();

  const provider = db
    .prepare(
      `SELECT id, status, availability_status, health_score, sync_mode, last_successful_stream_load_at
       FROM providers WHERE id = ? AND deleted = 0`
    )
    .get(providerId) as
    | (ProviderRow & { sync_mode?: ProviderSyncMode })
    | undefined;

  if (!provider) return undefined;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS stale,
         SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
       FROM channels WHERE provider_id = ?`
    )
    .get(providerId) as { total: number; active: number; inactive: number; stale: number; archived: number };

  return {
    providerId: provider.id,
    status: provider.status as any,
    availabilityStatus: provider.availability_status,
    healthScore: provider.health_score,
    syncMode: provider.sync_mode ?? undefined,
    lastSuccessfulStreamLoadAt: provider.last_successful_stream_load_at ?? undefined,
    totalChannels: counts.total ?? 0,
    counts: {
      active: counts.active ?? 0,
      inactive: counts.inactive ?? 0,
      stale: counts.stale ?? 0,
      archived: counts.archived ?? 0
    }
  };
}

export function listChannelCategories(providerId?: string): string[] {
  const rows = providerId
    ? (getDatabase()
        .prepare(
          `SELECT DISTINCT c.group_name
           FROM channels c JOIN providers p ON p.id = c.provider_id
           WHERE c.provider_id = ?
             AND c.group_name IS NOT NULL
             AND c.status != 'archived'
             AND p.deleted = 0
           ORDER BY c.group_name`
        )
        .all(providerId) as { group_name: string }[])
    : (getDatabase()
        .prepare(
          `SELECT DISTINCT c.group_name
           FROM channels c JOIN providers p ON p.id = c.provider_id
           WHERE c.group_name IS NOT NULL
             AND c.status != 'archived'
             AND p.deleted = 0
           ORDER BY c.group_name`
        )
        .all() as { group_name: string }[]);

  return rows.map((row) => row.group_name);
}

export function getLatestIngestionReport(providerId: string): IngestionReport | undefined {
  return latestIngestionReports.get(providerId);
}

export interface ParityDiagnostic {
  providerId: string;
  giToChannelCount: {
    active: number;
    includeInactive: number;
    raw: number;
  };
  ingestionReport: IngestionReport | undefined;
  mismatchAnalysis: {
    totalRejected: number;
    totalDuplicates: number;
    totalInactiveMarked: number;
    mismatchReasons: string[];
  };
  recommendations: string[];
}

export function getParityDiagnostics(providerId: string): ParityDiagnostic | undefined {
  const db = getDatabase();
  const provider = db
    .prepare("SELECT id FROM providers WHERE id = ? AND deleted = 0")
    .get(providerId) as { id: string } | undefined;

  if (!provider) {
    return undefined;
  }

  // Get counts for all modes
  const activeCounts = db
    .prepare("SELECT COUNT(*) as count FROM channels WHERE provider_id = ? AND status = 'active'")
    .get(providerId) as { count: number };

  const inactiveCounts = db
    .prepare("SELECT COUNT(*) as count FROM channels WHERE provider_id = ? AND status != 'archived'")
    .get(providerId) as { count: number };

  const rawCounts = db
    .prepare("SELECT COUNT(*) as count FROM channels WHERE provider_id = ?")
    .get(providerId) as { count: number };

  const ingestionReport = getLatestIngestionReport(providerId);

  const mismatchReasons: string[] = [];
  if (ingestionReport) {
    if (ingestionReport.duplicates > 0) {
      mismatchReasons.push(`${ingestionReport.duplicates} duplicates_filtered`);
    }
    if (ingestionReport.rejected > 0) {
      mismatchReasons.push(`${ingestionReport.rejected} url_or_parser_rejected`);
    }
    if (ingestionReport.inactiveMarked > 0) {
      mismatchReasons.push(`${ingestionReport.inactiveMarked} inactive_sync_mode`);
    }
  }

  const recommendations: string[] = [];
  if (ingestionReport) {
    if (ingestionReport.rejected > 0) {
      recommendations.push(`Review ${ingestionReport.rejected} rejected channels in ingestion report`);
    }
    if (ingestionReport.duplicates > 0) {
      recommendations.push(`${ingestionReport.duplicates} duplicate channels were filtered from incoming payload`);
    }
  }

  if (rawCounts.count !== activeCounts.count) {
    recommendations.push("Use ?mode=raw to see all channels including inactive and archived");
  }

  return {
    providerId,
    giToChannelCount: {
      active: activeCounts.count,
      includeInactive: inactiveCounts.count,
      raw: rawCounts.count
    },
    ingestionReport,
    mismatchAnalysis: {
      totalRejected: ingestionReport?.rejected ?? 0,
      totalDuplicates: ingestionReport?.duplicates ?? 0,
      totalInactiveMarked: ingestionReport?.inactiveMarked ?? 0,
      mismatchReasons
    },
    recommendations
  };
}
