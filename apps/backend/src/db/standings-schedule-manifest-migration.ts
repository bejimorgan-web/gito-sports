import type { SqlMigration } from "./migration-runner.js";

export const standingsScheduleManifestMigration: SqlMigration = {
  version: 5,
  name: "versioned-standings-schedule-completeness-manifests",
  sql: `
    CREATE TABLE standings_schedule_manifests (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'finalized')),
      supersedes_manifest_id TEXT,
      content_hash TEXT,
      created_at TEXT NOT NULL,
      finalized_at TEXT,
      UNIQUE (competition_id, season_id, version),
      UNIQUE (id, competition_id, season_id),
      CHECK (
        (state = 'draft' AND finalized_at IS NULL AND content_hash IS NULL)
        OR (state = 'finalized' AND finalized_at IS NOT NULL AND length(content_hash) = 64)
      ),
      CHECK (supersedes_manifest_id IS NULL OR supersedes_manifest_id <> id),
      FOREIGN KEY (competition_id, season_id)
        REFERENCES seasons(competition_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (supersedes_manifest_id, competition_id, season_id)
        REFERENCES standings_schedule_manifests(id, competition_id, season_id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX idx_standings_schedule_one_draft
      ON standings_schedule_manifests(competition_id, season_id)
      WHERE state = 'draft';

    CREATE TABLE standings_schedule_manifest_fixtures (
      manifest_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      fixture_key TEXT NOT NULL CHECK (length(trim(fixture_key)) > 0),
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      match_id TEXT,
      PRIMARY KEY (manifest_id, fixture_key),
      UNIQUE (manifest_id, match_id),
      CHECK (home_team_id <> away_team_id),
      FOREIGN KEY (manifest_id, competition_id, season_id)
        REFERENCES standings_schedule_manifests(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_schedule_manifest_version
    BEFORE INSERT ON standings_schedule_manifests
    BEGIN
      SELECT CASE
        WHEN NEW.version <> COALESCE(
          (SELECT MAX(version) + 1 FROM standings_schedule_manifests
           WHERE competition_id = NEW.competition_id AND season_id = NEW.season_id),
          1
        )
        THEN RAISE(ABORT, 'schedule manifest version must be the next version for its competition and season')
      END;
      SELECT CASE
        WHEN NEW.version = 1 AND NEW.supersedes_manifest_id IS NOT NULL
        THEN RAISE(ABORT, 'first schedule manifest cannot supersede another version')
        WHEN NEW.version > 1 AND NOT EXISTS (
          SELECT 1 FROM standings_schedule_manifests previous
          WHERE previous.id = NEW.supersedes_manifest_id
            AND previous.competition_id = NEW.competition_id
            AND previous.season_id = NEW.season_id
            AND previous.version = NEW.version - 1
            AND previous.state = 'finalized'
        )
        THEN RAISE(ABORT, 'schedule manifest must supersede the immediately previous finalized version')
      END;
    END;

    CREATE TRIGGER trg_standings_schedule_fixture_insert
    BEFORE INSERT ON standings_schedule_manifest_fixtures
    BEGIN
      SELECT CASE
        WHEN (SELECT state FROM standings_schedule_manifests WHERE id = NEW.manifest_id) <> 'draft'
        THEN RAISE(ABORT, 'schedule manifest fixtures can only be added to a draft')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM standings_schedule_manifests
          WHERE id = NEW.manifest_id
            AND competition_id = NEW.competition_id
            AND season_id = NEW.season_id
        )
        THEN RAISE(ABORT, 'schedule fixture context must match its manifest')
      END;
    END;

    CREATE TRIGGER trg_standings_schedule_fixture_update
    BEFORE UPDATE ON standings_schedule_manifest_fixtures
    WHEN (SELECT state FROM standings_schedule_manifests WHERE id = OLD.manifest_id) <> 'draft'
      OR (SELECT state FROM standings_schedule_manifests WHERE id = NEW.manifest_id) <> 'draft'
    BEGIN
      SELECT RAISE(ABORT, 'finalized schedule manifest fixtures are immutable');
    END;

    CREATE TRIGGER trg_standings_schedule_fixture_delete
    BEFORE DELETE ON standings_schedule_manifest_fixtures
    WHEN (SELECT state FROM standings_schedule_manifests WHERE id = OLD.manifest_id) <> 'draft'
    BEGIN
      SELECT RAISE(ABORT, 'finalized schedule manifest fixtures are immutable');
    END;

    CREATE TRIGGER trg_standings_schedule_manifest_finalize
    BEFORE UPDATE ON standings_schedule_manifests
    WHEN OLD.state = 'draft'
    BEGIN
      SELECT CASE
        WHEN NEW.state <> 'finalized'
          OR NEW.id IS NOT OLD.id
          OR NEW.competition_id IS NOT OLD.competition_id
          OR NEW.season_id IS NOT OLD.season_id
          OR NEW.version IS NOT OLD.version
          OR NEW.supersedes_manifest_id IS NOT OLD.supersedes_manifest_id
          OR NEW.created_at IS NOT OLD.created_at
          OR NEW.finalized_at IS NULL
          OR length(NEW.content_hash) <> 64
        THEN RAISE(ABORT, 'schedule manifest metadata is immutable except for finalization')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM standings_schedule_manifest_fixtures
          WHERE manifest_id = NEW.id
        )
        THEN RAISE(ABORT, 'schedule manifest cannot be finalized without expected fixtures')
      END;
    END;

    CREATE TRIGGER trg_standings_schedule_manifest_no_update
    BEFORE UPDATE ON standings_schedule_manifests
    WHEN OLD.state = 'finalized'
    BEGIN
      SELECT RAISE(ABORT, 'finalized schedule manifests are immutable; create a new version');
    END;

    CREATE TRIGGER trg_standings_schedule_manifest_no_delete
    BEFORE DELETE ON standings_schedule_manifests
    BEGIN
      SELECT RAISE(ABORT, 'schedule manifests are immutable');
    END;

    CREATE TABLE standings_coverage_manifest_fixtures (
      assessment_id TEXT NOT NULL,
      manifest_id TEXT NOT NULL,
      fixture_key TEXT NOT NULL,
      canonical_match_id TEXT,
      coverage_state TEXT NOT NULL CHECK (
        coverage_state IN ('required_pending', 'required_covered', 'explicitly_excluded', 'unresolved_ambiguous')
      ),
      selected_revision_id TEXT,
      reason_code TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (assessment_id, fixture_key),
      CHECK (
        (coverage_state = 'required_covered' AND selected_revision_id IS NOT NULL AND canonical_match_id IS NOT NULL)
        OR coverage_state <> 'required_covered'
      ),
      FOREIGN KEY (assessment_id) REFERENCES standings_coverage_assessments(id) ON DELETE RESTRICT,
      FOREIGN KEY (manifest_id, fixture_key)
        REFERENCES standings_schedule_manifest_fixtures(manifest_id, fixture_key) ON DELETE RESTRICT,
      FOREIGN KEY (canonical_match_id) REFERENCES matches(id) ON DELETE RESTRICT,
      FOREIGN KEY (canonical_match_id, selected_revision_id)
        REFERENCES match_result_revisions(match_id, id) ON DELETE RESTRICT
    );

    ALTER TABLE standings_coverage_assessments
      ADD COLUMN manifest_id TEXT REFERENCES standings_schedule_manifests(id) ON DELETE RESTRICT;
    ALTER TABLE standings_coverage_assessments
      ADD COLUMN schedule_state TEXT NOT NULL DEFAULT 'unverified'
      CHECK (schedule_state IN ('unverified', 'incomplete', 'invalid', 'verified_complete'));
    ALTER TABLE standings_coverage_assessments
      ADD COLUMN expected_manifest_fixture_count INTEGER NOT NULL DEFAULT 0
      CHECK (expected_manifest_fixture_count >= 0);

    CREATE TRIGGER trg_standings_coverage_manifest_context
    BEFORE INSERT ON standings_coverage_assessments
    WHEN NEW.manifest_id IS NOT NULL
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM standings_schedule_manifests
          WHERE id = NEW.manifest_id
            AND competition_id = NEW.competition_id
            AND season_id = NEW.season_id
            AND state = 'finalized'
        )
        THEN RAISE(ABORT, 'coverage requires a finalized schedule manifest in the same competition and season')
      END;
    END;

    CREATE TRIGGER trg_standings_coverage_manifest_fixtures_insert
    BEFORE INSERT ON standings_coverage_manifest_fixtures
    BEGIN
      SELECT CASE
        WHEN (SELECT is_finalized FROM standings_coverage_assessments WHERE id = NEW.assessment_id) <> 0
        THEN RAISE(ABORT, 'cannot add manifest decisions to a finalized coverage assessment')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM standings_coverage_assessments
          WHERE id = NEW.assessment_id AND manifest_id = NEW.manifest_id
        )
        THEN RAISE(ABORT, 'manifest decision must match its coverage assessment')
      END;
    END;

    CREATE TRIGGER trg_standings_coverage_manifest_fixtures_no_update
    BEFORE UPDATE ON standings_coverage_manifest_fixtures
    BEGIN
      SELECT RAISE(ABORT, 'coverage manifest decisions are immutable');
    END;

    CREATE TRIGGER trg_standings_coverage_manifest_fixtures_no_delete
    BEFORE DELETE ON standings_coverage_manifest_fixtures
    BEGIN
      SELECT RAISE(ABORT, 'coverage manifest decisions are immutable');
    END;

    CREATE TRIGGER trg_standings_coverage_manifest_finalize_count
    BEFORE UPDATE ON standings_coverage_assessments
    WHEN OLD.is_finalized = 0 AND NEW.is_finalized = 1
    BEGIN
      SELECT CASE
        WHEN NEW.expected_manifest_fixture_count <> (
          SELECT COUNT(*) FROM standings_coverage_manifest_fixtures
          WHERE assessment_id = NEW.id
        )
        THEN RAISE(ABORT, 'coverage assessment cannot finalize with missing manifest decisions')
      END;
    END;

    CREATE TRIGGER trg_standings_coverage_schedule_finalize
    BEFORE UPDATE ON standings_coverage_assessments
    WHEN OLD.is_finalized = 0 AND NEW.is_finalized = 1
    BEGIN
      SELECT CASE
        WHEN NEW.manifest_id IS NULL AND NEW.schedule_state <> 'unverified'
        THEN RAISE(ABORT, 'verified schedule coverage requires a selected finalized manifest')
      END;
      SELECT CASE
        WHEN NEW.schedule_state = 'verified_complete'
          AND (
            NOT EXISTS (
              SELECT 1 FROM standings_schedule_manifests
              WHERE id = NEW.manifest_id
                AND competition_id = NEW.competition_id
                AND season_id = NEW.season_id
                AND state = 'finalized'
            )
            OR EXISTS (
              SELECT 1 FROM standings_schedule_manifest_fixtures expected
              LEFT JOIN matches canonical ON canonical.id = expected.match_id
              WHERE expected.manifest_id = NEW.manifest_id
                AND (
                  expected.match_id IS NULL
                  OR canonical.competition_id IS NOT NEW.competition_id
                  OR canonical.season_id IS NOT NEW.season_id
                  OR canonical.home_team_id IS NOT expected.home_team_id
                  OR canonical.away_team_id IS NOT expected.away_team_id
                )
            )
            OR EXISTS (
              SELECT 1 FROM matches canonical
              WHERE canonical.competition_id = NEW.competition_id
                AND canonical.season_id = NEW.season_id
                AND NOT EXISTS (
                  SELECT 1 FROM standings_schedule_manifest_fixtures expected
                  WHERE expected.manifest_id = NEW.manifest_id
                    AND expected.match_id = canonical.id
                )
            )
          )
        THEN RAISE(ABORT, 'schedule cannot be verified until manifest entries exactly match canonical fixtures')
      END;
      SELECT CASE
        WHEN NEW.eligibility_state = 'eligible'
          AND (
            NEW.manifest_id IS NULL
            OR NEW.schedule_state <> 'verified_complete'
            OR NEW.blocking_reasons_json <> '[]'
            OR EXISTS (
              SELECT 1 FROM standings_coverage_fixtures
              WHERE assessment_id = NEW.id
                AND coverage_state NOT IN ('required_covered', 'explicitly_excluded')
            )
            OR EXISTS (
              SELECT 1 FROM standings_coverage_manifest_fixtures
              WHERE assessment_id = NEW.id
                AND coverage_state NOT IN ('required_covered', 'explicitly_excluded')
            )
          )
        THEN RAISE(ABORT, 'eligible coverage requires complete schedule and covered or permitted excluded fixtures')
      END;
    END;

    CREATE TRIGGER trg_standings_coverage_manifest_metadata_finalize
    BEFORE UPDATE ON standings_coverage_assessments
    WHEN OLD.is_finalized = 0
    BEGIN
      SELECT CASE
        WHEN NEW.is_finalized <> 1
          OR NEW.manifest_id IS NOT OLD.manifest_id
          OR NEW.schedule_state IS NOT OLD.schedule_state
          OR NEW.expected_manifest_fixture_count IS NOT OLD.expected_manifest_fixture_count
        THEN RAISE(ABORT, 'coverage manifest metadata is immutable except for finalization')
      END;
    END;
  `
};
