# Phase 7 Catalog-First Audit Report

## Audit Objective

Inspect the live SQLite schema and current referential integrity for the sports catalog domain. The goal is to validate the existing catalog shape, identify migration risks, and confirm whether the database already supports a catalog-first migration path.

## Key Findings

- The database contains the expected sports domain tables plus supporting operational and auth tables.
- Referential integrity checks found no orphaned foreign-key references for the primary catalog and operational relationships reviewed.
- `competition_teams` already exists as a join table between `competitions` and `teams`.
- `match_streams.match_id` points to `scheduling_matches`, not `matches`, which is an important structural detail for migration.

## Existing Tables

The database currently contains these tables:

- `sports`
- `countries`
- `regions`
- `competitions`
- `seasons`
- `teams`
- `matches`
- `streams`
- `competition_teams`
- `scheduling_matches`
- `match_streams`
- `providers`
- `channels`
- `sport_countries`
- `operator_users`
- `operator_settings`
- `auth_sessions`
- `operational_logs`

## Master Entity Schema Snapshots

### `sports`
- Primary key: `id TEXT`
- `name`, `slug`, `status`, `created_at`, `updated_at`
- `logo_url` exists
- Row count: `2`

### `countries`
- Primary key: `id TEXT`
- Geographic metadata: `iso2_code`, `iso3_code`, `region_id`
- `logo_url`, `flag_url`, `status`, timestamps
- Foreign key: `region_id` → `regions(id)`
- Row count: `3`

### `competitions`
- Primary key: `id TEXT`
- Foreign keys:
  - `sport_id` → `sports(id)`
  - `region_id` → `regions(id)`
- Fields: `name`, `slug`, `scope`, `current_season_id`, `status`, `competition_type`, `participant_type`
- `logo_url` exists
- Row count: `5`

### `teams`
- Primary key: `id TEXT`
- Foreign keys:
  - `country_id` → `countries(id)`
  - `sport_id` → `sports(id)`
- Fields: `name`, `short_name`, `type`, `status`
- `logo_url` exists
- Row count: `10`

## Operational & Assignment Tables

### `matches`
- Foreign keys:
  - `competition_id` → `competitions(id)`
  - `home_team_id` → `teams(id)`
  - `away_team_id` → `teams(id)`
  - `season_id` → `seasons(id)`
- Row count: `7`

### `streams`
- Foreign keys:
  - `match_id` → `matches(id)`
  - `channel_id` → `channels(id)`
- Row count: `6`

### `competition_teams`
- Join table with FKs:
  - `competition_id` → `competitions(id)`
  - `team_id` → `teams(id)`
- Row count: `2`

### `scheduling_matches`
- Foreign keys:
  - `competition_id` → `competitions(id)`
  - `sport_id` → `sports(id)`
  - `country_id` → `countries(id)`
  - `home_team_id` → `teams(id)`
  - `away_team_id` → `teams(id)`
- Row count: `1`

### `match_streams`
- Foreign keys:
  - `match_id` → `scheduling_matches(id)`
  - `provider_id` → `providers(id)`
  - `channel_id` → `channels(id)`
- Row count: `0`

### IPTV tables
- `providers`: `25` rows
- `channels`: `19,253` rows
- No orphaned `channels` were found for missing `providers`.

## Referential Integrity Checks

Checked the following foreign-key relationships for orphaned references:

- `competitions.sport_id` → `sports` : 0 orphans
- `competitions.country_id` → `countries` : 0 orphans
- `teams.sport_id` → `sports` : 0 orphans
- `teams.country_id` → `countries` : 0 orphans
- `matches.competition_id` → `competitions` : 0 orphans
- `matches.home_team_id` → `teams` : 0 orphans
- `matches.away_team_id` → `teams` : 0 orphans
- `streams.match_id` → `matches` : 0 orphans
- `streams.channel_id` → `channels` : 0 orphans
- `scheduling_matches.competition_id` → `competitions` : 0 orphans
- `scheduling_matches.home_team_id` → `teams` : 0 orphans
- `scheduling_matches.away_team_id` → `teams` : 0 orphans
- `scheduling_matches.country_id` → `countries` : 0 orphans
- `scheduling_matches.sport_id` → `sports` : 0 orphans
- `match_streams.match_id` → `scheduling_matches` : 0 orphans
- `competition_teams.competition_id` → `competitions` : 0 orphans
- `competition_teams.team_id` → `teams` : 0 orphans

## Migration-Relevant Observations

1. `countries` is still the geographic master entity name; the catalog-first model should rename this to `hosts`.
2. Both `competitions` and `teams` already have `sport_id` and `country_id` assignment fields, making the migration path clearer.
3. `logo_url` is already present on the key catalog tables, which supports the planned logo-centric operator UI.
4. `scheduling_matches` currently carries `sport_id` and `country_id` directly, implying a scheduling or staging table that must be reconciled with the new catalog-first flow.
5. `match_streams` links to `scheduling_matches`, not active `matches`; any migration or deletion logic must preserve this distinction.

## Risks & Next Steps

### Risks

- The `match_streams` / `scheduling_matches` relationship is non-standard and may hide legacy operational semantics.
- If `competition_teams` is used by current business logic, migration must preserve this join table exactly.
- The current schema uses `TEXT` primary keys, so any migration must preserve IDs or provide stable remapping.

### Next Steps

1. Construct a shadow catalog model mapping live tables to the desired catalog-first entities.
2. Identify UI compatibility gaps for host/sport assignment and competition/team metadata.
3. Define safe foreign-key updates and ON DELETE behaviors for the migration.
4. Build a non-destructive validation pass that confirms the migration logic before any production writes.

## Conclusion

Step 1 of the Phase 7 catalog-first audit is complete. The current SQLite database is structurally consistent for the reviewed relationships, and there are no immediate orphaned-relation blockers in the catalog domain.

The main migration focus should now be on mapping legacy scheduling/stream semantics into the new model and renaming `countries` to `hosts` while preserving existing geo and logo metadata.
