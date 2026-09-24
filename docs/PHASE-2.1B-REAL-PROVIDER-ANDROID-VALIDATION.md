# GiTO Live Sports - Phase 2.1B Real-Provider and Android Validation

## 1. Executive summary

Phase 2.1B could not execute the authorized real-provider or Android playback experiments because no authorized IPTV provider credentials or sanitized provider playback artifact was available in the workspace or environment.

Android tooling is available and a supported Android 13 device is connected. However, a connected device alone is not evidence of provider playback. No provider was contacted, no credentials were entered, and no playback test was attempted.

The current source path remains verified:

```text
Mobile -> GET /mobile/matches/live -> playbackUrl -> Flutter video_player -> IPTV provider
```

The current source also confirms that `playbackUrl` is derived from `channels.url`, which can contain provider authentication material for Xtream-style URLs. The current raw-URL model remains unsuitable for providers requiring reusable account credentials in the client URL.

Final gate:

```text
INCONCLUSIVE - TEST ENVIRONMENT NOT AVAILABLE
```

This is not a provider failure. It means the required authorized provider fixture/access was unavailable. Phase 2.2 must not proceed as a universal contract freeze.

## 2. Git/worktree safety verification

Recorded before creating this report:

- Branch: `main`
- HEAD: `f241730e6785ccf080f6f6f9f03b29e2443814bc`
- `origin/main`: `78efcf38269f4b12580f43678a32f97da0cd950e`
- Existing modified tracked files: 20
- Existing untracked files before this report: 8, including the prior Phase 2.1 and 2.1A reports
- Existing changed/untracked paths before this report: 28

The checkout is intentionally dirty and divergent from `origin/main`. No reset, clean, stash, restore, checkout, merge, rebase, commit, push, deployment, or unrelated-file modification was performed.

The only file created by this phase is:

```text
docs/PHASE-2.1B-REAL-PROVIDER-ANDROID-VALIDATION.md
```

## 3. Test environment

### Available

- `adb`: available
- `flutter`: available
- Android device: `SM G985F`
- Android platform: Android 13, API 33
- Device state: connected and supported

### Unavailable

- Authorized IPTV username/password
- Authorized M3U playlist URL
- Authorized Xtream server configuration
- Sanitized provider-issued playback URL or token
- Provider-specific test instructions

No relevant IPTV/demo environment variables were present. Values were not printed or inspected beyond presence checks.

### Safety result

**INCONCLUSIVE - AUTHORIZED PROVIDER ACCESS UNAVAILABLE**

Because provider access was unavailable, no real provider request, Android playback request, desktop shutdown test, or credential-boundary capture was performed.

## 4. Source playback baseline

### SOURCE VERIFIED

The controlled `origin/main` source establishes:

1. Backend IPTV routes fetch and persist provider catalogue data.
2. Desktop catalogue items become `Channel.url` or catalogue playback references.
3. `POST /matches/assign-stream` stores a channel reference in the canonical `streams` record.
4. Approval and publication update backend lifecycle state.
5. `GET /mobile/matches/live` calls `MatchService.listPublishedLiveMatches()`.
6. `operations-repository.ts` returns `playbackUrl` from the joined channel URL.
7. Flutter parses `playbackUrl` in `LiveMatch.fromJson()`.
8. `PlaybackScreen` creates `VideoPlayerController.networkUrl(Uri.parse(playbackUrl))`.

Evidence:

- `apps/backend/src/routes/iptv.ts`
- `apps/backend/src/routes/mobile.ts`
- `apps/backend/src/repositories/operations-repository.ts`, `listPublishedLiveMatches()`
- `apps/desktop/src/renderer/features/iptv/IptvCatalogueScreen.tsx`
- `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`
- `apps/mobile/lib/main.dart`, `LiveMatch.fromJson()` and `PlaybackScreen`

No backend media proxy, desktop relay, token exchange, playlist rewrite, or playback redirect path was found in the application source.

## 5. Authorized provider type

No authorized real provider was available for this phase.

| Provider mode | Result |
|---|---|
| M3U | INCONCLUSIVE - no authorized playlist |
| Xtream | INCONCLUSIVE - no authorized account |
| Demo provider | INCONCLUSIVE - no authorized access identified |

No provider classification is assigned.

## 6. Experiment A - Real M3U playlist

Status: **INCONCLUSIVE - AUTHORIZED PROVIDER ACCESS UNAVAILABLE**.

The following were not observed against a real playlist:

- presence or stability of `tvg-id`;
- ordering changes;
- name/group/logo changes;
- playback URL rotation;
- embedded reusable credentials;
- temporary tokens;
- URL expiry;
- required headers;
- required cookies.

