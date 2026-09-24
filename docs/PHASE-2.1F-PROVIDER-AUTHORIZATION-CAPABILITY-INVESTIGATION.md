# GiTO Live Sports - Phase 2.1F IPTV Provider Authorization Capability Investigation

## 1. Executive Summary

This is a read-only investigation. No application source, tests, schema, database, configuration, UI, dependency, Git history, deployment, or production data was changed.

The current GiTO source confirms that provider credentials can flow into a playback URL and then reach Mobile:

```text
provider credentials
  -> backend provider configuration
  -> M3U/Xtream playback URL
  -> channels.url
  -> PublishedLiveMatch.playbackUrl
  -> GET /mobile/matches/live
  -> Flutter LiveMatch.playbackUrl
  -> VideoPlayerController.networkUrl()
  -> IPTV provider
```

The current implementation has no separate provider authorization abstraction, no safe token exchange, no playback-specific expiry model, and no proxy. Therefore ordinary M3U/Xtream support cannot be assumed to satisfy GiTO's security requirement.

### Security verdict

```text
RED
```

### Phase 2.2 gate

```text
REMAIN BLOCKED - PROVIDER CAPABILITY MUST BE VERIFIED FIRST
```

The correct answer to the critical question is:

> **YES, BUT PROVIDER-DEPENDENT.**

Direct Mobile-to-provider playback after Desktop shutdown is technically possible only when the provider supplies a non-reusable, independently valid playback authorization. M3U and Xtream labels alone do not establish that capability.

## 2. Current GiTO Credential Path

### Desktop provider configuration

`apps/desktop/src/renderer/services/api-client.ts` sends provider configuration through:

```text
POST /iptv/providers
PUT /iptv/providers/:providerId
POST /iptv/providers/test
POST /iptv/providers/:providerId/test
```

Relevant request fields:

```text
name
baseUrl
type
authType
syncMode
username
password
```

The shared `IPTVProvider` contract in `packages/shared/src/streams.ts` also exposes optional `username` and `password` fields.

### Backend validation and storage

`apps/backend/src/routes/iptv.ts` calls `validateProviderConnection()`.

- Xtream validation calls `testXtreamConnection()` in `apps/backend/src/services/xtream-codes.ts`.
- M3U validation fetches and parses the playlist.
- `IPTVService.createProvider()` and `provider-repository.ts` persist provider data.

The schema stores:

```text
providers.credential_username
providers.credential_password
providers.base_url
providers.expires_at
```

`provider-repository.ts` maps the credential columns back to provider objects. Thus credentials can cross the backend-to-Desktop provider response boundary in the current contract.

### Catalogue and channel URL

M3U parsing in `apps/backend/src/services/m3u-parser.ts` stores the source URL in `ParsedChannel.url`. Catalogue synchronization persists it as `channels.url`.

Xtream URL construction in `apps/backend/src/services/xtream-codes.ts` builds provider playback paths using account values for generated media URLs. Actual values are not reproduced here.

### Publication and Mobile

`POST /matches/assign-stream` creates a canonical `streams` row containing `channel_id`.

`POST /streams/:streamId/approve` and `POST /streams/:streamId/publish` update lifecycle state.

`GET /mobile/matches/live` calls `MatchService.listPublishedLiveMatches()`. In `apps/backend/src/repositories/operations-repository.ts`, the published read model joins `streams` to `channels` and sets:

```text
playbackUrl = row.url
```

where `row.url` is `channels.url`.

Flutter then uses `playbackUrl` directly in `VideoPlayerController.networkUrl(Uri.parse(playbackUrl))`.

## 3. M3U Authentication Findings

### M3U standard/protocol facts

M3U is a playlist format. The HLS specification describes playlists as collections of resource URIs and notes that HLS playlist syntax derives from M3U. It does not define IPTV account login, provider username/password semantics, scoped playback tokens, device authorization, or a universal refresh protocol.

Evidence:

- RFC 8216, sections 2, 4, and 10: https://www.rfc-editor.org/rfc/rfc8216
- Current parser: `apps/backend/src/services/m3u-parser.ts`

The current GiTO parser recognizes:

