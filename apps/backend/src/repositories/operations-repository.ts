import crypto from "node:crypto";

import type {
  Channel,
  Match,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  PublishedLiveMatch,
  Stream
} from "@gito/shared";
import { createSlug } from "@gito/shared";

import { getDatabase } from "../db/connection";
import { logOperationalEvent, shouldLogOperationalEvent } from "./operational-log-repository";
import { updateProviderHealth } from "./provider-repository";
import { validateHttpStreamUrl } from "../services/url-validation";
import { assertMatchTransition, assertStreamTransition, WorkflowStateError } from "../services/workflow-state";
import { EventBus } from "../events/event-bus";

function now() {
  return new Date().toISOString();
}

function createUniqueSlug(database: ReturnType<typeof getDatabase>, baseSlug: string): string {
  let slug = baseSlug || "item";
  let suffix = 1;
  let existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ?").get(slug);

  while (existing) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
    existing = database.prepare("SELECT 1 FROM competitions WHERE slug = ?").get(slug);
  }

  return slug;
}

function ensureSport(name: string): string {
  const database = getDatabase();
  const slug = createSlug(name);
  const existing = database.prepare("SELECT id FROM sports WHERE slug = ?").get(slug) as
    | { id: string }
    | undefined;

  if (existing) {
    return existing.id;
  }

  const id = crypto.randomUUID();
  const timestamp = now();
  database
    .prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
    .run(id, name, slug, timestamp, timestamp);

  return id;
}

function ensureCompetition(sportId: string, name: string): string {
  const database = getDatabase();
  const baseSlug = createSlug(name);
  let slug = baseSlug;
  const existing = database.prepare("SELECT id, name FROM competitions WHERE slug = ?").get(slug) as
    | { id: string; name: string }
    | undefined;

  if (existing && existing.name === name) {
    return existing.id;
  }

  if (existing) {
    slug = createUniqueSlug(database, baseSlug);
  }

  const id = crypto.randomUUID();
  const timestamp = now();
  database
    .prepare(
      `INSERT INTO competitions (
        id, sport_id, name, slug, scope, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'custom', 'active', ?, ?)`
    )
    .run(id, sportId, name, slug, timestamp, timestamp);

  return id;
}

function ensureTeam(sportId: string, name: string): string {
  const database = getDatabase();
  const existing = database.prepare("SELECT id FROM teams WHERE sport_id = ? AND name = ?").get(sportId, name) as
    | { id: string }
    | undefined;

  if (existing) {
    return existing.id;
  }

  const id = crypto.randomUUID();
  const timestamp = now();
  database
    .prepare(
      `INSERT INTO teams (
        id, sport_id, name, type, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'club', 'active', ?, ?)`
    )
    .run(id, sportId, name, timestamp, timestamp);

  return id;
}

