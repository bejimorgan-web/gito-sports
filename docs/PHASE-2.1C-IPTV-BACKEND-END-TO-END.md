# GiTO Live Sports - Phase 2.1C IPTV Backend End-to-End Validation

## A. Scope

This phase validated the current IPTV implementation without redesigning the Stream Package, moving IPTV ownership, changing the desktop UI, changing mobile contracts, modifying production, or performing database migrations.

Validation covered:

- M3U parsing and import;
- Xtream validation and catalogue normalization;
- provider and channel persistence;
- catalogue filtering and pagination;
- operation cancellation and timeout behavior;
- canonical stream lifecycle;
- backend and desktop type safety;
- Flutter mobile playback-facing model parsing;
- current credential and playback URL flow.

No authorized real IPTV account was available. Real-provider and real mobile playback remain inconclusive.

## B. Current architecture

```text
IPTV provider
    -> backend IPTV validation/synchronization
    -> backend SQLite providers/channels/catalogue tables
    -> desktop catalogue API
    -> desktop channel selection and direct preview
    -> POST /matches/assign-stream
    -> streams row referencing channel_id
    -> POST /streams/:streamId/approve
    -> POST /streams/:streamId/publish
    -> GET /mobile/matches/live
    -> mobile playbackUrl
    -> direct IPTV provider playback
```

The current implementation remains backend-owned for IPTV persistence and synchronization.

Evidence:

- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/routes/matches.ts`
- `apps/backend/src/routes/streams.ts`
- `apps/backend/src/routes/mobile.ts`
- `apps/backend/src/repositories/provider-repository.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `apps/desktop/src/renderer/services/api-client.ts`
- `apps/mobile/lib/main.dart`

No backend video proxy was found in the current source.

## C. IPTV provider to desktop

### M3U

**OBSERVED in isolated tests:**

- M3U entries are parsed from inline or following-line URLs.
- `tvg-id`, `tvg-name`, `group-title`, `tvg-logo`, category metadata, and content type are preserved.
- Group metadata classifies mixed live, movie, series, and episode entries.
- Invalid entries are rejected without creating channels.
- M3U import activates a provider only after usable catalogue rows are saved.
- Provider-scoped catalogue rows remain isolated from other providers.

Evidence:

- `apps/backend/src/services/m3u-parser.ts`
- `apps/backend/src/services/m3u-catalogue-sync.ts`
- `apps/backend/src/services/iptv-validation.test.ts`
- `apps/backend/src/services/iptv-catalogue-api.test.ts`

### Xtream

**OBSERVED in isolated tests:**

- common Xtream URL forms normalize correctly;
- endpoint candidates include common API paths;
- authentication success, authentication failure, network failure, timeout, and malformed response are classified;
- live categories and streams normalize into provider-scoped channels;
- `stream_id` becomes the channel external reference;
- generated playback URLs are produced from the normalized Xtream base and account fields;
- empty or malformed catalogue responses fail explicitly;
- large synthetic channel totals are reported correctly.

No real provider request was made.

## D. Desktop to backend

### Provider creation

```text
POST /iptv/providers
```

Request fields include:

- `name`
- `baseUrl`
- `type`
- optional `authType`
- optional `syncMode`
- optional `username`
- optional `password`

Backend path:

```text
iptvRouter
  -> validateProviderConnection()
  -> testXtreamConnection() or M3U fetch/parse
  -> IPTVService.createProvider()
  -> provider repository
  -> providers table
```

Xtream provider creation returns an operation identifier for asynchronous catalogue synchronization.

### Validation

New provider validation:

```text
POST /iptv/providers/test
```

Existing provider validation:

```text
POST /iptv/providers/:providerId/test
```

### Synchronization

M3U operation:

```text
POST /iptv/operations
{ type: "m3u_import", providerId, playlist }
```

Xtream operation:

```text
POST /iptv/operations
{ type: "xtream_channel_sync", providerId }
```

Operation polling:

```text
GET /iptv/operations/:operationId
```

Cancellation:

