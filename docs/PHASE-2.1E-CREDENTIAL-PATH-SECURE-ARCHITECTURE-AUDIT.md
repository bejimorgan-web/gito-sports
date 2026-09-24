# GiTO Live Sports - Phase 2.1E Credential Path and Secure Architecture Audit

## 1. Executive summary

This is a read-only source and architecture audit. No source, test, schema, database, configuration, UI, dependency, Git history, deployment, or production state was changed.

The current implementation proves this credential/playback path:

```mermaid
flowchart TD
    Provider[IPTV provider credentials and catalogue]
    Desktop[Desktop provider configuration and catalogue UI]
    Backend[Backend IPTV routes and services]
    Providers[(providers table)]
    Channels[(channels table)]
    Streams[(streams table)]
    MobileAPI[GET /mobile/matches/live]
    Flutter[Flutter LiveMatch model]
    Player[video_player / VideoPlayerController]
    ProviderVideo[IPTV provider media endpoint]

    Provider -->|M3U/Xtream data| Backend
    Desktop -->|username/password/baseUrl/type| Backend
    Backend -->|credential fields| Providers
    Backend -->|channel URL/playback reference| Channels
    Desktop -->|channelId and match metadata| Backend
    Backend -->|channel_id and publication state| Streams
    Streams -->|join to channels.url| MobileAPI
    MobileAPI -->|playbackUrl| Flutter
    Flutter -->|Uri.parse(playbackUrl)| Player
    Player -->|direct media request| ProviderVideo
```

The exact current exposure point is:

```text
provider credentials
  -> Xtream/M3U playback URL
  -> channels.url in backend SQLite
  -> operations-repository.listPublishedLiveMatches()
  -> PublishedLiveMatch.playbackUrl
  -> GET /mobile/matches/live
  -> LiveMatch.fromJson()
  -> VideoPlayerController.networkUrl()
```

This is a confirmed security failure for any provider whose playback URL contains reusable account credentials. The current source has no safe authorization layer that prevents this while preserving direct Mobile-to-provider playback.

### Audit verdict

```text
RED
```

### Phase 2.2 status

```text
BLOCKED
```

Phase 2.2 must remain blocked until an authorized real provider demonstrates a non-reusable playback authorization mechanism compatible with Android direct playback and Desktop shutdown.

## 2. Repository state

Recorded at audit start:

- Branch: `main`
- HEAD: `c995602e644d0830224986f1c7d39a81af26ff23`
- `origin/main`: `c995602e644d0830224986f1c7d39a81af26ff23`
- Existing worktree: intentionally dirty with unrelated modified and untracked IPTV, schema, database, shared, desktop, and documentation work

The existing worktree was preserved. The only file created by this audit is this report.

## 3. Current architecture

The current controlled application has four relevant boundaries:

```text
Desktop renderer
  -> Backend HTTP API
  -> Backend SQLite and IPTV provider clients
  -> Mobile HTTP read model
  -> Flutter direct provider player
```

There is no explicit Stream Package or playback-authorization abstraction in the current implementation.

The canonical publication model is distributed across:

- `providers`: provider account and credential data;
- `channels`: provider channel metadata and playback URL;
- `streams`: match assignment, approval, publication, and health state;
- mobile read model: joins the stream to the channel and exposes playback data.

Relevant source:

- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/routes/matches.ts`
- `apps/backend/src/routes/streams.ts`
- `apps/backend/src/routes/mobile.ts`
- `apps/backend/src/repositories/provider-repository.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `apps/desktop/src/renderer/services/api-client.ts`
- `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`
- `apps/mobile/lib/main.dart`

## 4. Desktop path

### Provider configuration

Desktop methods in `apps/desktop/src/renderer/services/api-client.ts` include:

```text
POST /iptv/providers
PUT /iptv/providers/:providerId
POST /iptv/providers/test
POST /iptv/providers/:providerId/test
```

The provider creation/update payload can contain:

```text
name
baseUrl
type
authType
syncMode
username
password
```

The Desktop provider UI passes these values to the API client. The current shared `IPTVProvider` type also contains optional `username` and `password` fields.

### Validation

The backend route `validateProviderConnection()` in `apps/backend/src/routes/iptv.ts` performs validation. Xtream validation calls `testXtreamConnection()` in `apps/backend/src/services/xtream-codes.ts`. M3U validation fetches and parses the playlist.

The provider is contacted by the backend in the current implementation, not by a local Desktop IPTV engine.

### Desktop preview

`StreamPreviewPanel` receives a `Channel` object and uses `channel.url` as the playback source. It uses `hls.js` for HLS where applicable and native video playback otherwise.

The component has URL redaction for diagnostics, including query parameters and common Xtream path segments. That protects selected logs, but it does not prevent the raw URL from reaching the browser video element or browser network stack because the player needs the source URL.

