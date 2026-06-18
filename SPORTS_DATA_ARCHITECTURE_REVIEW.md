# Sports Data Architecture Review

## Purpose

This review evaluates the current sports data model and identifies the gaps between existing implementation and the desired target architecture:

Sport → Countries → Competitions → Teams → Matches → Streams

The system must support reusable sports entities, logo-enabled assets, full operator CRUD lifecycle, and preserved stream editability even after approval/publish.

## Current Schema Audit

### What currently exists

The backend schema already includes these tables:

- `sports`
- `regions`
- `countries`
- `competitions`
- `seasons`
- `teams`
- `matches`
- `streams`

The current match/stream pipeline is backed by:

- `matches` with `competition_id`, `season_id`, `home_team_id`, `away_team_id`
- `streams` with `match_id`, `channel_id`, `status`, `approval_status`, `published_at`, `health_status`

### Current relationships

- `competitions.sport_id` → `sports.id`
- `competitions.region_id` → `regions.id`
- `teams.sport_id` → `sports.id`
- `teams.country_id` → `countries.id`
- `matches.competition_id` → `competitions.id`
- `matches.home_team_id` → `teams.id`
- `matches.away_team_id` → `teams.id`
- `streams.match_id` → `matches.id`
- `streams.channel_id` → `channels.id`

### Existing strengths

- There is already a `countries` table, which means reusable country entities are possible.
- Teams can link to countries through `teams.country_id`.
- Matches are already modeled as first-class entities with competition and team references.
- Streams are linked to matches and carry approval/publish/health lifecycle fields.

### Current implementation behavior

The backend currently achieves match creation through `assignChannelToMatch`, which auto-creates:

- sports via `ensureSport`
- competitions via `ensureCompetition`
- teams via `ensureTeam`

That is a lightweight workflow, but it is not sufficient for a reusable operator-managed sports hierarchy.

## Key gaps and missing entities

### Missing reusable country relationship for competitions

- `competitions` are linked only to `regions`, not directly to `countries`.
- This means we cannot enforce "competitions linked to countries" in the current model.
- `regions` is a generic hierarchy, but it does not satisfy the requirement that countries are created once and reused.

### Country creation and reuse is not operator-driven

- There is no API surface for operators to create, edit, delete or deactivate countries.
- A country is modeled in the schema, but the current repository code does not surface it as a managed entity.

### Team model is incomplete for national team support

- `teams.type` defaults to `club`.
- `ensureTeam` always inserts teams with type `club`.
- National teams are not explicitly supported in the current creation flow.

### Competition participation is not explicitly modeled

- There is no join table or explicit association linking teams to competitions outside of individual matches.
- The current model relies on `matches` to infer participation.
- Requirement 4 calls for competitions linked to participating teams, which is missing.

### Logos are not modeled

- No `logo` column exists on:
  - `countries`
  - `competitions`
  - `teams`
- Therefore logo delivery to scheduling, approvals, published matches, and mobile is not currently supported.

### API surface is incomplete

- `sportsRouter.get("/")` returns an empty list.
- `matchesRouter.get("/")` returns an empty list.
- `streamsRouter.get("/")` returns an empty list.
- Most sports entity CRUD endpoints are missing entirely.

### Persisted state and lifecycle issues

- `assignChannelToMatch` auto-creates entities on the fly, so sports entity lifecycles are not controlled.
- There is no operator CRUD for sports entities, only implicit record creation.
- Approved and published streams are not explicitly supported as editable/removable in the API, though the schema does store the necessary metadata.

## Proposed schema

### Core sports hierarchy

#### `sports`
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### `countries`
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `iso2_code TEXT NOT NULL UNIQUE`
- `iso3_code TEXT NOT NULL UNIQUE`
- `region_id TEXT` — optional geographic grouping
- `logo_url TEXT` — country logo
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (region_id) REFERENCES regions(id)`

#### `competitions`
- `id TEXT PRIMARY KEY`
- `sport_id TEXT NOT NULL`
- `country_id TEXT` — optional primary country/nation for the competition
- `region_id TEXT` — preserve existing region grouping if needed
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `scope TEXT NOT NULL`
- `current_season_id TEXT`
- `logo_url TEXT` — competition logo
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (sport_id) REFERENCES sports(id)`
- `FOREIGN KEY (country_id) REFERENCES countries(id)`
- `FOREIGN KEY (region_id) REFERENCES regions(id)`

