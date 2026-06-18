# SPORTS_DATA_PHASE1_IMPLEMENTATION_PLAN

> Implementation planning only. No source code changes. No database schema changes. No migrations. Wait for approval before coding.

## SECTION 1 — PHASE 1 GOALS

Phase 1 implements a reusable sports taxonomy for the GiTO Live Sports system.

### Required entities

- Sport
- Country
- Competition
- Team

### Goals

- Eliminate entity duplication by using reusable shared records instead of free-form match metadata.
- Support logos for visual identification of sports, countries, competitions, and teams.
- Support future scheduling by establishing a clean taxonomy and relationships between sports, competitions, and teams.
- Support future mobile presentation by preparing entity metadata and logo references for downstream consumption.

## SECTION 2 — DATABASE DESIGN PLAN

Phase 1 requires the following tables and relationships.

### `sports`

- Columns:
  - `id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `slug TEXT NOT NULL UNIQUE`
  - `logo_url TEXT NULL`
  - `status TEXT NOT NULL DEFAULT 'active'`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- Primary key: `id`
- Unique constraints: `slug`
- Relationships:
  - `sports` 1 - N `competitions`
  - `sports` 1 - N `teams`

### `countries`

- Columns:
  - `id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `iso2_code TEXT NOT NULL UNIQUE`
  - `iso3_code TEXT NOT NULL UNIQUE`
  - `region_id TEXT NULL`
  - `logo_url TEXT NULL`
  - `status TEXT NOT NULL DEFAULT 'active'`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- Primary key: `id`
- Unique constraints: `iso2_code`, `iso3_code`
- Foreign keys:
  - `region_id` references `regions(id)` if region reuse is required
- Relationships:
  - `countries` 1 - N `competitions`
  - `countries` 1 - N `teams`

### `competitions`

- Columns:
  - `id TEXT PRIMARY KEY`
  - `sport_id TEXT NOT NULL`
  - `country_id TEXT NOT NULL`
  - `name TEXT NOT NULL`
  - `slug TEXT NOT NULL UNIQUE`
  - `type TEXT NOT NULL CHECK(type IN ('league','cup','tournament'))`
  - `logo_url TEXT NULL`
  - `status TEXT NOT NULL DEFAULT 'active'`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- Primary key: `id`
- Unique constraints: `slug`
- Foreign keys:
  - `sport_id` references `sports(id)`
  - `country_id` references `countries(id)`
- Relationships:
  - `competitions` 1 - N `matches`
  - `competitions` N - N `teams` via a membership join if competition teams are tracked

### `teams`

- Columns:
  - `id TEXT PRIMARY KEY`
  - `sport_id TEXT NOT NULL`
  - `country_id TEXT NOT NULL`
  - `name TEXT NOT NULL`
  - `short_name TEXT NULL`
  - `type TEXT NOT NULL CHECK(type IN ('club','national'))`
  - `logo_url TEXT NULL`
  - `status TEXT NOT NULL DEFAULT 'active'`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- Primary key: `id`
- Unique constraints: none mandated, but a compound uniqueness strategy is recommended on `(sport_id, country_id, name)` or `(sport_id, name)` if duplicates must be prevented
- Foreign keys:
  - `sport_id` references `sports(id)`
  - `country_id` references `countries(id)`
- Relationships:
  - `teams` 1 - N `matches` as `home_team_id` and `away_team_id`
  - `teams` N - N `competitions` via membership if team membership is tracked

### Relationship diagram summary

- `sports` 1 - N `competitions`
- `sports` 1 - N `teams`
- `countries` 1 - N `competitions`
- `countries` 1 - N `teams`
- `competitions` 1 - N `matches`
- `matches` references `home_team_id` and `away_team_id`

### Notes for Phase 1

- The plan focuses on sports taxonomy only; existing `matches`, `streams`, `providers`, and `channels` remain in place.
- Logo metadata is stored as `logo_url` fields rather than binary blobs.
- A competition-team membership join table is recommended for future team roster support, but it is optional if the initial scope only needs reusable team selection.

