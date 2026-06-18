# GiTO Live Sports Data Architecture Proposal

## SECTION 1 — EXECUTIVE SUMMARY

### Current shortcomings of the sports data workflow

- The existing workflow auto-creates sports entities during stream assignment, which makes operator control weak and leads to duplicated or inconsistent teams, competitions, and sports.
- Competitions are currently tied to generic `regions` rather than reusable `countries`, so geographic and league identity is not enforced.
- There is no proper operator-facing CRUD for sports entities, which means the UX forces operators to create matches by free-form text instead of selecting managed entities.

### Why operators struggle with the existing UX

- Operators cannot reliably reuse teams, competitions, or countries, so they often create duplicates with similar names.
- Scheduling workflows depend on implicit auto-creation, which hides entity ownership and breaks operator trust.
- Approval and publishing are disconnected from a managed sports hierarchy, making it difficult to audit, correct, or maintain published streams.

### Benefits of reusable sports entities

- Reusable `Country`, `Competition`, and `Team` entities prevent duplicate records and enforce consistency across matches.
- Operators can select from existing entities instead of entering names manually, reducing errors and speeding scheduling.
- A shared entity graph supports cross-match reporting, analytics, and mobile browsing by country, competition, or team.

### Benefits of logo-driven identification

- Logos make it easier to visually distinguish competitions, teams, and countries in desktop scheduling, approvals, and published match views.
- Logo branding improves operator confidence and reduces the risk of assigning the wrong match or stream.
- Logos also help mobile users identify content quickly, especially in multilingual or noisy environments.

### Benefits for mobile users and non-English speakers

- Structured metadata allows mobile clients to show competition names, logos, team names, and kickoff times without relying on free-form channel titles.
- Mobile users gain clarity from icons and logos even when text labels are translated or abbreviated.
- A reusable sports entity model supports filtering by country, competition, and team in the app, improving discoverability for global audiences.

## SECTION 2 — ENTITY MODEL

### Required entities

- Sport
- Country
- Competition
- Team
- Match
- Stream
- IPTV Provider
- Channel

### Entity definitions and relationships

#### Sport
- Represents a sport category such as football, basketball, or cricket.
- One sport contains many competitions.
- One sport contains many teams.

#### Country
- Represents a reusable geographic nation or territory.
- One country can own many competitions and many teams.
- Countries are created once and reused.

#### Competition
- Represents a league, cup, or tournament.
- One competition belongs to one sport.
- One competition is linked to one country.
- One competition contains many teams.

Supported competition types:
- `league`
- `cup`
- `tournament`

#### Team
- Represents a club or a national team.
- One team belongs to one sport.
- One team is linked to one country.
- One team can belong to many competitions.

Supported team types:
- `club`
- `national`

#### Match
- Represents a scheduled contest between two teams.
- One match belongs to one competition.
- One match optionally belongs to one season.
- One match has one home team and one away team.
- One match can have one or more streams assigned over time.

#### Stream
- Represents an IPTV delivery path for a match.
- One stream belongs to one match.
- One stream belongs to one channel.
- Streams are direct playback endpoints and are not proxied through GiTO.

#### IPTV Provider
- Represents an external IPTV source provider.
- One provider can own many channels.
- Providers expose the stream source directly; GiTO does not proxy the underlying provider streams.

#### Channel
- Represents a provider-specific channel or stream source.
- One channel belongs to one IPTV provider.
- One channel may be assigned to one or more streams over time.

### ERD-style relationship descriptions

- Sport 1 - N Competition
- Sport 1 - N Team
- Country 1 - N Competition
- Country 1 - N Team
- Competition N - N Team via `competition_teams`
- Competition 1 - N Match
- Match 1 - N Stream
- IPTV Provider 1 - N Channel
- Channel 1 - N Stream

## SECTION 3 — LOGO AND MEDIA STORAGE

### Logo storage location

- Logos are stored as media assets on the backend server filesystem or a managed asset directory accessible to the backend.
- Example storage path: `apps/backend/data/media/logos/` or `apps/backend/data/assets/logos/`.
- Database records reference logos through URL or path fields such as `logo_url`.

### Database references

- `countries.logo_url`
- `competitions.logo_url`
- `teams.logo_url`

### Update workflow

- Operators upload logo files through the desktop app.
- The backend stores each uploaded logo in the media directory and saves the resulting asset URL/path in the corresponding entity.
- On update, the backend replaces the old image reference with the new one and updates `updated_at`.
- The upload API returns the persisted URL so the desktop and mobile apps can render the new logo immediately.

### Deletion workflow

- When an operator deletes or clears a logo, the backend removes or archives the file from storage and clears the `logo_url` reference.
- The entity remains intact, preserving the sports model while removing only the visual asset.
- If an entity is deleted, its logo asset should be soft-deleted or archived to prevent orphaned media.

