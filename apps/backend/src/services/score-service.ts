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

export type ScoreSource = "live" | "cache" | "stale_cache";

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
const matchDetailsTtlMs = 30_000;
const competitionsTtlMs = 6 * 60 * 60 * 1000;

const cache = new Map<string, CacheEntry<unknown>>();

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

async function refreshLiveScores(cacheKey: string, attempt = 1): Promise<void> {
  try {
    const payload = await footballDataGet<{ matches?: FootballDataMatch[] }>("/matches?status=LIVE");
    const matches = (payload.matches ?? []).map(normalizeMatch);
    setCached(cacheKey, matches, liveScoresTtlMs);
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

    // No cache at all: return empty list but note source as 'cache' so UI can render quickly.
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