#### `teams`
- `id TEXT PRIMARY KEY`
- `sport_id TEXT NOT NULL`
- `country_id TEXT` — home country or national identity
- `name TEXT NOT NULL`
- `short_name TEXT`
- `type TEXT NOT NULL DEFAULT 'club'` — `club` or `national`
- `logo_url TEXT` — team logo
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (sport_id) REFERENCES sports(id)`
- `FOREIGN KEY (country_id) REFERENCES countries(id)`

#### `competition_teams`
- `competition_id TEXT NOT NULL`
- `team_id TEXT NOT NULL`
- `role TEXT NOT NULL DEFAULT 'participant'`
- `status TEXT NOT NULL DEFAULT 'active'`
- `joined_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY (competition_id, team_id)`
- `FOREIGN KEY (competition_id) REFERENCES competitions(id)`
- `FOREIGN KEY (team_id) REFERENCES teams(id)`

This table enables explicit team participation in competitions, separate from match scheduling.

#### `seasons`
- `id TEXT PRIMARY KEY`
- `competition_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `starts_at TEXT`
- `ends_at TEXT`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (competition_id) REFERENCES competitions(id)`

#### `matches`
- `id TEXT PRIMARY KEY`
- `competition_id TEXT NOT NULL`
- `season_id TEXT`
- `home_team_id TEXT NOT NULL`
- `away_team_id TEXT NOT NULL`
- `starts_at TEXT NOT NULL`
- `venue_name TEXT`
- `status TEXT NOT NULL DEFAULT 'draft' CHECK (...)`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (competition_id) REFERENCES competitions(id)`
- `FOREIGN KEY (season_id) REFERENCES seasons(id)`
- `FOREIGN KEY (home_team_id) REFERENCES teams(id)`
- `FOREIGN KEY (away_team_id) REFERENCES teams(id)`

#### `streams`
- `id TEXT PRIMARY KEY`
- `match_id TEXT NOT NULL`
- `channel_id TEXT NOT NULL`
- `protocol TEXT NOT NULL DEFAULT 'hls'`
- `status TEXT NOT NULL DEFAULT 'idle'`
- `approval_status TEXT NOT NULL DEFAULT 'idle'`
- `approved_by_user_id TEXT`
- `approved_at TEXT`
- `rejection_reason TEXT`
- `published_at TEXT`
- `health_status TEXT NOT NULL DEFAULT 'unknown'`
- `health_reason TEXT`
- `failure_count INTEGER NOT NULL DEFAULT 0`
- `last_health_at TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY (match_id) REFERENCES matches(id)`
- `FOREIGN KEY (channel_id) REFERENCES channels(id)`

### Key schema improvements

- Add `logo_url` to `countries`, `competitions`, and `teams`.
- Add `country_id` to `competitions` to link competitions to countries.
- Add `competition_teams` to explicitly model competition participants.
- Extend `teams.type` to support `club` and `national` explicitly.
- Preserve `regions` for higher-level geographic grouping, but do not use it as the sole country relationship.
- Ensure all operator-managed entities are persisted in SQLite with proper FK constraints.

## API requirements

### Sports entity management

Operators need a complete CRUD and status lifecycle for sports entities.

#### Sports
- `GET /sports`
- `GET /sports/:sportId`
- `POST /sports`
- `PUT /sports/:sportId`
- `DELETE /sports/:sportId`
- `PATCH /sports/:sportId/status`

#### Countries
- `GET /countries`
- `GET /countries/:countryId`
- `POST /countries`
- `PUT /countries/:countryId`
- `DELETE /countries/:countryId`
- `PATCH /countries/:countryId/status`

#### Competitions
- `GET /competitions`
- `GET /competitions/:competitionId`
- `POST /competitions`
- `PUT /competitions/:competitionId`
- `DELETE /competitions/:competitionId`
- `PATCH /competitions/:competitionId/status`

#### Teams
- `GET /teams`
- `GET /teams/:teamId`
- `POST /teams`
- `PUT /teams/:teamId`
- `DELETE /teams/:teamId`
- `PATCH /teams/:teamId/status`

#### Competition participation
- `GET /competitions/:competitionId/teams`
- `POST /competitions/:competitionId/teams`
- `DELETE /competitions/:competitionId/teams/:teamId`

### Match and stream operations

