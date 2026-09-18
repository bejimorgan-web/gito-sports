CREATE TABLE IF NOT EXISTS sports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_region_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (parent_region_id) REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS countries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iso2_code TEXT NOT NULL UNIQUE,
  iso3_code TEXT NOT NULL UNIQUE,
  region_id TEXT,
  flag_url TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (region_id) REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS sport_countries (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  country_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE CASCADE,
  FOREIGN KEY (country_id) REFERENCES countries(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sport_countries_sport_country ON sport_countries(sport_id, country_id);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host_type TEXT NOT NULL CHECK (host_type IN ('country', 'organization', 'federation', 'association', 'regional', 'international', 'other')),
  country_id TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id),
  FOREIGN KEY (country_id) REFERENCES countries(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_sport_name ON hosts(sport_id, name);

-- Phase 7 shadow catalog layer: entity mapping and catalog-only link tables
CREATE TABLE IF NOT EXISTS entity_catalog_mapping (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  catalog_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_catalog_mapping_legacy ON entity_catalog_mapping(entity_type, legacy_id, catalog_type);

CREATE TABLE IF NOT EXISTS sport_host_links (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_competition_links (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_club_links (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sport_national_team_links (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  national_team_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_club_links (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_national_team_links (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  national_team_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS host_competition_links (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sport_host_links_sport ON sport_host_links(sport_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sport_host_links_unique ON sport_host_links(sport_id, host_id);
CREATE INDEX IF NOT EXISTS idx_sport_competition_links_sport ON sport_competition_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_sport_club_links_sport ON sport_club_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_sport_national_team_links_sport ON sport_national_team_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_competition_club_links_competition ON competition_club_links(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_national_team_links_competition ON competition_national_team_links(competition_id);
CREATE INDEX IF NOT EXISTS idx_host_competition_links_host ON host_competition_links(host_id);

CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  sport_id TEXT,
  host_id TEXT,
  country_id TEXT,
  region_id TEXT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  scope TEXT NOT NULL,
  competition_type TEXT NOT NULL DEFAULT 'league',
  participant_type TEXT NOT NULL DEFAULT 'clubs',
  logo_url TEXT,
  current_season_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id),
  FOREIGN KEY (host_id) REFERENCES hosts(id),
  FOREIGN KEY (country_id) REFERENCES countries(id),
  FOREIGN KEY (region_id) REFERENCES regions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitions_slug ON competitions(slug);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (competition_id) REFERENCES competitions(id)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  sport_id TEXT,
  host_id TEXT,
  country_id TEXT,
  name TEXT NOT NULL,
  short_name TEXT,
  slug TEXT,
  type TEXT NOT NULL DEFAULT 'club',
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id),
  FOREIGN KEY (host_id) REFERENCES hosts(id),
  FOREIGN KEY (country_id) REFERENCES countries(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_sport_country_slug ON teams(sport_id, country_id, slug);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  country_id TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  photo_url TEXT,
  availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available', 'injured', 'suspended', 'unavailable')),
  injury_type TEXT,
  expected_return_date TEXT,
  injury_notes TEXT,
  position TEXT,
  jersey_number INTEGER,
  height_cm REAL,
  weight_kg REAL,
  birth_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (country_id) REFERENCES countries(id)
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

CREATE TABLE IF NOT EXISTS season_squads (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  competition_id TEXT,
  season_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id)
);

CREATE INDEX IF NOT EXISTS idx_season_squads_team ON season_squads(team_id);

CREATE TABLE IF NOT EXISTS squad_players (
  id TEXT PRIMARY KEY,
  squad_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'starter',
  position TEXT,
  jersey_number INTEGER,
  is_captain INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (squad_id) REFERENCES season_squads(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_squad_players_unique ON squad_players(squad_id, player_id);
CREATE INDEX IF NOT EXISTS idx_squad_players_squad ON squad_players(squad_id);

CREATE TABLE IF NOT EXISTS formation_templates (
  id TEXT PRIMARY KEY,
  sport_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  formation TEXT NOT NULL,
  positions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_templates_key ON formation_templates(sport_id, key);

CREATE TABLE IF NOT EXISTS fixture_lineups (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  season_squad_id TEXT NOT NULL,
  formation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_available' CHECK (status IN ('not_available', 'possible', 'confirmed')),
  captain_player_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(fixture_id, team_id),
  FOREIGN KEY (fixture_id) REFERENCES matches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (season_squad_id) REFERENCES season_squads(id),
  FOREIGN KEY (formation_id) REFERENCES formation_templates(id),
  FOREIGN KEY (captain_player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_fixture_lineups_fixture ON fixture_lineups(fixture_id);

CREATE TABLE IF NOT EXISTS lineup_player_assignments (
  id TEXT PRIMARY KEY,
  lineup_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('starter', 'substitute')),
  slot_index INTEGER,
  order_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(lineup_id, player_id),
  UNIQUE(lineup_id, role, slot_index),
  FOREIGN KEY (lineup_id) REFERENCES fixture_lineups(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_lineup_assignments_lineup ON lineup_player_assignments(lineup_id);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  season_id TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  venue_name TEXT,
  external_provider TEXT,
  external_match_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'assigned', 'approved', 'published', 'live', 'ended', 'cancelled', 'postponed')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (home_team_id) REFERENCES teams(id),
  FOREIGN KEY (away_team_id) REFERENCES teams(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_external_identity
  ON matches(external_provider, external_match_id)
  WHERE external_provider IS NOT NULL AND external_match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS scheduling_match_links (
  scheduling_match_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  link_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (link_status IN ('linked', 'ambiguous', 'unresolved', 'rejected')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  linked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scheduling_match_id) REFERENCES scheduling_matches(id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE INDEX IF NOT EXISTS idx_scheduling_match_links_match ON scheduling_match_links(match_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_match_links_status ON scheduling_match_links(link_status);

-- Phase 3: competition_teams linking table and scheduling matches
CREATE TABLE IF NOT EXISTS competition_teams (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  UNIQUE (competition_id, team_id)
);

CREATE TABLE IF NOT EXISTS competition_season_teams (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  membership_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  UNIQUE (competition_id, season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_season_teams_competition ON competition_season_teams(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_season_teams_season ON competition_season_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_competition_season_teams_team ON competition_season_teams(team_id);
CREATE INDEX IF NOT EXISTS idx_competition_season_teams_competition_season ON competition_season_teams(competition_id, season_id);

CREATE TABLE IF NOT EXISTS scheduling_matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  season_id TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  country_id TEXT,
  sport_id TEXT,
  kickoff_time TEXT NOT NULL,
  venue_name TEXT,
  external_provider TEXT,
  external_match_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (home_team_id) REFERENCES teams(id),
  FOREIGN KEY (away_team_id) REFERENCES teams(id),
  FOREIGN KEY (country_id) REFERENCES countries(id),
  FOREIGN KEY (sport_id) REFERENCES sports(id)
);

CREATE TABLE IF NOT EXISTS operational_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_artifacts (
  publication_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source_reference TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('live')),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'approved', 'published', 'revoked', 'unavailable')),
  availability TEXT NOT NULL CHECK (availability IN ('ready', 'degraded', 'offline', 'unknown')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE INDEX IF NOT EXISTS idx_publication_artifacts_match
  ON publication_artifacts(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_publication_artifacts_status
  ON publication_artifacts(publication_status, availability);

CREATE TABLE IF NOT EXISTS publication_delivery (
  publication_id TEXT PRIMARY KEY,
  delivery_reference TEXT NOT NULL,
  playback_mode TEXT NOT NULL DEFAULT 'DIRECT_SAFE',
  playback_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES publication_artifacts(publication_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entity_deletion_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  affected_records TEXT NOT NULL,
  operator_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'operator',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  -- Password storage (nullable for legacy DBs)
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  password_algo TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_settings (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (operator_user_id) REFERENCES operator_users(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (operator_user_id) REFERENCES operator_users(id)
);

CREATE TABLE IF NOT EXISTS mobile_analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  session_id TEXT,
  match_id TEXT,
  payload TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mobile_ad_events (
  id TEXT PRIMARY KEY,
  promotion_id TEXT,
  event_type TEXT NOT NULL,
  session_id TEXT,
  match_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mobile_ad_promotions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  action_url TEXT,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- API usage tracking for rate limiting
CREATE TABLE IF NOT EXISTS api_usage_log (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL UNIQUE CHECK (request_type IN ('live_fixtures', 'fixtures', 'logos', 'leagues')),
  last_request_timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_log_request_type ON api_usage_log(request_type);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_updated_at ON api_usage_log(updated_at);

-- Legacy mobile feature flags for remote control (preserved for compatibility)
CREATE TABLE IF NOT EXISTS mobile_features (
  id TEXT PRIMARY KEY,
  feature_name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_features_feature_name ON mobile_features(feature_name);

-- Mobile feature flags storage with display messages
CREATE TABLE IF NOT EXISTS mobile_feature_flags (
  id TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  display_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_feature_flags_feature_key ON mobile_feature_flags(feature_key);

-- Insert default navigation features
INSERT OR IGNORE INTO mobile_features (id, feature_name, enabled, created_at, updated_at)
VALUES
  ('nav_live_scores', 'navigation.liveScores', 1, datetime('now'), datetime('now')),
  ('nav_sports', 'navigation.sports', 1, datetime('now'), datetime('now')),
  ('nav_live', 'navigation.live', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at)
VALUES
  ('flag_live_scores', 'navigation.liveScores', 1, NULL, datetime('now'), datetime('now')),
  ('flag_sports', 'navigation.sports', 1, NULL, datetime('now'), datetime('now')),
  ('flag_live', 'navigation.live', 1, NULL, datetime('now'), datetime('now'));
