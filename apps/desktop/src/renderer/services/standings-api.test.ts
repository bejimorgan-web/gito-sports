import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, apiClient } from "./api-client.js";

test("standings API client calls the persisted read endpoint with the admin bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedAuthorization: string | undefined;
  const responseBody = {
    competition: { id: "league/1", name: "League" },
    season: { id: "season:1", name: "2026" },
    snapshot: { id: "snapshot-1", sequence: 1, calculatedAt: "2026-01-01T00:00:00.000Z", ruleset: { id: "league-points", version: 1 }, complete: true },
    rows: [],
    resultRevisions: [],
    coverage: { status: "unassessed", eligible: false, assessment: null }
  };
  globalThis.fetch = async (input, init) => {
    observedUrl = String(input);
    observedAuthorization = (init?.headers as Record<string, string>).authorization;
    return new Response(JSON.stringify({ data: responseBody }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await apiClient.getStandings("league/1", "season:1", "admin-token");
    assert.equal(new URL(observedUrl).pathname, "/standings/league%2F1/season%3A1");
    assert.equal(observedAuthorization, "Bearer admin-token");
    assert.deepEqual(response, responseBody);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("standings API client preserves backend status for route-specific handling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "standings_snapshot_not_found" }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });
  try {
    await assert.rejects(
      apiClient.getStandings("competition-1", "season-1", "admin-token"),
      (error: unknown) => error instanceof ApiRequestError
        && error.status === 404
        && error.message === "standings_snapshot_not_found"
        && error.path === "/standings/competition-1/season-1"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
