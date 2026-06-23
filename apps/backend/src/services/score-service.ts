import { env } from "../config/env.js";
import { EventBus } from "../events/event-bus.js";

type CacheEntry<T> = {
  expiresAt: number;
  createdAt: number;
  value: T;
};

 

type FootballDataMatch = Record<string, unknown>;
type FootballDataCompetition = Record<string, unknown>;
type FootballDataTeam = Record<string, unknown>;

export type ScoreSource = "live" | "cache" | "stale_cache" | "scheduled";

export type ScoreListResult = {
  matches: ScoreMatchSummary[];
  source: ScoreSource;
  ageMs?: number;
  cachedAt?: string;
};

export type ScoreMatchResult = {
  match: ScoreMatchSummary;
  source: ScoreSource;
  ageMs?: number;
  cachedAt?: string;
};

export type ScoreEventType =
  | "kickoff_reminder"
  | "match_started"
  | "goal"
  | "halftime"
  | "fulltime";

export type ScoreEventDescriptor = {
  type: ScoreEventType;
  supported: boolean;
  source: "score_snapshot";
};

export type ScoreMatchSummary = {
  id: string;
  utcDate: string | null;
  status: string;
  minute: number | null;
  competition: {
    id: string | null;
    name: string;
    logoUrl: string | null;
  };
  homeTeam: {
    id: string | null;
    name: string;
    logoUrl: string | null;
  };
  awayTeam: {
    id: string | null;
    name: string;
    logoUrl: string | null;
  };
  score: {
    home: number | null;
    away: number | null;
    winner: string | null;
  };
  events: ScoreEventDescriptor[];
};

export type ScoreCompetitionSummary = {
  id: string;
  code: string | null;
  name: string;
  type: string | null;
  logoUrl: string | null;
  currentSeasonStartDate: string | null;
  currentSeasonEndDate: string | null;
};

const liveScoresTtlMs = 20_000;
const scheduledMatchesTtlMs = 120_000;
const matchDetailsTtlMs = 30_000;
const competitionsTtlMs = 6 * 60 * 60 * 1000;
const upcomingMatchesWindowDays = 3;

