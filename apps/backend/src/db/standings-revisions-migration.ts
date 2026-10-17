import type { SqlMigration } from "./migration-runner.js";

export const standingsRevisionsMigration: SqlMigration = {
  version: 3,
  name: "auditable-result-revisions-and-standings-snapshots",
  sql: `
    CREATE TABLE match_result_revisions (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL CHECK (revision_number > 0),
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score INTEGER NOT NULL CHECK (typeof(home_score) = 'integer' AND home_score >= 0),
      away_score INTEGER NOT NULL CHECK (typeof(away_score) = 'integer' AND away_score >= 0),
      result_status TEXT NOT NULL CHECK (
        result_status IN ('scheduled', 'live', 'paused', 'ended', 'cancelled', 'postponed')
      ),
      final_result_confirmed INTEGER NOT NULL CHECK (final_result_confirmed IN (0, 1)),
      validation_state TEXT NOT NULL CHECK (validation_state IN ('pending', 'accepted', 'rejected')),
      source_category TEXT CHECK (
        source_category IS NULL OR source_category IN ('manual_operator', 'provider', 'system')
      ),
      actor_operator_id TEXT,
      source_reference TEXT,
      supersedes_revision_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (match_id, revision_number),
      UNIQUE (match_id, id),
      CHECK (
        validation_state <> 'accepted'
        OR (result_status = 'ended' AND final_result_confirmed = 1)
      ),
      CHECK (supersedes_revision_id IS NULL OR supersedes_revision_id <> id),
      FOREIGN KEY (match_id, competition_id, season_id)
        REFERENCES matches(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (actor_operator_id) REFERENCES operator_users(id) ON DELETE RESTRICT,
      FOREIGN KEY (match_id, supersedes_revision_id)
        REFERENCES match_result_revisions(match_id, id) ON DELETE RESTRICT
    );

    CREATE INDEX idx_match_result_revisions_match_latest
      ON match_result_revisions(match_id, revision_number DESC);

    CREATE TRIGGER trg_match_result_revisions_order
    BEFORE INSERT ON match_result_revisions
    BEGIN
      SELECT CASE
        WHEN NEW.revision_number <> COALESCE(
          (SELECT MAX(revision_number) + 1 FROM match_result_revisions WHERE match_id = NEW.match_id),
          1
        )
        THEN RAISE(ABORT, 'result revision number must be the next revision for its match')
      END;
      SELECT CASE
        WHEN NEW.supersedes_revision_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM match_result_revisions
          WHERE match_id = NEW.match_id
            AND id = NEW.supersedes_revision_id
            AND revision_number = NEW.revision_number - 1
        )
        THEN RAISE(ABORT, 'superseded result must be the immediately previous revision')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM matches
          WHERE id = NEW.match_id
            AND competition_id = NEW.competition_id
            AND season_id = NEW.season_id
            AND home_team_id = NEW.home_team_id
            AND away_team_id = NEW.away_team_id
        )
        THEN RAISE(ABORT, 'result revision context and teams must match its fixture')
      END;
    END;

    CREATE TRIGGER trg_match_result_revisions_no_update
    BEFORE UPDATE ON match_result_revisions
    BEGIN
      SELECT RAISE(ABORT, 'result revisions are immutable; append a correction revision');
    END;

    CREATE TRIGGER trg_match_result_revisions_no_delete
    BEFORE DELETE ON match_result_revisions
    BEGIN
      SELECT RAISE(ABORT, 'result revisions are immutable');
    END;

    CREATE TABLE standings_snapshots (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      ruleset_id TEXT NOT NULL,
      ruleset_version INTEGER NOT NULL CHECK (ruleset_version > 0),
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      content_json TEXT NOT NULL,
      calculated_at TEXT NOT NULL,
      expected_result_count INTEGER NOT NULL CHECK (expected_result_count >= 0),
      expected_row_count INTEGER NOT NULL CHECK (expected_row_count >= 0),
      is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0, 1)),
      UNIQUE (competition_id, season_id, sequence),
      UNIQUE (id, competition_id, season_id),
      FOREIGN KEY (competition_id, season_id)
        REFERENCES seasons(competition_id, id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_snapshots_sequence
    BEFORE INSERT ON standings_snapshots
    BEGIN
      SELECT CASE
        WHEN NEW.sequence <> COALESCE(
          (SELECT MAX(sequence) + 1 FROM standings_snapshots
           WHERE competition_id = NEW.competition_id AND season_id = NEW.season_id),
          1
        )
        THEN RAISE(ABORT, 'standings snapshot sequence must be the next sequence for its competition and season')
      END;
    END;

    CREATE TABLE standings_snapshot_results (
      snapshot_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      match_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL CHECK (revision_number > 0),
      PRIMARY KEY (snapshot_id, match_id),
      UNIQUE (snapshot_id, revision_id),
      FOREIGN KEY (snapshot_id, competition_id, season_id)
        REFERENCES standings_snapshots(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (match_id, revision_id)
        REFERENCES match_result_revisions(match_id, id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_snapshot_results_valid
    BEFORE INSERT ON standings_snapshot_results
    BEGIN
      SELECT CASE
        WHEN (SELECT is_complete FROM standings_snapshots WHERE id = NEW.snapshot_id) <> 0
        THEN RAISE(ABORT, 'cannot add source references to a completed snapshot')
      END;
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM match_result_revisions
          WHERE match_id = NEW.match_id
            AND id = NEW.revision_id
            AND revision_number = NEW.revision_number
            AND competition_id = NEW.competition_id
            AND season_id = NEW.season_id
            AND validation_state = 'accepted'
            AND result_status = 'ended'
            AND final_result_confirmed = 1
        )
        THEN RAISE(ABORT, 'snapshot result must reference the selected accepted final revision')
      END;
    END;

    CREATE TABLE standings_snapshot_rows (
      snapshot_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      rank INTEGER NOT NULL CHECK (rank > 0),
      played INTEGER NOT NULL CHECK (played >= 0),
      won INTEGER NOT NULL CHECK (won >= 0),
      drawn INTEGER NOT NULL CHECK (drawn >= 0),
      lost INTEGER NOT NULL CHECK (lost >= 0),
      scores_for INTEGER NOT NULL CHECK (scores_for >= 0),
      scores_against INTEGER NOT NULL CHECK (scores_against >= 0),
      score_difference INTEGER NOT NULL,
      points INTEGER NOT NULL CHECK (points >= 0),
      tie_break_values_json TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, entry_id),
      UNIQUE (snapshot_id, rank),
      FOREIGN KEY (snapshot_id, competition_id, season_id)
        REFERENCES standings_snapshots(id, competition_id, season_id) ON DELETE RESTRICT,
      FOREIGN KEY (entry_id, competition_id, season_id)
        REFERENCES competition_entries(id, competition_id, season_id) ON DELETE RESTRICT
    );

    CREATE TRIGGER trg_standings_snapshots_no_update
    BEFORE UPDATE ON standings_snapshots
    WHEN OLD.is_complete = 1
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshots are immutable');
    END;

    CREATE TRIGGER trg_standings_snapshots_complete
    BEFORE UPDATE ON standings_snapshots
    WHEN OLD.is_complete = 0
    BEGIN
      SELECT CASE
        WHEN NEW.is_complete <> 1
          OR NEW.id IS NOT OLD.id
          OR NEW.competition_id IS NOT OLD.competition_id
          OR NEW.season_id IS NOT OLD.season_id
          OR NEW.sequence IS NOT OLD.sequence
          OR NEW.ruleset_id IS NOT OLD.ruleset_id
          OR NEW.ruleset_version IS NOT OLD.ruleset_version
          OR NEW.content_hash IS NOT OLD.content_hash
          OR NEW.content_json IS NOT OLD.content_json
          OR NEW.calculated_at IS NOT OLD.calculated_at
          OR NEW.expected_result_count IS NOT OLD.expected_result_count
          OR NEW.expected_row_count IS NOT OLD.expected_row_count
        THEN RAISE(ABORT, 'snapshot metadata is immutable; only finalization is allowed')
      END;
      SELECT CASE
        WHEN NEW.expected_result_count <> (
          SELECT COUNT(*) FROM standings_snapshot_results WHERE snapshot_id = NEW.id
        )
        THEN RAISE(ABORT, 'snapshot cannot complete with missing result revision references')
      END;
      SELECT CASE
        WHEN NEW.expected_row_count <> (
          SELECT COUNT(*) FROM standings_snapshot_rows WHERE snapshot_id = NEW.id
        )
        THEN RAISE(ABORT, 'snapshot cannot complete with missing standings rows')
      END;
    END;

    CREATE TRIGGER trg_standings_snapshots_no_delete
    BEFORE DELETE ON standings_snapshots
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshots are immutable');
    END;

    CREATE TRIGGER trg_standings_snapshot_results_no_update
    BEFORE UPDATE ON standings_snapshot_results
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshot source references are immutable');
    END;

    CREATE TRIGGER trg_standings_snapshot_results_no_delete
    BEFORE DELETE ON standings_snapshot_results
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshot source references are immutable');
    END;

    CREATE TRIGGER trg_standings_snapshot_rows_no_update
    BEFORE UPDATE ON standings_snapshot_rows
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshot rows are immutable');
    END;

    CREATE TRIGGER trg_standings_snapshot_rows_incomplete_only
    BEFORE INSERT ON standings_snapshot_rows
    WHEN (SELECT is_complete FROM standings_snapshots WHERE id = NEW.snapshot_id) <> 0
    BEGIN
      SELECT RAISE(ABORT, 'cannot add standings rows to a completed snapshot');
    END;

    CREATE TRIGGER trg_standings_snapshot_rows_no_delete
    BEFORE DELETE ON standings_snapshot_rows
    BEGIN
      SELECT RAISE(ABORT, 'standings snapshot rows are immutable');
    END;
  `
};