## 5. Backend path

### Provider persistence

`apps/backend/src/repositories/provider-repository.ts` maps database fields into the shared provider object:

```text
providers.credential_username -> IPTVProvider.username
providers.credential_password -> IPTVProvider.password
providers.base_url -> IPTVProvider.baseUrl
```

The provider list and provider lookup queries select the credential columns. Therefore provider credentials can cross the backend-to-Desktop response boundary in the current contract.

### Channel persistence

`channels` contains:

| Column | Purpose | Credential-bearing possible | Mobile path |
|---|---|---:|---:|
| `id` | GiTO/provider channel row identity | No | Indirectly |
| `provider_id` | Provider association | No | Included in channel/provider projection |
| `external_ref` | M3U `tvg-id` or Xtream stream ID | No | Included in channel projection |
| `name` | Channel name | No | Yes |
| `group_name` | M3U/Xtream group metadata | No | Yes when mapped |
| `url` | Playback source URL | Yes | Yes as `playbackUrl` |
| `content_type` | Live/movie/series | No | Yes where mapped |

M3U parsing stores the source URL in the parsed channel and synchronization persists it into `channels.url`.

Xtream URL construction uses `xtreamStreamUrl()` and builds provider paths containing encoded account values for movie/series playback; the live-channel path is similarly generated by the Xtream channel normalization path. Actual values are not reproduced here.

### Stream assignment and publication

Assignment:

```text
POST /matches/assign-stream
```

The route calls `MatchService.assignChannelToMatch()`, which validates the channel and inserts a `streams` row containing `channel_id`. The canonical `streams` table does not own a separate playback URL.

Approval:

```text
POST /streams/:streamId/approve
```

Publication:

```text
POST /streams/:streamId/publish
```

Publication changes stream and match lifecycle state. It does not sanitize or replace the channel URL.

## 6. Database path

### `providers`

| Data | Current state |
|---|---|
| Provider identity | Stored |
| Base URL | Stored |
| IPTV username | Stored in `credential_username` |
| IPTV password | Stored in `credential_password` |
| Account expiry | Stored in `expires_at` where available |
| Sent to Mobile | Not intentionally as standalone fields |

### `channels`

| Data | Current state |
|---|---|
| Provider/channel identity | Stored in `id`, `provider_id`, `external_ref` |
| Display metadata | Stored |
| Playback URL | Stored in `url` |
| Credential-bearing URL | Possible and confirmed by URL construction/source model |
| Sent to Mobile | Joined into published response; URL exposed as `playbackUrl` |

### `streams`

| Data | Current state |
|---|---|
| Match identity | `match_id` |
| Channel identity | `channel_id` |
| Protocol | `protocol` |
| Approval/publication | lifecycle columns |
| Health | health columns |
| Playback URL | Not stored directly; resolved through `channels.url` |
| Sent to Mobile | Stream metadata plus joined playback URL |

### No separate authorization storage

The current schema has no first-class fields for:

- authorization kind;
- signed playback URL;
- temporary playback token;
- required playback headers;
- cookies/session state;
- playback-specific expiry;
- refresh mode;
- revocation of a playback artifact.

Provider account expiry is not equivalent to playback authorization expiry.

## 7. Mobile API path

The published live endpoint is:

```text
GET /mobile/matches/live
```

`apps/backend/src/routes/mobile.ts` calls `MatchService.listPublishedLiveMatches()`.

`apps/backend/src/repositories/operations-repository.ts` performs a SQLite join across matches, streams, channels, providers, and sports metadata. The returned object includes:

```text
match
stream
channel
provider
playbackUrl
```

The critical assignment is:

```text
playbackUrl = row.url
```

where `row.url` is selected from `channels.url`.

The response does not intentionally include standalone provider username/password fields in the published projection, but omitting those fields does not protect a credential-bearing URL.

## 8. Player path

Flutter implementation in `apps/mobile/lib/main.dart`:

```text
MobileFeedService.fetchLiveMatches()
  -> GET /mobile/matches/live
  -> LiveMatch.fromJson()
  -> json['playbackUrl']
     or stream/channel URL fallback
  -> LiveMatch.playbackUrl
  -> PlaybackScreen
  -> VideoPlayerController.networkUrl(Uri.parse(playbackUrl))
```

Current player inputs:

- URL: yes;
- custom headers: no first-class contract;
- cookies: no first-class contract;
- provider username/password: no standalone fields;
- provider bearer token: not separately modeled;
- refresh endpoint: none;
- backend media proxy: none.

The actual player destination is therefore the provider URL supplied through the Mobile API. If that URL contains reusable provider authentication, it reaches the player and the mobile device.

## 9. Exact credential exposure point

### Confirmed chain

