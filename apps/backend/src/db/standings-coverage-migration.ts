import type { SqlMigration } from "./migration-runner.js";

export const standingsCoverageMigration: SqlMigration = {
  version: 4,
  name: "standings-fixture-coverage-assessments",
  sql: `
    CREATE TABLE standings_coverage_assessments (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK (scope_type = 'competition_season'),
      snapshot_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      policy_json TEXT NOT NULL,
      eligibility_state TEXT NOT NULL CHECK (eligibility_state IN ('eligible', 'ineligible')),
      blocking_reasons_json TEXT NOT NULL,
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      content_json TEXT NOT NULL,
      assessed_at TEXT NOT NULL,
      expected_fixture_count INTEGER NOT NULL CHECK (expected_fixture_count >= 0),
      is_finalized INTEGER NOT NULL DEFAULT 0 CHECK (is_finalized IN (0, 1)),
      UNIQUE (snapshot_id, sequence),
      UNIQUE (id, competition_id, season_id),
      FOREIGN KEY (competition_id, season_id)
        REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (snapshot_id, competition_id, season_id)
        REFERENCES standings_snapshots(id, competition_id, season_id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_coverage_assessments_snapshot
    BEFORE INSERT ON standings_coverage_assessments
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM standings_snapshots
          WHERE id = NEW.snapshot_id
            AND competition_id = NEW.competition_id
            AND season_id = NEW.season_id
            AND is_complete = 1
        )
        THEN RAISE(ABORT, 'coverage assessments require a finalized snapshot in the same competition and season')
      END;
      SELECT CASE
        WHEN NEW.sequence <> COALESCE(
          (SELECT MAX(sequence) + 1 FROM standings_coverage_assessments
           WHERE snapshot_id = NEW.snapshot_id),
          1
        )
        THEN RAISE(ABORT, 'coverage assessment sequence must be the next sequence for its snapshot')
      END;
    END;

    CREATE TABLE standings_coverage_fixtures (
      assessment_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      fixture_status TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      participant_assignments_json TEXT NOT NULL,
      coverage_state TEXT NOT NULL CHECK (
        coverage_state IN ('required_pending', 'required_covered', 'explicitly_excluded', 'unresolved_ambiguous')
      ),
      selected_revision_id TEXT,
      reason_code TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (assessment_id, match_id),
      CHECK (
        (coverage_state = 'required_covered' AND selected_revision_id IS NOT NULL)
        OR coverage_state <> 'required_covered'
      ),
      FOREIGN KEY (assessment_id, competition_id, season_id)
        REFERENCES standings_coverage_assessments(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (match_id, competition_id, season_id)
        REFERENCES matches(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (match_id, selected_revision_id)
        REFERENCES match_result_revisions(match_id, id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_coverage_fixtures_insert
    BEFORE INSERT ON standings_coverage_fixtures
    WHEN (SELECT is_finalized FROM standings_coverage_assessments WHERE id = NEW.assessment_id) <> 0
    BEGIN
      SELECT RAISE(ABORT, 'cannot add fixture decisions to a finalized coverage assessment');
    END;

    CREATE TRIGGER trg_standings_coverage_fixtures_no_update
    BEFORE UPDATE ON standings_coverage_fixtures
    BEGIN
      SELECT RAISE(ABORT, 'coverage fixture decisions are immutable');
    END;

    CREATE TRIGGER trg_standings_coverage_fixtures_no_delete
    BEFORE DELETE ON standings_coverage_fixtures
    BEGIN
      SELECT RAISE(ABORT, 'coverage fixture decisions are immutable');
    END;

    CREATE TRIGGER trg_standings_coverage_assessments_finalize
    BEFORE UPDATE ON standings_coverage_assessments
    WHEN OLD.is_finalized = 0
    BEGIN
      SELECT CASE
        WHEN NEW.is_finalized <> 1
          OR NEW.id IS NOT OLD.id
          OR NEW.competition_id IS NOT OLD.competition_id
          OR NEW.season_id IS NOT OLD.season_id
          OR NEW.scope_type IS NOT OLD.scope_type
          OR NEW.snapshot_id IS NOT OLD.snapshot_id
          OR NEW.sequence IS NOT OLD.sequence
          OR NEW.policy_json IS NOT OLD.policy_json
          OR NEW.eligibility_state IS NOT OLD.eligibility_state
          OR NEW.blocking_reasons_json IS NOT OLD.blocking_reasons_json
          OR NEW.content_hash IS NOT OLD.content_hash
          OR NEW.content_json IS NOT OLD.content_json
          OR NEW.assessed_at IS NOT OLD.assessed_at
          OR NEW.expected_fixture_count IS NOT OLD.expected_fixture_count
        THEN RAISE(ABORT, 'coverage assessment metadata is immutable; only finalization is allowed')
      END;
      SELECT CASE
        WHEN NEW.expected_fixture_count <> (
          SELECT COUNT(*) FROM standings_coverage_fixtures WHERE assessment_id = NEW.id
        )
        THEN RAISE(ABORT, 'coverage assessment cannot finalize with missing fixture decisions')
      END;
    END;

    CREATE TRIGGER trg_standings_coverage_assessments_no_update
    BEFORE UPDATE ON standings_coverage_assessments
    WHEN OLD.is_finalized = 1
    BEGIN
      SELECT RAISE(ABORT, 'finalized coverage assessments are immutable; create a new assessment');
    END;

    CREATE TRIGGER trg_standings_coverage_assessments_no_delete
    BEFORE DELETE ON standings_coverage_assessments
    BEGIN
      SELECT RAISE(ABORT, 'coverage assessments are immutable');
    END;
  `
};
