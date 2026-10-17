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
const { default: userEvent } = await import("@testing-library/user-event");

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
  getStandingsWorkflowContext: apiClient.getStandingsWorkflowContext,
  proposeStandingsRuleset: apiClient.proposeStandingsRuleset,
  approveStandingsRuleset: apiClient.approveStandingsRuleset,
  prepareStandings: apiClient.prepareStandings
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

test("desktop preparation submits the reviewed teams, complete schedule, accepted results, and approved ruleset", async () => {
  const calls: {
    proposals: Array<{ competitionId: string; seasonId: string; ruleset: unknown; accessToken: string }>;
    approvals: Array<{ approvalId: string; accessToken: string }>;
    preparations: Array<{ competitionId: string; seasonId: string; input: any; accessToken: string }>;
  } = { proposals: [], approvals: [], preparations: [] };
  let approval: any = null;
  const ruleset = {
    id: "domestic-league",
    version: 1,
    points: { win: 3, draw: 1, loss: 0 },
    trackedStatistics: ["played", "won", "drawn", "lost", "scoresFor", "scoresAgainst", "scoreDifference", "points"],
    tieBreakers: [
      { criterion: "points", direction: "desc" },
      { criterion: "scoreDifference", direction: "desc" },
      { criterion: "scoresFor", direction: "desc" },
      { criterion: "entryId", direction: "asc" }
    ]
  };
  const workflowContext = {
    competition: { id: "competition-1", name: "Premier League", participantType: "clubs" },
    season: { id: "season-1", name: "2025/26" },
    teamCandidates: [
      { teamId: "team-home", name: "Home United" },
      { teamId: "team-away", name: "Away City" }
    ],
    entries: [],
    fixtures: [
      { id: "fixture-ended", homeTeamId: "team-home", homeTeamName: "Home United", awayTeamId: "team-away", awayTeamName: "Away City", status: "ended" },
      { id: "fixture-scheduled", homeTeamId: "team-away", homeTeamName: "Away City", awayTeamId: "team-home", awayTeamName: "Home United", status: "scheduled" }
    ],
    acceptedRevisions: [
      { id: "revision-final", matchId: "fixture-ended", revisionNumber: 2, homeScore: 2, awayScore: 1, createdAt: "2026-04-18T12:00:00.000Z" }
    ],
    rulesets: []
  };
  mockCatalog(async () => { throw new ApiRequestError("standings_snapshot_not_found", 404, "/standings"); });
  Object.assign(apiClient, {
    getStandingsWorkflowContext: async () => ({ data: { ...workflowContext, rulesets: approval ? [{ ...approval }] : [] } }),
    proposeStandingsRuleset: async (competitionId: string, seasonId: string, proposed: unknown, accessToken: string) => {
      calls.proposals.push({ competitionId, seasonId, ruleset: proposed, accessToken });
      approval = {
        id: "approval-domestic-league",
        rulesetId: "domestic-league",
        version: 1,
        ruleset,
        status: "pending",
        proposedByOperatorId: "admin-one",
        approvedByOperatorId: null,
        proposedAt: "2026-04-18T12:00:00.000Z",
        approvedAt: null
      };
      return { data: { id: approval.id, rulesetId: approval.rulesetId, version: approval.version, status: "pending" } };
    },
    approveStandingsRuleset: async (_competitionId: string, _seasonId: string, approvalId: string, accessToken: string) => {
      calls.approvals.push({ approvalId, accessToken });
      approval = { ...approval, status: "approved", approvedByOperatorId: "admin-two", approvedAt: "2026-04-18T12:05:00.000Z" };
      return { data: { id: approvalId, status: "approved" } };
    },
    prepareStandings: async (competitionId: string, seasonId: string, input: any, accessToken: string) => {
      calls.preparations.push({ competitionId, seasonId, input, accessToken });
      return { data: {
        snapshot: { id: "snapshot-domestic", sequence: 1, rulesetId: "domestic-league", rulesetVersion: 1 },
        manifest: { id: "manifest-domestic", version: 1, state: "finalized", source: { name: "Official schedule", reference: "league-calendar-2025", contentHash: "sha256" } },
        coverage: { id: "coverage-domestic", eligible: true, scheduleState: "verified_complete", blockingReasons: [] }
      } };
    }
  });
  try {
    const user = userEvent.setup();
    const { unmount } = render(<StandingsScreen accessToken="admin-one-token" isAdmin />);
    await waitFor(() => assert.ok(screen.getByLabelText("Accepted result for Home United vs Away City")));
    fireEvent.change(screen.getByLabelText(/Propose a new versioned ruleset/), { target: { value: JSON.stringify(ruleset) } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ruleset for approval" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Approve (second admin)" })));
    assert.equal(calls.proposals.length, 1);
    assert.equal(calls.proposals[0]?.accessToken, "admin-one-token");

    unmount();
    render(<StandingsScreen accessToken="admin-two-token" isAdmin />);
    const approveButton = await screen.findByRole("button", { name: "Approve (second admin)" });
    fireEvent.click(approveButton);
    const approvedRuleset = await screen.findByRole("radio", { name: /domestic-league v1 · approved/ });
    await user.click(approvedRuleset);
    assert.deepEqual(calls.approvals, [{ approvalId: "approval-domestic-league", accessToken: "admin-two-token" }]);

    fireEvent.click(await screen.findByLabelText("Home United"));
    fireEvent.click(await screen.findByLabelText("Away City"));
    fireEvent.click(await screen.findByLabelText("Home United vs Away City · ended"));
    fireEvent.click(await screen.findByLabelText("Away City vs Home United · scheduled"));
    fireEvent.change(screen.getByLabelText("Accepted result for Home United vs Away City"), { target: { value: "revision-final" } });
    fireEvent.change(screen.getByLabelText("Schedule source name"), { target: { value: "Official schedule" } });
    fireEvent.change(screen.getByLabelText("Schedule source reference (URL or document reference)"), { target: { value: "league-calendar-2025" } });
    const csv = new File(["homeTeam,awayTeam\nHome United,Away City\nAway City,Home United\n"], "schedule.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/Official schedule CSV/), csv);
    fireEvent.click(screen.getByLabelText(/I reconciled the full fixture list/));
    assert.deepEqual(Array.from(screen.getAllByRole("checkbox")).map((input) => (input as HTMLInputElement).checked), [true, true, true, true, true]);
    await waitFor(() => assert.equal((screen.getByRole("radio", { name: /domestic-league v1 · approved/ }) as HTMLInputElement).checked, true));
    assert.equal((screen.getByLabelText("Schedule source name") as HTMLInputElement).value, "Official schedule");
    assert.equal((screen.getByLabelText("Schedule source reference (URL or document reference)") as HTMLInputElement).value, "league-calendar-2025");
    await waitFor(() => assert.equal(screen.getByText("schedule.csv selected").textContent, "schedule.csv selected"));
    const submitButton = screen.getByRole("button", { name: "Create snapshot and assess coverage" }) as HTMLButtonElement;
    await waitFor(() => assert.equal(submitButton.disabled, false));
    const form = submitButton.closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => assert.equal(calls.preparations.length, 1));
    await waitFor(() => assert.ok(screen.getByText("Eligible standings prepared")));
    assert.equal(calls.preparations.length, 1);
    assert.deepEqual(calls.preparations[0], {
      competitionId: "competition-1",
      seasonId: "season-1",
      accessToken: "admin-two-token",
      input: {
        teamIds: ["team-home", "team-away"],
        expectedFixtures: [
          { fixtureKey: "fixture-ended", matchId: "fixture-ended", homeTeamId: "team-home", awayTeamId: "team-away" },
          { fixtureKey: "fixture-scheduled", matchId: "fixture-scheduled", homeTeamId: "team-away", awayTeamId: "team-home" }
        ],
        revisionSelections: [{ matchId: "fixture-ended", revisionId: "revision-final" }],
        rulesetApprovalId: "approval-domestic-league",
        scheduleConfirmed: true,
        scheduleSourceName: "Official schedule",
        scheduleSourceReference: "league-calendar-2025",
        scheduleCsvBase64: Buffer.from("homeTeam,awayTeam\nHome United,Away City\nAway City,Home United\n").toString("base64")
      }
    });
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