Source-only fact: the parser extracts `tvg-id`, `tvg-name`, `group-title`, `tvg-logo`, category metadata, and the stream URL in `apps/backend/src/services/m3u-parser.ts`.

## 7. Experiment B - Real Xtream

Status: **INCONCLUSIVE - AUTHORIZED PROVIDER ACCESS UNAVAILABLE**.

The following were not observed against a real Xtream provider:

- `stream_id` stability;
- generated URL rotation;
- credential embedding behavior;
- temporary token behavior;
- URL expiry;
- authorization regeneration;
- header requirements;
- cookie requirements.

Source-only fact: `apps/backend/src/services/xtream-codes.ts` reads Xtream stream/category metadata and constructs provider playback URLs using account credentials. This does not prove behavior for every Xtream provider.

## 8. Experiment C - Credential exposure

### SOURCE VERIFIED

The current controlled model stores provider credentials in backend provider records and may expose credential-bearing playback URLs because mobile receives `playbackUrl` from `channels.url`.

Evidence:

- `apps/backend/src/db/schema/initial-schema.sql`, `providers`
- `apps/backend/src/repositories/provider-repository.ts`, credential mapping
- `apps/backend/src/repositories/operations-repository.ts`, `playbackUrl`
- `apps/mobile/lib/main.dart`, `LiveMatch.fromJson()`

### Real boundary test

Not executed because no authorized provider artifact was available.

| Artifact | Desktop | Backend | Mobile | Finding |
|---|---|---|---|---|
| IPTV username | Current UI/backend flow can handle it | Current backend stores it | Not intentionally projected | Must be desktop-only in target architecture |
| IPTV password | Current UI/backend flow can handle it | Current backend stores it | Not intentionally projected | Must be desktop-only in target architecture |
| Credential-bearing URL | Current preview can use it | Current channel storage can retain it | Current `playbackUrl` can expose it | UNSAFE |
| Temporary token | Not separately modeled | Not separately modeled | Not separately modeled | INCONCLUSIVE |
| Signed URL | Not separately modeled | Not separately modeled | Would be bearer material | INCONCLUSIVE |
| Headers | Not represented in current mobile contract | Not represented | Not available through current model | INCONCLUSIVE |
| Cookies | Not represented | Not represented | Not available through current model | INCONCLUSIVE |
| Provider stream ID | Catalogue/provider data | Backend catalogue | Not required by current player | Candidate stable identity |
| Logical channel ID | Desktop selection | `streams.channel_id` | Not required by current player | Candidate stable identity |

The target security result remains: reusable IPTV credentials must never reach mobile.

## 9. Experiment D - Android direct playback

Status: **INCONCLUSIVE - PROVIDER PLAYBACK ARTIFACT UNAVAILABLE**.

The device was present, but no authorized test URL/token was available. The app was not changed, installed, launched for this experiment, or pointed at a provider.

### Source path

```text
LiveMatch.fromJson()
  -> MatchDetailsScreen
  -> WATCH LIVE
  -> PlaybackScreen
  -> VideoPlayerController.networkUrl()
  -> provider URL
```

The source supports direct URL playback in principle, but source inspection is not proof that a particular provider’s HLS format, redirect, header, cookie, or token works on Android.

## 10. Experiment E - Desktop shutdown

Status: **INCONCLUSIVE - PROVIDER PLAYBACK NOT STARTED**.

No authorized playback was running, so media continuity after desktop termination, provider session behavior, URL expiry, relay involvement, and backend dependency during playback could not be observed.

The synthetic loopback shutdown test from Phase 2.1A passed, but it is not real-provider evidence.

## 11. Experiment F - Desktop closed before playback

Status: **INCONCLUSIVE - NO AUTHORIZED PUBLISHED ARTIFACT**.

No real package was published in a safe development environment and no mobile request was made after desktop shutdown.

Source-level implication: the current mobile feed is backend-dependent, while the current media request is direct-provider-dependent. Whether a real provider authorization remains usable after desktop shutdown is unknown.

## 12. Experiment G - Backend availability

### SOURCE VERIFIED

| Stage | Backend required | Desktop required | Provider required |
|---|---:|---:|---:|
| Existing desktop catalogue retrieval | Yes | Yes | No, for cached response |
| Existing desktop preview | Catalogue selection may require backend; media request is direct | Yes for UI | Yes |
| Existing assignment/approval/publication | Yes | Yes for operator action | No direct media request |
| Mobile obtains live feed | Yes | No | No for metadata retrieval |
| Mobile starts direct playback after URL delivery | No media proxy path | No | Yes |
| Mobile continues an already-started direct stream | Not inherently | No | Yes |

Actual offline behavior for the authorized provider was not tested.