```text
Provider account credential
  -> Xtream-generated or M3U-supplied playback URL
  -> backend channels.url
  -> operations-repository.listPublishedLiveMatches()
  -> PublishedLiveMatch.playbackUrl
  -> GET /mobile/matches/live
  -> LiveMatch.playbackUrl
  -> VideoPlayerController.networkUrl()
  -> provider media request
```

This is **CONFIRMED FROM SOURCE** as a possible path. It is not merely inferred from field names.

### What is not confirmed

The following require real authorized provider testing:

- whether a particular provider embeds reusable credentials;
- whether a particular URL has a temporary token or signed authorization;
- whether the URL expires;
- whether headers/cookies are required;
- whether the provider supports a safe mobile-consumable authorization artifact.

## 10. Confirmed, likely, and unknown findings

### Confirmed

- Backend stores provider username/password fields.
- Backend stores channel playback URLs.
- Xtream URL-building code incorporates account values into generated URLs.
- Mobile API returns `playbackUrl` sourced from `channels.url`.
- Flutter passes that value directly to the video player.
- No video proxy or credential-exchange endpoint exists in the current source.
- No explicit playback authorization abstraction exists.
- Direct Desktop preview also uses the provider URL.

### Likely

- Any provider using reusable credentials in the playback URL exposes those credentials to Mobile.
- The same URL can also appear in mobile network tooling, device logs, crash diagnostics, or analytics if those layers record the URL.
- A long-lived credential-bearing URL can be replayed by anyone who obtains it.

These are strong consequences of the source path, but actual provider URL forms require provider-specific confirmation.

### Unknown

- Provider-specific URL lifetime.
- Provider token/session behavior.
- Required headers and cookies.
- Whether Xtream `stream_id` remains stable for target providers.
- Whether M3U `tvg-id` remains stable and unique for target providers.
- Whether a provider can issue a non-reusable signed URL or playback token.
- Whether Android can consume the provider’s required authorization mechanism directly.

## 11. Desktop shutdown implications

Source-level conclusion:

- Desktop is not a media relay in the current application.
- Mobile playback after receiving a URL does not call Desktop.
- Backend is required for Mobile to retrieve the published match/feed.
- Provider availability and URL validity remain required for media playback.
- There is no current Mobile refresh path for an expired URL.

Therefore:

```text
Desktop shutdown after Mobile receives a valid URL:
  architecturally possible, provider behavior unknown.

Desktop shutdown before Mobile retrieves the feed:
  backend can still provide the published record, but whether the URL remains usable is provider-dependent.

Desktop-generated session/token:
  no current source implementation.
```

This is a source-level conclusion, not a real-provider runtime result. Phase 2.1D correctly remains `INCONCLUSIVE` because no authorized provider artifact was available.

## 12. Security requirements

The target security boundary must enforce:

### Must never reach Mobile

- IPTV username;
- IPTV password;
- reusable IPTV account token;
- credential-bearing playback URL;
- long-lived provider session credential;
- provider API credentials;
- reusable cookies;
- reusable authorization headers;
- desktop vault secrets.

### Must never reach Backend

Under the approved Desktop-owned direction:

- IPTV username/password;
- desktop vault secrets;
- full IPTV catalogue;
- unrestricted provider session state;
- reusable provider credentials.

### May reach Mobile only conditionally

- provider-issued short-lived signed URL;
- provider-issued short-lived playback token;
- narrowly scoped playback headers/cookies, only if Android support is verified;
- explicit expiry and playback status metadata.

Even a short-lived token is a bearer secret and must be excluded from logs and analytics.

## 13. Proposed secure architecture

This is a proposal only. It is not implemented by this audit.

### Desktop owns

- provider credentials;
- provider login/session;
- M3U/Xtream retrieval;
- local catalogue and identity resolution;
- provider-specific authorization preparation;
- local preview and health checks;
- redacted publication preparation.

Credentials remain in OS-protected Desktop storage and are never sent to Backend.

### Backend owns

- GiTO matches and sports data;
- assignment and approval;
- publication lifecycle;
- stable provider/channel references;
- authorization metadata and expiry where safe;
- Mobile read model;
- audit events without secrets.

Backend must not store the full IPTV catalogue or reusable IPTV credentials.

### Mobile owns

- retrieving published GiTO match data;
- consuming the current playback descriptor;
- direct provider playback;
- reporting playback status without sending raw URLs or credentials to analytics.

## 14. Proposed Mobile contract

A safe conceptual contract is:

```json
{
  "match": {
    "id": "match-id",
    "status": "published",
    "startsAt": "timestamp"
  },
  "stream": {
    "id": "published-stream-id",
    "providerChannelRef": "opaque-channel-ref",
    "playback": {
      "kind": "provider_signed_url",
      "value": "[REDACTED_OR_SHORT_LIVED_ARTIFACT]",
      "expiresAt": "timestamp"
    },
    "health": "active",
    "publication": "published"
  }
}
```

