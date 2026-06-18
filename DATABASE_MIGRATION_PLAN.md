# Database Migration Plan

## Objective

Refactor the sports domain to a catalog-first architecture while preserving existing data and supporting independent master entities.

This plan covers:

- host rename from `countries` to `hosts`
- nullable sport and host assignments on competitions and teams
- logo metadata on all master entities
- explicit team `type` and competition `participant_type`
- assignment cleanup rules for deletes
- operational cascade rules for matches, streams, and scheduling

---

## Current schema summary

The current schema includes:

- `sports`
- `regions`
- `countries`
- `competitions`
- `seasons`
- `teams`
- `matches`
- `streams`
- `competition_teams`
- `scheduling_matches`
- `match_streams`

Existing issues for catalog-first:

- `countries` is used as a geographic entity but not operator-managed.
- `competitions` have `country_id` only through an incomplete relationship model.
- `teams` do not clearly separate club and national team semantics.
- master entity deletion is blocked by referential relationships.
- logos are missing on `countries`, `competitions`, and `teams`.

---

## Proposed schema changes

### Rename `countries` → `hosts`

This rename aligns the domain with the new catalog-first terminology.

- `countries` → `hosts`
- `country_id` columns → `host_id`
- `country` references in code and API should become `host`
- Preserve existing host data and ISO metadata as host attributes

### Master entity table schema

#### `sports`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `logo_url TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### `hosts`

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `iso2_code TEXT NOT NULL UNIQUE`
- `iso3_code TEXT NOT NULL UNIQUE`
- `region_id TEXT NULL`
- `logo_url TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (region_id) REFERENCES regions(id)`

#### `competitions`

- `id TEXT PRIMARY KEY`
- `sport_id TEXT NULL`
- `host_id TEXT NULL`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `type TEXT NOT NULL CHECK(type IN ('league','cup','friendly','tournament'))`
- `participant_type TEXT NOT NULL CHECK(participant_type IN ('clubs','nationalTeams'))`
- `logo_url TEXT NULL`
- `current_season_id TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE SET NULL`
- `FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL`
- `FOREIGN KEY (current_season_id) REFERENCES seasons(id) ON DELETE SET NULL`

#### `teams`

- `id TEXT PRIMARY KEY`
- `sport_id TEXT NULL`
- `host_id TEXT NULL`
- `name TEXT NOT NULL`
- `short_name TEXT NULL`
- `type TEXT NOT NULL CHECK(type IN ('club','national'))`
- `logo_url TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (sport_id) REFERENCES sports(id) ON DELETE SET NULL`
- `FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL`

#### `competition_teams`

- `id TEXT PRIMARY KEY`
- `competition_id TEXT NOT NULL`
- `team_id TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `joined_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `UNIQUE (competition_id, team_id)`

### Logo metadata

Add `logo_url` to:

- `sports`
- `hosts`
- `competitions`
- `teams`

This enables logo-first catalog rendering.

### Nullable assignments

Make the following assignment fields nullable:

- `competitions.sport_id`
- `competitions.host_id`
- `teams.sport_id`
- `teams.host_id`

This supports independent master deletion and orphaned assignments.

### Operational cascade rules

Update operational tables so deletes cascade only for allowed operational data:

- `matches.competition_id` → `competitions(id)` ON DELETE CASCADE
- `matches.home_team_id` → `teams(id)` ON DELETE CASCADE
- `matches.away_team_id` → `teams(id)` ON DELETE CASCADE
- `streams.match_id` → `matches(id)` ON DELETE CASCADE
- `scheduling_matches.competition_id` → `competitions(id)` ON DELETE CASCADE
- `scheduling_matches.home_team_id` → `teams(id)` ON DELETE CASCADE
- `scheduling_matches.away_team_id` → `teams(id)` ON DELETE CASCADE
- `match_streams.match_id` → `scheduling_matches(id)` ON DELETE CASCADE

Assignments and join tables:

- `competition_teams` should cascade when the competition or team is deleted.
- `sport_countries` should either be replaced by host assignment semantics or migrated with ON DELETE CASCADE from `hosts`.

---

## Migration strategy

### Phase 1: Schema preparation and host rename

1. Temporarily disable foreign keys during migration.
2. Rename `countries` to `hosts` using SQLite `ALTER TABLE countries RENAME TO hosts`.
3. Rename relevant foreign columns from `country_id` to `host_id` in:
   - `competitions`
   - `teams`
   - any join tables that currently reference `countries`
