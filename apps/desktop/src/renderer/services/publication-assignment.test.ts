import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalFixtureRequiredError,
  PublicationWorkflowError,
  resolveOrCreatePublicationMatchId,
  resolvePublicationMatchId
} from "./publication-artifact";
import { filterPublicationCompetitions, filterPublicationHosts, isPublicationFixtureValid } from "../features/broadcast/BroadcastConsoleScreen";

test("uses the supplied canonical fixture ID exactly", () => {
  assert.equal(resolvePublicationMatchId({ canonicalFixtureId: "fixture-real-1" }), "fixture-real-1");
});

test("preserves an explicit existing matchId when no canonicalFixtureId is supplied", () => {
  assert.equal(resolvePublicationMatchId({ matchId: "match-existing-1" }), "match-existing-1");
});

test("creates one canonical fixture and reuses its returned ID when none is selected", async () => {
  const calls: unknown[] = [];
  const matchId = await resolveOrCreatePublicationMatchId({
    competitionId: "competition-1",
    homeTeamId: "team-1",
    awayTeamId: "team-2",
    startsAt: "2026-09-20T15:00:00Z"
  }, async (fixture) => {
    calls.push(fixture);
    return { id: "fixture-created-1" };
  });

  assert.equal(matchId, "fixture-created-1");
  assert.deepEqual(calls, [{ competitionId: "competition-1", homeTeamId: "team-1", awayTeamId: "team-2", startsAt: "2026-09-20T15:00:00Z" }]);
});

test("does not create or duplicate when a canonical fixture is selected", async () => {
  let createCalls = 0;
  const matchId = await resolveOrCreatePublicationMatchId({ canonicalFixtureId: "fixture-existing-1" }, async () => {
    createCalls += 1;
    return { id: "unexpected" };
  });

  assert.equal(matchId, "fixture-existing-1");
  assert.equal(createCalls, 0);
});

test("rejects a missing canonical fixture before publication work can begin", () => {
  let randomUuidCalls = 0;
  const originalRandomUuid = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = (() => {
    randomUuidCalls += 1;
    return "00000000-0000-0000-0000-000000000000";
  }) as typeof globalThis.crypto.randomUUID;

  try {
    assert.throws(
      () => resolvePublicationMatchId({}),
      (error: unknown) => error instanceof CanonicalFixtureRequiredError && error.code === "canonical_fixture_required"
    );
    assert.equal(randomUuidCalls, 0);
  } finally {
    globalThis.crypto.randomUUID = originalRandomUuid;
  }
});

test("keeps publication creation and bind failures distinguishable", () => {
  const fixtureCreation = new PublicationWorkflowError("fixture_creation", new Error("fixture_duplicate"));
  const creation = new PublicationWorkflowError("creation", new Error("publication_match_not_found"));
  const bind = new PublicationWorkflowError("bind", new Error("publication_match_conflict"));
  const approval = new PublicationWorkflowError("approval", new Error("publication_approval_rejected"));
  const publish = new PublicationWorkflowError("publish", new Error("publication_status_transition_invalid"));

  assert.equal(fixtureCreation.stage, "fixture_creation");
  assert.match(fixtureCreation.message, /fixture_duplicate/);
  assert.equal(creation.stage, "creation");
  assert.match(creation.message, /publication_match_not_found/);
  assert.equal(bind.stage, "bind");
  assert.match(bind.message, /publication_match_conflict/);
  assert.equal(approval.stage, "approval");
  assert.equal(publish.stage, "publish");
});

test("publication hierarchy filters hosts, competitions, teams, and stale fixtures", () => {
  const hosts = [{ id: "host-a", sportId: "sport-a" }, { id: "host-b", sportId: "sport-b" }] as any;
  const competitions = [{ id: "competition-a", sportId: "sport-a", hostId: "host-a" }, { id: "competition-b", sportId: "sport-a", hostId: "host-b" }] as any;
  const teams = [{ id: "team-home" }, { id: "team-away" }] as any;
  const fixture = { id: "fixture-a", sport: { id: "sport-a" }, competitionId: "competition-a", homeTeamId: "team-home", awayTeamId: "team-away", homeTeam: { hostId: "host-a" }, awayTeam: { hostId: "host-a" } };

  assert.deepEqual(filterPublicationHosts(hosts, "sport-a").map((host) => host.id), ["host-a"]);
  assert.deepEqual(filterPublicationCompetitions(competitions, "sport-a", "host-a").map((competition) => competition.id), ["competition-a"]);
  assert.equal(isPublicationFixtureValid(fixture, { sportId: "sport-a", hostId: "host-a", competitionId: "competition-a", competitionTeams: teams }), true);
  assert.equal(isPublicationFixtureValid(fixture, { sportId: "sport-b", hostId: "host-a", competitionId: "competition-a", competitionTeams: teams }), false);
  assert.equal(isPublicationFixtureValid(fixture, { sportId: "sport-a", hostId: "host-a", competitionId: "competition-b", competitionTeams: teams }), false);
});