## SECTION 3 — LOGO STORAGE PLAN

### File storage location

- Store logos under a dedicated backend media directory.
- Example path: `apps/backend/data/media/logos/`.
- Subfolders may be organized by entity type, e.g.:
  - `apps/backend/data/media/logos/sports/`
  - `apps/backend/data/media/logos/countries/`
  - `apps/backend/data/media/logos/competitions/`
  - `apps/backend/data/media/logos/teams/`

### Database reference fields

- `sports.logo_url`
- `countries.logo_url`
- `competitions.logo_url`
- `teams.logo_url`

The fields contain the backend-accessible path or URL for the stored logo asset.

### Upload flow

1. Operator opens create or edit form in the desktop UI.
2. Operator chooses a logo image file.
3. Desktop sends the file to a backend logo upload endpoint for the targeted entity type.
4. Backend saves the file to the media directory and generates a stable path.
5. Backend returns the persisted `logo_url`.
6. Desktop updates the entity form with the returned `logo_url` and saves the entity record.

### Replacement flow

1. Operator uploads a new logo in the edit form.
2. Backend stores the new file and optionally deletes or archives the previous logo file.
3. Backend returns the new `logo_url`.
4. Entity record is updated with the new reference.

### Deletion flow

1. Operator clears the logo from an entity or deletes the entity.
2. Backend removes or archives the existing logo file from storage.
3. Backend clears the `logo_url` field on the entity.
4. When an entity is deleted, the logo asset should be archived or soft-deleted to avoid orphaned files.

### Notes

- The plan assumes asset storage is governed by the backend and is not embedded in SQLite.
- Logos must remain available after a backend restart and must resolve from the returned `logo_url`.

## SECTION 4 — API PLAN

Phase 1 requires CRUD endpoints for Sports, Countries, Competitions, and Teams.

### Sports endpoints

- `GET /sports`
- `GET /sports/:sportId`
- `POST /sports`
- `PUT /sports/:sportId`
- `DELETE /sports/:sportId`

#### Example request/response

`POST /sports`
```json
{
  "name": "Football",
  "logoUrl": "/media/logos/sports/football.png"
}
```

Response:
```json
{
  "data": {
    "id": "sport-uuid",
    "name": "Football",
    "slug": "football",
    "logoUrl": "/media/logos/sports/football.png",
    "status": "active",
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T12:00:00Z"
  }
}
```

`PUT /sports/:sportId`
```json
{
  "name": "Soccer",
  "logoUrl": "/media/logos/sports/soccer.png"
}
```

`DELETE /sports/:sportId`
- Response status: `204 No Content`

### Countries endpoints

- `GET /countries`
- `GET /countries/:countryId`
- `POST /countries`
- `PUT /countries/:countryId`
- `DELETE /countries/:countryId`

#### Example request/response

`POST /countries`
```json
{
  "name": "France",
  "iso2Code": "FR",
  "iso3Code": "FRA",
  "logoUrl": "/media/logos/countries/france.png"
}
```

Response:
```json
{
  "data": {
    "id": "country-uuid",
    "name": "France",
    "iso2Code": "FR",
    "iso3Code": "FRA",
    "logoUrl": "/media/logos/countries/france.png",
    "status": "active",
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T12:00:00Z"
  }
}
```

`PUT /countries/:countryId`
```json
{
  "name": "France",
  "logoUrl": "/media/logos/countries/france_v2.png"
}
```

`DELETE /countries/:countryId`
- Response status: `204 No Content`

### Competitions endpoints

- `GET /competitions`
- `GET /competitions/:competitionId`
- `POST /competitions`
- `PUT /competitions/:competitionId`
- `DELETE /competitions/:competitionId`

#### Example request/response

