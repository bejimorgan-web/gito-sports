import type { SqlMigration } from "./migration-runner.js";

export const soccerRulesetsMigration: SqlMigration = {
  version: 8,
  name: "soccer-competition-rulesets-seasons-and-qualification",
  sql: `
    ALTER TABLE competitions ADD COLUMN default_soccer_ruleset_id TEXT;
    ALTER TABLE competitions ADD COLUMN default_soccer_format_id TEXT;

    CREATE TABLE competition_soccer_rulesets (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL CHECK (version > 0),
      format_template_id TEXT NOT NULL CHECK (format_template_id IN (
        'domestic_league', 'league_phase_knockout', 'groups_only', 'groups_knockout',
        'single_match_knockout', 'two_legged_knockout', 'league_playoffs', 'custom_multi_stage'
      )),
      ruleset_json TEXT NOT NULL,
      ruleset_hash TEXT NOT NULL CHECK (length(ruleset_hash) = 64),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      proposed_by_operator_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
      proposed_at TEXT NOT NULL,
      approved_by_operator_id TEXT REFERENCES operator_users(id) ON DELETE RESTRICT,
      approved_at TEXT,
      UNIQUE (competition_id, version),
      UNIQUE (id, competition_id),
      CHECK ((status = 'pending' AND approved_by_operator_id IS NULL AND approved_at IS NULL)
        OR (status = 'approved' AND approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL
          AND approved_by_operator_id <> proposed_by_operator_id))
    );

    CREATE TABLE season_soccer_rulesets (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      source_ruleset_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      format_template_id TEXT NOT NULL,
      ruleset_json TEXT NOT NULL,
      ruleset_hash TEXT NOT NULL CHECK (length(ruleset_hash) = 64),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      proposed_by_operator_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
      proposed_at TEXT NOT NULL,
      approved_by_operator_id TEXT REFERENCES operator_users(id) ON DELETE RESTRICT,
      approved_at TEXT,
      UNIQUE (competition_id, season_id, version),
      UNIQUE (id, competition_id, season_id),
      FOREIGN KEY (competition_id, season_id) REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (source_ruleset_id, competition_id) REFERENCES competition_soccer_rulesets(id, competition_id) ON DELETE RESTRICT,
      CHECK ((status = 'pending' AND approved_by_operator_id IS NULL AND approved_at IS NULL)
        OR (status = 'approved' AND approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL
          AND approved_by_operator_id <> proposed_by_operator_id))
    );

    CREATE TABLE soccer_qualification_routes (
      id TEXT PRIMARY KEY,
      source_competition_id TEXT NOT NULL,
      source_season_id TEXT NOT NULL,
      destination_competition_id TEXT NOT NULL,
      destination_season_id TEXT NOT NULL,
      destination_stage_id TEXT NOT NULL,
      route_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      proposed_by_operator_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE RESTRICT,
      proposed_at TEXT NOT NULL,
      approved_by_operator_id TEXT REFERENCES operator_users(id) ON DELETE RESTRICT,
      approved_at TEXT,
      FOREIGN KEY (source_competition_id, source_season_id) REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (destination_competition_id, destination_season_id) REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      CHECK ((status = 'pending' AND approved_by_operator_id IS NULL AND approved_at IS NULL)
        OR (status = 'approved' AND approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL
          AND approved_by_operator_id <> proposed_by_operator_id))
    );

    CREATE TABLE soccer_qualification_decisions (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL REFERENCES soccer_qualification_routes(id) ON DELETE RESTRICT,
      source_snapshot_id TEXT NOT NULL REFERENCES standings_snapshots(id) ON DELETE RESTRICT,
      source_ruleset_hash TEXT NOT NULL CHECK (length(source_ruleset_hash) = 64),
      slot_number INTEGER NOT NULL CHECK (slot_number > 0),
      team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
      state TEXT NOT NULL CHECK (state IN ('provisional', 'confirmed', 'rejected', 'vacant')),
      decision_json TEXT NOT NULL,
      decided_by_operator_id TEXT REFERENCES operator_users(id) ON DELETE RESTRICT,
      decided_at TEXT,
      UNIQUE (route_id, slot_number),
      CHECK ((state = 'confirmed' AND decided_by_operator_id IS NOT NULL AND decided_at IS NOT NULL)
        OR state <> 'confirmed'),
      CHECK ((state = 'vacant' AND team_id IS NULL) OR (state <> 'vacant' AND team_id IS NOT NULL))
    );

    CREATE TRIGGER trg_competition_soccer_ruleset_immutable
    BEFORE UPDATE ON competition_soccer_rulesets
    WHEN OLD.status = 'approved' OR NEW.id IS NOT OLD.id OR NEW.competition_id IS NOT OLD.competition_id
      OR NEW.version IS NOT OLD.version OR NEW.format_template_id IS NOT OLD.format_template_id
      OR NEW.ruleset_json IS NOT OLD.ruleset_json OR NEW.ruleset_hash IS NOT OLD.ruleset_hash
      OR NEW.proposed_by_operator_id IS NOT OLD.proposed_by_operator_id OR NEW.proposed_at IS NOT OLD.proposed_at
      OR NEW.status <> 'approved' OR NEW.approved_by_operator_id = OLD.proposed_by_operator_id OR NEW.approved_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'approved competition rulesets are immutable and require a second administrator'); END;
    CREATE TRIGGER trg_competition_soccer_ruleset_proposal_only
    BEFORE INSERT ON competition_soccer_rulesets WHEN NEW.status <> 'pending' OR NEW.approved_by_operator_id IS NOT NULL OR NEW.approved_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'competition rulesets must be proposed as pending'); END;
    CREATE TRIGGER trg_competition_soccer_ruleset_no_delete
    BEFORE DELETE ON competition_soccer_rulesets
    BEGIN SELECT RAISE(ABORT, 'competition ruleset history is immutable'); END;
    CREATE TRIGGER trg_season_soccer_ruleset_immutable
    BEFORE UPDATE ON season_soccer_rulesets
    WHEN OLD.status = 'approved' OR NEW.id IS NOT OLD.id OR NEW.competition_id IS NOT OLD.competition_id
      OR NEW.season_id IS NOT OLD.season_id OR NEW.source_ruleset_id IS NOT OLD.source_ruleset_id
      OR NEW.version IS NOT OLD.version OR NEW.format_template_id IS NOT OLD.format_template_id
      OR NEW.ruleset_json IS NOT OLD.ruleset_json OR NEW.ruleset_hash IS NOT OLD.ruleset_hash
      OR NEW.proposed_by_operator_id IS NOT OLD.proposed_by_operator_id OR NEW.proposed_at IS NOT OLD.proposed_at
      OR NEW.status <> 'approved' OR NEW.approved_by_operator_id = OLD.proposed_by_operator_id OR NEW.approved_at IS NULL
    BEGIN SELECT RAISE(ABORT, 'approved season rulesets are immutable and require a second administrator'); END;
    CREATE TRIGGER trg_season_soccer_ruleset_proposal_only
    BEFORE INSERT ON season_soccer_rulesets WHEN NEW.status <> 'pending' OR NEW.approved_by_operator_id IS NOT NULL OR NEW.approved_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'season rulesets must be proposed as pending'); END;
    CREATE TRIGGER trg_season_soccer_ruleset_no_delete
    BEFORE DELETE ON season_soccer_rulesets
    BEGIN SELECT RAISE(ABORT, 'season ruleset history is immutable'); END;
    CREATE TRIGGER trg_qualification_route_immutable
    BEFORE UPDATE ON soccer_qualification_routes WHEN OLD.status = 'approved'
    BEGIN SELECT RAISE(ABORT, 'approved qualification routes are immutable'); END;
    CREATE TRIGGER trg_qualification_route_proposal_only
    BEFORE INSERT ON soccer_qualification_routes WHEN NEW.status <> 'pending' OR NEW.approved_by_operator_id IS NOT NULL OR NEW.approved_at IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'qualification routes must be proposed as pending'); END;
    CREATE TRIGGER trg_qualification_route_no_delete
    BEFORE DELETE ON soccer_qualification_routes
    BEGIN SELECT RAISE(ABORT, 'qualification route history is immutable'); END;
    CREATE TRIGGER trg_qualification_decision_confirm_guard
    BEFORE UPDATE ON soccer_qualification_decisions WHEN NEW.state = 'confirmed' AND OLD.state <> 'confirmed'
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM soccer_qualification_routes r
        JOIN standings_snapshots s ON s.id = NEW.source_snapshot_id
        JOIN standings_coverage_assessments a ON a.snapshot_id = s.id
        WHERE r.id = NEW.route_id AND r.status = 'approved'
          AND s.competition_id = r.source_competition_id AND s.season_id = r.source_season_id
          AND s.content_hash IS NOT NULL AND s.is_complete = 1 AND a.eligibility_state = 'eligible' AND a.schedule_state = 'verified_complete'
          AND a.is_finalized = 1
          AND EXISTS (SELECT 1 FROM season_soccer_rulesets sr WHERE sr.competition_id = r.source_competition_id
            AND sr.season_id = r.source_season_id AND sr.status = 'approved' AND sr.ruleset_hash = NEW.source_ruleset_hash)
          AND r.proposed_by_operator_id <> NEW.decided_by_operator_id
      ) THEN RAISE(ABORT, 'qualification requires an approved route and complete eligible source snapshot') END;
    END;
    CREATE TRIGGER trg_qualification_decision_no_direct_confirm
    BEFORE INSERT ON soccer_qualification_decisions WHEN NEW.state = 'confirmed'
    BEGIN SELECT RAISE(ABORT, 'qualification decisions must be proposed before confirmation'); END;
    CREATE TRIGGER trg_qualification_decision_no_delete
    BEFORE DELETE ON soccer_qualification_decisions
    BEGIN SELECT RAISE(ABORT, 'qualification decisions are audited and cannot be deleted'); END;
    CREATE TRIGGER trg_qualification_final_decision_immutable
    BEFORE UPDATE ON soccer_qualification_decisions WHEN OLD.state IN ('confirmed', 'vacant', 'rejected')
    BEGIN SELECT RAISE(ABORT, 'final qualification decisions are immutable; create a separately audited amendment'); END;

    CREATE TRIGGER trg_competition_soccer_default_guard
    BEFORE UPDATE OF default_soccer_ruleset_id, default_soccer_format_id ON competitions
    WHEN NEW.default_soccer_ruleset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM competition_soccer_rulesets r WHERE r.id = NEW.default_soccer_ruleset_id
        AND r.competition_id = NEW.id AND r.status = 'approved' AND r.format_template_id = NEW.default_soccer_format_id
    )
    BEGIN SELECT RAISE(ABORT, 'competition default must reference its approved ruleset version'); END;

    PRAGMA user_version = 8;
  `
};
