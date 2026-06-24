import crypto from "node:crypto";

import { getDatabase } from "../db/connection.js";

export interface MobileAnalyticsEvent {
  id: string;
  eventType: string;
  sessionId?: string | null;
  matchId?: string | null;
  payload?: Record<string, unknown> | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

export interface MobilePromotion {
  id: string;
  title: string;
  description?: string | null;
  actionUrl?: string | null;
  imageUrl?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const defaultMobilePromotions: MobilePromotion[] = [
  {
    id: "promo-support-gito",
    title: "Support GiTO Live Sports",
    description:
      "Share GiTO with friends or help keep live sports free by promoting the app.",
    actionUrl: "https://gito.live/support",
    imageUrl: null,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "promo-premium-upgrade",
    title: "Upgrade to Premium",
    description:
      "Unlock faster match updates, fewer refreshes, and early access to highlights.",
    actionUrl: "https://gito.live/premium",
    imageUrl: null,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function logMobileAnalyticsEvent(input: {
  eventType: string;
  sessionId?: string;
  matchId?: string;
  payload?: Record<string, unknown>;
  userAgent?: string;
  ipAddress?: string;
}) {
  const database = getDatabase();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO mobile_analytics_events (
        id,
        event_type,
        session_id,
        match_id,
        payload,
        user_agent,
        ip_address,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      input.eventType,
      input.sessionId ?? null,
      input.matchId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.userAgent ?? null,
      input.ipAddress ?? null,
      now
    );
}

export function logMobileAdEvent(input: {
  promotionId?: string;
  eventType: string;
  sessionId?: string;
  matchId?: string;
  metadata?: Record<string, unknown>;
}) {
  const database = getDatabase();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO mobile_ad_events (
        id,
        promotion_id,
        event_type,
        session_id,
        match_id,
        metadata,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      input.promotionId ?? null,
      input.eventType,
      input.sessionId ?? null,
      input.matchId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    );
}

export function listMobileAnalyticsEvents(limit = 100) {
  const rows = getDatabase()
    .prepare(
      `SELECT id, event_type, session_id, match_id, payload, user_agent, ip_address, created_at
      FROM mobile_analytics_events
      ORDER BY created_at DESC
      LIMIT ?`
    )
    .all(limit) as Array<{
    id: string;
    event_type: string;
    session_id: string | null;
    match_id: string | null;
    payload: string | null;
    user_agent: string | null;
    ip_address: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    sessionId: row.session_id,
    matchId: row.match_id,
    payload: row.payload ? JSON.parse(row.payload) : null,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  }));
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface MobileAnalyticsSummary {
  activeUsers: number;
  totalViews: number;
  watchTime: number;
  activeUsersOverTime: TimeSeriesPoint[];
  streamsOverTime: TimeSeriesPoint[];
  watchMinutesOverTime: TimeSeriesPoint[];
  viewersPerHour: TimeSeriesPoint[];
  averageWatchDurationOverTime: TimeSeriesPoint[];
  streams: {
    total: number;
    started: number;
    ended: number;
    averageDuration: number;
  };
  ads: {
    impressions: number;
    clicks: number;
    total: number;
    rewards: number;
    impressionsOverTime: TimeSeriesPoint[];
    clicksOverTime: TimeSeriesPoint[];
    estimatedRevenueTrend: TimeSeriesPoint[];
  };
  users: {
    sessions: number;
    newUsers: number;
    returningUsers: number;
  };
  funnel: {
    entering: number;
    playbackRequested: number;
    playbackStarted: number;
    streamsCompleted: number;
    matchToPlaybackRate: number;
    playbackSuccessRate: number;
    averageSessionDuration: number;
  };
  quality: {
    bufferStarts: number;
    bufferEnds: number;
    averageBufferDuration: number;
    streamErrors: number;
    qualityChanges: number;
  };
  matches: {
    topViewed: Array<{ matchId: string; views: number; watchTime: number }>;
    watchTimeByMatch: Array<{ matchId: string; watchTime: number }>;
  };
}

function parseEventPayloadWatchTime(payload: string | null): number {
  if (!payload) {
    return 0;
  }

  try {
    const data = JSON.parse(payload) as Record<string, unknown>;
    const candidates = [
      data.revenue,
      data.amount,
      data.watchTime,
      data.watch_time,
      data.duration,
      data.durationSeconds,
      data.seconds,
    ];

    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  } catch {
    // ignore malformed payloads
  }

  return 0;
}

function formatHourBucket(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) {
    return "unknown";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00`;
}

function mapToSeries(data: Map<string, number>): TimeSeriesPoint[] {
  return Array.from(data.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => (a.label > b.label ? 1 : a.label < b.label ? -1 : 0));
}

export function getMobileAnalyticsSummary(): MobileAnalyticsSummary {
  const database = getDatabase();

  const analyticsRows = database
    .prepare(
      `SELECT event_type, session_id, match_id, payload, created_at FROM mobile_analytics_events`
    )
    .all() as Array<{
    event_type: string;
    session_id: string | null;
    match_id: string | null;
    payload: string | null;
    created_at: string;
  }>;

  const adRows = database
    .prepare(`SELECT event_type, created_at FROM mobile_ad_events`)
    .all() as Array<{ event_type: string; created_at: string }>;

  const activeUserBuckets = new Map<string, Set<string>>();
  const streamBuckets = new Map<string, number>();
  const watchSecondsBuckets = new Map<string, number>();
  const watchEventCounts = new Map<string, number>();
  const viewerBuckets = new Map<string, Set<string>>();
  const enteringSessions = new Set<string>();
  const matchViewSessions = new Set<string>();
  const playbackRequestedSessions = new Set<string>();
  const playbackStartedSessions = new Set<string>();
  const streamCompletedSessions = new Set<string>();
  const sessionDurationSecondsBySession = new Map<string, number>();
  const bufferStartBuckets = new Map<string, number>();
  const bufferEndBuckets = new Map<string, number>();
  const streamErrorBuckets = new Map<string, number>();
  const qualityChangeBuckets = new Map<string, number>();
  const bufferDurations: number[] = [];
  let bufferStarts = 0;
  let bufferEnds = 0;
  let streamErrors = 0;
  let qualityChanges = 0;

  const activeUsers = new Set(
    analyticsRows
      .map((row) => row.session_id)
      .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0)
  ).size;

  const totalViews = analyticsRows.filter((row) =>
    ["match_view", "stream_start", "stream_end", "user_login", "app_open"].includes(row.event_type)
  ).length;

  const watchTime = analyticsRows.reduce(
    (sum, row) => sum + parseEventPayloadWatchTime(row.payload),
    0
  );

  analyticsRows.forEach((row) => {
    const bucket = formatHourBucket(row.created_at);
    const sessionId = typeof row.session_id === "string" ? row.session_id.trim() : "";

    if (sessionId) {
      const activeSet = activeUserBuckets.get(bucket) ?? new Set();
      activeSet.add(sessionId);
      activeUserBuckets.set(bucket, activeSet);

      const viewerSet = viewerBuckets.get(bucket) ?? new Set();
      viewerSet.add(sessionId);
      viewerBuckets.set(bucket, viewerSet);

      if (["app_open", "match_view"].includes(row.event_type)) {
        enteringSessions.add(sessionId);
      }

      if (row.event_type === "match_view") {
        matchViewSessions.add(sessionId);
      }

      if (row.event_type === "playback_requested") {
        playbackRequestedSessions.add(sessionId);
      }

      if (row.event_type === "playback_start") {
        playbackStartedSessions.add(sessionId);
      }

      if (row.event_type === "stream_end") {
        streamCompletedSessions.add(sessionId);
        const durationSeconds = parseEventPayloadWatchTime(row.payload);
        if (durationSeconds > 0) {
          sessionDurationSecondsBySession.set(
            sessionId,
            (sessionDurationSecondsBySession.get(sessionId) ?? 0) + durationSeconds
          );
        }
      }
    }

    if (row.event_type === "stream_start") {
      streamBuckets.set(bucket, (streamBuckets.get(bucket) ?? 0) + 1);
    }

    if (row.event_type === "buffer_start") {
      bufferStarts += 1;
      bufferStartBuckets.set(bucket, (bufferStartBuckets.get(bucket) ?? 0) + 1);
    }

    if (row.event_type === "buffer_end") {
      bufferEnds += 1;
      bufferEndBuckets.set(bucket, (bufferEndBuckets.get(bucket) ?? 0) + 1);
      const duration = parseEventPayloadWatchTime(row.payload);
      if (duration > 0) {
        bufferDurations.push(duration);
      }
    }

    if (row.event_type === "stream_error") {
      streamErrors += 1;
      streamErrorBuckets.set(bucket, (streamErrorBuckets.get(bucket) ?? 0) + 1);
    }

    if (row.event_type === "quality_change") {
      qualityChanges += 1;
      qualityChangeBuckets.set(bucket, (qualityChangeBuckets.get(bucket) ?? 0) + 1);
    }

    const watchSeconds = parseEventPayloadWatchTime(row.payload);
    if (watchSeconds > 0) {
      watchSecondsBuckets.set(bucket, (watchSecondsBuckets.get(bucket) ?? 0) + watchSeconds);
      watchEventCounts.set(bucket, (watchEventCounts.get(bucket) ?? 0) + 1);
    }
  });

  const streams = {
    total: analyticsRows.filter((row) => ["stream_start", "stream_end"].includes(row.event_type)).length,
    started: analyticsRows.filter((row) => row.event_type === "stream_start").length,
    ended: analyticsRows.filter((row) => row.event_type === "stream_end").length,
    averageDuration: 0,
  };

  const adBuckets = new Map<string, { impressions: number; clicks: number; rewards: number }>();

  const ads = {
    impressions: adRows.filter((row) => row.event_type === "ad_impression").length,
    clicks: adRows.filter((row) => row.event_type === "ad_click").length,
    total: adRows.length,
    rewards: adRows.filter((row) => row.event_type === "reward_completed").length,
    impressionsOverTime: [],
    clicksOverTime: [],
    estimatedRevenueTrend: [],
  };

  adRows.forEach((row) => {
    const bucket = formatHourBucket(row.created_at);
    const current = adBuckets.get(bucket) ?? { impressions: 0, clicks: 0, rewards: 0 };

    if (row.event_type === "ad_impression") {
      current.impressions += 1;
    }

    if (row.event_type === "ad_click") {
      current.clicks += 1;
    }

    if (row.event_type === "reward_completed") {
      current.rewards += 1;
    }

    adBuckets.set(bucket, current);
  });

  const sessionIds = new Set(
    analyticsRows
      .map((row) => row.session_id)
      .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0)
  );

  const loginSessionIds = new Set(
    analyticsRows
      .filter((row) => row.event_type === "user_login")
      .map((row) => row.session_id)
      .filter((sessionId): sessionId is string => typeof sessionId === "string" && sessionId.trim().length > 0)
  );

  const users = {
    sessions: sessionIds.size,
    newUsers: loginSessionIds.size,
    returningUsers: Math.max(sessionIds.size - loginSessionIds.size, 0),
  };

  const sessionDurations = Array.from(sessionDurationSecondsBySession.values());
  const averageSessionDuration = sessionDurations.length > 0
    ? Math.round(sessionDurations.reduce((sum, duration) => sum + duration, 0) / sessionDurations.length)
    : 0;

  const matchToPlaybackRate = matchViewSessions.size > 0
    ? Math.round((playbackRequestedSessions.size / matchViewSessions.size) * 100) / 100
    : 0;

  const playbackSuccessRate = playbackRequestedSessions.size > 0
    ? Math.round((playbackStartedSessions.size / playbackRequestedSessions.size) * 100) / 100
    : 0;

  const averageBufferDuration = bufferDurations.length > 0
    ? Math.round(bufferDurations.reduce((sum, duration) => sum + duration, 0) / bufferDurations.length)
    : 0;

  const funnel = {
    entering: enteringSessions.size,
    playbackRequested: playbackRequestedSessions.size,
    playbackStarted: playbackStartedSessions.size,
    streamsCompleted: streamCompletedSessions.size,
    matchToPlaybackRate,
    playbackSuccessRate,
    averageSessionDuration,
  };

  const quality = {
    bufferStarts,
    bufferEnds,
    averageBufferDuration,
    streamErrors,
    qualityChanges,
  };

  const matchStats = analyticsRows.reduce(
    (acc, row) => {
      const matchId = row.match_id?.trim();
      if (!matchId) {
        return acc;
      }

      const current = acc.get(matchId) ?? { views: 0, watchTime: 0 };
      current.views += 1;
      current.watchTime += parseEventPayloadWatchTime(row.payload);
      acc.set(matchId, current);
      return acc;
    },
    new Map<string, { views: number; watchTime: number }>()
  );

  const topViewed = Array.from(matchStats.entries())
    .map(([matchId, stats]) => ({ matchId, views: stats.views, watchTime: stats.watchTime }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  const watchTimeByMatch = Array.from(matchStats.entries())
    .map(([matchId, stats]) => ({ matchId, watchTime: stats.watchTime }))
    .sort((a, b) => b.watchTime - a.watchTime)
    .slice(0, 5);

  const activeUsersOverTime = mapToSeries(
    new Map(Array.from(activeUserBuckets.entries()).map(([label, sessions]) => [label, sessions.size]))
  );
  const streamsOverTime = mapToSeries(streamBuckets);
  const watchMinutesOverTime = mapToSeries(
    new Map(Array.from(watchSecondsBuckets.entries()).map(([label, seconds]) => [label, Math.round(seconds / 60)]))
  );
  const viewersPerHour = mapToSeries(
    new Map(Array.from(viewerBuckets.entries()).map(([label, sessions]) => [label, sessions.size]))
  );
  const averageWatchDurationOverTime = mapToSeries(
    new Map(Array.from(watchSecondsBuckets.entries()).map(([label, seconds]) => [label, Math.round(seconds / (watchEventCounts.get(label) ?? 1))]))
  );

  const impressionsOverTime = mapToSeries(
    new Map(Array.from(adBuckets.entries()).map(([label, stats]) => [label, stats.impressions]))
  );
  const clicksOverTime = mapToSeries(
    new Map(Array.from(adBuckets.entries()).map(([label, stats]) => [label, stats.clicks]))
  );
  const estimatedRevenueTrend = mapToSeries(
    new Map(
      Array.from(adBuckets.entries()).map(([label, stats]) => [
        label,
        Math.round((stats.impressions * 0.015 + stats.clicks * 0.25 + stats.rewards * 0.75) * 100) / 100,
      ])
    )
  );

  const averageDuration = streams.started > 0 ? Math.round(watchTime / streams.started) : 0;

  return {
    activeUsers,
    totalViews,
    watchTime,
    activeUsersOverTime,
    streamsOverTime,
    watchMinutesOverTime,
    viewersPerHour,
    averageWatchDurationOverTime,
    streams: {
      ...streams,
      averageDuration,
    },
    ads: {
      ...ads,
      impressionsOverTime,
      clicksOverTime,
      estimatedRevenueTrend,
    },
    users,
    funnel,
    quality,
    matches: {
      topViewed,
      watchTimeByMatch,
    },
  };
}

export function listActiveMobileAdPromotions() {
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, description, action_url, image_url, status, created_at, updated_at
      FROM mobile_ad_promotions
      WHERE status = 'active'
      ORDER BY created_at DESC`
    )
    .all() as Array<{
    id: string;
    title: string;
    description: string | null;
    action_url: string | null;
    image_url: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  if (rows.length > 0) {
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      actionUrl: row.action_url,
      imageUrl: row.image_url,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  return defaultMobilePromotions;
}
