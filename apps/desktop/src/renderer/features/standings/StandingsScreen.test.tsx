import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { ApiRequestError, apiClient, type StandingsResponse } from "../../services/api-client";
import { navigationItems } from "../../types/navigation";
import { StandingsScreen } from "./StandingsScreen.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const target = globalThis as typeof globalThis & Record<string, unknown>;
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true
})) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}
const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");

const competitions = [
  { id: "competition-1", name: "Premier League" },
  { id: "competition-2", name: "Cup" }
] as any;
const seasonSets: Record<string, Array<{ id: string; competitionId: string; name: string }>> = {
  "competition-1": [
    { id: "season-1", competitionId: "competition-1", name: "2025/26" },
    { id: "season-2", competitionId: "competition-1", name: "2024/25" },
    { id: "season-3", competitionId: "competition-1", name: "2023/24" }
  ],
  "competition-2": [{ id: "season-cup", competitionId: "competition-2", name: "2026" }]
};

function makeResponse(overrides: Partial<StandingsResponse> = {}): StandingsResponse {
  return {
    competition: { id: "competition-1", name: "Premier League" },
    season: { id: "season-1", name: "2025/26" },
    snapshot: {
      id: "snapshot-abc",
      sequence: 3,
      calculatedAt: "2026-04-18T12:00:00.000Z",
      ruleset: { id: "example-league", version: 2 },
      rulesetApproval: null,
      complete: true
    },
    rows: [{
      rank: 1,
      entry: { id: "entry-home", type: "team", teamId: "team-home", playerId: null, displayName: "Home United" },
      played: 10,
      won: 7,
      drawn: 2,
      lost: 1,
      goalsFor: 22,
      goalsAgainst: 8,
      goalDifference: 14,
      points: 23
    }],
    resultRevisions: [],
    coverage: {
      status: "verified_complete",
      eligible: true,
      assessment: {
        id: "assessment-1",
        sequence: 1,
        manifest: { id: "manifest-1", version: 1, state: "finalized" },
        blockingReasons: []
      }
    },
    ...overrides
  };
}

const originals = {
  listCompetitions: apiClient.listCompetitions,
  listSeasons: apiClient.listSeasons,
  getStandings: apiClient.getStandings,
  getStandingsWorkflowContext: apiClient.getStandingsWorkflowContext
};

function mockCatalog(getStandings: typeof apiClient.getStandings) {
  Object.assign(apiClient, {
    listCompetitions: async () => competitions,
    listSeasons: async (competitionId: string) => seasonSets[competitionId] ?? [],
    getStandings,
    getStandingsWorkflowContext: async (competitionId: string, seasonId: string) => ({
      data: {
        competition: { id: competitionId, name: competitionId, participantType: "clubs" },
        season: { id: seasonId, name: seasonId },
        teamCandidates: [],
        entries: [],
        fixtures: [],
        acceptedRevisions: [],
        rulesets: []
      }
    })
  });
}

test("standings navigation item is registered for the admin-only review screen", () => {
  assert.ok(navigationItems.some((item) => item.key === "standings"));
});

