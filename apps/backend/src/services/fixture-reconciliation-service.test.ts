import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { FixtureReconciliationService, type SchedulingMatchRow } from "./fixture-reconciliation-service.js";
import { applyHighConfidenceLinks, createHighConfidenceLink } from "../repositories/scheduling-match-links-repository.js";

function createDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE scheduling_matches (
      id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, season_id TEXT, home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL, kickoff_time TEXT NOT NULL, venue_name TEXT, external_provider TEXT,
      external_match_id TEXT
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, season_id TEXT, home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL, starts_at TEXT NOT NULL, venue_name TEXT, external_provider TEXT,
      external_match_id TEXT
    );
    CREATE TABLE scheduling_match_links (
      scheduling_match_id TEXT PRIMARY KEY, match_id TEXT NOT NULL UNIQUE,
      link_status TEXT NOT NULL, confidence TEXT NOT NULL, linked_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function legacy(overrides: Partial<SchedulingMatchRow> = {}): SchedulingMatchRow {
  return {
    id: "scheduled-1", competition_id: "competition-1", season_id: "season-1", home_team_id: "team-home",
    away_team_id: "team-away", kickoff_time: "2026-08-20T15:00:00.000Z", venue_name: "Arena",
    external_provider: null, external_match_id: null, ...overrides
  };
}

function canonical(database: Database, overrides: Partial<SchedulingMatchRow> = {}) {
  const row = legacy({ id: "ignored", ...overrides });
  database.prepare(`INSERT INTO matches (id, competition_id, season_id, home_team_id, away_team_id, starts_at, venue_name, external_provider, external_match_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    overrides.id ?? "match-1", row.competition_id, row.season_id, row.home_team_id, row.away_team_id, row.kickoff_time, row.venue_name, row.external_provider, row.external_match_id
  );
}

test("external provider identity links with high confidence", () => {
  const database = createDatabase();
  canonical(database, { external_provider: "provider-a", external_match_id: "event-1" });
  const decision = new FixtureReconciliationService(database).reconcile(legacy({ external_provider: "PROVIDER-A", external_match_id: "event-1" }));
  assert.equal(decision.linkStatus, "linked");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.selectedMatchId, "match-1");
  assert.match(decision.reasons[0]!, /external provider identity/);
});

test("exact catalog identity links only inside the high-confidence kickoff window", () => {
  const database = createDatabase();
  canonical(database);
  const decision = new FixtureReconciliationService(database).reconcile(legacy({ venue_name: "arena" }));
  assert.equal(decision.linkStatus, "linked");
  assert.equal(decision.confidence, "high");
  assert.ok(decision.reasons.some((reason) => reason === "same venue"));
});

test("kickoff mismatch, wrong competition, reversed teams, and postponed fixtures remain unresolved", () => {
  const database = createDatabase();
  canonical(database);
  const service = new FixtureReconciliationService(database);
  assert.equal(service.reconcile(legacy({ kickoff_time: "2026-08-20T18:01:00.000Z" })).linkStatus, "unresolved");
  assert.equal(service.reconcile(legacy({ competition_id: "competition-2" })).linkStatus, "unresolved");
  assert.equal(service.reconcile(legacy({ home_team_id: "team-away", away_team_id: "team-home" })).linkStatus, "unresolved");
  assert.equal(service.reconcile(legacy({ season_id: "season-2" })).linkStatus, "unresolved");
});

test("multiple candidates are ambiguous and preview does not mutate links", () => {
  const database = createDatabase();
  canonical(database, { id: "match-1" });
  canonical(database, { id: "match-2", kickoff_time: "2026-08-20T15:05:00.000Z" });
  const preview = new FixtureReconciliationService(database).preview([legacy()]);
  assert.equal(preview.decisions[0]!.linkStatus, "ambiguous");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM scheduling_match_links").get().count, 0);
});

test("link repository applies only high-confidence decisions and preserves existing links", () => {
  const database = createDatabase();
  const service = new FixtureReconciliationService(database);
  canonical(database);
  const decision = service.reconcile(legacy());
  const result = applyHighConfidenceLinks([decision], database);
  assert.equal(result.applied.length, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM scheduling_match_links").get().count, 1);
  assert.throws(() => createHighConfidenceLink(decision, database), /link_exists/);
  const skipped = applyHighConfidenceLinks([{ ...decision, schedulingMatchId: "scheduled-2", confidence: "medium", linkStatus: "unresolved", selectedMatchId: undefined }], database);
  assert.equal(skipped.applied.length, 0);
  assert.equal(skipped.skipped.length, 1);
});