function mapMatch(row: Record<string, string>): Match {
  return {
    id: row.id as string,
    competitionId: row.competition_id as string,
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
    startsAt: row.starts_at as string,
    status: row.status as Match["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ...(row.season_id ? { seasonId: row.season_id } : {}),
    ...(row.venue_name ? { venueName: row.venue_name } : {})
  };
}

function mapStream(row: Record<string, string | null>): Stream {
  const status = ((row.status as Stream["status"] | null) ?? row.approval_status) as Stream["status"];

  return {
    id: row.id as string,
    matchId: row.match_id as string,
    channelId: row.channel_id as string,
    protocol: (row.protocol as Stream["protocol"]) ?? "hls",
    status,
    approvalStatus: status,
    healthStatus: ((row.health_status as Stream["healthStatus"] | null) ?? "unknown") as Stream["healthStatus"],
    failureCount: Number(row.failure_count ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ...(row.health_reason ? { healthReason: row.health_reason } : {}),
    ...(row.last_health_at ? { lastHealthAt: row.last_health_at } : {}),
    ...(row.approved_by_user_id ? { approvedByUserId: row.approved_by_user_id } : {}),
    ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {})
  };
}

function mapChannel(row: Record<string, string | null>): Channel {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    name: row.name as string,
    url: row.url as string,
    status: row.status as Channel["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    ...(row.group_name ? { groupName: row.group_name } : {})
  };
}

export function assignChannelToMatch(input: MatchAssignmentRequest): MatchAssignmentResult {
  const database = getDatabase();
  const channelExists = database
    .prepare(
      `SELECT c.id, c.url
      FROM channels c
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE c.id = ? AND c.status != 'archived' AND (p.deleted IS NULL OR p.deleted = 0)`
    )
    .get(input.channelId) as { id: string; url: string } | undefined;

  if (!channelExists) {
    throw new WorkflowStateError(
      "A stream assignment requires an existing channel.",
      "channel_required"
    );
  }

  const streamUrlError = validateHttpStreamUrl(channelExists.url);

  if (streamUrlError) {
    throw new WorkflowStateError(
      "Stream assignment requires a valid HTTP or HTTPS stream URL.",
      streamUrlError,
      400
    );
  }

  const sportId = ensureSport(input.sportName);
  const competitionId = ensureCompetition(sportId, input.competitionName);
  const homeTeamId = ensureTeam(sportId, input.homeTeamName);
  const awayTeamId = ensureTeam(sportId, input.awayTeamName);
  const matchId = crypto.randomUUID();
  const streamId = crypto.randomUUID();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO matches (
        id, competition_id, home_team_id, away_team_id, starts_at, venue_name,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?, ?)`
    )
    .run(
      matchId,
      competitionId,
      homeTeamId,
      awayTeamId,
      input.startsAt,
      input.venueName ?? null,
      timestamp,
      timestamp
    );

  database
    .prepare(
      `INSERT INTO streams (
        id, match_id, channel_id, protocol, status, approval_status, created_at, updated_at
      ) VALUES (?, ?, ?, 'hls', 'assigned', 'assigned', ?, ?)`
    )
    .run(streamId, matchId, input.channelId, timestamp, timestamp);

  logOperationalEvent({
    eventType: "stream_assigned",
    entityType: "stream",
    entityId: streamId,
    message: "Stream assigned to match.",
    metadata: { matchId, channelId: input.channelId }
  });

  const match = database.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as Record<string, string>;
  const stream = database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>;
  const channel = database.prepare("SELECT * FROM channels WHERE id = ?").get(input.channelId) as Record<string, string | null>;

  return {
    match: mapMatch(match),
    stream: mapStream(stream),
    channel: mapChannel(channel)
  };
}

export function approveStream(streamId: string, operatorId: string): Stream | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT s.status AS stream_status, m.status AS match_status, m.id AS match_id
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      LEFT JOIN channels c ON c.id = s.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE s.id = ?`
    )
    .get(streamId) as
    | { stream_status: Stream["status"]; match_status: Match["status"]; match_id: string }
    | undefined;

  if (!row) {
    return null;
  }

  assertStreamTransition(row.stream_status, "approved");
  assertMatchTransition(row.match_status, "approved");

  const timestamp = now();
  const result = database
    .prepare(
      `UPDATE streams
      SET status = 'approved', approval_status = 'approved', approved_by_user_id = ?, approved_at = ?, updated_at = ?
      WHERE id = ?`
    )
    .run(operatorId, timestamp, timestamp, streamId);

  if (result.changes === 0) {
    return null;
  }

  database.prepare("UPDATE matches SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, row.match_id);

  logOperationalEvent({
    eventType: "stream_approved",
    entityType: "stream",
    entityId: streamId,
    message: "Stream approved by operator.",
    metadata: { matchId: row.match_id, operatorId }
  });

  return mapStream(database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>);
}

export function publishStream(streamId: string): Stream | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT s.status AS stream_status, s.health_status, m.status AS match_status, m.id AS match_id, c.url
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      LEFT JOIN channels c ON c.id = s.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE s.id = ?`
    )
    .get(streamId) as
    | { stream_status: Stream["status"]; health_status: Stream["healthStatus"]; match_status: Match["status"]; match_id: string; url: string }
    | undefined;

  if (!row) {
    return null;
  }

  assertStreamTransition(row.stream_status, "active");
  assertMatchTransition(row.match_status, "published");

  const streamUrlError = validateHttpStreamUrl(row.url);

  if (streamUrlError) {
    throw new WorkflowStateError(
      "Publishing requires a valid HTTP or HTTPS stream URL.",
      streamUrlError,
      400
    );
  }

  if (row.health_status === "failed") {
    throw new WorkflowStateError(
      "Publishing is blocked because stream health is failed.",
      "stream_health_failed"
    );
  }

  const timestamp = now();
  const result = database
    .prepare(
      `UPDATE streams
      SET status = 'active', approval_status = 'active', published_at = ?, updated_at = ?
      WHERE id = ? AND status = 'approved'`
    )
    .run(timestamp, timestamp, streamId);

  if (result.changes === 0) {
    return null;
  }

  database.prepare("UPDATE matches SET status = 'published', updated_at = ? WHERE id = ?").run(timestamp, row.match_id);

  logOperationalEvent({
    eventType: "stream_published",
    entityType: "stream",
    entityId: streamId,
    message: "Stream published to live feed.",
    metadata: { matchId: row.match_id }
  });

  return mapStream(database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>);
}

export function reassignStream(streamId: string, channelId: string): Stream | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT s.match_id, s.status AS stream_status, m.status AS match_status
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      WHERE s.id = ?`
    )
    .get(streamId) as
    | { match_id: string; stream_status: Stream["status"]; match_status: Match["status"] }
    | undefined;

  if (!row) {
    return null;
  }

  if (row.stream_status === "disabled") {
    throw new WorkflowStateError("Cannot reassign a disabled stream.", "stream_disabled", 400);
  }

  const channel = database
    .prepare(
      `SELECT c.id, c.url
      FROM channels c
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE c.id = ? AND c.status != 'archived' AND (p.deleted IS NULL OR p.deleted = 0)`
    )
    .get(channelId) as
    | { id: string; url: string }
    | undefined;

  if (!channel) {
    throw new WorkflowStateError(
      "A reassign target must be an existing channel.",
      "channel_required",
      400
    );
  }

  const streamUrlError = validateHttpStreamUrl(channel.url);

  if (streamUrlError) {
    throw new WorkflowStateError(
      "Reassigning stream requires a valid HTTP or HTTPS stream URL.",
      streamUrlError,
      400
    );
  }

  const timestamp = now();
  database
    .prepare(
      `UPDATE streams
      SET channel_id = ?, status = 'assigned', approval_status = 'assigned', health_status = 'unknown', failure_count = 0,
          approved_by_user_id = NULL, approved_at = NULL, rejection_reason = NULL, published_at = NULL, updated_at = ?
      WHERE id = ?`
    )
    .run(channelId, timestamp, streamId);

  if (row.match_status !== "assigned") {
    database.prepare("UPDATE matches SET status = 'assigned', updated_at = ? WHERE id = ?").run(timestamp, row.match_id);
  }

  logOperationalEvent({
    eventType: "stream_reassigned",
    entityType: "stream",
    entityId: streamId,
    message: "Stream reassigned to a different active channel.",
    metadata: { matchId: row.match_id, channelId }
  });

  return mapStream(database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>);
}

