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
const upcomingMatchesWindowDays = 7;

const cache = new Map<string, CacheEntry<unknown>>();

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateRangePath(dateFrom: string, dateTo: string) {
  return `/matches?status=SCHEDULED&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
}

function buildMatchListPath(dateFrom: string, dateTo: string) {
  return `/matches?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
}

function validateDateString(value: string, name: string) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is required and must be a YYYY-MM-DD string.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be formatted as YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) {
    throw new Error(`${name} is not a valid UTC date.`);
  }
}

function validateDateRange(dateFrom: string, dateTo: string) {
  validateDateString(dateFrom, "dateFrom");
  validateDateString(dateTo, "dateTo");
  if (dateFrom > dateTo) {
    throw new Error("dateFrom must be before or equal to dateTo.");
  }
}

function isLiveStatus(status: string | null): boolean {
  return status !== null && ["LIVE", "IN_PLAY", "PAUSED", "SUSPENDED"].includes(status);
}

function isUtcDateOnDay(utcDate: string | null, date: string): boolean {
  if (!utcDate) return false;
  const parsed = new Date(utcDate);
  return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === date;
}

function isUtcDateAfterDay(utcDate: string | null, date: string): boolean {
  if (!utcDate) return false;
  const parsed = new Date(utcDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatDate(parsed) > date;
}

function buildTodayCacheKey(date: string) {
  return `scores:today:${date}`;
}

function buildUpcomingCacheKey(dateFrom: string, dateTo: string) {
  return `scores:upcoming:${dateFrom}:${dateTo}`;
}

type FetchMatchesResult = {
  matches: FootballDataMatch[];
  success: boolean;
};

async function fetchMatchesForRange(dateFrom: string, dateTo: string): Promise<FetchMatchesResult> {
  try {
    validateDateRange(dateFrom, dateTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serviceStatus.lastApiRequestAt = new Date().toISOString();
    serviceStatus.lastApiResponseStatus = 400;
    serviceStatus.lastErrorMessage = message;
    console.error('[football] invalid date range:', message);
    return { matches: [], success: false };
  }

  const path = buildMatchListPath(dateFrom, dateTo);
  const baseUrl = env.footballDataBaseUrl.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;

  console.log("FOOTBALL FETCH START");
  console.log("FOOTBALL REQUEST URL:", url);
  console.log("FOOTBALL DATE RANGE:", dateFrom, "->", dateTo);
  serviceStatus.lastApiRequestAt = new Date().toISOString();
  serviceStatus.lastApiResponseStatus = null;
  serviceStatus.lastErrorMessage = null;
  serviceStatus.lastCompetitionQueried = null;

  try {
    const payload = await footballDataGet<{ matches?: FootballDataMatch[] }>(path);
    const rawMatches = payload.matches ?? [];
    console.log("MATCH COUNT RAW:", rawMatches.length);
    if (rawMatches.length === 0) {
      console.log("MATCH COUNT RAW: 0, sample:", JSON.stringify(rawMatches.slice(0, 3)));
    }
    return { matches: rawMatches, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] fetchMatchesForRange failed:', message);
    serviceStatus.lastErrorMessage = message;
    if (serviceStatus.lastApiResponseStatus === null) {
      serviceStatus.lastApiResponseStatus = 502;
    }
    return { matches: [], success: false };
  }
}

async function refreshScheduledMatches(cacheKey: string, dateFrom: string, dateTo: string, attempt = 1): Promise<void> {
  try {
    const fetchResult = await fetchMatchesForRange(dateFrom, dateTo);
    if (!fetchResult.success) {
      throw new Error("Failed to fetch scheduled matches.");
    }
    const matches = fetchResult.matches.map(normalizeMatch);
    setCached(cacheKey, matches, scheduledMatchesTtlMs);
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = matches.length;
    serviceStatus.lastMatchesReceived = fetchResult.matches.length;
    serviceStatus.lastCompetitionQueried = matches[0]?.competition?.name ?? null;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "scheduled", count: matches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: matches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] scheduled refresh failed:', message);
    serviceStatus.lastErrorMessage = message;
    emitScoreEvent("scores:failed", { cacheKey, attempt, error: message });
    if (attempt < 2) {
      emitScoreEvent("scores:retry", { cacheKey, nextAttempt: attempt + 1 });
      await refreshScheduledMatches(cacheKey, dateFrom, dateTo, attempt + 1);
    }
    throw error;
  }
}

async function refreshTodayMatches(cacheKey: string, dateFrom: string, dateTo: string, attempt = 1): Promise<void> {
  try {
    const fetchResult = await fetchMatchesForRange(dateFrom, dateTo);
    if (!fetchResult.success) {
      throw new Error("Failed to fetch today matches.");
    }
    const matches = fetchResult.matches.map(normalizeMatch);
    setCached(cacheKey, matches, scheduledMatchesTtlMs);
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = matches.length;
    serviceStatus.lastMatchesReceived = fetchResult.matches.length;
    serviceStatus.lastCompetitionQueried = matches[0]?.competition?.name ?? null;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "today", count: matches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: matches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] today refresh failed:', message);
    serviceStatus.lastErrorMessage = message;
    emitScoreEvent("scores:failed", { cacheKey, attempt, error: message });
    if (attempt < 2) {
      emitScoreEvent("scores:retry", { cacheKey, nextAttempt: attempt + 1 });
      await refreshTodayMatches(cacheKey, dateFrom, dateTo, attempt + 1);
    }
    throw error;
  }
}