- `tvg-id`;
- `tvg-name`;
- `group-title`;
- `tvg-logo`;
- category/type metadata;
- stream URI.

It does not implement a first-class authorization descriptor for headers, cookies, authorization tokens, or refresh credentials.

### Authentication conclusion

M3U itself does not provide a standard secure authorization mechanism for IPTV playback.

Authentication is therefore provider-specific and commonly appears as one or more of:

- credentials embedded in the playlist URL;
- credentials embedded in each stream URL;
- query-string tokens;
- signed URLs;
- required HTTP headers;
- cookies or provider sessions;
- an external login/session process.

The exact behavior is **PROVIDER-DEPENDENT** and was not real-provider tested in this environment.

### M3U capability classifications

| Capability | M3U standard | Provider-specific behavior | GiTO requirement |
|---|---|---|---|
| Username/password authentication | NO | PROVIDER-DEPENDENT | Must remain Desktop-only |
| Credential-bearing stream URL | NO | PROVIDER-DEPENDENT | Prohibited on Mobile |
| Signed playback URL | NO | PROVIDER-DEPENDENT | Acceptable only if scoped/non-reusable |
| Short-lived playback token | NO | PROVIDER-DEPENDENT | Acceptable only if independently valid |
| Stream-specific token | NO | PROVIDER-DEPENDENT | Required for safe direct playback |
| Device-specific token | NO | PROVIDER-DEPENDENT | Potentially acceptable; must be verified |
| Expiry | NO | PROVIDER-DEPENDENT | Must be explicit |
| Token refresh | NO | PROVIDER-DEPENDENT | Must not require Mobile account credentials |
| Cookies/session authorization | NO | PROVIDER-DEPENDENT | Usually incompatible with Desktop shutdown |
| HTTP header authorization | NO | PROVIDER-DEPENDENT | Android support must be verified |
| Android direct playback | NO | PROVIDER-DEPENDENT | Required |
| Playback after Desktop shutdown | NO | PROVIDER-DEPENDENT | Required |
| Stable channel identity | NO | PROVIDER-DEPENDENT metadata | Required separately from authorization |
| No reusable credentials on Mobile | NO | PROVIDER-DEPENDENT | Mandatory |

## 4. Xtream Authentication Findings

### What the current code proves

The current Xtream client:

- normalizes provider base URLs;
- calls common Xtream API endpoint candidates;
- sends username/password to provider API requests;
- checks `user_info` authentication state;
- reads account expiry metadata when returned;
- fetches live categories and streams;
- uses stream identifiers as catalogue references;
- generates playback URLs using provider/account values.

Relevant source:

- `apps/backend/src/services/xtream-codes.ts`
- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/repositories/provider-repository.ts`

### Xtream protocol limitation

“Xtream-compatible” is an ecosystem convention, not a single authoritative authorization standard that guarantees signed URLs or scoped playback tokens.

The current code does not establish that Xtream providers provide:

- short-lived playback tokens;
- signed URLs without account credentials;
- device-specific authorization;
- stream-specific authorization;
- refreshable Mobile-safe sessions;
- revocable playback artifacts.

Those capabilities are **PROVIDER-DEPENDENT**.

### Account expiry versus playback expiry

The code can read provider account expiry (`expires_at`), but that does not prove that a generated media URL has the same lifetime. A provider may keep a URL stable, rotate it, require a token, or require a session. This is **UNKNOWN** without authorized provider testing.

### Xtream capability classifications

| Capability | Xtream-compatible systems | Provider-specific behavior | GiTO requirement |
|---|---|---|---|
| Username/password API authentication | Common/expected | Provider-dependent details | Desktop-only |
| Credential-bearing generated URL | Common in current ecosystem patterns and current GiTO code | Provider-dependent | Prohibited on Mobile |
| Signed playback URL | Not guaranteed by protocol convention | PROVIDER-DEPENDENT | Preferred |
| Short-lived playback token | Not guaranteed | PROVIDER-DEPENDENT | Preferred |
| Stream-specific token | Not guaranteed | PROVIDER-DEPENDENT | Required for safe direct playback |
| Device-specific token | Not guaranteed | PROVIDER-DEPENDENT | Optional safe mechanism |
| Expiry | Account expiry may be reported | Playback expiry unknown | Must be explicit |
| Token refresh | Not guaranteed | PROVIDER-DEPENDENT | Must avoid Mobile credentials |
| Cookies/session authorization | Not guaranteed | PROVIDER-DEPENDENT | Must survive Desktop shutdown or be rejected |
| HTTP header authorization | Not guaranteed | PROVIDER-DEPENDENT | Android support required |
| Android direct playback | Player supports media formats, not provider policy | PROVIDER-DEPENDENT | Required |
| Playback after Desktop shutdown | Not guaranteed | PROVIDER-DEPENDENT | Required |
| Stable stream ID | Often exposed as `stream_id` | Stability unknown | Must be verified |
| No reusable credentials on Mobile | Not guaranteed | PROVIDER-DEPENDENT | Mandatory |

## 5. Android Playback Findings

The current GiTO Flutter player uses `video_player` with a direct URI and no first-class header, cookie, or token descriptor.

Android Media3/ExoPlayer documentation confirms that Android players can use injectable HTTP data sources and network stacks, including the built-in stack, Cronet, and OkHttp. Media3 also supports HLS through `HlsMediaSource` and custom `MediaSource.Factory`/`DataSource.Factory` configurations.

Sources:

- Android Media3 network stacks: https://developer.android.com/media/media3/exoplayer/network-stacks
- Android Media3 media sources: https://developer.android.com/media/media3/exoplayer/media-sources
- HLS RFC 8216: https://www.rfc-editor.org/rfc/rfc8216

This establishes player capability, not provider authorization capability.

### Android can potentially consume

- a public HTTPS HLS URL;
- a signed URL with sufficient lifetime;
- a scoped short-lived bearer token, if the player/data source receives it safely;
- custom headers, if the chosen Android data source is configured for them;
- cookies, if a controlled cookie/session mechanism is configured.

### Android limitations for this project

The current Flutter contract does not expose a structured header/cookie/token descriptor. No authorized real-provider Android test has established that target providers work with such mechanisms.

Therefore:

```text
Android player capability != provider authorization capability
```

## 6. Desktop Shutdown Analysis

### Model A - URL-contained authorization valid after shutdown

- Desktop obtains a URL.
- Backend publishes it.
- Mobile connects directly to provider.
- Desktop closes.

This satisfies the shutdown requirement only if the URL is non-reusable or otherwise safe, remains valid for the required window, and does not contain account credentials.

Result: **Potentially compatible; requires provider validation.**

### Model B - Active Desktop session required

If playback depends on Desktop memory, a Desktop HTTP server, browser state, local cookies, or a Desktop relay, playback cannot reliably start or continue after Desktop shutdown.

Result: **Incompatible.**

### Model C - Backend refresh required

If Backend refresh requires IPTV credentials, this violates the approved ownership boundary. If Backend merely stores a provider-issued, safe refresh artifact, it may be possible, but provider semantics must be proven.

Result: **Provider-dependent; not established.**

### Model D - Short-lived authorization independently refreshable by Mobile

This can satisfy Desktop shutdown only if Mobile can refresh using a non-reusable provider artifact and no account credentials, and the provider supports the flow.

Result: **Potentially compatible; requires provider and Android validation.**

### Model E - Reusable username/password URL

Mobile receives reusable account authentication in the playback URL.

Result: **Incompatible with GiTO security requirements.**

## 7. Security Model Comparison

| Approach | Classification | Reason |
|---|---|---|
| Mobile receives existing credential-bearing URL | Not secure | Mobile receives reusable provider authorization |
| Rename `playbackUrl` to `streamToken` | Not secure | Renaming does not change secret capability |
| Encrypt credential-bearing URL for Mobile | Not secure | Mobile needs decryption capability; the credential still reaches the client |
| Send username/password separately | Not secure | Direct credential exposure |
| Desktop obtains provider-issued short-lived artifact | Conditionally secure | Safe only if non-reusable, scoped, expiring, and Android-compatible |
| Backend obtains/refreshed safe artifact | Conditionally secure | Backend must not hold account credentials; artifact must be safe and provider-supported |
| Backend playback gateway/proxy | Architecturally incompatible | Could isolate credentials but violates the no-proxy invariant and adds cost/operations |
| Provider/platform with signed/scoped playback | Preferred | Best fit for direct playback and Desktop shutdown if verified |

## 8. Provider Capability Matrix

| Capability | M3U standard | Xtream-compatible systems | Provider-specific | GiTO requirement |
|---|---|---|---|---|
| Username/password authentication | NO | Commonly supported | PROVIDER-DEPENDENT | Desktop-only |
| Credential-bearing stream URL | NO | Current GiTO code can generate it | PROVIDER-DEPENDENT | Never Mobile |
| Signed playback URL | NO | UNKNOWN | PROVIDER-DEPENDENT | Preferred |
| Short-lived playback token | NO | UNKNOWN | PROVIDER-DEPENDENT | Preferred |
| Stream-specific token | NO | UNKNOWN | PROVIDER-DEPENDENT | Required for safe direct playback |
| Device-specific token | NO | UNKNOWN | PROVIDER-DEPENDENT | Optional |
| Expiry token/URL | NO | Account expiry may exist | PROVIDER-DEPENDENT | Required |
| Token refresh | NO | UNKNOWN | PROVIDER-DEPENDENT | Required if authorization expires |
| Cookies/session authorization | NO | UNKNOWN | PROVIDER-DEPENDENT | Must not require Desktop after publication |
| HTTP header authorization | NO | UNKNOWN | PROVIDER-DEPENDENT | Android support required |
| Android direct playback | NO | Player capability, not protocol capability | PROVIDER-DEPENDENT | Required |
| Playback after Desktop shutdown | NO | UNKNOWN | PROVIDER-DEPENDENT | Required |
| Stable channel identity | NO | `stream_id` commonly exposed | PROVIDER-DEPENDENT | Required separately |
| No reusable credentials on Mobile | NO | NOT GUARANTEED | PROVIDER-DEPENDENT | Mandatory |

## 9. Existing GiTO Code Path

### Credential storage

- `apps/backend/src/db/schema/initial-schema.sql`: `providers.credential_username`, `providers.credential_password`.
- `apps/backend/src/repositories/provider-repository.ts`: provider queries and `mapProvider()` expose credential fields in the shared provider object.

### M3U

- `apps/backend/src/services/m3u-parser.ts`: extracts metadata and raw stream URL.
- `apps/backend/src/services/m3u-catalogue-sync.ts`: persists catalogue records.
- `apps/backend/src/repositories/provider-repository.ts`: persists `channels.url`.

### Xtream

- `apps/backend/src/services/xtream-codes.ts`: authenticates API calls and builds stream URLs using provider account values.
- `apps/backend/src/routes/iptv.ts`: orchestrates validation and synchronization.

### Publication

- `apps/backend/src/routes/matches.ts`: `POST /matches/assign-stream`.
- `apps/backend/src/routes/streams.ts`: approval/publication endpoints.
- `apps/backend/src/repositories/operations-repository.ts`: lifecycle persistence and mobile published read model.

### Mobile

- `apps/backend/src/routes/mobile.ts`: `GET /mobile/matches/live`.
- `apps/mobile/lib/main.dart`: `LiveMatch.fromJson()` and `VideoPlayerController.networkUrl()`.
- `apps/mobile/lib/services/mobile_api_service.dart`: HTTP client wrapper for mobile APIs; live feed fetching is implemented in `main.dart`.

### Existing authorization abstraction

No explicit provider playback authorization entity, token exchange, signed URL service, header/cookie descriptor, or refresh service exists in the inspected source.

## 10. Secure Architecture Options

### Option 1 - Provider with secure playback authorization

Recommended smallest safe direction:

```text
Desktop credentials
  -> provider login/authorization
  -> provider-issued scoped/temporary playback artifact
  -> Backend stores publication metadata and artifact metadata
  -> Mobile receives artifact
  -> Mobile directly plays provider