This contract is only safe when the provider artifact is not a reusable account credential. `kind` must distinguish at least:

- public URL;
- provider-issued short-lived signed URL;
- provider-issued short-lived token;
- header-bound authorization;
- cookie/session-bound authorization;
- unsupported credential-bearing URL.

The exact fields require real-provider and Android validation.

## 15. Authorization options comparison

| Option | Reusable credentials on Mobile | Desktop must remain online | Backend video proxy | Expiry/refresh | Status |
|---|---:|---:|---:|---|---|
| Raw credential-bearing URL | Yes | No | No | Provider-dependent | Reject |
| Public direct URL | No | No | No | Usually long-lived; provider-dependent | Conditional |
| Provider-issued signed URL | No, if truly scoped | No until expiry | No | Provider-controlled | Recommended if verified |
| Provider-issued short-lived token | No, if scoped | No until expiry | No | Provider-controlled | Recommended if verified |
| Desktop-only refresh artifact | No | Yes for recovery | No | Desktop-owned | Conditional only |
| Session-bound cookie | Potentially reusable | Often yes | No | Session-controlled | Usually reject |
| Backend credential resolver | Backend holds credentials | No | Not necessarily | Backend-controlled | Violates target ownership |
| Backend video proxy | Can hide provider credentials | No | Yes | Backend-controlled | Rejected by no-proxy invariant |

Provider support for signed URLs, scoped tokens, independent refresh, headers, and cookies is **REQUIRES REAL PROVIDER VALIDATION**.

## 16. Direct playback versus credential-free direct playback

Direct playback alone is not sufficient.

```text
Direct playback:
  Mobile connects to provider using whatever authorization the provider requires.

Credential-free direct playback:
  Mobile connects to provider using an artifact that does not grant reusable IPTV account access.
```

If a provider requires username/password embedded in the playback URL and offers no alternative scoped token, signed URL, or playback session, GiTO cannot satisfy all of these simultaneously:

- Mobile direct playback;
- no reusable credentials on Mobile;
- Desktop shutdown after publication;
- no Backend video proxy.

That provider/channel mode must be classified incompatible or require an explicit future architecture decision outside this audit.

## 17. Provider capability questions

Before Phase 2.2, an authorized real provider must answer:

1. Does the M3U or Xtream playback URL embed reusable credentials?
2. Is the URL permanent, signed, tokenized, or session-bound?
3. What is its lifetime and expiry signal?
4. Can the provider issue a scoped non-reusable playback artifact?
5. Can that artifact be used directly by Android?
6. Are headers, cookies, Referer, Origin, or User-Agent required?
7. Can those requirements survive Desktop shutdown?
8. Can the playback artifact be regenerated without Mobile receiving account credentials?
9. Are channel IDs/`tvg-id` values stable across refreshes?
10. Can an issued artifact be revoked or replaced?
11. Does the provider require an active session after publication?
12. Does the provider permit the target offline-after-publication window?

## 18. Required real-provider experiments

Use only an authorized provider and redacted capture:

1. Retrieve M3U twice and compare safe identity metadata.
2. Retrieve Xtream live catalogue twice and compare `stream_id` values.
3. Inspect URL structure without recording values.
4. Determine whether reusable credentials are embedded.
5. Determine whether a provider-issued short-lived artifact exists.
6. Validate direct Android playback.
7. Close Desktop completely while playback continues.
8. Restart Mobile while Desktop remains closed.
9. Test artifact expiry and refresh ownership.
10. Inspect backend/mobile responses for credential-bearing URL exposure.
11. Verify no credential-bearing URL reaches analytics or crash logs.
12. Verify backend publication remains available while Desktop is closed.

## 19. Phase 2.2 readiness gate

```text
RED
```

Reason:

- The current source exposes `channels.url` as Mobile `playbackUrl`.
- Credential-bearing URL exposure is possible and confirmed by the code path.
- No existing safe authorization layer prevents reusable provider credentials from reaching Mobile.
- Real provider capability and Android behavior remain unverified.

## 20. Recommended next step

Do not implement Phase 2.2 yet.

Obtain an authorized provider test account or sanitized provider-issued playback fixture, then execute the real-provider experiments in section 18. Only after a provider demonstrates safe direct Android playback without reusable credentials and with the required Desktop-shutdown behavior should the Stream Package contract be frozen.

## 21. Files changed

- `docs/PHASE-2.1E-CREDENTIAL-PATH-SECURE-ARCHITECTURE-AUDIT.md`

No existing source, test, schema, configuration, database, UI, dependency, or deployment file was changed.