```text
POST /iptv/operations/:operationId/cancel
```

### Catalogue browsing

Desktop uses provider-scoped catalogue requests:

```text
GET /iptv/providers/:providerId/categories
GET /iptv/providers/:providerId/channels
GET /iptv/providers/:providerId/movies
GET /iptv/providers/:providerId/series
GET /iptv/providers/:providerId/series/:seriesId/seasons
GET /iptv/providers/:providerId/seasons/:seasonId/episodes
```

The API supports pagination, search, category filtering, and status filtering. Maximum page size is 100.

### Selection and assignment

The desktop stores the selected channel in renderer state. Assignment uses:

```text
POST /matches/assign-stream
```

Payload includes match metadata and `channelId`.

The backend validates that the channel exists and has a valid HTTP/HTTPS URL, then creates or reuses a match and inserts a canonical `streams` row.

## E. Backend persistence

### Provider

Table: `providers`

Important columns:

- `id`
- `name`
- `base_url`
- `type`
- `auth_type`
- `credential_username`
- `credential_password`
- `expires_at`
- provider health fields
- lifecycle status

### Channel

Table: `channels`

Important columns:

- `id`
- `provider_id`
- `name`
- `external_ref`
- `tvg_name`
- `category_id`
- `group_name`
- `logo_url`
- `url`
- `content_type`
- lifecycle status

### Catalogue

Tables include:

- `iptv_categories`
- `iptv_movies`
- `iptv_series`
- `iptv_seasons`
- `iptv_series_episodes`
- EPG tables

### Canonical stream

Table: `streams`

Important columns:

- `id`
- `match_id`
- `channel_id`
- `protocol`
- `status`
- `approval_status`
- `health_status`
- approval metadata
- `published_at`
- timestamps

The canonical stream does not store a separate playback URL. It references `channels.url` through `channel_id`.

### Lifecycle

```text
assigned -> approved -> active/published
```

Approval:

```text
POST /streams/:streamId/approve
```

Publication:

```text
POST /streams/:streamId/publish
```

Publication requires a valid current channel URL and rejects failed health.

The canonical stream lifecycle test passed and confirmed persistence while preserving legacy scheduling tables.

## F. Backend to mobile

Mobile feed endpoint:

```text
GET /mobile/matches/live
```

Backend path:

```text
mobileRouter
  -> MatchService.listPublishedLiveMatches()
  -> operations-repository.listPublishedLiveMatches()
  -> SQLite join of matches, streams, channels, providers, teams, competitions, sports, countries
  -> { data: PublishedLiveMatch[] }
```

Only matches with:

- `matches.status = 'published'`;
- `streams.status = 'active'`;
- non-null `streams.published_at`

are returned.

The response contains match, stream, channel, provider summary, display metadata, and:

```text
playbackUrl = channels.url
```

## G. Mobile playback

Flutter path:

```text
MobileFeedService.fetchLiveMatches()
  -> GET /mobile/matches/live
  -> LiveMatch.fromJson()
  -> MatchDetailsScreen
  -> WATCH LIVE
  -> PlaybackScreen
  -> VideoPlayerController.networkUrl(Uri.parse(playbackUrl))
  -> IPTV provider
```

The current mobile player uses the direct URL. It does not call the backend for media bytes, use a GiTO redirect, or use the desktop as a relay.

Flutter model tests passed, including top-level and nested response parsing and playable stream state.

Real provider playback on Android was not performed because no authorized provider artifact was available.

## H. Credential exposure

### SOURCE VERIFIED

- IPTV username is accepted and stored in `providers.credential_username`.
- IPTV password is accepted and stored in `providers.credential_password`.
- Provider mappings can include username/password fields in backend-to-desktop provider responses.
- Xtream-generated playback URLs can embed account authentication material.
- `channels.url` stores the playback URL.
- Mobile receives `playbackUrl` from `channels.url`.

### INFERRED

A credential-bearing URL can reach a mobile client through the current published-match response even if standalone username/password fields are not included in that response.

