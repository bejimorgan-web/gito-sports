# GiTO Live Sports UX Specification

## SECTION 1 — DESIGN PRINCIPLES

### Operator-first workflow
- The UI is built for operators who manage sports data, schedule matches, approve streams, and publish live events.
- Every screen should support quick creation, editing, and correction without requiring database access or developer intervention.
- Primary actions are visible and optimized for task completion.

### Reusable sports entities
- Sports, countries, competitions, and teams are managed as shared entities.
- Operators select existing entities rather than retyping names for each match.
- Reuse prevents duplicates and supports consistent scheduling, approvals, and mobile delivery.

### Minimal duplication
- The system must prevent creating duplicate sports entities by using selection controls and search-as-you-type.
- Duplicate checks should run during create/edit workflows and surface near-misses on save.
- Free-form match entry is replaced by managed entities.

### Logo-first identification
- Logos are primary visual cues for sports, countries, competitions, and teams.
- UI lists and cards display logos next to names to help operators identify entities quickly.
- Logos are present in scheduling, approvals, published streams, and mobile views.

### Fast scheduling workflow
- Scheduling should be a linear, minimal-step flow.
- The core flow is: competition → home team → away team → kickoff → save.
- IPTV assignment and approval are separate but adjacent steps to avoid overloading the scheduling form.

### Persistence of all data and settings
- All operator actions persist in SQLite and survive backend restarts.
- The UI should confirm save success and show persisted saved state.
- Settings and entity metadata remain available across sessions.

### Direct IPTV stream delivery (no proxying)
- The UX must clearly show that the channel stream is delivered directly from the provider.
- Providers and channels are configured as external sources; GiTO manages assignment and metadata only.
- No interface should imply proxy ingestion of stream content.

## SECTION 2 — APPLICATION NAVIGATION

### Proposed navigation structure

#### Dashboard
- Summary of active matches, pending approvals, published streams, provider health, and recent activity.
- Quick links to schedule a match, assign a stream, and review approvals.

#### Sports Management
- Sports
- Countries
- Competitions
- Teams

#### IPTV Management
- Providers
- Channels
- Categories

#### Match Operations
- Schedule Matches
- Stream Assignment
- Approvals
- Published Streams

#### Settings
- Application settings
- Media upload settings
- User preferences

### Expected navigation flow
- Operators start on Dashboard for overall status.
- Sports Management is used first to define the entity model.
- IPTV Management configures providers and channels before channel assignment.
- Match Operations is the primary operational area for scheduling, assigning, approving, and publishing.
- Settings is secondary and used for environment and asset management.

## SECTION 3 — SPORTS MANAGEMENT SCREEN

### Fields
- Sport Name
- Description
- Logo

### Actions
- Create
- Edit
- Delete
- Search
- Filter by status (active/inactive)

### Display
- Logo
- Name
- Creation date
- Status

### Notes
- Sports are a lightweight entity; their management screen should be simple.
- Search should allow case-insensitive matching on name.
- Delete should require confirmation and prevent orphaned competitions.

## SECTION 4 — COUNTRIES SCREEN

### Fields
- Country Name
- Flag / Logo

### Actions
- Create
- Edit
- Delete
- Search

### Display
- Flag
- Country name
- Competitions count
- Teams count

### Notes
- Countries must be reusable and selected for competitions and teams.
- Country entries should include count badges for competitions and teams.
- Search should support name and ISO codes if present.

## SECTION 5 — COMPETITIONS SCREEN

### Fields
- Competition Name
- Country
- Type: League, Cup, Tournament
- Logo

### Actions
- Create
- Edit
- Delete
- Search
- Filter by type and country

### Display
- Logo
- Competition name
- Country
- Team count

### Notes
- Competition type should be explicit and selectable.
- Country selection must be required.
- Team count should reflect competition membership.

## SECTION 6 — TEAMS SCREEN

### Fields
- Team Name
- Team Type: Club, National Team
- Country
- Logo

### Actions
- Create
- Edit
- Delete
- Search
- Filter by sport, country, and type

### Display
- Logo
- Team name
- Country
- Competitions count

### Notes
- Team creation requires country and sport.
- National teams are clearly marked by type.
- Search should match team name and country.

## SECTION 7 — COMPETITION MEMBERSHIP SCREEN

### Workflow
- Select Competition
- Select Teams to add
- Save membership

### Requirements
- Add team
- Remove team
- Search team
- Prevent duplicates

### Display
- Competition header with logo
- Current team roster with logos, names, country, and type
- Search input for filtering available teams
- Candidate team list with Add action

### Notes
- Duplicate membership is prevented by disabling Add for already-attached teams.
- Teams are added from the shared pool, not created inline.
- Team logos appear in the membership list.

## SECTION 8 — IPTV PROVIDERS SCREEN

### Improved workflow
- Create provider
- Edit provider
- Delete provider
- Activate provider
- Deactivate provider
- Test credentials
- Sync channels

### Display
- Provider name
- Status
- Channels imported
- Categories imported
- Last validation result

### Notes
- Provide clear validation feedback after test and sync actions.
- Deactivate should keep existing channel assignments but prevent new assignments from inactive providers.
- Sync should pull category and channel metadata and show imported counts.
- Validation results should include success/failure and a short detail message.