`POST /competitions`
```json
{
  "sportId": "sport-uuid",
  "countryId": "country-uuid",
  "name": "Ligue 1",
  "type": "league",
  "logoUrl": "/media/logos/competitions/ligue1.png"
}
```

Response:
```json
{
  "data": {
    "id": "competition-uuid",
    "sportId": "sport-uuid",
    "countryId": "country-uuid",
    "name": "Ligue 1",
    "slug": "ligue-1",
    "type": "league",
    "logoUrl": "/media/logos/competitions/ligue1.png",
    "status": "active",
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T12:00:00Z"
  }
}
```

`PUT /competitions/:competitionId`
```json
{
  "name": "Ligue 1 Uber Eats",
  "type": "league"
}
```

`DELETE /competitions/:competitionId`
- Response status: `204 No Content`

### Teams endpoints

- `GET /teams`
- `GET /teams/:teamId`
- `POST /teams`
- `PUT /teams/:teamId`
- `DELETE /teams/:teamId`

#### Example request/response

`POST /teams`
```json
{
  "sportId": "sport-uuid",
  "countryId": "country-uuid",
  "name": "Paris Saint-Germain",
  "shortName": "PSG",
  "type": "club",
  "logoUrl": "/media/logos/teams/psg.png"
}
```

Response:
```json
{
  "data": {
    "id": "team-uuid",
    "sportId": "sport-uuid",
    "countryId": "country-uuid",
    "name": "Paris Saint-Germain",
    "shortName": "PSG",
    "type": "club",
    "logoUrl": "/media/logos/teams/psg.png",
    "status": "active",
    "createdAt": "2026-05-30T12:00:00Z",
    "updatedAt": "2026-05-30T12:00:00Z"
  }
}
```

`PUT /teams/:teamId`
```json
{
  "name": "PSG",
  "shortName": "PSG"
}
```

`DELETE /teams/:teamId`
- Response status: `204 No Content`

### API behavior notes

- List endpoints should support search and simple filters by status, type, country, and sport.
- Delete responses should be `204` for successful deletes and `409` with an explanatory error when referential integrity prevents deletion.
- Create/update responses should return the normalized persisted entity.
- Validation errors should return `400 Bad Request` with a structured error payload.

## SECTION 5 — DESKTOP UI PLAN

Phase 1 desktop screens cover sports taxonomy management.

### Sports screen

- Fields:
  - Name
  - Logo
  - Status
- Buttons:
  - Create sport
  - Edit sport
  - Delete sport
  - Save
  - Cancel
- Table columns:
  - Logo
  - Name
  - Status
  - Created at
  - Actions
- Search:
  - Search by sport name
- Filters:
  - Status filter (active/inactive)

### Countries screen

- Fields:
  - Country name
  - ISO2 code
  - ISO3 code
  - Flag/logo
  - Status
- Buttons:
  - Create country
  - Edit country
  - Delete country
  - Save
  - Cancel
- Table columns:
  - Flag/logo
  - Name
  - ISO2
  - ISO3
  - Competitions count
  - Teams count
  - Actions
- Search:
  - Search by name, ISO2, ISO3
- Filters:
  - None required for Phase 1, optional status filter

### Competitions screen

- Fields:
  - Competition name
  - Sport selector
  - Country selector
  - Type selector (league/cup/tournament)
  - Logo
  - Status
- Buttons:
  - Create competition
  - Edit competition
  - Delete competition
  - Save
  - Cancel
- Table columns:
  - Logo
  - Name
  - Sport
  - Country
  - Type
  - Team count
  - Actions
- Search:
  - Search by competition name
- Filters:
  - Sport
  - Country
  - Type
  - Status

### Teams screen

- Fields:
  - Team name
  - Short name
  - Sport selector
  - Country selector
  - Team type selector (club/national)
  - Logo
  - Status
- Buttons:
  - Create team
  - Edit team
  - Delete team
  - Save
  - Cancel
- Table columns:
  - Logo
  - Name
  - Country
  - Sport
  - Type
  - Actions