No actual credentials or complete credential-bearing URLs were printed.

This phase observes the current behavior only. It does not redesign credential handling.

## I. Desktop shutdown

### Backend record persistence

**SOURCE VERIFIED:** publication state is persisted in backend SQLite. Desktop shutdown does not delete the backend match, stream, or publication record.

### Real playback continuity

**INCONCLUSIVE - real provider/playback artifact unavailable.**

No real stream was published or played on Android, so continuity after complete desktop shutdown was not observed.

The source shows that the current media path is direct provider playback, but source inspection alone is not a real-provider shutdown test.

## J. Tests

### Passed

- `npx tsx --test apps/backend/src/services/iptv-validation.test.ts apps/backend/src/services/iptv-catalogue-api.test.ts apps/backend/src/services/iptv-operation-manager.test.ts`
  - 32 tests passed.
- `npx tsx --test apps/backend/src/repositories/streams-repository.test.ts`
  - 1 test passed.
- `npm run typecheck -w apps/backend`
  - passed.
- `npm run typecheck -w apps/desktop`
  - passed.
- `Push-Location apps/mobile; flutter test; Pop-Location`
  - 15 tests passed.

The initial root-level `flutter test` invocation was invalid because the workspace root has no Flutter `test` directory; it was rerun from `apps/mobile` successfully.

### Test coverage demonstrated

- M3U parsing and metadata handling;
- M3U catalogue persistence and lifecycle;
- Xtream validation classifications;
- Xtream catalogue normalization;
- provider/channel identity and isolation;
- catalogue pagination/filtering;
- operation progress, cancellation, and timeout;
- canonical stream persistence;
- Flutter live-match parsing and playable-state mapping.

### Not executed

- authorized real-provider M3U test;
- authorized real-provider Xtream test;
- Android direct playback;
- real desktop shutdown playback test;
- production or Render validation;
- mutating database migration.

## K. Remaining issues

1. Real-provider validation remains unavailable, so URL lifetime, token rotation, headers, cookies, and Android compatibility are unknown.
2. The current backend stores IPTV credentials and full catalogues by design; this phase did not redesign that behavior.
3. The current mobile response can expose credential-bearing playback URLs through `playbackUrl`; this is observed and remains a security limitation.
4. There is no current end-to-end automated test that creates a match, assigns a channel, approves, publishes, fetches `/mobile/matches/live`, and asserts the final playback URL. The individual persistence and mobile parsing slices pass, but the composite path remains a test gap.
5. The checked-out branch remains divergent from `origin/main`; existing dirty changes were preserved.

No additional implementation defect was reproduced by the focused tests, so no application source fix was made in this phase.

## L. Phase gate

```text
INCONCLUSIVE
```

The current synthetic/backend workflow is validated and type-safe in the tested slices. The phase cannot be `PASS` because the real-provider and Android playback portions remain untested.

## Final status

```text
PHASE 2.1C COMPLETE

Final gate:
INCONCLUSIVE

IPTV system status:
Current M3U/Xtream validation, persistence, catalogue APIs, operation lifecycle, and canonical stream persistence pass isolated tests.

Desktop -> Backend:
Provider management, validation, catalogue browsing, channel assignment, approval, and publication routes are wired and typechecked.

Backend -> Mobile:
Published active streams are joined to channels and returned by GET /mobile/matches/live with playbackUrl derived from channels.url.

Mobile playback:
Flutter parses the published match and passes playbackUrl directly to VideoPlayerController.networkUrl; mobile tests pass.

Credential exposure:
Provider credentials are stored in backend providers, and credential-bearing channels.url values can reach mobile as playbackUrl. This is observed current behavior, not redesigned here.

Real-provider test:
INCONCLUSIVE - authorized provider unavailable.

Desktop shutdown test:
INCONCLUSIVE - real playback artifact unavailable.

Remaining blockers:
Authorized provider access, Android direct playback, real URL/token/header/cookie behavior, and a composite publication-to-mobile integration test.

Phase 2.2:
DO NOT PROCEED YET
```