test("loads backend standings, renders persisted statistics, switches scope, and clears stale rows on failure", async () => {
  const requests: Array<[string, string, string]> = [];
  let refreshed = false;
  mockCatalog(async (competitionId, seasonId, accessToken) => {
    requests.push([competitionId, seasonId, accessToken]);
    if (seasonId === "season-2") {
      throw new ApiRequestError("standings_snapshot_not_found", 404, `/standings/${competitionId}/${seasonId}`);
    }
    return makeResponse(refreshed ? {
      rows: [{
        rank: 1,
        entry: { id: "entry-home", type: "team", teamId: "team-home", playerId: null, displayName: "Home United" },
        played: 11,
        won: 8,
        drawn: 2,
        lost: 1,
        goalsFor: 25,
        goalsAgainst: 9,
        goalDifference: 16,
        points: 26
      }]
    } : {});
  });
  try {
    render(<StandingsScreen accessToken="admin-token" isAdmin />);
    await waitFor(() => assert.ok(screen.getByRole("table")));
    assert.equal(screen.getByText("Eligible standings").textContent, "Eligible standings");
    assert.ok(screen.getByText("Snapshot 3 · snapshot-abc"));
    assert.ok(screen.getByText("Ruleset example-league v2"));
    const cells = screen.getAllByRole("row")[1]?.querySelectorAll("td");
    assert.deepEqual(Array.from(cells ?? []).map((cell) => cell.textContent), [
      "1", "Home United", "10", "7", "2", "1", "22", "8", "14", "23"
    ]);
    assert.deepEqual(requests[0], ["competition-1", "season-1", "admin-token"]);

    refreshed = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh standings" }));
    await waitFor(() => assert.equal(screen.getAllByRole("row")[1]?.querySelectorAll("td")[9]?.textContent, "26"));
    assert.equal(requests.length, 2);

    fireEvent.change(screen.getByLabelText("Competition"), { target: { value: "competition-2" } });
    await waitFor(() => assert.equal((screen.getByLabelText("Season") as HTMLSelectElement).value, "season-cup"));
    await waitFor(() => assert.ok(screen.getByText("Home United")));
    assert.deepEqual(requests.at(-1), ["competition-2", "season-cup", "admin-token"]);

    fireEvent.change(screen.getByLabelText("Competition"), { target: { value: "competition-1" } });
    await waitFor(() => assert.equal((screen.getByLabelText("Season") as HTMLSelectElement).value, "season-1"));
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "season-2" } });
    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes("No calculated standings snapshot")));
    assert.equal(screen.queryByText("Home United"), null);
    assert.deepEqual(requests.at(-1), ["competition-1", "season-2", "admin-token"]);
  } finally {
    cleanup();
    Object.assign(apiClient, originals);
  }
});

test("displays incomplete and unassessed coverage without upgrading eligibility", async () => {
  mockCatalog(async (_competitionId, seasonId) => makeResponse({
    season: { id: seasonId, name: seasonId },
    coverage: {
      status: seasonId === "season-1" ? "incomplete" : seasonId === "season-2" ? "unassessed" : "unverified",
      eligible: false,
      assessment: null
    }
  }));
  try {
    render(<StandingsScreen accessToken="admin-token" isAdmin />);
    await waitFor(() => assert.ok(screen.getByText(/schedule coverage is incomplete or unresolved/)));
    assert.equal(screen.queryByText("Eligible standings"), null);
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "season-2" } });
    await waitFor(() => assert.ok(screen.getByText(/not assessed for eligibility/)));
    fireEvent.change(screen.getByLabelText("Season"), { target: { value: "season-3" } });
    await waitFor(() => assert.ok(screen.getByText(/schedule completeness has not been verified/i)));
  } finally {
    cleanup();
    Object.assign(apiClient, originals);
  }
});

test("handles authentication, authorization, validation, not-found, and network errors", async () => {
  const cases: Array<{ error: unknown; message: string }> = [
    { error: new ApiRequestError("identifier_invalid", 400, "/standings"), message: "identifier is invalid" },
    { error: new ApiRequestError("missing_token", 401, "/standings"), message: "Sign in again" },
    { error: new ApiRequestError("admin_required", 403, "/standings"), message: "Administrator access is required" },
    { error: new ApiRequestError("competition_not_found", 404, "/standings"), message: "competition could not be found" },
    { error: new ApiRequestError("standings_snapshot_not_found", 404, "/standings"), message: "No calculated standings snapshot" },
    { error: new Error("connection refused"), message: "connection refused" }
  ];
  for (const { error, message } of cases) {
    mockCatalog(async () => { throw error; });
    try {
      render(<StandingsScreen accessToken="admin-token" isAdmin />);
      await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes(message)));
      assert.equal(screen.queryByText("Home United"), null);
    } finally {
      cleanup();
    }
  }
  Object.assign(apiClient, originals);
});

test("blocks direct use without administrator access", () => {
  render(<StandingsScreen accessToken="operator-token" isAdmin={false} />);
  assert.ok(screen.getByRole("alert").textContent?.includes("Administrator access required"));
  assert.equal(screen.queryByLabelText("Competition"), null);
  cleanup();
  Object.assign(apiClient, originals);
});

test.after(() => {
  cleanup();
  Object.assign(apiClient, originals);
  dom.window.close();
});