## 13. Experiment H - Headers

Status: **INCONCLUSIVE - NO REAL PROVIDER REQUEST**.

The current `Channel` and mobile playback contracts do not model custom headers, Referer, Origin, User-Agent, or Authorization headers. Android support for provider-specific headers remains unverified.

No generalized header support was added.

## 14. Experiment I - Cookies and session

Status: **INCONCLUSIVE - NO REAL PROVIDER SESSION**.

The current source has no first-class cookie/session playback contract and no desktop-to-mobile session exchange. A provider requiring an active desktop session would be classified:

```text
DESKTOP-DEPENDENT / INCOMPATIBLE WITH OFFLINE REQUIREMENT
```

No proxy workaround was introduced.

## 15. Experiment J - Authorization expiration

Status: **INCONCLUSIVE - NO REAL PROVIDER AUTHORIZATION**.

Unknown real-world values include authorization lifetime, predictable expiry, provider expiry signaling, failure mode after expiry, regeneration capability, and whether regeneration requires account credentials.

Phase 2.1A’s synthetic result remains valid only as a lifecycle model: valid, expiring, expired, and refresh-required are distinct states.

## 16. Experiment K - Playback URL rotation

Status: **INCONCLUSIVE - NO REPEATED REAL PROVIDER OBSERVATIONS**.

```text
logical identity stable: UNKNOWN
authorization changed: UNKNOWN
URL changed: UNKNOWN
```

The current source still demonstrates why the target model must separate channel identity from playback authorization.

## 17. Provider capability classification

| Class | Real-provider result | Classification |
|---|---|---|
| A - Direct stable | Not tested | INCONCLUSIVE |
| B - Direct temporary | Not tested | INCONCLUSIVE |
| C - Refresh required | Not tested | INCONCLUSIVE |
| D - Session bound | Not tested | INCONCLUSIVE |
| E - Reusable credential URL | Possible in current Xtream URL model; no authorized provider tested | INCONCLUSIVE for provider, unsafe policy |

No actual provider is assigned to a capability class.

## 18. Stream Package evaluation

The proposed conceptual fields remain appropriate for evaluation:

```text
stableStreamId
matchId
providerReference
channelReference
playbackMode
playbackAuthorization
issuedAt
expiresAt
refreshMode
healthState
publicationState
revokedAt
```

The required distinction is:

- provider-issued authorization: a URL, token, signed URL, header, or cookie supplied/required by the provider;
- desktop-generated metadata: identity, capability classification, timestamps, validation result, and redacted health summary.

The desktop cannot create usable provider authorization without provider support. `authorizationKind` should be added to distinguish public, provider-token, signed-url, header-bound, cookie-bound, and unsupported credential-bearing modes.

No Stream Package was implemented or frozen.

## 19. Security assessment

### SOURCE VERIFIED

- Backend currently stores provider credentials.
- Current mobile playback may receive a raw URL derived from `channels.url`.
- A raw URL can carry reusable provider credentials.
- The backend source has no video proxy.
- The mobile source has no credential-refresh exchange.

### Required target controls

- credentials in desktop OS-protected storage only;
- no reusable credentials in backend requests or database;
- no reusable credentials in mobile URLs, headers, or cookies;
- no provider secrets in logs, analytics, screenshots, or crash reports;
- reject credential-bearing playback modes at publication;
- treat temporary playback artifacts as bearer secrets;
- record expiry and revocation state.

## 20. No-proxy verification

### SOURCE VERIFIED

No media proxy route or relay was found in the controlled application source. The Flutter player is constructed with the provider URL, not a GiTO media endpoint.

### Runtime verification

Status: **INCONCLUSIVE**. No real playback was started, so no Android network capture or provider-versus-backend byte-flow observation was possible.

The absence of a source proxy is not presented as runtime proof for an unexecuted real-provider test.

## 21. Failure and limitation matrix

| Scenario | Result in this phase | Required owner/recovery |
|---|---|---|
| Desktop online, valid artifact | Not tested with real provider | Provider/mobile direct playback |
| Desktop offline, valid artifact | Not tested with real provider | Must continue without desktop |
| Backend unavailable after URL delivery | Source indicates direct media path | Mobile/provider; feed refresh unavailable |
| Authorization expires | Synthetic failure established; real expiry unknown | Desktop/provider refresh or replacement |
| URL changes | Real rotation unknown | Desktop resync and package replacement |
| Channel removed | Real behavior unknown | Desktop selects replacement |
| Account expires | Real behavior unknown | Desktop revalidation |
| Provider unavailable | Real behavior unknown | Provider retry or replacement |
| Required headers | Unknown | Must be validated on Android |
| Required cookies/session | Unknown | Reject if desktop-dependent |
| Mobile offline | No new feed | Mobile retry; buffered playback only |