- `GET /matches`
- `GET /matches/:matchId`
- `POST /matches`
- `PUT /matches/:matchId`
- `PATCH /matches/:matchId/status`
- `DELETE /matches/:matchId`
- `POST /matches/:matchId/assign-stream`
- `GET /streams`
- `GET /streams/:streamId`
- `POST /streams/:streamId/approve`
- `POST /streams/:streamId/publish`
- `PATCH /streams/:streamId`
- `DELETE /streams/:streamId`
- `POST /streams/:streamId/health`

### Mobile/live feed

- `GET /live-matches`
- `GET /live-matches/feed`
- `GET /live-matches/current`
- `GET /mobile/matches/live`

### Required API behavior

- Countries must be globally reusable and unique by ISO code and name.
- Competitions must be linked to a sport and optionally to a primary country.
- Teams must be linked to sport and optionally to country.
- Competitions must support explicit team participation rather than inferred participation via matches.
- Sports entities must be creatable, editable, deletable, and deactivatable by operators.
- Approved/published streams remain editable and removable; lifecycle status should not lock entity mutation.
- Published live matches must preserve the published stream record but allow updates.

## Desktop UI requirements

### Scheduling UI

The scheduling UI should:

- Allow operators to browse sports, countries, competitions, teams, seasons and matches.
- Display country, competition, and team logos.
- Enable creation/editing/deactivation of sports entities.
- Provide an explicit team/competition selection flow instead of auto-creating entities.
- Allow operators to assign streams to scheduled matches using channel selection.
- Show match status and stream assignment state.

### Approvals UI

Approvals workflows should:

- Show pending/assigned streams with match, competition, and team context.
- Include logos for the home and away teams, competition, and country where available.
- Allow operators to approve, reject, or revise stream metadata.
- Allow editing or deleting approved streams without requiring a new match.
- Preserve audit state while still allowing operator corrections.

### Published matches UI

The published matches experience should:

- Display live and published matches with team and competition logos.
- Surface stream health and provider/channel status.
- Show country affiliation for teams and competitions.
- Allow operators to inspect and remove published streams if necessary.

## Mobile UI requirements

The mobile application should:

- Consume `mobile/matches/live` and/or `live-matches` endpoints.
- Render live/published matches with team, competition, and country logos.
- Show match start time, status, stream health, and playback metadata.
- Support browsing by sport, country, competition, or team where appropriate.
- Preserve the same entity logo branding as desktop.

## Migration strategy

### Phase 1: Audit and preserve existing data

- Inspect existing `competitions`, `teams`, `matches`, and `streams` rows.
- Identify any competitions currently linked to `regions` that should be associated with countries.
- Identify duplicate teams by sport/name.

### Phase 2: Schema extension

- Add `logo_url` to `countries`, `competitions`, and `teams`.
- Add `country_id` to `competitions`.
- Create `competition_teams` to represent participation.
- Add explicit `team.type` support for `club` and `national`.
- Add `status` lifecycle support where missing.

### Phase 3: Backfill data

- Backfill `countries` for any existing competition or team content that has country meaning.
- Backfill `competition_teams` using existing match participants.
- Normalize duplicate competitions and teams on slug/name constraints.

### Phase 4: API and workflow migration

- Replace auto-create logic in `assignChannelToMatch` with explicit selection of existing sports entities.
- Implement dedicated CRUD endpoints for `sports`, `countries`, `competitions`, `teams`, and `competition_teams`.
- Preserve current `matches` and `streams` area while building the new sports entity workflows.

### Phase 5: UI alignment

- Update desktop Scheduling, Approvals, and Published Matches UIs to use the new sports entity API.
- Update mobile live match feeds to include logos and competition/country metadata.

### Phase 6: Validation and cleanup

- Validate that logos render across scheduling, approvals, published matches, and mobile.
- Confirm that approved/published streams remain editable and removable.
- Clean up any stale auto-created sports entities.

## Conclusion

The current schema already contains many of the required tables, but the sports data layer is not yet reusable or operator-managed.

The highest-value changes are:

1. Expose `countries`, `competitions`, and `teams` as first-class operator-managed entities.
2. Add explicit competition participation via `competition_teams`.
3. Add logo support to countries, competitions, and teams.
4. Replace the current implicit auto-create model with explicit selection and CRUD operations.
5. Preserve stream edit/delete behavior after approval/publish.

This architecture review should guide the next implementation phase toward a reusable sports hierarchy with rich branding and reliable lifecycle control.