- Search:
  - Search by team name and country
- Filters:
  - Sport
  - Country
  - Type
  - Status

### Competition membership screen (optional for Phase 1)

- Fields:
  - Competition selector
  - Team membership list
- Buttons:
  - Add team
  - Remove team
  - Save membership
- Table columns:
  - Team logo
  - Team name
  - Country
  - Type
  - Status
- Search:
  - Search available teams by name and country
- Filters:
  - Sport
  - Country

## SECTION 6 — VALIDATION RULES

### Uniqueness rules

- `sports.name` must be unique within active sports and should normalize casing for duplicate detection.
- `sports.slug` must be unique.
- `countries.iso2_code` must be unique.
- `countries.iso3_code` must be unique.
- `competitions.slug` must be unique.
- `teams` should enforce reasonable duplicate detection by name within the same sport and/or country.

### Required fields

- Sport: `name`
- Country: `name`, `iso2_code`, `iso3_code`
- Competition: `sport_id`, `country_id`, `name`, `type`
- Team: `sport_id`, `country_id`, `name`, `type`

### Logo validation

- Allowed file types: `.png`, `.jpg`, `.jpeg`, `.svg`.
- Maximum file size: 2 MB (recommended).
- Minimum dimensions: 64x64 pixels (recommended), preserve aspect ratio.
- Uploaded logos should be validated before the entity save completes.

### Deletion restrictions

- Prevent deletion of a sport that has active competitions or teams.
- Prevent deletion of a country that has active competitions or teams.
- Prevent deletion of a competition that is referenced by existing matches.
- Prevent deletion of a team that is referenced by existing matches.
- If delete is allowed, return a clear explanatory error when the entity is in use.

## SECTION 7 — DATA MIGRATION PLAN

### Impact on existing database

- Phase 1 focuses on taxonomy tables and metadata; it does not require altering runtime behavior outside of entity management.
- The existing schema already contains `sports`, `countries`, `competitions`, and `teams`, so Phase 1 should align with those tables rather than introduce new core tables.
- Any new logo fields or unique constraints are plan-level design items only and must be validated against the existing SQLite schema before implementation.

### Backward compatibility

- Existing workflows that auto-create `sports`, `competitions`, and `teams` during match assignment must continue to function until the Phase 1 explicit taxonomy workflow is fully enabled.
- New CRUD APIs must not break existing provider/channel/stream APIs.
- If a new API field or response property is introduced, it must be optional for existing clients during a transitional implementation.

### Migration approach

- Phase 1 should use a careful dual-read strategy if schema extensions are required:
  - Read existing `sports`, `countries`, `competitions`, and `teams` records normally.
  - Only add new fields (such as `logo_url`) once the schema is approved and migration is created separately.
- If a new join table is required for competition-team membership, create it as a separate migration after approval.
- Preserve existing `matches` and `streams` rows while migrating taxonomy; do not alter or delete existing operational data in Phase 1.

## SECTION 8 — TEST PLAN

### Database tests

- Verify `sports` CRUD operations persist correct rows in SQLite.
- Verify `countries` CRUD operations persist correct rows in SQLite.
- Verify `competitions` CRUD operations persist correct rows in SQLite.
- Verify `teams` CRUD operations persist correct rows in SQLite.
- Verify logo URL fields persist and remain unchanged after backend restart.
- Verify uniqueness constraints and error conditions when duplicate entities are created.

### API tests

- `GET /sports` returns all sports.
- `POST /sports` creates a sport and returns persisted data.
- `PUT /sports/:sportId` updates sport fields.
- `DELETE /sports/:sportId` deletes or deactivates sport only when allowed.
- Repeat for countries, competitions, and teams.
- Validate error payloads for missing required fields and duplicate entries.
- Validate `GET` detail endpoints return correct entity metadata including `logo_url`.

### UI tests