export function deleteStream(streamId: string): boolean {
  const database = getDatabase();
  const row = database
    .prepare("SELECT match_id FROM streams WHERE id = ?")
    .get(streamId) as { match_id: string } | undefined;

  if (!row) {
    return false;
  }

  database.prepare("DELETE FROM streams WHERE id = ?").run(streamId);

  logOperationalEvent({
    eventType: "stream_deleted",
    entityType: "stream",
    entityId: streamId,
    message: "Stream removed from live feed and database.",
    metadata: { matchId: row.match_id }
  });

  return true;
}

export function publishApprovedStreamForMatch(matchId: string): Stream | null {
  const row = getDatabase()
    .prepare("SELECT id FROM streams WHERE match_id = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1")
    .get(matchId) as { id: string } | undefined;

  if (!row) {
    return null;
  }

  return publishStream(row.id);
}

export function listPublishedLiveMatches(): PublishedLiveMatch[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
        m.id AS match_id, m.competition_id, m.season_id, m.home_team_id, m.away_team_id,
        m.starts_at, m.venue_name, m.status AS match_status, m.created_at AS match_created_at,
        m.updated_at AS match_updated_at,
        h.name AS home_team_name, h.logo_url AS home_team_logo_url,
        a.name AS away_team_name, a.logo_url AS away_team_logo_url,
        comp.name AS competition_name, comp.logo_url AS competition_logo_url,
        comp.sport_id AS competition_sport_id, comp.country_id AS competition_country_id,
        sp.name AS sport_name, sp.logo_url AS sport_logo_url,
        cnt.name AS country_name, cnt.flag_url AS country_flag_url,
        s.id AS stream_id, s.channel_id, s.protocol, s.status AS stream_status, s.health_status,
        s.health_reason, s.failure_count, s.last_health_at, s.approval_status, s.approved_by_user_id,
        s.approved_at, s.rejection_reason, s.published_at, s.created_at AS stream_created_at,
        s.updated_at AS stream_updated_at,
        c.id AS channel_id, c.provider_id, c.name AS channel_name, c.external_ref, c.group_name,
        c.url, c.status AS channel_status, c.created_at AS channel_created_at, c.updated_at AS channel_updated_at,
        p.id AS provider_id, p.name AS provider_name, p.type AS provider_type, p.status AS provider_status,
        p.availability_status AS provider_availability_status, p.health_score AS provider_health_score
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
      LEFT JOIN competitions comp ON comp.id = m.competition_id
      LEFT JOIN sports sp ON sp.id = comp.sport_id
      LEFT JOIN countries cnt ON cnt.id = comp.country_id
      LEFT JOIN channels c ON c.id = s.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE s.status = 'active' AND s.published_at IS NOT NULL AND m.status = 'published'
      ORDER BY m.starts_at`
    )
    .all() as Record<string, string | null>[];

  return rows.map((row) => ({
    match: {
      id: row.match_id as string,
      competitionId: row.competition_id as string,
      homeTeamId: row.home_team_id as string,
      awayTeamId: row.away_team_id as string,
      startsAt: row.starts_at as string,
      status: row.match_status as Match["status"],
      createdAt: row.match_created_at as string,
      updatedAt: row.match_updated_at as string,
      ...(row.season_id ? { seasonId: row.season_id } : {}),
      ...(row.venue_name ? { venueName: row.venue_name } : {})
    },
    stream: {
      id: row.stream_id as string,
      matchId: row.match_id as string,
      channelId: row.channel_id as string,
      protocol: row.protocol as Stream["protocol"],
      status: row.stream_status as Stream["status"],
      approvalStatus: row.stream_status as Stream["approvalStatus"],
      healthStatus: row.health_status as Stream["healthStatus"],
      failureCount: Number(row.failure_count ?? 0),
      createdAt: row.stream_created_at as string,
      updatedAt: row.stream_updated_at as string,
      ...(row.health_reason ? { healthReason: row.health_reason } : {}),
      ...(row.last_health_at ? { lastHealthAt: row.last_health_at } : {}),
      ...(row.approved_by_user_id ? { approvedByUserId: row.approved_by_user_id } : {}),
      ...(row.approved_at ? { approvedAt: row.approved_at } : {}),
      ...(row.published_at ? { publishedAt: row.published_at } : {})
    },
    channel: {
      id: row.channel_id as string,
      providerId: row.provider_id as string,
      name: (row.channel_name as string | null) ?? "Missing channel",
      url: (row.url as string | null) ?? "",
      status: row.channel_status as Channel["status"],
      createdAt: (row.channel_created_at as string | null) ?? row.stream_created_at as string,
      updatedAt: (row.channel_updated_at as string | null) ?? row.stream_updated_at as string,
      ...(row.external_ref ? { externalRef: row.external_ref } : {}),
      ...(row.group_name ? { groupName: row.group_name } : {})
    },
    provider: {
      id: row.provider_id as string,
      name: (row.provider_name as string | null) ?? "Missing provider",
      type: (row.provider_type as PublishedLiveMatch["provider"]["type"] | null) ?? "manual",
      status: (row.provider_status as PublishedLiveMatch["provider"]["status"] | null) ?? "invalid",
      availabilityStatus: (row.provider_availability_status as PublishedLiveMatch["provider"]["availabilityStatus"] | null) ?? "unknown",
      healthScore: Number(row.provider_health_score ?? 100)
    },
    ...(row.home_team_name ? { homeTeamName: row.home_team_name } : {}),
    ...(row.away_team_name ? { awayTeamName: row.away_team_name } : {}),
    ...(row.competition_name ? { competitionName: row.competition_name } : {}),
    ...(row.home_team_logo_url ? { homeTeamLogoUrl: row.home_team_logo_url } : {}),
    ...(row.away_team_logo_url ? { awayTeamLogoUrl: row.away_team_logo_url } : {}),
    ...(row.competition_logo_url ? { competitionLogoUrl: row.competition_logo_url } : {}),
    ...(row.competition_sport_id ? { sportId: row.competition_sport_id } : {}),
    ...(row.competition_country_id ? { countryId: row.competition_country_id } : {}),
    ...(row.sport_name ? { sportName: row.sport_name } : {}),
    ...(row.sport_logo_url ? { sportLogoUrl: row.sport_logo_url } : {}),
    ...(row.country_name ? { countryName: row.country_name } : {}),
    ...(row.country_flag_url ? { countryLogoUrl: row.country_flag_url } : {}),
    playbackUrl: (row.url as string | null) ?? ""
  }));
}

export function reportStreamHealth(streamId: string, input: { status: Stream["healthStatus"]; reason?: string }): Stream | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT s.id, s.status AS stream_status, s.health_status, s.health_reason, s.last_health_at,
        s.failure_count, s.match_id, c.provider_id
      FROM streams s
      JOIN channels c ON c.id = s.channel_id
      WHERE s.id = ?`
    )
    .get(streamId) as
    | {
        id: string;
        stream_status: Stream["status"];
        health_status: Stream["healthStatus"];
        health_reason: string | null;
        last_health_at: string | null;
        failure_count: number;
        match_id: string;
        provider_id: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const timestamp = now();
  const isFailure = input.status === "failed";
  const lastHealthAt = row.last_health_at ? Date.parse(row.last_health_at) : 0;
  const repeatedNonCritical =
    !isFailure &&
    row.health_status === input.status &&
    Number.isFinite(lastHealthAt) &&
    Date.now() - lastHealthAt < 10_000;

  if (repeatedNonCritical) {
    return mapStream(database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>);
  }

  const failureCount = isFailure ? row.failure_count + 1 : row.failure_count;

  database.exec("BEGIN IMMEDIATE;");

  try {
    database
      .prepare(
        `UPDATE streams
        SET health_status = ?, health_reason = ?, failure_count = ?, last_health_at = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(input.status, input.reason ?? null, failureCount, timestamp, timestamp, streamId);

    updateProviderHealth({
      providerId: row.provider_id,
      success: input.status === "active",
      impact: input.status === "active" ? "success" : input.status === "degraded" ? "degraded" : "failure",
      ...(input.reason ? { failureReason: input.reason } : {})
    });

    if (isFailure) {
      database
        .prepare(
          `UPDATE streams
          SET status = 'failed', approval_status = 'failed', updated_at = ?
          WHERE id = ? AND status = 'active'`
        )
        .run(timestamp, streamId);
      database
        .prepare(
          `UPDATE matches
          SET status = 'cancelled', updated_at = ?
          WHERE id = ? AND status = 'published'`
        )
        .run(timestamp, row.match_id);
    }

    if (isFailure) {
      EventBus.emit("stream:failed", {
        streamId,
        matchId: row.match_id,
        providerId: row.provider_id,
        reason: input.reason ?? "stream_failure"
      });
    }

    if (!isFailure && row.health_status !== "active") {
      EventBus.emit("stream:recovered", {
        streamId,
        matchId: row.match_id,
        providerId: row.provider_id,
        reason: input.reason ?? "stream_recovered"
      });
    }

    if (row.health_status === "failed" && input.status === "active") {
      EventBus.emit("stream:reconnected", {
        streamId,
        matchId: row.match_id,
        providerId: row.provider_id
      });
    }

    if (
      isFailure ||
      row.health_status !== input.status ||
      shouldLogOperationalEvent({
        eventType: "stream_health_updated",
        entityId: streamId,
        minimumIntervalSeconds: 60
      })
    ) {
      logOperationalEvent({
        eventType: isFailure ? "stream_failure_detected" : "stream_health_updated",
        entityType: "stream",
        entityId: streamId,
        severity: isFailure ? "error" : input.status === "degraded" ? "warning" : "info",
        message: input.reason ?? `Stream health changed to ${input.status}.`,
        metadata: { healthStatus: input.status, matchId: row.match_id, providerId: row.provider_id }
      });
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  return mapStream(database.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<string, string | null>);
}
