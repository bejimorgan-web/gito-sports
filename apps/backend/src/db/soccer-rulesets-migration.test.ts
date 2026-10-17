import assert from "node:assert/strict";
import test from "node:test";
import { allowSqliteInstantiation, DatabaseSync } from "./sqlite.js";
import { soccerRulesetsMigration } from "./soccer-rulesets-migration.js";

test("soccer ruleset migration creates versioned defaults, immutable season pins, and qualification audit guards", () => {
  allowSqliteInstantiation(() => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`PRAGMA foreign_keys = ON;
        CREATE TABLE operator_users (id TEXT PRIMARY KEY);
        CREATE TABLE sports (id TEXT PRIMARY KEY);
        CREATE TABLE competitions (id TEXT PRIMARY KEY, sport_id TEXT NOT NULL REFERENCES sports(id));
        CREATE TABLE seasons (id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES competitions(id), UNIQUE (competition_id, id));
        CREATE TABLE teams (id TEXT PRIMARY KEY);
        CREATE TABLE standings_snapshots (id TEXT PRIMARY KEY, competition_id TEXT, season_id TEXT, content_hash TEXT, is_complete INTEGER);
        CREATE TABLE standings_coverage_assessments (snapshot_id TEXT, eligibility_state TEXT, schedule_state TEXT, is_finalized INTEGER);
      `);
      assert.doesNotThrow(() => db.exec(soccerRulesetsMigration.sql));
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 8);
      for (const table of ["competition_soccer_rulesets", "season_soccer_rulesets", "soccer_qualification_routes", "soccer_qualification_decisions"]) {
        assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
      }
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_qualification_decision_confirm_guard'").get());
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_qualification_decision_no_direct_confirm'").get());
      db.prepare("INSERT INTO sports(id) VALUES ('soccer')").run();
      db.prepare("INSERT INTO competitions(id, sport_id) VALUES ('source', 'soccer'), ('destination', 'soccer')").run();
      db.prepare("INSERT INTO seasons(id, competition_id) VALUES ('source-season', 'source'), ('destination-season', 'destination')").run();
      assert.throws(() => db.prepare("INSERT INTO soccer_qualification_routes (id,source_competition_id,source_season_id,destination_competition_id,destination_season_id,destination_stage_id,route_json,status,proposed_by_operator_id,proposed_at) VALUES ('invalid','source','missing','destination','destination-season','entry','{}','pending','operator','now')").run(), /FOREIGN KEY/);
    } finally { db.close(); }
  });
});