4. Update indexes and constraints to use `host_id`.

### Phase 2: Add logo metadata and nullable assignment fields

1. Alter `sports`, `hosts`, `competitions`, and `teams` to add `logo_url TEXT`.
2. Recreate `competitions` with `sport_id TEXT NULL` and `host_id TEXT NULL` if SQLite cannot directly alter nullability.
3. Recreate `teams` with `sport_id TEXT NULL` and `host_id TEXT NULL`.
4. Backfill existing assignment values from current data.

### Phase 3: Add explicit participation semantics

1. Ensure `teams.type` has values `club` or `national`.
2. Add or normalize `competitions.participant_type` values to `clubs` or `nationalTeams`.
3. Add `competition_teams` membership tracking with cascade delete semantics if not already present.
4. Migrate any inferred participation from existing match data into `competition_teams` only if required for the new catalog flow.

### Phase 4: Update delete semantics and foreign keys

1. Recreate assignment tables and operational tables with proper ON DELETE behavior:
   - `competition_teams` ON DELETE CASCADE for both FKs
   - `matches` ON DELETE CASCADE for competition and team FKs
   - `streams` ON DELETE CASCADE for match FK
   - `scheduling_matches` ON DELETE CASCADE for competition and team FKs
   - `match_streams` ON DELETE CASCADE for scheduling match FK
2. Set `competitions.sport_id`, `competitions.host_id`, `teams.sport_id`, and `teams.host_id` to ON DELETE SET NULL.
3. Optionally create triggers for any additional orphan cleanup required by legacy join tables.

### Phase 5: Data validation and cleanup

1. Validate that all existing `countries` rows now appear in `hosts`.
2. Validate that `competition.host_id` and `team.host_id` reference valid hosts.
3. Validate that `competitions.sport_id` and `teams.sport_id` reference valid sports.
4. Ensure no deleted master entity accidentally cascaded to other masters.
5. Verify logo references are present and asset URLs resolve.

### Phase 6: Rollback plan

1. Back up the SQLite database before migration.
2. Maintain a copy of the pre-migration schema and data.
3. If migration fails, restore the backup and retry after fixing the migration script.
4. After migration, run automated validation queries to confirm referential integrity.

---

## Foreign key strategy

### Master assignments

| Column | References | Delete action |
|--------|------------|---------------|
| `competitions.sport_id` | `sports(id)` | `SET NULL` |
| `competitions.host_id` | `hosts(id)` | `SET NULL` |
| `teams.sport_id` | `sports(id)` | `SET NULL` |
| `teams.host_id` | `hosts(id)` | `SET NULL` |

### Assignment/join tables

| Table | FK | Delete action |
|-------|----|---------------|
| `competition_teams` | `competition_id` | `CASCADE` |
| `competition_teams` | `team_id` | `CASCADE` |
| `sport_countries` | `sport_id` | `CASCADE` |
| `sport_countries` | `host_id` | `CASCADE` |

### Operational data

| Table | FK | Delete action |
|-------|----|---------------|
| `matches` | `competition_id` | `CASCADE` |
| `matches` | `home_team_id` | `CASCADE` |
| `matches` | `away_team_id` | `CASCADE` |
| `streams` | `match_id` | `CASCADE` |
| `scheduling_matches` | `competition_id` | `CASCADE` |
| `scheduling_matches` | `home_team_id` | `CASCADE` |
| `scheduling_matches` | `away_team_id` | `CASCADE` |
| `match_streams` | `match_id` | `CASCADE` |

---

## Notes on host rename

- The rename from `countries` to `hosts` should be implemented in both schema and API.
- UI terminology should update from "Country" to "Host" for all catalog surfaces.
- Preserve existing ISO metadata during migration as host properties.

---

## Validation checklist

- [ ] `hosts` table exists and contains migrated country rows.
- [ ] `competitions.host_id` and `teams.host_id` are nullable and populated correctly.
- [ ] `sports.logo_url`, `hosts.logo_url`, `competitions.logo_url`, and `teams.logo_url` exist.
- [ ] Competition participant type uses `clubs` or `nationalTeams`.
- [ ] Team type uses `club` or `national`.
- [ ] `competition_teams` cascades delete assignments.
- [ ] `matches` and `streams` cascade delete as expected.
- [ ] No master entity deletion removes another master entity.
- [ ] Operational cleanup behavior is documented and tested.