## SECTION 9 — CHANNEL MANAGEMENT SCREEN

### Display
- Channel name
- Category
- Provider
- Status

### Features
- Search
- Category filter
- Provider filter
- Status filter

### Notes
- Group channels by category similar to IPTV applications with category headings.
- Provide a provider badge on each channel row.
- Search should match channel name, category name, and provider name.

## SECTION 10 — MATCH SCHEDULING SCREEN

### Workflow
- Select Competition
- Select Home Team
- Select Away Team
- Set Kickoff
- Save

### Display
- Competition logo
- Competition name
- Home team logo
- Away team logo
- Kickoff time

### Notes
- The screen should prevent manual typing of team or competition names by using selection controls.
- Team selection should show only teams belonging to the selected competition.
- The schedule list should surface competition and team logos for each match.
- The save action should validate unique home/away teams and scheduled time.

## SECTION 11 — STREAM ASSIGNMENT SCREEN

### Workflow
- Select Match
- Select Provider
- Select Channel
- Assign

### Display
- Competition logo
- Team logos
- Provider
- Channel

### Notes
- Only active providers and active channels are selectable.
- The assignment form should show current match metadata and logos prominently.
- The channel list should filter by selected provider and category.
- Once assigned, the stream record should appear in the approval queue.

## SECTION 12 — APPROVALS SCREEN

### Display
- Match name and date
- Competition and team logos
- Assigned channel
- Provider
- Category (if available)
- Current approval status

### Actions
- Approve
- Reject
- Edit
- Delete

### Notes
- Approval cards should show all required context to decide: match, teams, competition, provider, and channel.
- Edit should allow stream metadata and channel reassignment before approval.
- Reject should optionally capture a rejection reason.
- Delete removes the stream assignment while preserving the match.

## SECTION 13 — PUBLISHED STREAMS SCREEN

### Display
- Competition logo
- Competition name
- Home team logo
- Away team logo
- Stream status
- Provider
- Channel
- Published timestamp

### Actions
- Edit
- Unpublish
- Delete
- Reassign channel

### Notes
- Published streams remain manageable and editable.
- Unpublish should not delete the match or stream metadata; it only withdraws live status.
- Reassign channel should allow changing the active provider channel while preserving the publish lifecycle.

## SECTION 14 — MOBILE APPLICATION DISPLAY

### Published match presentation
- Competition logo
- Competition name
- Home team logo
- Home team name
- Away team logo
- Away team name
- Kickoff time
- Live status

### Notes
- The mobile view prioritizes visual identification over text.
- Logos enable users to identify matches even without reading the language.
- Live status should be clearly labeled as `Live`, `Upcoming`, or `Ended`.
- Kickoff time should be displayed in local device time.

## SECTION 15 — SEARCH AND FILTER STRATEGY

### Search
- Global search across sports, competitions, teams, providers, and channels.
- Competition search by name and country.
- Team search by name and country.
- Provider search by name and status.
- Channel search by channel name, category, and provider.

### Filter
- Filter competitions by country and type.
- Filter teams by sport, country, and type.
- Filter providers by status and validation state.
- Filter channels by provider, category, and status.
- Filter matches by competition, status, and date range.

## SECTION 16 — LOGO DISPLAY RULES

### Logo visibility
- Sports: logo shown in the sports list and entity detail.
- Countries: flag/logo shown in the countries list and selection controls.
- Competitions: logo shown in competition cards, selection dropdowns, and scheduling rows.
- Teams: logo shown in team roster lists, selection dropdowns, and match cards.
- Scheduling: competition and team logos appear in the schedule form and match list.
- Approvals: all logos appear on approval cards for fast visual validation.
- Publishing: published stream rows show competition and team logos.
- Mobile app: every published match card includes competition and team logos.

### Logo presentation rules
- Use square or rounded square thumbnails consistently.
- Show fallback initials if no logo is available.
- Keep logo size consistent across lists and cards.

## SECTION 17 — EDIT AND DELETE RULES

### Supported entity management
Every managed entity must support:
- Edit
- Delete

### Entities included
- Sports
- Countries
- Competitions
- Teams
- Matches
- Streams
- Providers

### Notes
- Delete actions require confirmation and must preserve referential integrity.
- Soft-delete or status-based deactivation is preferred for entities with dependent records.
- Operators should use the UI for routine corrections rather than direct database access.
- Edit actions should expose all editable fields and update persisted data immediately.

## SECTION 18 — IMPLEMENTATION PRIORITY

### Phase 1
- Countries
- Competitions
- Teams

### Phase 2
- Logos

### Phase 3
- Competition membership

### Phase 4
- Scheduling

### Phase 5
- Stream management

### Phase 6
- Mobile presentation

### Notes
- Phase 1 establishes the reusable entity model.
- Phase 2 adds visual identity to make the model usable in production.
- Phase 3 formalizes team membership before match scheduling.
- Phase 4 enables reliable match creation with managed entities.
- Phase 5 delivers the approval and publish lifecycle.
- Phase 6 ensures mobile users receive the full branded experience.

---

> This specification is UX-only and intended for review and approval prior to implementation.