async function refreshUpcomingMatches(cacheKey: string, dateFrom: string, dateTo: string, attempt = 1): Promise<void> {
  try {
    const fetchResult = await fetchMatchesForRange(dateFrom, dateTo);
    if (!fetchResult.success) {
      throw new Error("Failed to fetch upcoming matches.");
    }
    const matches = fetchResult.matches.map(normalizeMatch);
    setCached(cacheKey, matches, scheduledMatchesTtlMs);
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = matches.length;
    serviceStatus.lastMatchesReceived = fetchResult.matches.length;
    serviceStatus.lastCompetitionQueried = matches[0]?.competition?.name ?? null;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "upcoming", count: matches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: matches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] upcoming refresh failed:', message);
    serviceStatus.lastErrorMessage = message;
    emitScoreEvent("scores:failed", { cacheKey, attempt, error: message });
    if (attempt < 2) {
      emitScoreEvent("scores:retry", { cacheKey, nextAttempt: attempt + 1 });
      await refreshUpcomingMatches(cacheKey, dateFrom, dateTo, attempt + 1);
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

  if (cached) {
    scheduleBackgroundRefresh(cacheKey, () => refreshScheduledMatches(cacheKey, dateFrom, dateTo));
    return {
      matches: cached.value,
      source: "cache",
      ageMs: Date.now() - cached.createdAt,
      cachedAt: new Date(cached.createdAt).toISOString()
    };
  }

  try {
    await refreshScheduledMatches(cacheKey, dateFrom, dateTo);
    const fresh = getCacheEntry<ScoreMatchSummary[]>(cacheKey);
    if (fresh) {
      return {
        matches: fresh.value,
        source: "scheduled",
        ageMs: Date.now() - fresh.createdAt,
        cachedAt: new Date(fresh.createdAt).toISOString()
      };
    }
  } catch (error) {
    console.debug("[score] scheduled fetch failed", error instanceof Error ? error.message : error);
  }

  const stale = getStaleCacheEntry<ScoreMatchSummary[]>(cacheKey, 120_000);
  if (stale) {
    return {
      matches: stale.value,
      source: "cache",
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
  lastApiRequestAt: string | null;
  lastApiResponseStatus: number | null;
  lastErrorMessage: string | null;
  lastCompetitionQueried: string | null;
  lastMatchesReceived: number;
  cacheKeys: string[];
} = {
  footballApiEnabled: Boolean(env.footballDataApiKey && env.footballDataApiKey.trim()),
  cacheInitialized: false,
  lastFetchTime: null,
  lastResponseCount: 0,
  lastApiRequestAt: null,
  lastApiResponseStatus: null,
  lastErrorMessage: null,
  lastCompetitionQueried: null,
  lastMatchesReceived: 0,
  cacheKeys: []
};

function clearCacheKeys(prefix?: string) {
  for (const key of Array.from(cache.keys())) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
  serviceStatus.cacheKeys = Array.from(cache.keys());
}

async function refreshAllScores(): Promise<{ liveCount: number; todayCount: number; upcomingCount: number }> {
  const now = new Date();
  const dateFrom = formatDate(now);
  const dateTo = formatDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  const results = { liveCount: 0, todayCount: 0, upcomingCount: 0 };

  try {
    const fetchResult = await fetchMatchesForRange(dateFrom, dateTo);
    if (!fetchResult.success) {
      serviceStatus.cacheInitialized = false;
      serviceStatus.lastResponseCount = 0;
      serviceStatus.cacheKeys = Array.from(cache.keys());
      return results;
    }

    const normalizedMatches = fetchResult.matches.map(normalizeMatch);
    const liveMatches = normalizedMatches.filter((match) => isLiveStatus(match.status));
    const todayMatches = normalizedMatches.filter((match) => isUtcDateOnDay(match.utcDate, dateFrom));
    const upcomingMatches = normalizedMatches.filter((match) => isUtcDateAfterDay(match.utcDate, dateFrom));

    setCached("scores:live", liveMatches, liveScoresTtlMs);
    setCached(buildScheduleCacheKey(dateFrom, dateFrom), todayMatches, scheduledMatchesTtlMs);
    setCached(buildScheduleCacheKey(formatDate(new Date(now.getTime() + 24 * 60 * 60 * 1000)), formatDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))), upcomingMatches, scheduledMatchesTtlMs);

    serviceStatus.cacheInitialized = true;
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = fetchResult.matches.length;
    serviceStatus.lastMatchesReceived = fetchResult.matches.length;
    serviceStatus.lastCompetitionQueried = normalizedMatches[0]?.competition?.name ?? null;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    console.log("MATCH COUNT AFTER FILTER:", liveMatches.length);
    console.log("LIVE COUNT:", liveMatches.length);

    results.liveCount = liveMatches.length;
    results.todayCount = todayMatches.length;
    results.upcomingCount = upcomingMatches.length;
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] refreshAll failed:', message);
    serviceStatus.lastErrorMessage = message;
    serviceStatus.cacheInitialized = false;
    serviceStatus.lastResponseCount = 0;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    return results;
  }
}

