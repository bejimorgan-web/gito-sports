# SPORTS_DATA_IMPLEMENTATION_AUDIT

## Purpose

This audit compares the current GiTO Live Sports backend and desktop/mobile implementation to the proposed sports data architecture, lifecycle, and operator UX defined in the earlier architecture and UX documents.

It identifies what is already implemented, where the current codebase deviates from the proposed model, and what gaps should be addressed before moving to implementation.

---

## 1. Current Implementation Inventory

### 1.1 Backend data model

The current backend schema in `apps/backend/src/db/schema/initial-schema.sql` includes:

- `sports`, `regions`, `countries`
- `providers`, `channels`
- `competitions`, `seasons`, `teams`, `matches`, `streams`
- operational tables: `operational_logs`, `operator_users`, `operator_settings`, `auth_sessions`

Key observations:

- `providers` use a soft-delete flag (`deleted`) and statuses: `active`, `pending`, `failed`, `invalid`.
- `channels` are scoped to providers and have `group_name`, `external_ref`, and `url`.
- `matches` have statuses across a lifecycle and reference `competition`, `season`, `teams`.
- `streams` track assignment, approval, publish, health, and failure metrics.

### 1.2 Provider lifecycle

Implemented APIs in `apps/backend/src/routes/iptv.ts` and `apps/backend/src/repositories/provider-repository.ts`:

- Create/update provider
- Soft delete provider
- List providers and provider details
- List provider channels and categories
- Test provider connectivity for manual/m3u/xtream
- Sync provider channels for xtream and m3u providers
- Set provider status explicitly

Provider health is maintained by `updateProviderHealth()` and `availability_status` changes based on stream health events.

### 1.3 Channel ingestion and management

- Channels are ingested from provider syncs and persisted with `active/inactive` status.
- `syncProviderChannels()` updates channels by `external_ref` or `url`, reactivates matched channels, and marks missing channels inactive.
- There is no explicit channel deletion cascade.

### 1.4 Match and stream workflow

Implemented work in `apps/backend/src/routes/matches.ts`, `apps/backend/src/routes/streams.ts`, and `apps/backend/src/repositories/operations-repository.ts`:

- `POST /matches/assign-stream` creates or reuses provider/channel entities and assigns a channel to a match.
- Match assignment automatically creates `sports`, `competitions`, and `teams` if they do not exist.
- New matches are stored with status `assigned`; new streams are stored with status `assigned`.
- Approval is handled via `POST /streams/:streamId/approve`.
- Publish is handled via `POST /streams/:streamId/publish`.
- Stream health can be reported via `POST /streams/:streamId/health`.
- Health failures can transition a stream to `failed` and cancel a published match.

### 1.5 Live match feed

- `GET /live-matches/`, `/live-matches/feed`, `/live-matches/current` all return published live matches.
- `GET /mobile/matches/live` exposes the same live match list to mobile clients.
- Both feed and mobile endpoints are implemented using `listPublishedLiveMatches()`.

### 1.6 Desktop operator UX

Implemented desktop screens in `apps/desktop/src/renderer`:

- `BroadcastConsoleScreen` for the operator dashboard and live monitoring.
- `IptvManagementScreen` for provider/channel management.
- `CompetitionManagementScreen` for assignment workflows.
- `LiveMatchApprovalScreen` for approval/publish decisions.
- `StreamPreviewPanel` for channel preview before assignment.

`App.tsx` orchestrates navigation between `dashboard`, `iptv`, `preview`, `competitions`, and `approvals`, and ties UI actions to backend APIs.

### 1.7 Authentication and protection

- Protected routes exist for stream approve/publish and live match publish.
- Mobile feed endpoint is public, while the live match listing API is protected.

---

## 2. Alignment with Proposed Architecture

### 2.1 Matching the proposed model

Areas where current implementation aligns strongly:

- It has all core domain entities: sports, competitions, seasons, teams, matches, providers, channels, streams.
- It supports an operator-managed lifecycle: assign → approve → publish.
- It supports provider connectivity verification and periodic channel sync.
- It maintains health reporting and live-match discovery.
- Desktop app includes key operator surfaces: provider management, preview, match assignment, approvals, and broadcast console.

### 2.2 Functional coverage

Core workflow coverage:

- Provider onboarding: create provider, test, sync channels.
- Channel selection and preview.
- Match assignment to a selected channel.
- Stream approval and live publish.
- Live feed exposure to mobile and downstream clients.

---

## 3. Implementation Gaps and Deviations

### 3.1 Data model gaps

1. Explicit taxonomy management is weak.
   - `ensureSport()`, `ensureCompetition()`, and `ensureTeam()` auto-create taxonomy records during assignment.
   - This bypasses a deliberate operator-controlled taxonomy workflow and makes entity quality harder to govern.

2. Missing media and metadata fields.
   - No provider logo, channel logo, team crest, competition icon, or broadcast asset metadata.
   - No explicit team/country metadata used by UI beyond `name`.

3. Country/region usage is minimal.
   - `countries` and `regions` exist in schema, but there is no operator flow or API to manage them.
   - Competitions link to regions, but assignment logic ignores region classification.

4. Seasons are defined in schema but not used by the operator flow.
   - `assignChannelToMatch()` only assigns `competition_id`; `season_id` is not set from operator input.

