import { env } from "../config/env.js";

type SportmonksRecord = Record<string, unknown>;
type SportmonksConfig = {
  sportmonksApiToken?: string;
  sportmonksApiKey?: string;
  sportmonksBaseUrl?: string;
};

type SportmonksFixture = {
  id?: number | string;
  starting_at?: string;
  startingAt?: string;
  date?: string;
  status?: string | SportmonksRecord;
  minute?: number | null;
  elapsed?: number | null;
  league_id?: number | string;
  league?: SportmonksRecord;
  season_id?: number | string;
  home_team?: SportmonksRecord;
  homeTeam?: SportmonksRecord;
  away_team?: SportmonksRecord;
  awayTeam?: SportmonksRecord;
  scores?: SportmonksRecord;
  score?: SportmonksRecord;
  home_score?: number | null;
  away_score?: number | null;
  round?: string;
  venue?: SportmonksRecord;
  country?: SportmonksRecord;
  country_name?: string;
  country_flag?: string;
};

function asRecord(value: unknown): SportmonksRecord {
  return value && typeof value === "object" ? (value as SportmonksRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toInteger(value: unknown): number | null {
  const number = asNumber(value);
  if (number !== null) return Math.trunc(number);
  const text = asString(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTokenValue(configuration: SportmonksConfig): string {
  return (configuration.sportmonksApiToken || configuration.sportmonksApiKey || "").trim();
}

function normalizeSportmonksTeam(team: SportmonksRecord): SportmonksRecord {
  const teamRecord = asRecord(team);
  const metadata = asRecord(teamRecord.meta);
  return {
    id: toInteger(teamRecord.id) ?? 0,
    name: asString(teamRecord.name) ?? "Team",
    logo: asString(teamRecord.logo_path ?? teamRecord.image_path ?? teamRecord.logo) ?? "",
    winner: Boolean(teamRecord.winner ?? metadata.winner)
  };
}

function getSportmonksParticipant(raw: SportmonksRecord, side: "home" | "away"): SportmonksRecord {
  const participants = Array.isArray(raw.participants) ? raw.participants : [];
  const participant = participants.find((value) => {
    const item = asRecord(value);
    return asString(asRecord(item.meta).location ?? item.location)?.toLowerCase() === side;
  });
  const legacyKey = side === "home" ? "home_team" : "away_team";
  const camelKey = side === "home" ? "homeTeam" : "awayTeam";
  return asRecord(participant ?? raw[legacyKey] ?? raw[camelKey]);
}

function getSportmonksScores(
  rawScores: unknown,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: unknown,
  awayScore: unknown
): { home: number | null; away: number | null } {
  if (!Array.isArray(rawScores)) {
    const scores = asRecord(rawScores);
    const fullTime = asRecord(scores.ft ?? scores.fulltime ?? {});
    return {
      home: toInteger(scores.home_score ?? scores.home ?? homeScore) ?? toInteger(fullTime.home ?? scores.home),
      away: toInteger(scores.away_score ?? scores.away ?? awayScore) ?? toInteger(fullTime.away ?? scores.away)
    };
  }

  const currentScores = rawScores.filter((value) => {
    const description = (asString(asRecord(value).description) ?? "").toLowerCase();
    return description === "current" || description.includes("fulltime") || description.includes("full time");
  });
  const scores = currentScores.length ? currentScores : rawScores;
  let home: number | null = null;
  let away: number | null = null;

  for (const value of scores) {
    const row = asRecord(value);
    const score = asRecord(row.score);
    const goals = toInteger(score.goals ?? row.goals);
    const side = asString(score.participant ?? row.participant)?.toLowerCase();
    const participantId = toInteger(row.participant_id ?? asRecord(row.participant).id);
    if (side === "home" || (homeTeamId !== 0 && participantId === homeTeamId)) home = goals;
    if (side === "away" || (awayTeamId !== 0 && participantId === awayTeamId)) away = goals;
  }

  return { home, away };
}

function normalizeSportmonksStatus(rawStatus: unknown): { short: string; long: string; elapsed: number | null } {
  const status = asRecord(rawStatus);
  const short = asString(status.short ?? status.short_name ?? status.code ?? status.name ?? rawStatus) ?? "NS";
  const long = asString(status.long ?? status.name ?? rawStatus) ?? short;
  const elapsed = toInteger(status.elapsed ?? status.minute);
  return { short, long, elapsed };
}

function normalizeSportmonksFixture(raw: SportmonksRecord): Record<string, unknown> {
  const league = asRecord(raw.league ?? raw.leagueData);
  const homeTeam = normalizeSportmonksTeam(getSportmonksParticipant(raw, "home"));
  const awayTeam = normalizeSportmonksTeam(getSportmonksParticipant(raw, "away"));
  const venue = asRecord(raw.venue);
  const scores = getSportmonksScores(
    raw.scores ?? raw.score ?? {},
    toInteger(homeTeam.id) ?? 0,
    toInteger(awayTeam.id) ?? 0,
    raw.home_score,
    raw.away_score
  );
  const dateValue = asString(raw.starting_at ?? raw.startingAt ?? raw.date) ?? new Date(0).toISOString();
  const status = normalizeSportmonksStatus(raw.state ?? raw.status ?? raw.fixture_status ?? raw.match_status ?? "NS");
  const roundText = asString(raw.round ?? league.name) ?? "Regular Season";

  return {
    id: toInteger(raw.id) ?? 0,
    fixture: {
      id: toInteger(raw.id) ?? 0,
      referee: null,
      timezone: "UTC",
      date: dateValue,
      timestamp: Date.parse(dateValue) || Date.now(),
      periods: { first: null, second: null },
      venue: {
        id: toInteger(venue.id) ?? null,
        name: asString(venue.name) ?? null,
        city: asString(venue.city) ?? null
      },
      status: {
        long: status.long,
        short: status.short,
        elapsed: status.elapsed
      }
    },
    league: {
      id: toInteger(raw.league_id ?? league.id) ?? 0,
      name: asString(league.name ?? raw.league_name) ?? "Competition",
      country: asString(league.country_name ?? raw.country_name ?? asRecord(raw.country).name) ?? "",
      logo: asString(league.logo_path ?? league.logo ?? raw.league_logo) ?? "",
      flag: asString(league.country_flag ?? raw.country_flag ?? asRecord(raw.country).flag) ?? null,
      season: toInteger(raw.season_id ?? league.season_id) ?? new Date(dateValue).getFullYear(),
      round: roundText
    },
    teams: {
      home: {
        ...homeTeam,
        id: toInteger(homeTeam.id) ?? 0,
        name: asString(homeTeam.name) ?? "Home Team",
        logo: asString(homeTeam.logo) ?? "",
        winner: Boolean(homeTeam.winner)
      },
      away: {
        ...awayTeam,
        id: toInteger(awayTeam.id) ?? 0,
        name: asString(awayTeam.name) ?? "Away Team",
        logo: asString(awayTeam.logo) ?? "",
        winner: Boolean(awayTeam.winner)
      }
    },
    goals: {
      home: scores.home ?? 0,
      away: scores.away ?? 0
    },
    score: {
      halftime: { home: 0, away: 0 },
      fulltime: { home: scores.home ?? 0, away: scores.away ?? 0 },
      extratime: { home: 0, away: 0 },
      penalty: { home: 0, away: 0 }
    }
  };
}

function ensureConfigured(configuration: SportmonksConfig): string {
  const token = buildTokenValue(configuration);
  if (!token) {
    throw new Error("SPORTMONKS_API_TOKEN is not configured.");
  }
  return token;
}

function buildBaseUrl(configuration: SportmonksConfig): string {
  return (configuration.sportmonksBaseUrl?.trim() || "https://api.sportmonks.com/v3").replace(/\/+$/, "");
}

function buildRequestUrl(path: string, configuration: SportmonksConfig, token: string): URL {
  const url = new URL(path.replace(/^\/+/, ""), `${buildBaseUrl(configuration)}/`);
  url.searchParams.set("api_token", token);
  return url;
}

function buildRequestHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "GiTO-Backend/1.0"
  };
}

async function fetchSportmonksJson<T>(path: string, configuration: SportmonksConfig, fetcher: typeof fetch): Promise<T> {
  const token = ensureConfigured(configuration);
  const url = buildRequestUrl(path, configuration, token);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: buildRequestHeaders(token)
    });
  } catch {
    throw new Error("Sportmonks network request failed.");
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Sportmonks request failed with status ${response.status}.`), {
      statusCode: response.status
    });
  }

  if (!bodyText.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error("Sportmonks returned invalid JSON.");
  }
}

export function createSportmonksService(configuration: SportmonksConfig, fetcher: typeof fetch = fetch) {
  const request = <T>(path: string) => fetchSportmonksJson<T>(path, configuration, fetcher);

  return {
    getConfig() {
      const token = buildTokenValue(configuration);
      const tokenSource = configuration.sportmonksApiToken?.trim()
        ? "SPORTMONKS_API_TOKEN"
        : configuration.sportmonksApiKey?.trim()
          ? "SPORTMONKS_API_KEY"
          : "none";
      return {
        baseUrl: buildBaseUrl(configuration),
        apiTokenPresent: Boolean(token),
        isConfigured: Boolean(token),
        tokenSource
      };
    },

    isConfigured(): boolean {
      return Boolean(buildTokenValue(configuration));
    },

    async getFixturesByRange(from: string, to: string): Promise<Record<string, unknown>[]> {
      const payload = await request<{ data?: Array<SportmonksRecord>; response?: Array<SportmonksRecord> }>(`football/fixtures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&include=participants;scores;league;state;venue`);
      const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.response) ? payload.response : [];
      return rows.map((row) => normalizeSportmonksFixture(row));
    },

    async getLiveFixtures(): Promise<Record<string, unknown>[]> {
      const payload = await request<{ data?: Array<SportmonksRecord>; response?: Array<SportmonksRecord> }>("football/fixtures?live=true&include=participants;scores;league;state;venue");
      const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.response) ? payload.response : [];
      return rows.map((row) => normalizeSportmonksFixture(row));
    },

    async getFixtureDetails(id: string): Promise<Record<string, unknown> | null> {
      const payload = await request<{ data?: SportmonksRecord | Array<SportmonksRecord> }>(`football/fixtures/${encodeURIComponent(id)}?include=participants;scores;league;state;venue`);
      const item = Array.isArray(payload.data) ? payload.data[0] : payload.data;
      return item ? normalizeSportmonksFixture(item as SportmonksRecord) : null;
    },

    async getLeagues(season: number): Promise<Record<string, unknown>[]> {
      const payload = await request<{ data?: Array<SportmonksRecord>; response?: Array<SportmonksRecord> }>(`football/leagues?season=${encodeURIComponent(String(season))}&include=country`);
      const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.response) ? payload.response : [];
      return rows.map((row) => ({
        league: {
          id: toInteger(row.id) ?? 0,
          name: asString(row.name) ?? "Competition",
          type: asString(row.type) ?? "league",
          logo: asString(row.logo_path ?? row.logo) ?? ""
        },
        country: {
          name: asString(row.country_name ?? asRecord(row.country).name) ?? "",
          code: asString(row.country_code ?? asRecord(row.country).code) ?? null,
          flag: asString(row.country_flag ?? asRecord(row.country).flag) ?? null
        },
        seasons: [{ year: season, current: true, coverage: {} }]
      }));
    }
  };
}

export const SportmonksService = createSportmonksService(env);
