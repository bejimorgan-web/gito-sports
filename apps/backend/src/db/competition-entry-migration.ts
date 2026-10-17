import type { SqlMigration } from "./migration-runner.js";

// The current canonical catalog has teams and players but no pair/group entity.
// Add a canonical group/member model before extending entry_type beyond these two types.
export const competitionEntryMigration: SqlMigration = {
  version: 2,
  name: "competition-entries-and-fixture-participants",
  sql: `
    CREATE UNIQUE INDEX idx_seasons_competition_id_id
      ON seasons(competition_id, id);

    CREATE UNIQUE INDEX idx_matches_participant_context
      ON matches(id, competition_id, season_id);

    CREATE TABLE competition_entries (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('team', 'individual')),
      team_id TEXT,
      player_id TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (entry_type = 'team' AND team_id IS NOT NULL AND player_id IS NULL)
        OR
        (entry_type = 'individual' AND player_id IS NOT NULL AND team_id IS NULL)
      ),
      FOREIGN KEY (competition_id, season_id)
        REFERENCES seasons(competition_id, id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );

    -- Canonical competitors may enter once per competition and season.
    CREATE UNIQUE INDEX idx_competition_entries_team
      ON competition_entries(competition_id, season_id, team_id)
      WHERE team_id IS NOT NULL;

    CREATE UNIQUE INDEX idx_competition_entries_player
      ON competition_entries(competition_id, season_id, player_id)
      WHERE player_id IS NOT NULL;

    CREATE UNIQUE INDEX idx_competition_entries_context
      ON competition_entries(id, competition_id, season_id);

    -- Slot labels remain sport-neutral; the same entry cannot occupy multiple slots.
    CREATE TABLE fixture_participants (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (length(trim(slot)) > 0),
      created_at TEXT NOT NULL,
      UNIQUE (match_id, slot),
      UNIQUE (match_id, entry_id),
      FOREIGN KEY (match_id, competition_id, season_id)
        REFERENCES matches(id, competition_id, season_id) ON DELETE CASCADE,
      FOREIGN KEY (entry_id, competition_id, season_id)
        REFERENCES competition_entries(id, competition_id, season_id) ON DELETE RESTRICT
    );

    CREATE INDEX idx_fixture_participants_entry
      ON fixture_participants(entry_id);
  `
};
