# GiTO Live Sports - Phase 2.1 Playback and Identity Experiments

## Scope and safety

This is a validation report only. No production service, production database, local database, UI, configuration, environment variable, package dependency, or Git history was changed.

The reconciled controlled baseline is `origin/main` at `78efcf38269f4b12580f43678a32f97da0cd950e`. The checked-out worktree is a divergent, intentionally dirty branch at `f241730e6785ccf080f6f6f9f03b29e2443814bc`; it was inspected but not reconciled.

No real credentials, tokens, or credential-bearing URLs appear in this report.

## 1. Executive summary

The current controlled implementation has this playback path:

```text
Provider -> backend IPTV sync -> backend SQLite channels.url
Desktop -> backend catalogue API -> direct provider preview
Desktop -> backend assignment/approval/publication
Mobile -> backend live-match API -> direct provider playback
```

The current implementation does not have an explicit Stream Package. A canonical `streams` record references a `channels` record; the mobile read model then exposes `channels.url` as `playbackUrl`.

The proposed architecture is technically viable only for provider/channel combinations that can supply a direct-playback authorization which:

- does not contain reusable IPTV account credentials;
- works from the mobile client without a GiTO video proxy;
- remains valid for the required playback window without the desktop remaining online; and
- is supported by the target mobile player, including any required headers or cookies.

Static source inspection validates the current data path and the absence of a proxy, but it cannot validate provider-specific URL lifetime, token behavior, headers, cookies, or identity stability. Those items remain experiments, not assumptions.

## 2. Repository state

Recorded before the report edit:

- Branch: `main`
- HEAD: `f241730e6785ccf080f6f6f9f03b29e2443814bc`
- `origin/main`: `78efcf38269f4b12580f43678a32f97da0cd950e`
- Modified tracked files: 20
- Untracked files: 7
- Existing changed/untracked paths: 27

The initial and final status listings were identical except for this report file, which is the requested deliverable. Existing changes were not reverted, staged, or cleaned.

## 3. Current playback architecture

### Verified source path

1. IPTV provider data is fetched by backend code in `apps/backend/src/routes/iptv.ts` and `apps/backend/src/services/xtream-codes.ts`.
2. M3U and Xtream records are persisted into backend catalogue tables.
3. The desktop requests catalogue pages through `apps/desktop/src/renderer/services/api-client.ts`.
4. `IptvCatalogueScreen` maps catalogue `playbackReference` to `Channel.url`.
5. `StreamPreviewPanel` uses the selected `Channel.url` directly.
6. `POST /matches/assign-stream` stores `channel_id` in `streams`.
7. `POST /streams/:streamId/approve` and `POST /streams/:streamId/publish` update publication state.
8. `GET /mobile/matches/live` calls `MatchService.listPublishedLiveMatches()`.
9. `operations-repository.ts` joins `streams` to `channels` and returns `playbackUrl: row.url`.
10. Flutter parses `playbackUrl` in `LiveMatch.fromJson()`.
11. `PlaybackScreen` creates `VideoPlayerController.networkUrl(Uri.parse(playbackUrl))`.

Evidence:

- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/repositories/operations-repository.ts`, `listPublishedLiveMatches()`
- `apps/backend/src/routes/mobile.ts`, `GET /matches/live`
- `apps/desktop/src/renderer/features/iptv/IptvCatalogueScreen.tsx`
- `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`
- `apps/mobile/lib/main.dart`, `LiveMatch.fromJson()` and `PlaybackScreen`

### Proxy and redirect findings

- No video proxy route is mounted in `apps/backend/src/app.ts`.
- No backend media relay, token exchange, playlist rewriting, or redirect handler was found.
- Desktop preview contacts the provider directly.
- Mobile playback contacts the provider directly.

Result: **VERIFIED FROM SOURCE** - the current application does not proxy video.

## 4. Credential exposure findings

### Current implementation

The controlled schema contains `providers.credential_username` and `providers.credential_password`. The provider repository maps these fields to the shared `IPTVProvider.username` and `IPTVProvider.password` fields.

Evidence:

- `apps/backend/src/db/schema/initial-schema.sql`, `providers`
- `apps/backend/src/repositories/provider-repository.ts`, `mapProvider()` and provider queries
- `packages/shared/src/streams.ts`, `IPTVProvider`

The published mobile projection does not intentionally include provider username/password fields. However, `playbackUrl` is taken directly from `channels.url`, and Xtream-style generated URLs can contain authentication material.

Result: **VERIFIED FROM SOURCE** - reusable credentials can be exposed through a credential-bearing playback URL even when username/password fields are omitted from the JSON object.

### Security classification

| Mechanism | Result | Reason |
|---|---|---|
| Public, non-secret direct URL | Conditionally safe | Still shareable and must be revocable or short-lived where possible |
| URL containing reusable username/password | Unsafe | Mobile and network observers receive account credentials |
| Provider-issued short-lived token | Conditionally safe | Token is still a bearer secret and requires expiry/replay controls |
| Required custom headers | Conditionally safe | Must be supported by mobile without exposing account secrets |
| Required cookies | High risk / requires experiment | Mobile persistence, sharing, and replay behavior must be tested |
| Desktop-only refresh | Incompatible with full offline requirement | Playback cannot recover while desktop is closed |
| Backend credential-based resolution | Not permitted | Backend must not own IPTV credentials |
| Backend video proxy | Rejected | Violates the no-proxy requirement |

## 5. Desktop-offline playback findings

### Verified behavior

Once mobile has received a playback URL, there is no code path requiring the desktop for the media request. Therefore an already-open player can continue independently of the desktop if the provider accepts the URL.

The mobile feed itself requires the backend. There is no local mobile feed persistence or playback URL refresh path.

### Conditions

| Condition | Expected result |
|---|---|
| Long-lived direct authorization | Playback can continue after desktop shutdown |
| Temporary authorization still valid | Playback can continue until expiry |
| Authorization expires | Playback fails unless a new artifact is obtained |
| Provider requires desktop session | Playback cannot continue after desktop shutdown |
| Provider URL changes | Existing published URL may fail; no automatic repair exists |
| Backend is unavailable after mobile has loaded the URL | Existing playback may continue; feed refresh cannot occur |
| Backend is unavailable before mobile loads the match | Mobile cannot obtain playback information |

Provider URL lifetime is **UNKNOWN - REQUIRES EXPERIMENT**.

## 6. Expiry findings

The controlled backend stores Xtream account expiry in provider metadata through `expires_at`. This is account expiry, not proof of playback URL expiry.

No current source path was found for:

- stream URL expiry;
- playback token refresh;
- signed URL regeneration;
- mobile playback-session refresh;
- automatic replacement of a published URL.

The current implementation can therefore detect some provider/account metadata during validation, but it cannot guarantee that a published playback URL remains valid.

### Required expiry experiment

Use a synthetic provider that can issue a valid URL, a near-expiry URL, an expired URL, and a refreshed URL. Record only status codes and redacted metadata. Test whether the mobile player can recover without a new backend response.

Status: **NOT EXECUTED - SAFE PROVIDER FIXTURE NOT PRESENT**.

## 7. URL-change findings

The current canonical identity is not fully separated from playback data:

- `streams.channel_id` identifies the selected channel;
- `channels.url` contains the current stored playback URL;
- publication resolves the URL from the channel at publication time;
- mobile receives the resolved URL.

The provider repository performs deduplication using provider-scoped identifiers and URL/name comparisons, but the source does not prove universal provider identity stability.

If a provider changes a URL while retaining the logical channel identity, the current published package has no independent authorization refresh mechanism. The old URL can fail until a desktop/backend catalogue update and republish path replaces it.

Result: **VERIFIED FROM SOURCE** - stable identity and playback authorization are not currently separate enough for safe migration.

## 8. M3U identity findings

The parser extracts:

- `tvg-id` as `externalRef`;
- `tvg-name`;
- display name;
- `group-title`;
- group/category identifiers;
- logo URL;
- content type;
- stream URL;
- optional series, season, and episode metadata.

Evidence: `apps/backend/src/services/m3u-parser.ts` and `packages/shared/src/operations.ts` (`ParsedChannel`).

### Identity evaluation

| Candidate | Same URL | URL changes | Name changes | Reorder | Group changes | Duplicate ID | Missing ID |
|---|---:|---:|---:|---:|---:|---:|---:|
| Provider identity alone | No | No | No | No | No | No | No |
| Provider + `tvg-id` | Yes | Yes, if ID stable | Yes | Yes | Yes | No | No |
| Provider + normalized URL | Yes | No | Yes | Yes | Yes | No | No |
| Provider metadata ID | Yes | Yes, if stable | Yes | Yes | Yes | Provider-dependent | Provider-dependent |
| Name + group | Usually | Usually not | No | Yes | No | No | Yes |
| Deterministic fallback hash | Yes | No if URL is included | No if name included | Yes | No if group included | No | Yes |

### Recommendation

Use a versioned identity strategy:

1. provider fingerprint;
2. provider-side stable ID where available;
3. M3U `tvg-id` where unique and stable;
4. provider metadata identity;
5. normalized URL with volatile authorization removed;
6. deterministic fallback marked `identityConfidence = low`.

Duplicate and missing identities must remain separate records requiring operator review. Identity confidence must be stored and must not silently promote a URL hash to a permanent identity.

The scenarios requested in the brief were not run against a controlled fixture. Results above are source-informed design analysis, not provider behavior claims.

## 9. Xtream identity findings

Xtream records expose stream/category identifiers and generated playback URLs. The preferred logical identity is:

```text
providerFingerprint + contentType + providerStreamId
```

Fallback identity should use a versioned provider-specific strategy based on stable metadata. URL alone must not be the primary identity because credentials, tokens, hostnames, or paths may change.

The source cannot establish whether real providers keep stream IDs stable across:

- URL changes;
- name changes;
- category changes;
- provider migrations;
- repeated synchronization.

Result: **UNKNOWN - REQUIRES PROVIDER-SPECIFIC EXPERIMENT**.

## 10. Headers, cookies, and tokens

The current controlled M3U parser stores the stream URL and playlist metadata but does not define a first-class parsed model for required headers, cookies, referrer, origin, or user-agent.

The current shared `Channel` and `ParsedChannel` contracts also do not provide a complete playback-authorization descriptor.

The source therefore proves only that plain URL playback is implemented. It does not prove that all target providers require only plain URLs.

| Capability | Source result |
|---|---|
| Plain direct URL | Implemented and verified |
| Temporary URL | Not modeled; experiment required |
| Provider token | Not modeled as a separate artifact; experiment required |
| Custom headers | Not represented in current channel contract |
| Cookies | Not represented in current channel contract |
| Authorization header | Not represented in current channel contract |
| Refresh token | Not implemented |
| Desktop refresh | Not implemented for published mobile playback |
| Playback after desktop shutdown | Works only if the already-issued authorization remains valid |
| Mobile direct playback with headers/cookies | UNKNOWN - REQUIRES DEVICE EXPERIMENT |

## 11. Stream Package field evaluation

The following is a prototype evaluation only. It is not a production schema.

| Field | Necessary | Sensitive | Creator | Backend stores | Mobile reads |
|---|---:|---:|---|---|---|
| `stableStreamId` | Yes | No | Desktop/backend | Yes | Usually opaque ID |
| `matchId` | Yes | No | Backend | Yes | Yes |
| `providerReference` | Yes | Low | Desktop | Yes | Usually no |
| `channelReference` | Yes | Low | Desktop | Yes | Usually no |
| `playbackMode` | Yes | No | Desktop | Yes | Yes |
| `playbackUrl` or authorization descriptor | Conditional | High | Desktop/provider | Minimal or encrypted/short-lived | Yes when direct playback requires it |
| `requiredHeaders` | Conditional | High | Desktop/provider | Avoid unless necessary | Only if mobile supports them |
| `requiredCookies` | Conditional | High | Desktop/provider | Avoid | Only if mobile supports them |
| `issuedAt` | Yes | No | Desktop | Yes | Optional |
| `expiresAt` | Conditional | No | Desktop/provider | Yes | Yes when relevant |
| `refreshMode` | Yes | No | Desktop | Yes | Yes as a capability/status |
| `healthState` | Yes | No | Desktop/backend | Summary only | Yes |
| `publicationState` | Yes | No | Backend | Yes | Yes |
| `revokedAt` | Conditional | No | Backend | Yes | Optional |

The backend must never receive:

- reusable IPTV username/password;
- desktop vault keys;
- full provider catalogue;
- unrestricted provider session state;
- unredacted diagnostic URLs in logs.

## 12. Authorization-model comparison

Scores are qualitative and based on current source constraints.

| Model | Security | Offline desktop | Compatibility | Complexity | Decision |
|---|---|---|---|---|---|
| A. Raw provider URL | Low to conditional | Good while valid | High | Low | Reject for credential-bearing URLs |
| B. Backend resolves stable reference | Conditional | Good | Low without backend credentials | Medium | Reject under no-credential backend rule |
| C. Desktop-issued temporary descriptor | Good if non-reusable | Good until expiry | Provider-dependent | Medium | Recommended |
| D. Desktop-assisted refresh | Good | Fails when refresh is needed offline | Medium | High | Conditional fallback only |
| E. Backend video proxy | Can isolate credentials | Good | High | Very high | REJECTED - violates architecture |

## 13. Provider capability classification

| Class | Capability | Compatibility |
|---|---|---|
| A | Direct stable playback without reusable credentials | Compatible |
| B | Direct temporary playback valid after desktop shutdown | Compatible until expiry |
| C | Playback refreshable by desktop | Conditional; desktop must be online for recovery |
| D | Session-bound playback requiring active desktop/provider session | Incompatible with offline-after-publication requirement |
| E | Reusable account credentials required in client URL | Incompatible unless provider offers another authorization mode |

Classification is a target policy. Actual provider assignment requires experiments.

## 14. Mobile contract recommendation

The target mobile response should contain only:

```text
match
streamPackageId
publicationState
playbackMode
playbackAuthorization
authorizationExpiresAt
streamHealth
```

It must not contain:

- IPTV username;
- IPTV password;
- provider base credentials;
- complete catalogue data;
- desktop installation data;
- local sync state.

If direct playback requires a provider-issued bearer token or temporary URL, that artifact will necessarily be visible to mobile. The security requirement is therefore to prevent reusable account credentials from being included, not to pretend that all playback authorization can remain secret from the player.

## 15. Electron boundary

The current Electron shell already uses `contextIsolation: true` and `nodeIntegration: false` in `apps/desktop/electron/main.ts`.

Future ownership should be:

### Main process

- local SQLite;
- IPTV clients;
- sync workers;
- provider validation;
- OS credential vault;
- health checks;
- playback authorization preparation;
- backup/restore;
- IPC authorization.

### Renderer

- existing UI unchanged;
- presentation and operator interaction only;
- no raw credential access;
- no unrestricted filesystem or database access.

### Preload

Expose a narrow typed API such as:

```text
providers.list
providers.validate
catalogue.search
catalogue.sync
catalogue.cancel
preview.start
publication.prepare
backup.export
backup.import
```

No Electron conversion was performed in this phase.

## 16. Failure matrix

| Failure | Owner | Recovery | Mobile continuation | Republish |
|---|---|---|---|---|
| Desktop closed | Desktop/provider | None needed for valid artifact | Yes | No |
| Desktop restarted | Desktop | Reload local DB and vault references | Yes if artifact valid | No |
| Backend restarted | Backend | Durable publication data reloads | Existing playback may continue | No |
| Provider offline | Provider/desktop | Retry or replacement | Existing stream may fail | Usually |
| Account expired | Desktop/provider | Revalidate credentials | No if provider rejects playback | Yes if repaired |
| Authorization expired | Desktop/provider | Refresh or replace | No without new artifact | Usually |
| URL changed | Desktop | Resync and replace package | Old playback may fail | Yes |
| Channel deleted | Desktop | Select replacement | No for deleted channel | Yes |
| Health degraded | Desktop | Retry and report summary | Possibly, depending on provider | Not always |
| Mobile offline | Mobile | Retry feed/playback | Buffered playback only | No |
| Desktop DB corruption | Desktop | Restore catalogue, re-enter credentials, revalidate | Existing package may continue | Possibly |
| Credentials unavailable | Desktop | Re-enter and validate | Existing artifact only if still valid | Yes if expired |
| Two desktops publish same match | Backend | Versioned replacement and authorization | Latest valid package | Not necessarily |
| Continuous provider session | Desktop/provider | Keep session active | No after desktop shutdown | Yes, but violates target requirement |

## 17. Security threat model

| Threat | Mitigation |
|---|---|
| IPTV credential leakage | OS vault; never send credentials to backend/mobile |
| Stolen desktop database | Catalogue-only backup; credentials outside SQLite; OS encryption |
| Renderer compromise | Main-process secret operations; narrow preload IPC |
| Backend database compromise | No provider credentials; short-lived artifacts only |
| Mobile extraction of playback artifact | Short expiry, provider token scope, revocation where supported |
| Playback URL sharing | Bearer-token warning; short lifetime; provider-side restrictions |
| Expired token reuse | Expiry validation and backend publication state |
| Unauthorized publication | Backend operator authorization and approval transitions |
| Malicious desktop operator | Backend authorization, audit trail, package validation |
| Stale authorization | Package version, expiry, revocation, replacement state |
| Replay of temporary authorization | Provider-side expiry/scope; cannot be fully prevented if provider supplies bearer URLs |

If mobile receives a temporary authorization, it does not become a reusable account credential provided that the artifact is provider-issued or scoped by the desktop/provider, expires independently, and contains no username/password. This must be verified for each provider.

## 18. Performance and cost implications

The target architecture removes from Render:

- large M3U downloads;
- Xtream catalogue requests;
- large JSON parsing and normalization;
- catalogue SQLite writes;
- IPTV cleanup and indexing;
- IPTV EPG synchronization;
- long-running catalogue operations.

This should reduce backend CPU, RAM, disk I/O, database size, backup size, and provider traffic from Render. No numerical reduction is claimed because no controlled before/after benchmark was run.

The desktop must use indexed local SQLite queries, bounded batches, and restart-safe checkpoints. The renderer must never load a 100,000-item catalogue into memory.

## 19. Required architecture changes

Before migration implementation:

1. Define versioned provider and channel identity strategies.
2. Define a capability-gated Stream Package contract.
3. Move credentials to OS-protected desktop storage.
4. Build a local desktop catalogue engine outside the visible UI.
5. Build isolated provider fixtures for M3U and Xtream behavior.
6. Define package expiry, replacement, and revocation states.
7. Define mobile support for authorization URLs, headers, and cookies.
8. Remove playback URLs from analytics and diagnostic payloads.
9. Define migration and dual-read compatibility before removing backend tables.

## 20. Open questions

UNKNOWN - REQUIRES EXPERIMENT:

1. Are target-provider Xtream stream IDs stable across URL and metadata changes?
2. Are target-provider M3U `tvg-id` values unique and stable?
3. Which providers use expiring URLs or tokens?
4. Which providers require headers, cookies, referrer, origin, or user-agent values?
5. Can Android and iOS playback use those values safely?
6. Can provider-issued temporary authorization be revoked?
7. Can every supported provider meet offline-after-publication requirements?
8. What is the maximum expected desktop catalogue size?
9. Does the scheduling `match_streams` model need migration with canonical streams?
10. What exact deployed revision produced the recorded production interruption?

## 21. Experiment results and limitations

### Passed from source inspection

- Current playback URL path identified.
- Direct desktop preview identified.
- Direct mobile playback identified.
- No backend video proxy identified.
- Current credential-bearing URL risk identified.
- Current absence of explicit Stream Package identified.
- Current lack of refresh/session model identified.
- Current lack of local desktop IPTV database identified.

### Not executed

- Real-provider URL expiry test.
- Real-provider URL-change test.
- Device playback test with headers.
- Device playback test with cookies.
- Device playback test with provider tokens.
- Desktop shutdown test against a controlled provider.
- Cross-sync identity test against controlled M3U/Xtream fixtures.
- Temporary authorization replay test.

Reason: no safe provider fixture was available in the repository, and no real credentials may be used in this phase.

## 22. Final recommendation

Proceed with the approved target direction only through isolated experiments first:

> Desktop-owned IPTV with a local catalogue and OS-protected credentials, publishing capability-gated direct-playback authorization artifacts to the backend. Mobile plays directly against the provider. The backend never stores reusable IPTV credentials, full IPTV catalogues, or video data.

Do not publish a provider/channel combination unless it passes the capability policy for:

- stable identity;
- direct mobile playback;
- non-reusable authorization;
- required headers/cookies support;
- required playback lifetime;
- desktop-offline continuation.

## Phase 2.1 decision gate

`PHASE 2.1 - PASS WITH CONDITIONS`

The source-level viability questions are answered, but provider-specific playback behavior remains unverified. Implementation must wait for the controlled M3U/Xtream and mobile-device experiments listed above.

Recommended next step:

**Proceed to Phase 2.2 - Freeze the Stream Package contract only after the priority provider and mobile playback experiments pass.**

## 23. Files changed and tests executed

### Files changed by this phase

- `docs/PHASE-2.1-PLAYBACK-IDENTITY-EXPERIMENTS.md`

No source, UI, schema, database, configuration, or environment files were changed.

### Tests and experiments executed

- Read-only Git state inspection: passed.
- Read-only source and controlled-history inspection: passed.
- Current playback path audit: passed from source.
- Credential exposure audit: passed from source; exposure risk confirmed.
- Provider expiry/header/cookie/token experiments: not executed; safe fixture unavailable.
- Mobile device playback experiments: not executed.
- No database migrations or mutating tests were run.