```

Requirements:

- artifact contains no reusable account credentials;
- artifact is scoped to playback and expires;
- artifact remains valid after Desktop shutdown;
- Android can consume it;
- Mobile telemetry redacts it;
- provider supports the behavior.

Status: **REQUIRES REAL PROVIDER VALIDATION**.

### Option 2 - Controlled playback gateway/proxy

A backend or dedicated media gateway could keep provider credentials private and provide Mobile a GiTO-controlled URL. This conflicts with GiTO's explicit no-proxy invariant and adds bandwidth, cost, scaling, observability, security, and operational complexity.

Status: **Not recommended under the current invariant.**

### Option 3 - Provider-specific integration

Some providers may support a separate API/session/token flow. GiTO could implement provider adapters that produce a normalized authorization descriptor. This is more complex than raw M3U/Xtream support but preserves direct playback when the provider capability exists.

Status: **Potentially viable; provider-dependent.**

### Option 4 - Unsupported-provider policy

Reject publication for any provider/channel combination that requires reusable credentials on Mobile, active Desktop session state, unsupported headers/cookies, or a token lifetime shorter than the required offline window.

Status: **Required safety policy even if a secure provider is supported.**

## 11. Phase 2.2 Gate

```text
REMAIN BLOCKED
```

Reasons:

- current source exposes raw channel playback URLs;
- credential-bearing URLs are possible;
- M3U/Xtream standards do not guarantee scoped playback authorization;
- no target provider has demonstrated a safe artifact;
- no Android direct-playback test has validated the required authorization mechanism;
- Desktop-shutdown behavior for a real provider remains unverified.

## 12. Recommended Next Step

Do not freeze or implement the Stream Package contract yet.

Obtain an authorized provider test account or provider-issued sanitized playback artifact, then test:

1. account/API authentication;
2. generated URL structure without recording secret values;
3. whether URLs contain reusable credentials;
4. signed/scoped token availability;
5. token/URL expiry and refresh;
6. headers/cookies/session requirements;
7. Android direct playback;
8. Desktop shutdown and Mobile restart;
9. backend/mobile response redaction;
10. analytics and crash-log redaction.

Only after a provider passes those checks should a provider-specific authorization adapter and Stream Package contract be designed.

## 13. Evidence / Sources

### Repository evidence

- `apps/backend/src/services/xtream-codes.ts`
- `apps/backend/src/services/m3u-parser.ts`
- `apps/backend/src/repositories/provider-repository.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/routes/matches.ts`
- `apps/backend/src/routes/streams.ts`
- `apps/backend/src/routes/mobile.ts`
- `apps/backend/src/db/schema/initial-schema.sql`
- `packages/shared/src/streams.ts`
- `apps/mobile/lib/main.dart`
- `apps/mobile/lib/services/mobile_api_service.dart`
- `apps/desktop/src/renderer/services/api-client.ts`
- `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`

### External protocol/player references

- RFC 8216, HTTP Live Streaming: https://www.rfc-editor.org/rfc/rfc8216
  - HLS defines playlists and media resource URIs, but does not define IPTV account authentication or a universal provider token/refresh system.
  - HLS security includes HTTPS, cookies, and key delivery considerations, but provider authorization remains outside the HLS playlist format.
- Android Media3 network stacks: https://developer.android.com/media/media3/exoplayer/network-stacks
  - Media3 supports injectable HTTP data sources/network stacks, which can technically support provider-specific request behavior when implemented by the app.
- Android Media3 media sources: https://developer.android.com/media/media3/exoplayer/media-sources
  - Media3 supports HLS media sources and custom media-source/data-source configuration.

These references establish protocol/player capabilities only. They do not prove that any specific IPTV provider supports safe scoped authorization.

## Final investigation result

- Files created: `docs/PHASE-2.1F-PROVIDER-AUTHORIZATION-CAPABILITY-INVESTIGATION.md`
- Source/test/schema/config/UI/database files changed: none
- Commits created: none
- Pushes: none
- Provider login attempts: none
- Real credentials used: none
- Final security verdict: `RED`
- Phase 2.2 recommendation: `REMAIN BLOCKED`
- Exact blocker: no demonstrated provider-issued non-reusable authorization artifact compatible with direct Android playback after Desktop shutdown; current raw `channels.url -> playbackUrl` path can expose reusable credentials.
