import assert from "node:assert/strict";
import test from "node:test";

import { resolveSportmonksApiToken } from "../config/env.js";
import { getFootballProvider } from "./score-service.js";
import { ApiFootballService } from "./api-football-service.js";
import { createSportmonksService, SportmonksService } from "./sportmonks-service.js";

const fakeToken = "test-sportmonks-token";
const fixturePayload = {
  data: [{
    id: 345,
    starting_at: "2026-10-01 18:30:00",
    state: { name: "Not Started", short_name: "NS" },
    participants: [
      { id: 10, name: "Home FC", image_path: "home.png", meta: { location: "home" } },
      { id: 20, name: "Away FC", image_path: "away.png", meta: { location: "away" } }
    ],
    scores: [
      { description: "CURRENT", participant_id: 10, score: { goals: 2 } },
      { description: "CURRENT", participant_id: 20, score: { goals: 1 } }
    ],
    league: { id: 55, name: "Example League", logo_path: "league.png", country_name: "Exampleland" },
    season_id: 2026,
    venue: { id: 7, name: "Example Stadium", city: "Example City" }
  }]
};

function createRequestRecorder(payload: unknown = { data: [] }) {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { requests, fetcher };
}

function createTestService(payload?: unknown, baseUrl = "https://api.sportmonks.com/v3") {
  const recorder = createRequestRecorder(payload);
  const service = createSportmonksService({ sportmonksApiToken: fakeToken, sportmonksBaseUrl: baseUrl }, recorder.fetcher);
  return { ...recorder, service };
}

test("token resolver trims values, prefers primary token, and uses compatibility alias", () => {
  assert.equal(resolveSportmonksApiToken(" primary ", "compatibility"), "primary");
  assert.equal(resolveSportmonksApiToken("   ", " compatibility "), "compatibility");
  assert.equal(resolveSportmonksApiToken("  ", "  "), "");
});

test("provider selection prefers configured Sportmonks and otherwise preserves API-Football fallback", () => {
  assert.equal(getFootballProvider(` ${fakeToken} `), SportmonksService);
  assert.equal(getFootballProvider("", " compatibility-test-token "), SportmonksService);
  assert.equal(getFootballProvider("  ", ""), ApiFootballService);
});

test("live fixtures use the configured v3 base URL and expected authentication", async () => {
  const { requests, service } = createTestService({ data: [] }, "https://sports.example/custom/v3/");
  await service.getLiveFixtures();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url.origin + requests[0]?.url.pathname, "https://sports.example/custom/v3/football/fixtures");
  assert.equal(requests[0]?.url.searchParams.get("live"), "true");
  assert.equal(requests[0]?.url.searchParams.get("api_token"), fakeToken);
  assert.equal(requests[0]?.headers.get("authorization"), `Bearer ${fakeToken}`);
  assert.equal(requests[0]?.headers.get("accept"), "application/json");
});

test("scheduled fixtures preserve from/to dates and use the default v3 base URL", async () => {
  const { requests, service } = createTestService();
  await service.getFixturesByRange("2026-10-01", "2026-10-08");

  assert.equal(requests[0]?.url.origin + requests[0]?.url.pathname, "https://api.sportmonks.com/v3/football/fixtures");
  assert.equal(requests[0]?.url.searchParams.get("from"), "2026-10-01");
  assert.equal(requests[0]?.url.searchParams.get("to"), "2026-10-08");
});

test("fixture details encode the fixture identifier in the path", async () => {
  const { requests, service } = createTestService({ data: fixturePayload.data[0] });
  await service.getFixtureDetails("fixture/345");

  assert.equal(requests[0]?.url.pathname, "/v3/football/fixtures/fixture%2F345");
});

test("leagues request uses the season and country relationship", async () => {
  const { requests, service } = createTestService({ data: [] });
  await service.getLeagues(2026);

  assert.equal(requests[0]?.url.pathname, "/v3/football/leagues");
  assert.equal(requests[0]?.url.searchParams.get("season"), "2026");
  assert.equal(requests[0]?.url.searchParams.get("include"), "country");
});

test("fixture normalization preserves identifiers, home/away teams, date, status, score, and league", async () => {
  const { service } = createTestService(fixturePayload);
  const [match] = await service.getFixturesByRange("2026-10-01", "2026-10-01");

  assert.equal(match?.id, 345);
  assert.deepEqual(match?.teams, {
    home: { id: 10, name: "Home FC", logo: "home.png", winner: false },
    away: { id: 20, name: "Away FC", logo: "away.png", winner: false }
  });
  assert.equal((match?.fixture as Record<string, unknown>)?.date, "2026-10-01 18:30:00");
  assert.deepEqual((match?.fixture as Record<string, unknown>)?.status, {
    long: "Not Started",
    short: "NS",
    elapsed: null
  });
  assert.deepEqual(match?.goals, { home: 2, away: 1 });
  assert.deepEqual(match?.league, {
    id: 55,
    name: "Example League",
    country: "Exampleland",
    logo: "league.png",
    flag: null,
    season: 2026,
    round: "Example League"
  });
});

test("provider errors do not include credential or upstream response text", async () => {
  const fetcher: typeof fetch = async () => new Response(`upstream echoed ${fakeToken}`, { status: 401 });
  const service = createSportmonksService({ sportmonksApiToken: fakeToken }, fetcher);

  await assert.rejects(service.getLiveFixtures(), (error: unknown) => {
    assert.match((error as Error).message, /status 401/);
    assert.equal((error as Error).message.includes(fakeToken), false);
    assert.equal("responseSnippet" in (error as object), false);
    return true;
  });
});

test("network and malformed-response errors do not reveal credential-bearing details", async () => {
  const networkService = createSportmonksService({ sportmonksApiToken: fakeToken }, async () => {
    throw new Error(`request failed for ${fakeToken}`);
  });
  await assert.rejects(networkService.getLiveFixtures(), (error: unknown) => {
    assert.equal((error as Error).message, "Sportmonks network request failed.");
    assert.equal((error as Error).message.includes(fakeToken), false);
    return true;
  });

  const malformedService = createSportmonksService(
    { sportmonksApiToken: fakeToken },
    async () => new Response(fakeToken, { status: 200 })
  );
  await assert.rejects(malformedService.getLiveFixtures(), (error: unknown) => {
    assert.equal((error as Error).message, "Sportmonks returned invalid JSON.");
    assert.equal((error as Error).message.includes(fakeToken), false);
    return true;
  });
});

test("production Sportmonks service exposes only safe configuration metadata", () => {
  const config = SportmonksService.getConfig();
  assert.equal(typeof config.isConfigured, "boolean");
  assert.equal(typeof config.apiTokenPresent, "boolean");
  assert.equal(typeof config.tokenSource, "string");
  assert.equal("token" in config, false);
});