5. Provider delete lifecycle is soft delete only.
   - Deleting a provider marks it deleted but does not automatically handle provider channels, matches, or streams still linked to those channels.
   - There is no explicit archive/unlink strategy for orphaned or in-flight streams after provider deletion.

### 3.2 API surface gaps

1. Stubbed query endpoints.
   - `GET /matches/` returns an empty array.
   - `GET /streams/` returns an empty array.
   - There is no endpoint to query existing match assignments, draft matches, or pending approvals beyond current assignment state.

2. No dedicated sports/competition/team management APIs.
   - The desktop UI has a `CompetitionManagementScreen`, but the backend lacks endpoints for CRUD on sports, competitions, or teams.
   - This makes taxonomy management impossible outside of implicit assignment.

3. Incomplete publish lifecycle.
   - `POST /live-matches/:matchId/unpublish` exists but returns 405; rollback is not supported.
   - There is no explicit `draft` or `scheduled` endpoint for preparing future content.

4. No stream proxy / playback orchestration.
   - Published playback URLs are direct channel URLs; the system does not implement a proxy or managed delivery path.
   - This is a gap relative to operator-level control and stream resilience expectations.

5. Health reporting is available but operator controls are limited.
   - There is no backend automation to automatically recover or reassign failed streams.
   - A failed health report cancels the match, which may be appropriate but should be exposed as a policy decision.

### 3.3 UX gaps

1. Operator taxonomy workflow is missing.
   - There is no explicit screen or API to manage sports / regions / competitions / teams before match assignment.
   - The UX relies on the operator entering sport, competition, and team names at assignment time.

2. Provider management UX lacks deeper status and recovery controls.
   - The existing provider view can create, test, and sync, but there is no detailed provider health dashboard or channel problem view.

3. Live operations UX is surface-level.
   - The dashboard shows live matches and stream health, but there is no explicit operator guidance for `degraded` or `failed` stream remediation.

4. No provider deletion confirmation or orphan cleanup UX.
   - Since delete is soft, there is no operator-facing workflow to understand impacts on channels and live matches.

5. Mobile experience is limited.
   - The mobile API exposes published live matches, but there is no separate mobile-specific metadata or presentation contract.
   - There is no dedicated support for discovery by sport, region, or provider in mobile endpoints.

---

## 4. Risks and Operational Concerns

### 4.1 Data integrity risk

- Auto-creation of taxonomy records during assignment can produce duplicate or inconsistent `sports`, `competitions`, and `teams`.
- Without explicit operator curation, the database may accumulate synonym noise and impair reporting.

### 4.2 Provider deletion risk

- Soft delete alone may leave active channels or published matches referencing deleted providers, causing stale or inconsistent states.
- There is no cleanup or disabled-state enforcement for streams produced from deleted providers.

### 4.3 Publish/health risk

- Publishing is allowed if a stream is `approved` and not `failed`, but the direct playback URL may still be invalid or blocked.
- Mobile/live feed exposure of a published stream relies on current stream health and active provider state; if providers are deleted or channels become inactive, the feed may become stale without explicit invalidation.

### 4.4 UX risk

- Operators may assume taxonomy control exists, while the current implementation only provides a freeform assignment flow.
- This mismatch may cause incorrect assumptions and lead to manual work around the system.

---

## 5. Recommendations

### 5.1 Stabilize the sports taxonomy flow

- Replace implicit `ensureSport()`, `ensureCompetition()`, and `ensureTeam()` auto-creation with explicit operator-managed entities.
- Add backend CRUD APIs for sports, competitions, seasons, teams, and regions.
- Add desktop screens to manage these entities before assignment.

### 5.2 Complete the query and lifecycle APIs

- Implement `GET /matches/` and `GET /streams/` to support administrative listing and dashboard views.
- Add endpoints for listing match drafts, scheduled events, pending approvals, and published/live content.
- Add a controlled `unpublish` or rollback path when needed, with clear operator guardrails.

### 5.3 Harden provider deletion semantics

- When a provider is deleted, ensure channel and stream associations are properly handled and not left in inconsistent states.
- Consider archiving related channels or marking them inactive rather than leaving them implicitly attached.
- Add operator-visible impact analysis for deletion.

### 5.4 Expand operational metadata

- Add media metadata fields for provider/logo, team crest, competition icon, and channel language/category.
- Add provider and channel status details to improve operator diagnosis.

### 5.5 Improve live feed and mobile data contracts

- Expose richer live match metadata for mobile discovery: sport, competition, teams, start time, playback rules, and provider quality signals.
- Consider a separate mobile schema for browse-by-sport/region.

### 5.6 Strengthen health and recovery flows

- Add automation or operator workflows for failed stream recovery and channel reassignment.
- Introduce monitoring that can flag degraded streams before publish or automatically surface them in the dashboard.

---

## 6. Summary

The current GiTO Live Sports implementation has a strong foundation with core data entities, provider integration, stream approval, publish flow, and live match feed.

However, it still deviates from the proposed architecture in key ways:

- taxonomy management is implicit and operator control is limited,
- provider deletion and channel lifecycle semantics are incomplete,
- admin listing APIs are stubbed,
- the desktop UX does not fully reflect the proposed sports-data management model,
- mobile/live discovery is narrow and not yet optimized for sport/region discovery.

This audit recommends first closing the taxonomy and API gaps, then extending provider and live feed metadata so implementation matches the proposed architecture and UX.