async function refreshLiveScores(cacheKey: string, attempt = 1): Promise<void> {
  try {
    const now = new Date();
    const fromDate = formatDate(now);
    const toDate = formatDate(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
    const fetchResult = await fetchMatchesForRange(fromDate, toDate);
    if (!fetchResult.success) {
      console.error('[football] live refresh aborted because fetch failed.');
      emitScoreEvent("scores:failed", { cacheKey, attempt, error: serviceStatus.lastErrorMessage });
      return;
    }
    const liveMatches = fetchResult.matches
      .filter((match) => isLiveStatus(asString(match.status) ?? null))
      .map(normalizeMatch);
    console.log("MATCH COUNT AFTER FILTER:", liveMatches.length);
    console.log("LIVE COUNT:", liveMatches.length);
    setCached(cacheKey, liveMatches, liveScoresTtlMs);
    serviceStatus.lastFetchTime = new Date().toISOString();
    serviceStatus.lastResponseCount = liveMatches.length;
    serviceStatus.lastMatchesReceived = fetchResult.matches.length;
    serviceStatus.lastCompetitionQueried = liveMatches[0]?.competition?.name ?? null;
    serviceStatus.cacheKeys = Array.from(cache.keys());
    emitScoreEvent("scores:updated", { cacheKey, source: "live", count: liveMatches.length, attempt });
    emitScoreEvent("scores:cache:refreshed", { cacheKey, count: liveMatches.length, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[football] live refresh failed:', message);
    serviceStatus.lastErrorMessage = message;
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
    const err = Object.assign(new Error("FOOTBALL_DATA_API_KEY is not configured."), {
      statusCode: 503,
      code: "football_data_api_key_missing"
    });
    console.error('[football] missing API key');
    serviceStatus.lastErrorMessage = err.message;
    throw err;
  }

  const baseUrl = env.footballDataBaseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  serviceStatus.lastApiRequestAt = new Date().toISOString();
  serviceStatus.lastErrorMessage = null;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        "X-Auth-Token": env.footballDataApiKey,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    serviceStatus.lastApiResponseStatus = response.status;
    console.log('FOOTBALL API STATUS CODE:', response.status);

    if (!response.ok) {
      const bodyText = await response.text();
      const snippet = bodyText.slice(0, 200);
      const message = `Football-Data.org request failed with ${response.status}.`;
      const err = Object.assign(new Error(message), {
        statusCode: response.status >= 500 ? 502 : response.status,
        code: response.status === 429 ? "football_data_rate_limited" : "football_data_request_failed"
      });
      console.error('[football] HTTP failure', response.status, response.statusText);
      console.error('FOOTBALL RAW RESPONSE:', snippet);
      serviceStatus.lastErrorMessage = snippet || message;
      throw err;
    }

    try {
      return response.json() as Promise<T>;
    } catch (parseError) {
      console.error('[football] invalid JSON response');
      const err = Object.assign(new Error('Football-Data.org returned invalid JSON.'), {
        statusCode: 502,
        code: 'football_data_invalid_json'
      });
      serviceStatus.lastErrorMessage = err.message;
      throw err;
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if ((err as any).name === "AbortError") {
      const timeoutError = Object.assign(new Error("Football-Data.org request timed out."), {
        statusCode: 504,
        code: "football_data_request_timeout"
      });
      console.error('[football] request timed out');
      serviceStatus.lastErrorMessage = timeoutError.message;
      throw timeoutError;
    }

    serviceStatus.lastErrorMessage = err.message;
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
      lastApiStatus: serviceStatus.lastApiResponseStatus,
      lastFetchTime: serviceStatus.lastFetchTime,
      lastResponseCount: serviceStatus.lastResponseCount,
      cacheKeys: serviceStatus.cacheKeys.length
    };
  },

  getDebug() {
    return {
      enabled: serviceStatus.footballApiEnabled,
      cacheInitialized: serviceStatus.cacheInitialized,
      lastFetchTime: serviceStatus.lastFetchTime,
      lastResponseCount: serviceStatus.lastResponseCount,
      lastApiStatus: serviceStatus.lastApiResponseStatus,
      lastError: serviceStatus.lastErrorMessage,
      lastApiRequestAt: serviceStatus.lastApiRequestAt,
      lastCompetitionQueried: serviceStatus.lastCompetitionQueried,
      lastMatchesReceived: serviceStatus.lastMatchesReceived,
      cachedKeys: serviceStatus.cacheKeys.length
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

    if (cached && cached.value.length > 0) {
      if (!this._backgroundRefreshes.has(cacheKey)) {
        scheduleBackgroundRefresh(cacheKey, () => refreshLiveScores(cacheKey));
      }
      return {
        matches: cached.value,
        source: "cache",
        ageMs: Date.now() - cached.createdAt,
        cachedAt: new Date(cached.createdAt).toISOString()
      };
    }

    try {
      await refreshLiveScores(cacheKey);
      const fresh = getCacheEntry<ScoreMatchSummary[]>(cacheKey);
      if (fresh && fresh.value.length > 0) {
        return {
          matches: fresh.value,
          source: "live",
          ageMs: Date.now() - fresh.createdAt,
          cachedAt: new Date(fresh.createdAt).toISOString()
        };
      }
    } catch (e) {
      console.debug("[score] live fetch failed", e instanceof Error ? e.message : e);
    }

    const stale = getStaleCacheEntry<ScoreMatchSummary[]>(cacheKey, 120_000);
    if (stale) {
      return {
        matches: stale.value,
        source: "cache",
        ageMs: stale.ageMs,
        cachedAt: stale.cachedAt
      };
    }

    try {
      const today = getTodayDateRange();
      const todayCacheKey = buildScheduleCacheKey(today.dateFrom, today.dateTo);
      await refreshScheduledMatches(todayCacheKey, today.dateFrom, today.dateTo);
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
      console.debug("[score] today fallback fetch failed", e instanceof Error ? e.message : e);
    }

    if (cached) {
      return {
        matches: cached.value,
        source: "cache",
        ageMs: Date.now() - cached.createdAt,
        cachedAt: new Date(cached.createdAt).toISOString()
      };
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
