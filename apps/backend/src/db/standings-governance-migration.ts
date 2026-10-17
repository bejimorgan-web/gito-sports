import type { SqlMigration } from "./migration-runner.js";

export const standingsGovernanceMigration: SqlMigration = {
  version: 6,
  name: "standings-ruleset-approval-and-schedule-provenance",
  sql: `
    CREATE TABLE standings_rulesets (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      ruleset_id TEXT NOT NULL,
      ruleset_version INTEGER NOT NULL CHECK (ruleset_version > 0),
      ruleset_json TEXT NOT NULL,
      ruleset_hash TEXT NOT NULL CHECK (length(ruleset_hash) = 64),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      proposed_by_operator_id TEXT NOT NULL,
      proposed_at TEXT NOT NULL,
      approved_by_operator_id TEXT,
      approved_at TEXT,
      UNIQUE (competition_id, season_id, ruleset_id, ruleset_version),
      UNIQUE (id, competition_id, season_id),
      CHECK (
        (status = 'pending' AND approved_by_operator_id IS NULL AND approved_at IS NULL)
        OR (status = 'approved' AND approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL
            AND approved_by_operator_id <> proposed_by_operator_id)
      ),
      FOREIGN KEY (competition_id, season_id) REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (proposed_by_operator_id) REFERENCES operator_users(id) ON DELETE RESTRICT,
      FOREIGN KEY (approved_by_operator_id) REFERENCES operator_users(id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_ruleset_no_update
    BEFORE UPDATE ON standings_rulesets
    WHEN OLD.status = 'approved'
      OR NEW.id IS NOT OLD.id
      OR NEW.competition_id IS NOT OLD.competition_id
      OR NEW.season_id IS NOT OLD.season_id
      OR NEW.ruleset_id IS NOT OLD.ruleset_id
      OR NEW.ruleset_version IS NOT OLD.ruleset_version
      OR NEW.ruleset_json IS NOT OLD.ruleset_json
      OR NEW.ruleset_hash IS NOT OLD.ruleset_hash
      OR NEW.proposed_by_operator_id IS NOT OLD.proposed_by_operator_id
      OR NEW.proposed_at IS NOT OLD.proposed_at
      OR NEW.status <> 'approved'
      OR NEW.approved_by_operator_id = OLD.proposed_by_operator_id
      OR NEW.approved_at IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'approved rulesets are immutable and require a different administrator to approve');
    END;

    CREATE TRIGGER trg_standings_ruleset_proposal_only
    BEFORE INSERT ON standings_rulesets
    WHEN NEW.status <> 'pending' OR NEW.approved_by_operator_id IS NOT NULL OR NEW.approved_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'rulesets must be proposed as pending before a second administrator can approve them');
    END;

    CREATE TRIGGER trg_standings_ruleset_no_delete
    BEFORE DELETE ON standings_rulesets
    BEGIN
      SELECT RAISE(ABORT, 'standings rulesets are immutable');
    END;

    ALTER TABLE standings_schedule_manifests ADD COLUMN source_name TEXT;
    ALTER TABLE standings_schedule_manifests ADD COLUMN source_reference TEXT;

  `
};