- Verify desktop screens render sports, countries, competitions, and teams lists.
- Verify create/edit/delete workflows for each entity through the UI.
- Verify search and filter behavior on management screens.
- Verify logo upload interactions and preview behavior in forms.
- Verify deletion prevention messaging when entities are referenced by dependent data.

### Persistence tests

- Confirm entity data persists after backend restart.
- Confirm logo references remain valid after restart and are served correctly from the backend media path.
- Confirm no duplicate entities appear after repeated create attempts.

### Restart tests

- Restart backend and verify all Phase 1 entities remain available from APIs.
- Restart desktop client and verify cached data can be refreshed from backend.
- Verify the UI can recover from a backend restart without losing form state unexpectedly.

## SECTION 9 — ACCEPTANCE CRITERIA

Phase 1 is complete only when all of the following are satisfied:

- Sports can be created, edited, and deleted.
- Countries can be created, edited, and deleted.
- Competitions can be created, edited, and deleted.
- Teams can be created, edited, and deleted.
- Logos persist after backend restart.
- Data persists in SQLite.
- No duplicate entities can be created.

## SECTION 10 — IMPLEMENTATION ORDER

### Backend files

1. `apps/backend/src/routes/sports.ts`
2. `apps/backend/src/routes/countries.ts`
3. `apps/backend/src/routes/competitions.ts`
4. `apps/backend/src/routes/teams.ts`
5. `apps/backend/src/repositories/sports-repository.ts`
6. `apps/backend/src/repositories/countries-repository.ts`
7. `apps/backend/src/repositories/competitions-repository.ts`
8. `apps/backend/src/repositories/teams-repository.ts`
9. `apps/backend/src/services/logo-storage.ts`
10. `apps/backend/src/routes/media.ts` (logo upload/delete endpoints)

### Shared types

1. `packages/shared/src/types/sports.ts`
2. `packages/shared/src/types/countries.ts`
3. `packages/shared/src/types/competitions.ts`
4. `packages/shared/src/types/teams.ts`
5. `packages/shared/src/api-client.ts` updates for new endpoints

### Desktop files

1. `apps/desktop/src/renderer/features/sports/SportsManagementScreen.tsx`
2. `apps/desktop/src/renderer/features/countries/CountriesManagementScreen.tsx`
3. `apps/desktop/src/renderer/features/competitions/CompetitionsManagementScreen.tsx`
4. `apps/desktop/src/renderer/features/teams/TeamsManagementScreen.tsx`
5. `apps/desktop/src/renderer/services/api-client.ts` updates
6. `apps/desktop/src/renderer/components/LogoUploadField.tsx`
7. `apps/desktop/src/renderer/components/EntityTable.tsx` or shared table component updates
8. `apps/desktop/src/renderer/layouts/AuthenticatedLayout.tsx` navigation entries for taxonomy screens

### Migration files

- `apps/backend/src/db/migrations/2026XXXXXX_add_logo_fields_to_sports_countries_competitions_teams.sql`
- `apps/backend/src/db/migrations/2026XXXXXX_add_competition_team_membership_table.sql`

### Tests

- `apps/backend/test/sports-repository.test.ts`
- `apps/backend/test/countries-repository.test.ts`
- `apps/backend/test/competitions-repository.test.ts`
- `apps/backend/test/teams-repository.test.ts`
- `apps/backend/test/sports-api.test.ts`
- `apps/backend/test/countries-api.test.ts`
- `apps/backend/test/competitions-api.test.ts`
- `apps/backend/test/teams-api.test.ts`
- `apps/desktop/test/SportsManagementScreen.test.tsx`
- `apps/desktop/test/CountriesManagementScreen.test.tsx`
- `apps/desktop/test/CompetitionsManagementScreen.test.tsx`
- `apps/desktop/test/TeamsManagementScreen.test.tsx`

### Notes

- The implementation order is intentionally backend-first, then shared type updates, then desktop UI, and finally tests.
- Migration files are listed for planning only and must not be created or applied until the Phase 1 design is approved.
