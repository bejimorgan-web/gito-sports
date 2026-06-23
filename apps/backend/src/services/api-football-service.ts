import { env } from "../config/env.js";

type ApiFootballPaging = {
  current: number;
  total: number;
};

type ApiFootballResponse<T> = {
  get: string;
  parameters: Record<string, unknown>;
  errors: unknown[];
  results: number;
  paging: ApiFootballPaging;
  response: T[];
};

type ApiFootballFixtureTeam = {
  id: number | null;
  name: string;
  logo: string;
  winner: boolean | null;
};

type ApiFootballFixtureTeamInfo = {
  home: ApiFootballFixtureTeam;
  away: ApiFootballFixtureTeam;
};

type ApiFootballFixtureLeague = {
  id: number;
  name: string;
  country: string;
  logo: string;
  flag: string | null;
  season: number;
  round: string;
};

type ApiFootballFixtureFixture = {
  id: number;
  referee: string | null;
  timezone: string;
  date: string;
  timestamp: number;
  periods: { first: number | null; second: number | null };
  venue: { id: number | null; name: string | null; city: string | null };
  status: {
    long: string;
    short: string;
    elapsed: number | null;
  };
};

type ApiFootballFixtureGoals = {
  home: number | null;
  away: number | null;
};

type ApiFootballFixtureScore = {
  halftime: ApiFootballFixtureGoals;
  fulltime: ApiFootballFixtureGoals;
  extratime: ApiFootballFixtureGoals;
  penalty: ApiFootballFixtureGoals;
};

type ApiFootballFixture = {
  fixture: ApiFootballFixtureFixture;
  league: ApiFootballFixtureLeague;
  teams: ApiFootballFixtureTeamInfo;
  goals: ApiFootballFixtureGoals;
  score: ApiFootballFixtureScore;
};

type ApiFootballLeague = {
  league: {
    id: number;
    name: string;
    type: string;
    logo: string;
  };
  country: {
    name: string;
    code: string | null;
    flag: string | null;
  };
  seasons: Array<{ year: number; current: boolean; coverage: Record<string, unknown> }>;
};

function buildApiFootballHeaders(): Record<string, string> {
  return {
    "x-apisports-key": env.apiFootballKey,
    Accept: "application/json"
  };
}

function ensureApiFootballKey(): void {
  if (!env.apiFootballKey || !env.apiFootballKey.trim()) {
    throw new Error("API_FOOTBALL_KEY is not configured.");
  }
}

async function fetchApiFootball<T>(path: string): Promise<ApiFootballResponse<T>> {
  ensureApiFootballKey();
  const baseUrl = env.apiFootballBaseUrl.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  console.log("API-FOOTBALL REQUEST URL:", url);

  const response = await fetch(url, {
    headers: buildApiFootballHeaders()
  });

  console.log("API-FOOTBALL API STATUS CODE:", response.status);
  const bodyText = await response.text();
  const snippet = bodyText.slice(0, 200);
  if (!response.ok) {
    console.error("API-FOOTBALL RAW RESPONSE:", snippet);
    throw Object.assign(new Error(`API-Football request failed with status ${response.status}.`), {
      statusCode: response.status,
      responseSnippet: snippet
    });
  }

  try {
    return JSON.parse(bodyText) as ApiFootballResponse<T>;
  } catch (error) {
    console.error("API-FOOTBALL RAW RESPONSE:", snippet);
    throw new Error("API-Football returned invalid JSON.");
  }
}

export const ApiFootballService = {
  async getLiveFixtures(): Promise<ApiFootballFixture[]> {
    const payload = await fetchApiFootball<ApiFootballFixture>("/fixtures?live=all");
    return payload.response;
  },

  async getTodayFixtures(date: string): Promise<ApiFootballFixture[]> {
    const payload = await fetchApiFootball<ApiFootballFixture>(`/fixtures?date=${encodeURIComponent(date)}`);
    return payload.response;
  },

  async getFixturesByRange(from: string, to: string): Promise<ApiFootballFixture[]> {
    const payload = await fetchApiFootball<ApiFootballFixture>(`/fixtures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return payload.response;
  },

  async getUpcomingFixtures(): Promise<ApiFootballFixture[]> {
    const payload = await fetchApiFootball<ApiFootballFixture>("/fixtures?next=20");
    return payload.response;
  },

  async getFixtureDetails(id: string): Promise<ApiFootballFixture | null> {
    const payload = await fetchApiFootball<ApiFootballFixture>(`/fixtures?id=${encodeURIComponent(id)}`);
    return payload.response[0] ?? null;
  },

  async getLeagues(season: number): Promise<ApiFootballLeague[]> {
    const payload = await fetchApiFootball<ApiFootballLeague>(`/leagues?season=${season}`);
    return payload.response;
  }
};