### Required logo visibility

Logos must appear in:
- desktop scheduling
- approvals workflows
- published matches
- mobile application

## SECTION 4 — DATABASE DESIGN

### Proposed tables and relationships

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
- `region_id TEXT NULL`
- `logo_url TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY(region_id) REFERENCES regions(id)`

#### `competitions`
- `id TEXT PRIMARY KEY`
- `sport_id TEXT NOT NULL`
- `country_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `type TEXT NOT NULL CHECK(type IN ('league','cup','tournament'))`
- `scope TEXT NULL`
- `current_season_id TEXT NULL`
- `logo_url TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY(sport_id) REFERENCES sports(id)`
- `FOREIGN KEY(country_id) REFERENCES countries(id)`

#### `competition_teams`
- `competition_id TEXT NOT NULL`
- `team_id TEXT NOT NULL`
- `role TEXT NOT NULL DEFAULT 'participant'`
- `status TEXT NOT NULL DEFAULT 'active'`
- `joined_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY (competition_id, team_id)`
- `FOREIGN KEY(competition_id) REFERENCES competitions(id)`
- `FOREIGN KEY(team_id) REFERENCES teams(id)`

#### `teams`
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
- `FOREIGN KEY(sport_id) REFERENCES sports(id)`
- `FOREIGN KEY(country_id) REFERENCES countries(id)`

#### `matches`
- `id TEXT PRIMARY KEY`
- `competition_id TEXT NOT NULL`
- `season_id TEXT NULL`
- `home_team_id TEXT NOT NULL`
- `away_team_id TEXT NOT NULL`
- `starts_at TEXT NOT NULL`
- `venue_name TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY(competition_id) REFERENCES competitions(id)`
- `FOREIGN KEY(season_id) REFERENCES seasons(id)`
- `FOREIGN KEY(home_team_id) REFERENCES teams(id)`
- `FOREIGN KEY(away_team_id) REFERENCES teams(id)`

#### `streams`
- `id TEXT PRIMARY KEY`
- `match_id TEXT NOT NULL`
- `channel_id TEXT NOT NULL`
- `protocol TEXT NOT NULL DEFAULT 'hls'`
- `status TEXT NOT NULL DEFAULT 'idle'`
- `approval_status TEXT NOT NULL DEFAULT 'idle'`
- `approved_by_user_id TEXT NULL`
- `approved_at TEXT NULL`
- `rejection_reason TEXT NULL`
- `published_at TEXT NULL`
- `health_status TEXT NOT NULL DEFAULT 'unknown'`
- `health_reason TEXT NULL`
- `failure_count INTEGER NOT NULL DEFAULT 0`
- `last_health_at TEXT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY(match_id) REFERENCES matches(id)`
- `FOREIGN KEY(channel_id) REFERENCES channels(id)`

#### `iptv_providers`
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `slug TEXT NOT NULL UNIQUE`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### `channels`
- `id TEXT PRIMARY KEY`
- `provider_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `stream_url TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `FOREIGN KEY(provider_id) REFERENCES iptv_providers(id)`

### Duplicate-prevention strategy

- Enforce unique entity keys:
  - `sports.slug`
  - `countries.iso2_code`, `countries.iso3_code`, `countries.name`
  - `competitions.slug`
  - `teams.name` scoped by sport and country where appropriate
  - `iptv_providers.slug`
- Reuse `countries` and `competitions` rather than creating new records for each match.
- Use `competition_teams` to manage membership rather than inferring teams from match assignments.
- Prevent duplicate teams and competitions by selecting existing entities in the scheduling flow.

## SECTION 5 — OPERATOR WORKFLOW

### Core workflow

Operators should be able to:

1. Create Sport
2. Create Country
3. Create Competition
4. Create Team
5. Upload Logos
6. Assign Teams to Competitions
7. Schedule Matches
8. Assign IPTV Channels
9. Approve Streams
10. Publish Streams

### Editing and deletion

Operators must be able to edit or delete:

- sports
- countries
- competitions
- teams
- matches
- streams
- providers

### Workflow details

- `Sport` creation establishes the sport domain for competitions and teams.
- `Country` creation ensures national identity is defined once and reused.
- `Competition` creation links to a sport and a country and specifies type (`league`, `cup`, `tournament`).
- `Team` creation links to a sport and country, with `club` or `national` type.
- Logo uploads attach to the entity and become visible in desktop and mobile views.
- `Competition` membership is managed via explicit team assignments rather than implicit match-based inference.
- `Match` scheduling selects competition, home team, away team, kickoff time, and venue.
- `Channel` selection assigns an IPTV source to the match stream.
- Approval marks streams as ready for publish without changing the underlying direct provider delivery.
- Publish makes the stream available in live feeds and mobile applications.

## SECTION 6 — MATCH SCHEDULING UX

### User flow

- Select Competition
- Select Home Team from competition participants
- Select Away Team from competition participants
- Set Date/Time
- Assign IPTV Channel
- Submit for Approval
- Publish when approved

### UX guarantees

- No free-form duplication of teams or competitions.
- Teams are chosen from the managed competition roster.
- Competitions are selected from existing reusable records.
- The match scheduling form validates that both teams belong to the same competition or are permitted to face each other.
- The match record stores explicit entity relationships, making schedule data clean and repeatable.

## SECTION 7 — STREAM MANAGEMENT UX

### Required controls

- Edit Stream
- Delete Stream
- Unpublish Stream
- Reassign Channel
- Reapprove Stream

### UX behavior

- Streams can be edited after approval, preserving the published match record.
- Deleting a stream should remove only the stream assignment, not the match or team entities.
- Unpublish is allowed on published streams and keeps the underlying match intact.
- Reassigning a channel updates the direct provider stream without proxying through GiTO.
- Reapproval is available when stream metadata or assignment changes.

### Published stream management

- Published streams remain manageable and must not become immutable.
- The operator interface should show status transitions clearly: `draft` → `pending approval` → `approved` → `published`.
- Stream health and provider/channel metadata must remain visible after publish.

## SECTION 8 — MOBILE APP REQUIREMENTS

### Published matches must expose

- competition name
- competition logo
- home team name
- home team logo
- away team name
- away team logo
- kickoff time
- stream status

### Mobile behavior

- Mobile clients should consume published match feeds with full entity metadata.
- Logos should display consistently for competition and teams.
- Kickoff times should be normalized and surfaced in local time.
- Stream status should reflect publish readiness and health.

## SECTION 9 — DATA INTEGRITY RULES

### Architecture invariants

- Countries are unique by name and ISO codes.
- Teams are unique and managed as reusable entities.
- Competitions are unique by slug and linked to a single country.
- No duplicated sports entities are created through free-form match entry.
- Deleting entities must not orphan dependent records; foreign key constraints and soft-delete semantics should preserve integrity.
- SQLite persistence must survive backend restarts and remain the authoritative store.
- Stream delivery must remain direct from IPTV providers and must not be proxied through GiTO.
- No stream proxying is permitted; GiTO only assigns and manages provider streams.

## SECTION 10 — PHASED IMPLEMENTATION PLAN

### Phase 1: Sports, Countries, Competitions, Teams

- Implement reusable entity CRUD for `sports`, `countries`, `competitions`, `teams`.
- Add required entity metadata fields and status lifecycle.
- Ensure operator UX supports entity creation and selection.

### Phase 2: Logos and media management

- Add logo storage and `logo_url` support for `countries`, `competitions`, and `teams`.
- Implement logo upload/update/delete flows.
- Surface logos in desktop scheduling and approval screens.

### Phase 3: Competition membership management

- Implement `competition_teams` membership.
- Enable explicit team assignment to competitions.
- Prevent match scheduling with teams outside the chosen competition unless explicitly allowed.

### Phase 4: Match scheduling redesign

- Redesign match scheduling to select managed competitions and teams instead of free-form entity creation.
- Add validation for team membership and competition consistency.
- Persist match metadata with strong foreign key relationships.

### Phase 5: Stream management redesign

- Implement editable stream lifecycle controls: edit, delete, unpublish, reassign channel, reapprove.
- Preserve `approved` and `published` state while allowing operator corrections.
- Maintain direct provider stream delivery with no proxy.

### Phase 6: Mobile app enhancements

- Update mobile feeds to include competition/team logos and metadata.
- Ensure mobile published matches expose the required fields.
- Support browsing or filtering by sport, country, competition, and team where appropriate.

## SECTION 11 — MIGRATION STRATEGY

### Existing matches migration

- Preserve current `matches` rows and map them to the new managed entity model.
- Backfill `competition_id`, `home_team_id`, and `away_team_id` with existing match references.
- If duplicate teams or competitions exist, consolidate them using slug/name normalization.

### Existing streams migration

- Preserve existing `streams` rows and maintain `match_id` and `channel_id` associations.
- Migrate approval and published metadata into the redesigned stream lifecycle fields.
- Ensure that stream health and publish state remain intact after migration.

### Existing providers/channels migration

- Preserve all existing `iptv_providers` and `channels` records.
- Continue to use the provider/channel model without changing direct stream delivery semantics.
- Ensure provider status remains editable and channel assignments remain valid.

### Avoiding data loss

- Use migration scripts or data backfill processes that read current records and write new relationships without dropping existing tables.
- Perform data validation after migration to confirm no matches, streams, providers, or channels are lost.
- Retain old entity references until the new model is verified and stable.
- Soft-delete entities rather than hard-delete during transition to maintain referential integrity.

---

> This proposal is architecture-only. No source code or database schema changes are made here. Implementation begins only after approval.