const cache = new Map<string, CacheEntry<unknown>>();

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateRangePath(dateFrom: string, dateTo: string) {
  return `/matches?status=SCHEDULED&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
}

async function refreshScheduledMatches(cacheKey: string, path: string, attempt = 1): Promise<void> {
  try {
    const payload = await footballDataGet<{ matches?: FootballDataMatch[] }>(path);
    const matches = (payload.matches ?? []).map(normalizeMatch);
    setCached(cacheKey, matches, scheduledMatchesTtlMs);
    // update status
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = matches.length;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "scheduled", count: matches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: matches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitScoreEvent("scores:failed", { cacheKey, attempt, error: message });
    if (attempt < 2) {
      emitScoreEvent("scores:retry", { cacheKey, nextAttempt: attempt + 1 });
      await refreshScheduledMatches(cacheKey, path, attempt + 1);
    }
    throw error;
  }
}

function scheduleBackgroundRefresh(cacheKey: string, refreshFn: () => Promise<void>) {
  if (ScoreService._backgroundRefreshes.has(cacheKey)) {
    return;
  }

  const p = (async () => {
    try {
      await refreshFn();
    } catch (e) {
      console.debug("[score] background refresh failed", e instanceof Error ? e.message : e);
    } finally {
      ScoreService._backgroundRefreshes.delete(cacheKey);
    }
  })();

  ScoreService._backgroundRefreshes.set(cacheKey, p);
}

function buildScheduleCacheKey(dateFrom: string, dateTo: string) {
  return `scores:scheduled:${dateFrom}:${dateTo}`;
}

async function listScheduledMatches(dateFrom: string, dateTo: string): Promise<ScoreListResult> {
  const cacheKey = buildScheduleCacheKey(dateFrom, dateTo);
  const cached = getCacheEntry<ScoreMatchSummary[]>(cacheKey);
  const path = buildDateRangePath(dateFrom, dateTo);

  if (cached) {
    scheduleBackgroundRefresh(cacheKey, () => refreshScheduledMatches(cacheKey, path));
    return {
      matches: cached.value,
      source: "cache",
      ageMs: Date.now() - cached.createdAt,
      cachedAt: new Date(cached.createdAt).toISOString()
    };
  }

  if (!ScoreService._backgroundRefreshes.has(cacheKey)) {
    scheduleBackgroundRefresh(cacheKey, () => refreshScheduledMatches(cacheKey, path));
  }

  const stale = getStaleCacheEntry<ScoreMatchSummary[]>(cacheKey, 120_000);
  if (stale) {
    return {
      matches: stale.value,
      source: "stale_cache",
      ageMs: stale.ageMs,
      cachedAt: stale.cachedAt
    };
  }

  return { matches: [], source: "cache" };
}

function getTodayDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const today = formatDate(now);
  return { dateFrom: today, dateTo: today };
}

function getUpcomingDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const fromDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const toDate = new Date(fromDate.getTime() + (upcomingMatchesWindowDays - 1) * 24 * 60 * 60 * 1000);
  return { dateFrom: formatDate(fromDate), dateTo: formatDate(toDate) };
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);

  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number) {
  const now = Date.now();
  cache.set(key, {
    expiresAt: now + ttlMs,
    createdAt: now,
    value
  });
}

function getCacheEntry<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) {
      cache.delete(key);
    }
    return null;
  }

  return entry;
}

function getStaleCacheEntry<T>(key: string, maxAgeMs: number): { value: T; ageMs: number; cachedAt: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.expiresAt > Date.now()) {
    return null;
  }

  const ageMs = Date.now() - entry.createdAt;
  if (ageMs > maxAgeMs) {
    cache.delete(key);
    return null;
  }

  return {
    value: entry.value,
    ageMs,
    cachedAt: new Date(entry.createdAt).toISOString()
  };
}

function emitScoreEvent(event: "scores:updated" | "scores:cache:refreshed" | "scores:retry" | "scores:failed", payload?: unknown) {
  EventBus.emit(event, payload);
}

const serviceStatus: {
  footballApiEnabled: boolean;
  cacheInitialized: boolean;
  lastFetchTime: string | null;
  lastResponseCount: number;
  cacheKeys: string[];
} = {
  footballApiEnabled: Boolean(env.footballDataApiKey && env.footballDataApiKey.trim()),
  cacheInitialized: false,
  lastFetchTime: null,
  lastResponseCount: 0,
  cacheKeys: []
};

function clearCacheKeys(prefix?: string) {
  for (const key of Array.from(cache.keys())) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
  serviceStatus.cacheKeys = Array.from(cache.keys());
}

async function refreshAllScores(): Promise<{ liveCount: number; todayCount: number; upcomingCount: number }> {
  serviceStatus.cacheInitialized = true;
  const results = { liveCount: 0, todayCount: 0, upcomingCount: 0 } as any;
  try {
    await refreshLiveScores("scores:live");
    const liveEntry = getCacheEntry<ScoreMatchSummary[]>("scores:live");
    results.liveCount = liveEntry?.value.length ?? 0;
  } catch (e) {}

  try {
    const today = getTodayDateRange();
    const todayPath = buildDateRangePath(today.dateFrom, today.dateTo);
    await refreshScheduledMatches(buildScheduleCacheKey(today.dateFrom, today.dateTo), todayPath);
    const todayEntry = getCacheEntry<ScoreMatchSummary[]>(buildScheduleCacheKey(today.dateFrom, today.dateTo));
    results.todayCount = todayEntry?.value.length ?? 0;
  } catch (e) {}

  try {
    const up = getUpcomingDateRange();
    const upPath = buildDateRangePath(up.dateFrom, up.dateTo);
    await refreshScheduledMatches(buildScheduleCacheKey(up.dateFrom, up.dateTo), upPath);
    const upEntry = getCacheEntry<ScoreMatchSummary[]>(buildScheduleCacheKey(up.dateFrom, up.dateTo));
    results.upcomingCount = upEntry?.value.length ?? 0;
  } catch (e) {}

  serviceStatus.cacheKeys = Array.from(cache.keys());
  return results;
}

async function refreshLiveScores(cacheKey: string, attempt = 1): Promise<void> {
  try {
    const payload = await footballDataGet<{ matches?: FootballDataMatch[] }>("/matches?status=LIVE");
    const matches = (payload.matches ?? []).map(normalizeMatch);
    setCached(cacheKey, matches, liveScoresTtlMs);
    // update status
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = matches.length;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "live", count: matches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: matches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitScoreEvent("scores:failed", { cacheKey, attempt, error: message });
    if (attempt < 2) {
      emitScoreEvent("scores:retry", { cacheKey, nextAttempt: attempt + 1 });
      await refreshLiveScores(cacheKey, attempt + 1);
    }
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLogoUrl(value: unknown) {
  const raw = asString(value);
  return raw && /^https?:\/\//.test(raw) ? raw : raw;
}

function extractTeam(team: FootballDataTeam) {
  return {
    id: asNumber(team.id)?.toString() ?? asString(team.id),
    name: asString(team.name) ?? asString(team.shortName) ?? "Team",
    logoUrl: normalizeLogoUrl(team.crest)
  };
}

function notificationDescriptors(): ScoreEventDescriptor[] {
  return [
    { type: "kickoff_reminder", supported: true, source: "score_snapshot" },
    { type: "match_started", supported: true, source: "score_snapshot" },
    { type: "goal", supported: true, source: "score_snapshot" },
    { type: "halftime", supported: true, source: "score_snapshot" },
    { type: "fulltime", supported: true, source: "score_snapshot" }
  ];
}

function inferMinute(match: FootballDataMatch): number | null {
  const directMinute = asNumber(match.minute);
  if (directMinute !== null) {
    return directMinute;
  }

  const status = asString(match.status);
  const utcDate = asString(match.utcDate);

  if (!utcDate || status !== "IN_PLAY" && status !== "PAUSED") {
    return null;
  }

  const elapsed = Math.floor((Date.now() - Date.parse(utcDate)) / 60_000);
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }

  return Math.min(elapsed, status === "PAUSED" ? 45 : 120);
}

function normalizeMatch(match: FootballDataMatch): ScoreMatchSummary {
  const competition = asRecord(match.competition);
  const homeTeam = asRecord(match.homeTeam);
  const awayTeam = asRecord(match.awayTeam);
  const score = asRecord(match.score);
  const fullTime = asRecord(score.fullTime);
  const regularTime = asRecord(score.regularTime);

  return {
    id: (asNumber(match.id)?.toString() ?? asString(match.id) ?? "match"),
    utcDate: asString(match.utcDate),
    status: asString(match.status) ?? "UNKNOWN",
    minute: inferMinute(match),
    competition: {
      id: asNumber(competition.id)?.toString() ?? asString(competition.id),
      name: asString(competition.name) ?? "Competition",
      logoUrl: normalizeLogoUrl(competition.emblem)
    },
    homeTeam: extractTeam(homeTeam),
    awayTeam: extractTeam(awayTeam),
    score: {
      home: asNumber(fullTime.home) ?? asNumber(regularTime.home),
      away: asNumber(fullTime.away) ?? asNumber(regularTime.away),
      winner: asString(score.winner)
    },
    events: notificationDescriptors()
  };
}

function normalizeCompetition(competition: FootballDataCompetition): ScoreCompetitionSummary {
  const currentSeason = asRecord(competition.currentSeason);

  return {
    id: (asNumber(competition.id)?.toString() ?? asString(competition.id) ?? "competition"),
    code: asString(competition.code),
    name: asString(competition.name) ?? "Competition",
    type: asString(competition.type),
    logoUrl: normalizeLogoUrl(competition.emblem),
    currentSeasonStartDate: asString(currentSeason.startDate),
    currentSeasonEndDate: asString(currentSeason.endDate)
  };
}

async function footballDataGet<T>(path: string): Promise<T> {
  if (!env.footballDataApiKey) {
    throw Object.assign(new Error("FOOTBALL_DATA_API_KEY is not configured."), {
      statusCode: 503,
      code: "football_data_api_key_missing"
    });
  }

  const baseUrl = env.footballDataBaseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        "X-Auth-Token": env.footballDataApiKey,
        accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw Object.assign(new Error(`Football-Data.org request failed with ${response.status}.`), {
        statusCode: response.status >= 500 ? 502 : response.status,
        code: "football_data_request_failed"
      });
    }

    return response.json() as Promise<T>;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if ((err as any).name === "AbortError") {
      throw Object.assign(new Error("Football-Data.org request timed out."), {
        statusCode: 504,
        code: "football_data_request_timeout"
      });
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const ScoreService = {
  // Track in-flight background refreshes to avoid duplicate work
  _backgroundRefreshes: new Map<string, Promise<void>>(),

  getStatus() {
    return {
      footballApiEnabled: serviceStatus.footballApiEnabled,
      cacheInitialized: serviceStatus.cacheInitialized,
      lastFetchTime: serviceStatus.lastFetchTime,
      lastResponseCount: serviceStatus.lastResponseCount,
      cacheKeys: serviceStatus.cacheKeys.length
    };
  },

  clearCache(prefix?: string) {
    clearCacheKeys(prefix);
  },

  refreshAll() {
    return refreshAllScores();
  },

  async listLiveScores(): Promise<ScoreListResult> {
    const cacheKey = "scores:live";
    const cached = getCacheEntry<ScoreMatchSummary[]>(cacheKey);

    // If we have cached data, return immediately and trigger a background refresh
    if (cached) {
      // Trigger background refresh if not already running
      if (!this._backgroundRefreshes.has(cacheKey)) {
        const p = (async () => {
          try {
            await refreshLiveScores(cacheKey);
          } catch (e) {
            console.debug("[score] background refresh failed", e instanceof Error ? e.message : e);
          } finally {
            this._backgroundRefreshes.delete(cacheKey);
          }
        })();

        this._backgroundRefreshes.set(cacheKey, p);
      }

      return {
        matches: cached.value,
        source: "cache",
        ageMs: Date.now() - cached.createdAt,
        cachedAt: new Date(cached.createdAt).toISOString()
      };
    }

    // No cache: kick off a background refresh but don't block the request. Try to return stale cache if available.
    if (!this._backgroundRefreshes.has(cacheKey)) {
      const p = (async () => {
        try {
          await refreshLiveScores(cacheKey);
        } catch (e) {
          console.debug("[score] background initial fetch failed", e instanceof Error ? e.message : e);
        } finally {
          this._backgroundRefreshes.delete(cacheKey);
        }
      })();

      this._backgroundRefreshes.set(cacheKey, p);
    }

    const stale = getStaleCacheEntry<ScoreMatchSummary[]>(cacheKey, 120_000);
    if (stale) {
      return {
        matches: stale.value,
        source: "stale_cache",
        ageMs: stale.ageMs,
        cachedAt: stale.cachedAt
      };
    }

    // No live cache at all: attempt an immediate today scheduled fetch fallback.
    try {
      const today = getTodayDateRange();
      const todayCacheKey = buildScheduleCacheKey(today.dateFrom, today.dateTo);
      const todayPath = buildDateRangePath(today.dateFrom, today.dateTo);
      await refreshScheduledMatches(todayCacheKey, todayPath);
      const scheduled = getCacheEntry<ScoreMatchSummary[]>(todayCacheKey);
      if (scheduled) {
        return {
          matches: scheduled.value,
          source: "scheduled",
          ageMs: Date.now() - scheduled.createdAt,
          cachedAt: new Date(scheduled.createdAt).toISOString()
        };
      }
    } catch (e) {
      // ignore and fallthrough to empty
    }

    return { matches: [], source: "cache" };
  },

  async getMatch(matchId: string): Promise<ScoreMatchResult | null> {
    const cacheKey = `scores:match:${matchId}`;
    const cached = getCacheEntry<ScoreMatchSummary>(cacheKey);
    if (cached) {
      // trigger background refresh
      if (!this._backgroundRefreshes.has(cacheKey)) {
        const p = (async () => {
          try {
            const payload = await footballDataGet<{ match?: FootballDataMatch }>(`/matches/${encodeURIComponent(matchId)}`);
            if (payload.match) {
              const match = normalizeMatch(payload.match);
              setCached(cacheKey, match, matchDetailsTtlMs);
            }
          } catch (e) {
            console.debug("[score] background match refresh failed", e instanceof Error ? e.message : e);
          } finally {
            this._backgroundRefreshes.delete(cacheKey);
          }
        })();

        this._backgroundRefreshes.set(cacheKey, p);
      }

      return {
        match: cached.value,
        source: "cache",
        ageMs: Date.now() - cached.createdAt,
        cachedAt: new Date(cached.createdAt).toISOString()
      };
    }

    // No cache: schedule background fetch and return null quickly so UI can show fallback
    if (!this._backgroundRefreshes.has(cacheKey)) {
      const p = (async () => {
        try {
          const payload = await footballDataGet<{ match?: FootballDataMatch }>(`/matches/${encodeURIComponent(matchId)}`);
          if (payload.match) {
            const match = normalizeMatch(payload.match);
            setCached(cacheKey, match, matchDetailsTtlMs);
          }
        } catch (e) {
          console.debug("[score] background initial match fetch failed", e instanceof Error ? e.message : e);
        } finally {
          this._backgroundRefreshes.delete(cacheKey);
        }
      })();

      this._backgroundRefreshes.set(cacheKey, p);
    }

    const stale = getStaleCacheEntry<ScoreMatchSummary>(cacheKey, 120_000);
    if (stale) {
      return {
        match: stale.value,
        source: "stale_cache",
        ageMs: stale.ageMs,
        cachedAt: stale.cachedAt
      };
    }

    return null;
  },

  async listTodayMatches(): Promise<ScoreListResult> {
    const { dateFrom, dateTo } = getTodayDateRange();
    return listScheduledMatches(dateFrom, dateTo);
  },

  async listUpcomingMatches(): Promise<ScoreListResult> {
    const { dateFrom, dateTo } = getUpcomingDateRange();
    return listScheduledMatches(dateFrom, dateTo);
  },

  async listCompetitions(): Promise<ScoreCompetitionSummary[]> {
    const cached = getCached<ScoreCompetitionSummary[]>("scores:competitions");
    if (cached) {
      return cached;
    }

    const payload = await footballDataGet<{ competitions?: FootballDataCompetition[] }>("/competitions");
    const competitions = (payload.competitions ?? []).map(normalizeCompetition);
    setCached("scores:competitions", competitions, competitionsTtlMs);
    return competitions;
  }
};
