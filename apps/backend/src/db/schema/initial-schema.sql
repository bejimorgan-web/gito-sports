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
CREATE INDEX IF NOT EXISTS idx_sport_competition_links_sport ON sport_competition_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_sport_club_links_sport ON sport_club_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_sport_national_team_links_sport ON sport_national_team_links(sport_id);
CREATE INDEX IF NOT EXISTS idx_competition_club_links_competition ON competition_club_links(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_national_team_links_competition ON competition_national_team_links(competition_id);
CREATE INDEX IF NOT EXISTS idx_host_competition_links_host ON host_competition_links(host_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  auth_type TEXT NOT NULL DEFAULT 'none',
  credential_username TEXT,
  credential_password TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'partial' CHECK (
    sync_mode IN ('partial', 'full')
  ),
  availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    availability_status IN ('online', 'offline', 'degraded', 'unknown')
  ),
  last_successful_stream_load_at TEXT,
  failed_channel_loads INTEGER NOT NULL DEFAULT 0,
  health_score INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('active', 'pending', 'failed', 'invalid')
  ),
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  external_ref TEXT,
  group_name TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  sport_id TEXT,
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
  country_id TEXT,
  name TEXT NOT NULL,
  short_name TEXT,
  type TEXT NOT NULL DEFAULT 'club',
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sport_id) REFERENCES sports(id),
  FOREIGN KEY (country_id) REFERENCES countries(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  season_id TEXT,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  venue_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'assigned', 'approved', 'published', 'live', 'ended', 'cancelled')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (home_team_id) REFERENCES teams(id),
  FOREIGN KEY (away_team_id) REFERENCES teams(id)
);

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

CREATE TABLE IF NOT EXISTS scheduling_matches (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  country_id TEXT,
  sport_id TEXT,
  kickoff_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (home_team_id) REFERENCES teams(id),
  FOREIGN KEY (away_team_id) REFERENCES teams(id),
  FOREIGN KEY (country_id) REFERENCES countries(id),
  FOREIGN KEY (sport_id) REFERENCES sports(id)
);

CREATE TABLE IF NOT EXISTS match_streams (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES scheduling_matches(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  UNIQUE (match_id, channel_id)
);

CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'hls',
  status TEXT NOT NULL DEFAULT 'idle' CHECK (
    status IN ('idle', 'assigned', 'testing', 'approved', 'active', 'failed', 'disabled')
  ),
  approval_status TEXT NOT NULL DEFAULT 'idle' CHECK (
    approval_status IN ('idle', 'assigned', 'testing', 'approved', 'active', 'failed', 'disabled')
  ),
  approved_by_user_id TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  published_at TEXT,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    health_status IN ('active', 'degraded', 'failed', 'unknown')
  ),
  health_reason TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_health_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
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