## 22. Answers to Q1-Q19

1. **Can IPTV ownership safely move from backend to desktop?** **INCONCLUSIVE** for the full provider set; architecture is plausible but real provider compatibility is untested.
2. **Can backend stop owning the IPTV catalogue?** **INFERRED YES**, if the desktop local catalogue and publication contract are implemented and validated.
3. **Can mobile continue direct playback without a proxy?** **SOURCE VERIFIED in principle; real-provider runtime INCONCLUSIVE.**
4. **Can reusable credentials remain desktop-only?** **YES as a target rule; current implementation does not satisfy it for credential-bearing URLs.**
5. **Can Android receive safe playback authorization?** **INCONCLUSIVE.**
6. **Can Android play directly using it?** **INCONCLUSIVE.**
7. **Can playback survive complete desktop shutdown?** **INCONCLUSIVE with real provider; synthetic loopback PASS.**
8. **Can Android start playback after desktop shutdown?** **INCONCLUSIVE.**
9. **Can identity be separated from changing authorization?** **PASS for synthetic model; real provider stability INCONCLUSIVE.**
10. **Does M3U identity appear sufficiently reliable?** **INCONCLUSIVE for real providers; unique `tvg-id` is a candidate, duplicates require review.**
11. **Does Xtream `stream_id` appear sufficiently reliable?** **INCONCLUSIVE for real providers.**
12. **Are headers required?** **INCONCLUSIVE.**
13. **Are cookies required?** **INCONCLUSIVE.**
14. **Is session state required?** **INCONCLUSIVE.**
15. **Does authorization expire?** **INCONCLUSIVE for real providers; synthetic expiry model PASS.**
16. **Can authorization be refreshed safely?** **INCONCLUSIVE; must not use reusable credentials on mobile.**
17. **What provider classes can GiTO support?** Classes A and B are target-compatible; C is conditional; D and E are incompatible under the stated rules. No real provider was classified.
18. **Is the Stream Package concept viable?** **INFERRED YES**, but it must include authorization kind, expiry, refresh, and unsupported-mode states.
19. **What exact conditions remain before Phase 2.2?** Authorized M3U/Xtream observations, Android direct playback, shutdown tests, authorization lifetime/rotation, header/cookie behavior, and credential-boundary verification.

## 23. Remaining blockers

1. No authorized real-provider access was available.
2. No real M3U or Xtream observations were possible.
3. No Android playback test was possible despite a connected device because no authorized playback artifact was available.
4. Header, cookie, session, expiry, URL rotation, and refresh behavior remain unknown.
5. The current raw playback URL path can expose reusable credentials and cannot be adopted for the target architecture unchanged.

## 24. Final gate decision

```text
INCONCLUSIVE - TEST ENVIRONMENT NOT AVAILABLE
```

This is not `PASS`, because critical real-provider and Android tests were not executed. It is not `BLOCKED` by a proven provider failure; the required authorized test environment was unavailable.

## 25. Recommendation for Phase 2.2

```text
DO NOT PROCEED
```

Phase 2.2 should wait until an authorized, sanitized M3U/Xtream test fixture or provider account is supplied and the connected Android device completes:

1. direct playback;
2. credential exposure verification;
3. desktop shutdown after authorization delivery;
4. desktop shutdown before mobile playback starts;
5. URL/token expiry and rotation;
6. header/cookie/session behavior;
7. repeated identity observations.

## 26. Files changed and tests executed

### Files changed by this phase

- `docs/PHASE-2.1B-REAL-PROVIDER-ANDROID-VALIDATION.md`

No application source, UI, database, schema, configuration, environment, dependency, or production file was changed.

### Executed

- Git/worktree inspection: **PASS**.
- Prior Phase 2.1 and 2.1A report inspection: **PASS**.
- Controlled source playback audit: **SOURCE VERIFIED**.
- Environment-variable presence check: no IPTV/demo configuration found; values not printed.
- Android tooling check: `adb` and `flutter` available.
- Android device enumeration: supported Android 13 device connected.
- Real M3U provider test: **INCONCLUSIVE - authorized access unavailable**.
- Real Xtream provider test: **INCONCLUSIVE - authorized access unavailable**.
- Android direct playback: **INCONCLUSIVE - authorized playback artifact unavailable**.
- Desktop shutdown tests: **INCONCLUSIVE - playback not started**.
- Backend dependency runtime test: **INCONCLUSIVE - no published real artifact**.
- No production endpoint was contacted.
- No credentials, tokens, cookies, or complete playback URLs were printed.
- No mutating tests, migrations, installs, deployments, or production changes were performed.
