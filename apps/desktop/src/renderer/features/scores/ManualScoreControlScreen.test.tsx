import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { ApiRequestError, apiClient } from "../../services/api-client.js";
import { ManualScoreControlScreen } from "./ManualScoreControlScreen.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const target = globalThis as any;
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
  return dom;
}

const dom = installDom();
const { render, screen, fireEvent, waitFor, cleanup } = await import("@testing-library/react");

test("manual score controls stay hidden from non-admin sessions", async () => {
  try {
    render(<ManualScoreControlScreen accessToken="operator-token" isAdmin={false} />);
    assert.ok(screen.getByRole("alert").textContent?.includes("Administrator access required"));
    assert.equal(screen.queryByRole("button", { name: "Start fixture" }), null);
  } finally {
    cleanup();
  }
});

test("admin workflow sends versioned mutations and refreshes authoritative state", async () => {
  const originalMethods = {
    listSports: apiClient.listSports,
    listCompetitions: apiClient.listCompetitions,
    listFixtures: apiClient.listFixtures,
    getManualScoreState: apiClient.getManualScoreState,
    startManualScore: apiClient.startManualScore,
    updateManualScore: apiClient.updateManualScore,
    confirmManualScore: apiClient.confirmManualScore,
    correctManualScore: apiClient.correctManualScore,
    reopenManualScore: apiClient.reopenManualScore
  };
  const observed: Array<{ action: string; id: string; input?: Record<string, unknown> }> = [];
  let current: any = null;
  let forceStaleUpdate = false;
  const fixture = {
    id: "canonical-fixture-7",
    startsAt: "2026-10-10T17:00:00.000Z",
    status: "scheduled",
    sport: { id: "sport-football", name: "Football" },
    competition: { id: "competition-1", name: "Local Cup" },
    homeTeam: { id: "home", name: "Home FC" },
    awayTeam: { id: "away", name: "Away FC" }
  };
  Object.assign(apiClient, {
    listSports: async () => [{ id: "sport-football", name: "Football", slug: "football" }],
    listCompetitions: async () => [{ id: "competition-1", name: "Local Cup", sportId: "sport-football" }],
    listFixtures: async () => [fixture],
    getManualScoreState: async (id: string) => {
      if (!current) throw new ApiRequestError("manual_score_not_found", 404, `/scores/manual/${id}`);
      return current;
    },
    startManualScore: async (id: string, input: any) => {
      observed.push({ action: "start", id, input });
      current = { matchId: id, homeScore: input.homeScore, awayScore: input.awayScore, status: "live", version: 1, finalResultConfirmed: false, updatedByOperatorId: "admin", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastConfirmedAt: null };
      return current;
    },
    updateManualScore: async (id: string, input: any) => {
      observed.push({ action: "update", id, input });
      if (forceStaleUpdate) {
        current = { ...current, homeScore: 1, awayScore: 0, version: current.version + 1 };
        throw new ApiRequestError("stale_score_version", 409, `/scores/manual/${id}`);
      }
      current = { ...current, homeScore: input.homeScore, awayScore: input.awayScore, status: input.status, version: current.version + 1 };
      return current;
    },
    confirmManualScore: async (id: string, input: any) => {
      observed.push({ action: "confirm", id, input });
      current = { ...current, finalResultConfirmed: true, version: current.version + 1 };
      return current;
    },
    correctManualScore: async (id: string, input: any) => {
      observed.push({ action: "correct", id, input });
      current = { ...current, homeScore: input.homeScore, awayScore: input.awayScore, version: current.version + 1 };
      return current;
    },
    reopenManualScore: async (id: string, input: any) => {
      observed.push({ action: "reopen", id, input });
      current = { ...current, status: "live", finalResultConfirmed: false, version: current.version + 1 };
      return current;
    }
  });
  const originalConfirm = dom.window.confirm;
  dom.window.confirm = () => true;
  try {
    render(<ManualScoreControlScreen accessToken="admin-token" isAdmin />);
    await waitFor(() => assert.equal((screen.getByLabelText("Sport") as HTMLSelectElement).options.length, 2));
    fireEvent.change(screen.getByLabelText("Sport"), { target: { value: "sport-football" } });
    await waitFor(() => assert.equal((screen.getByLabelText("Competition") as HTMLSelectElement).options.length, 2));
    fireEvent.change(screen.getByLabelText("Competition"), { target: { value: "competition-1" } });
    await waitFor(() => assert.equal((screen.getByLabelText("Fixture") as HTMLSelectElement).options.length, 2));
    fireEvent.change(screen.getByLabelText("Fixture"), { target: { value: fixture.id } });
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Start fixture" })));

    fireEvent.click(screen.getByRole("button", { name: "Start fixture" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Save score and status" })));
    fireEvent.change(screen.getByLabelText("Next status"), { target: { value: "ended" } });
    fireEvent.click(screen.getByRole("button", { name: "Save score and status" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Confirm final result" })));
    fireEvent.click(screen.getByRole("button", { name: "Confirm final result" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Correct result" })));

    fireEvent.change(screen.getByLabelText("Home score"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Verified correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Correct result" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Reopen result" })));

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review requested" } });
    fireEvent.click(screen.getByRole("button", { name: "Reopen result" }));
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Save score and status" })));
    forceStaleUpdate = true;
    fireEvent.click(screen.getByRole("button", { name: "Save score and status" }));
    await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /Another operator changed this score/));

    assert.deepEqual(observed.map(({ action, id, input }) => ({ action, id, version: input?.version })), [
      { action: "start", id: fixture.id, version: 0 },
      { action: "update", id: fixture.id, version: 1 },
      { action: "confirm", id: fixture.id, version: 2 },
      { action: "correct", id: fixture.id, version: 3 },
      { action: "reopen", id: fixture.id, version: 4 },
      { action: "update", id: fixture.id, version: 5 }
    ]);
    assert.equal(observed[3]?.input?.reason, "Verified correction");
    assert.equal(observed[4]?.input?.reason, "Review requested");
    assert.ok(screen.getByText("6"), "the stale response must refresh the displayed version");
  } finally {
    dom.window.confirm = originalConfirm;
    cleanup();
    Object.assign(apiClient, originalMethods);
  }
});

test.after(() => { cleanup(); dom.window.close(); });
