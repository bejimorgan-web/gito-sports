# GiTO Live Sports - Phase 2.1A Controlled Provider Experiments

## 1. Executive summary

Phase 2.1A validated the identity and authorization assumptions that can be tested safely without real IPTV credentials or production changes.

The controlled synthetic experiments support this architecture rule:

```text
stable channel identity != current playback authorization
```

Provider-scoped `tvg-id` and Xtream `stream_id` identities remained stable when synthetic playback authorization, display name, category, and playlist order changed. Duplicate M3U identifiers collided and cannot be auto-merged safely. Missing identifiers require a lower-confidence fallback and operator review.

A local provider fixture verified that direct playback can continue after the publisher process closes when the already-issued authorization remains valid. The same fixture verified that expired authorization fails and cannot be refreshed without an available refresh owner.

The critical real-provider and Android-device experiments were not executed because no safe provider fixture with real playback behavior was available in the repository and no real credentials may be used in this phase. Therefore the final gate is:

```text
PHASE 2.1A - PASS WITH CONDITIONS
```

The architecture is viable for provider/channel combinations that provide direct playback without reusable account credentials, support the required mobile playback mechanism, and remain valid for the required offline window. Phase 2.2 must not freeze a universal contract until the priority provider and Android tests pass.

## 2. Git/worktree safety verification

Recorded before the report edit:

- Branch: `main`
- HEAD: `f241730e6785ccf080f6f6f9f03b29e2443814bc`
- `origin/main`: `78efcf38269f4b12580f43678a32f97da0cd950e`
- Existing modified tracked files: 20
- Existing untracked files: 7
- Existing changed/untracked paths: 27

The checked-out branch remains divergent from `origin/main`. Existing changes were not reset, cleaned, stashed, restored, staged, committed, or deleted. The only artifact created by this phase is this report.

No application source, UI, database, schema, configuration, environment variable, package dependency, production service, or production data was changed.

## 3. Experiment methodology

Two evidence categories were used:

1. Controlled source inspection against the reconciled `origin/main` implementation.
2. Isolated in-memory or local-loopback synthetic fixtures using non-secret values.

No real IPTV account, real credential, production endpoint, production database, or Render service was contacted.

Synthetic execution command results were recorded as sanitized status and identity outcomes only. The synthetic identity algorithm intentionally models the proposed future identity rule; it does not claim that the production catalogue has already implemented that rule.

## 4. Experiment A - M3U identity

### A1. Stable `tvg-id`, changed URL

- Hypothesis: provider identity plus unique `tvg-id` remains stable while playback authorization changes.
- Setup: synthetic provider `p`, logical ID `chan-a`, two URLs differing only by token material.
- Actual result: both records produced `p|tvg:chan-a`.
- Result: **PASS** for the proposed identity rule.
- Consequence: URL/token changes must update authorization, not create a new logical channel.

### A2. Missing `tvg-id`, changed URL

- Hypothesis: normalized URL fallback remains stable when only known volatile query values change.
- Actual result: both synthetic records produced the same normalized URL identity.
- Result: **PASS WITH CONDITIONS**.
- Consequence: the fallback requires a provider-specific volatile-parameter allowlist. Unknown URL changes must not be silently merged.

### A3. Duplicate `tvg-id`

- Hypothesis: duplicate IDs are distinguishable automatically.
- Actual result: both records produced `p|tvg:dup`.
- Result: **FAIL for automatic merging**.
- Consequence: duplicate IDs require collision records, operator review, and a secondary identity. They must not overwrite one another.

### A4. URL authentication material changes

- Hypothesis: known volatile authorization parameters can be removed for fallback identity.
- Actual result: the synthetic normalizer removed only explicitly recognized fields and produced a stable identity.
- Result: **PASS WITH CONDITIONS**.
- Consequence: normalization must be versioned and conservative. It must never remove unknown parameters that may distinguish channels.

### A5. Metadata changes

- Hypothesis: display name, logo, and group changes do not change a unique `tvg-id` identity.
- Actual result: identity remained `p|tvg:chan-a`.
- Result: **PASS** when the ID is unique and stable.
- Consequence: metadata is mutable channel state, not identity.

### A6. Playlist reorder

- Hypothesis: ordering does not affect identity.
- Actual result: identity remained unchanged.
- Result: **PASS**.

### M3U evidence limitation

The controlled production parser extracts `tvg-id` as `externalRef`, but it does not itself implement the proposed future identity resolver. Evidence: `apps/backend/src/services/m3u-parser.ts`, `apps/backend/src/services/m3u-catalogue-sync.ts`, and `apps/backend/src/repositories/provider-repository.ts`.

The synthetic results validate the design rule, not real provider stability. Real M3U provider identity remains **INCONCLUSIVE** until repeated playlists from the target providers are tested.

## 5. Experiment B - Xtream identity

### B1-B4. Same provider and `stream_id`

- Hypothesis: `providerFingerprint + contentType + providerStreamId` remains stable across URL, name, category, and token changes.
- Actual result: synthetic identity remained stable for the same provider, content type, and stream ID.
- Result: **PASS** for the proposed identity rule.
- Consequence: generated playback URLs must not be used as the primary Xtream identity.

### B5. Missing or invalid `stream_id`

- Result: **INCONCLUSIVE** for real providers.
- Required behavior: assign a low-confidence fallback identity and require operator review before publication.

### B6. Same `stream_id` across providers

- Actual result: `provider-a|live|42` and `provider-b|live|42` remained distinct.
- Result: **PASS** for provider scoping.

### Xtream evidence limitation

The controlled Xtream integration uses provider stream identifiers and generated URLs in `apps/backend/src/services/xtream-codes.ts`. Static code cannot prove that real providers preserve stream IDs across catalogue refreshes.

Real-provider Xtream stability is **INCONCLUSIVE**.

## 6. Experiment C - URL replacement

- Hypothesis: a logical channel can retain identity while authorization changes from URL-A to URL-B.
- Setup: synthetic `CHANNEL-A`, initial authorization URL-A, replacement authorization URL-B.
- Actual result: identity remained `CHANNEL-A`; authorization was treated as a separate mutable value.
- Result: **PASS** for the proposed conceptual model.
- Consequence: the future package must store `stableStreamId`, provider/channel references, and playback authorization as separate fields.

The current production model does not fully provide this separation. `streams.channel_id` identifies the channel, while `channels.url` carries the current playback URL. Evidence: `apps/backend/src/repositories/operations-repository.ts`.

## 7. Experiment D - Expiring authorization

Synthetic lifecycle:

```text
VALID -> EXPIRING -> EXPIRED
```

Results:

- Valid authorization: playable.
- Near-expiry authorization: playable but must be marked expiring.
- Expired authorization: not playable.
- Refresh without the credential owner: unavailable.

Local provider fixture result:

- valid direct request: HTTP 200;
- expired direct request: HTTP 410;
- refresh without desktop/credential owner: not possible.

Result: **PASS** for lifecycle semantics.

Architecture consequence:

- desktop owns credential-based refresh;
- backend stores expiry and publication state;
- mobile receives only the current authorization artifact;
- an expired artifact requires replacement or refresh;
- no automatic refresh is claimed by the current application.

## 8. Experiment E - Desktop shutdown

### E1. Desktop closed after authorization delivery

- Setup: local provider fixture served a synthetic direct media response. The publisher was logically closed after the authorization was prepared.
- Provider status before close: HTTP 200.
- Provider status after close: HTTP 200.
- Result: **PASS**.
- Meaning: direct playback does not inherently require the desktop after authorization delivery.

### E2. Desktop closed before mobile requests playback information

- Result: **INCONCLUSIVE for the future architecture** because no new package/publication API exists yet.
- Current source behavior: mobile obtains the live feed from the backend, not the desktop. The existing desktop is not a playback relay.

The hard requirement is satisfied only for already-published, still-valid authorization. A provider requiring desktop participation after publication is incompatible.

## 9. Experiment F - Mobile credential exposure

### Current controlled source

- Backend stores provider credentials in `providers.credential_username` and `providers.credential_password`.
- Shared provider mapping includes credential fields.
- Mobile published feed uses `playbackUrl` from `channels.url`.
- Xtream-style URLs may contain reusable authentication material.

Evidence:

- `apps/backend/src/db/schema/initial-schema.sql`
- `apps/backend/src/repositories/provider-repository.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `apps/mobile/lib/main.dart`

### Artifact classification

| Artifact | Mobile exposure | Classification |
|---|---:|---|
| Username/password fields | Not intentionally in published projection | Must remain desktop-only |
| Credential-bearing URL | Possible through `playbackUrl` | **UNSAFE** |
| Temporary provider token | Not currently modeled | Conditionally safe, requires expiry/scope |
| Signed temporary URL | Not currently modeled | Conditionally safe, bearer-secret risk |
| Cookies | Not currently modeled | Inconclusive; device testing required |
| Headers | Not currently modeled | Inconclusive; device testing required |
| Desktop vault secret | No source path | Must never cross boundary |

Result: **FAIL for the current raw-URL model when URLs contain reusable credentials**. The target architecture must reject such provider/channel combinations unless the provider offers an alternative authorization mechanism.

## 10. Experiment G - Headers

The current contracts do not represent required playback headers. The Flutter playback path constructs `VideoPlayerController.networkUrl(Uri.parse(playbackUrl))` without a header descriptor.

Result: **INCONCLUSIVE** for provider requirements and **NOT SUPPORTED by the current contract**.

Required device experiment:

- test a sanitized HLS URL requiring User-Agent, Referer, Origin, and Authorization variations;
- verify Android player behavior without backend or desktop relay;
- record only capability and failure status.

## 11. Experiment H - Cookies and sessions

The current source contains no first-class playback cookie/session contract and no mobile session exchange.

Result: **INCONCLUSIVE**.

Any provider requiring a live desktop session is **DESKTOP-DEPENDENT / INCOMPATIBLE** with the offline requirement. No proxy workaround is permitted.

## 12. Experiment I - Direct Android playback

The source path is direct:

```text
LiveMatch.fromJson()
  -> PlaybackScreen
  -> VideoPlayerController.networkUrl()
  -> provider
```

No Android device or sanitized provider authorization fixture was available for execution.

Result: **INCONCLUSIVE**.

Source establishes that no backend media proxy is required by the current code, but it does not establish that every provider URL, redirect, header, cookie, or HLS variant works on Android.

## 13. Experiment J - Real demo provider

No real demo provider was contacted. No real credentials or provider URLs were used.

Result: **INCONCLUSIVE**.

Required before provider support is approved:

- M3U and Xtream behavior where applicable;
- stable identity across repeated syncs;
- URL/token lifetime;
- credential embedding;
- headers/cookies;
- direct Android playback;
- desktop shutdown continuity;
- refresh requirements.

## 14. Provider capability classification

| Class | Required evidence | Result in this phase | Architecture decision |
|---|---|---|---|
| A - Direct stable | Direct playback, no reusable credentials, no desktop dependency | Synthetic model supports it; real providers untested | Compatible when verified |
| B - Direct temporary | Provider-issued temporary authorization, known expiry, no reusable credentials | Synthetic expiry semantics pass; provider behavior untested | Compatible until expiry when verified |
| C - Desktop refresh required | Direct playback but refresh depends on desktop | Not tested with real provider | Conditional; cannot guarantee offline recovery |
| D - Session bound | Active desktop/provider session required | Not tested | Incompatible with offline requirement |
| E - Reusable credential URL | Client receives reusable account authentication | Current source risk confirmed | Incompatible unless safe provider alternative exists |

Do not classify an untested provider as A or B merely because it uses M3U or Xtream terminology.

## 15. Stream Package evaluation

The accurate term for the proposed artifact is:

> Desktop-issued Playback Authorization Descriptor

The desktop prepares or packages provider-issued authorization; it does not create provider authorization from nothing.

| Field | Needed | Sensitivity | Owner/reader | Result |
|---|---:|---|---|---|
| `stableStreamId` | Yes | Low | Backend and mobile opaque reference | Required |
| `matchId` | Yes | Low | Backend/mobile | Required |
| `providerReference` | Yes | Low | Backend; usually hidden from mobile | Required |
| `channelReference` | Yes | Low | Backend; usually hidden from mobile | Required |
| `playbackMode` | Yes | Low | Backend/mobile | Required |
| `playbackAuthorization` | Conditional | High | Desktop creates; mobile consumes; backend stores minimally | Required for direct playback |
| `issuedAt` | Yes | Low | Backend/mobile | Required |
| `expiresAt` | Conditional | Low | Desktop/backend/mobile | Required when temporary |
| `refreshMode` | Yes | Low | Backend/mobile status | Required |
| `healthState` | Yes | Low | Desktop reports; backend publishes summary | Required |
| `publicationState` | Yes | Low | Backend/mobile | Required |
| `revokedAt` | Conditional | Low | Backend | Required for revocation |
| `requiredHeaders` | Conditional | High | Only if mobile supports them | Not yet supported |
| `requiredCookies` | Conditional | High | Only if mobile supports them | Not yet supported |

Missing requirement: `authorizationKind` or equivalent, distinguishing provider-issued token, signed URL, public URL, and unsupported credential-bearing URL.

## 16. Security findings

### Backend must not receive

- IPTV username/password;
- reusable credential-bearing playback URLs;
- desktop vault secrets;
- unrestricted provider session state;
- full IPTV catalogue.

### Mobile must not receive

- IPTV username/password;
- reusable account credentials in any URL or header;
- desktop vault material;
- provider management data.

### Logs must not contain

- credentials;
- tokens;
- cookies;
- authorization headers;
- unredacted playback URLs.

A temporary playback artifact is still a bearer secret. It is acceptable only when it is non-reusable as an account credential, scoped where the provider supports scope, expires independently, and is excluded from analytics/logging.

## 17. Failure matrix

| Scenario | Expected state | Owner | Mobile continuation | Republish/recovery |
|---|---|---|---|---|
| Desktop online, authorization valid | Published/playable | Provider + mobile | Yes | No |
| Desktop offline, authorization valid | Published/playable | Mobile/provider | Yes | No |
| Desktop offline, authorization expiring | Expiring | Backend records state; desktop unavailable | Until expiry | Refresh later or replace |
| Authorization expired | Expired/unavailable | Desktop/provider | No | Required unless another artifact exists |
| Backend unavailable before feed retrieval | Feed unavailable | Backend/mobile | No new playback | Retry backend |
| Backend unavailable after URL delivery | Existing player may continue | Mobile/provider | Possibly | No immediate republish |
| Provider URL changed | Existing artifact stale | Desktop/provider | May fail | Resync and replace |
| Provider channel removed | Channel unavailable | Desktop | No | Select and publish replacement |
| Provider account expired | Provider rejected | Desktop/provider | No | Revalidate credentials and republish |
| Provider unavailable | Playback failure/degraded | Provider | No or intermittent | Retry/replace |
| Mobile offline | No new feed | Mobile | Buffered playback only | No |
| Desktop database corruption | Local IPTV state unavailable | Desktop | Existing artifact may continue | Restore and revalidate |
| Credentials unavailable | Refresh unavailable | Desktop | Existing artifact only | Re-enter credentials |
| Two desktops publish same match | Backend version conflict/replacement | Backend | Latest valid package | Authorized replacement |
| Provider requires continuous session | Desktop-dependent | Provider/desktop | No after shutdown | Incompatible |

## 18. Required changes before Phase 2.2

1. Execute real M3U and Xtream tests using a controlled, authorized provider fixture or sanitized demo access.
2. Execute Android direct-playback tests for plain, temporary, tokenized, header-required, and cookie-required authorization.
3. Freeze identity confidence and collision rules for duplicate/missing M3U IDs.
4. Verify target Xtream providers preserve `stream_id` across refreshes.
5. Define `authorizationKind`, expiry, refresh, revocation, and unsupported-provider states.
6. Prohibit credential-bearing URLs at publication validation.
7. Remove playback URLs from mobile analytics and error telemetry before production contract migration.
8. Decide whether headers/cookies are supported in the first mobile contract. Unsupported modes must be rejected, not silently degraded.
9. Keep backend video proxying rejected.

## 19. Open questions

UNKNOWN - REQUIRES EXPERIMENT:

1. Which actual M3U providers provide unique, stable `tvg-id` values?
2. Which actual Xtream providers preserve `stream_id` values?
3. Which providers embed reusable credentials in playback URLs?
4. Which providers issue temporary or signed playback URLs?
5. Which providers require headers, cookies, referrer, origin, or user-agent values?
6. Can the target Android player supply those values consistently?
7. Can an authorization be revoked after mobile receives it?
8. Can a provider authorization remain valid after desktop shutdown?
9. What exact demo provider access is authorized for testing?
10. Does the scheduling `match_streams` path need separate migration treatment?

## 20. Final gate decision

```text
PHASE 2.1A - PASS WITH CONDITIONS
```

### Findings

- Synthetic identity separation passed.
- Duplicate identity collision behavior was detected and requires review.
- Synthetic expiry and direct-playback shutdown behavior passed.
- Current raw credential-bearing URL risk remains a failure condition.
- Real provider behavior is unverified.
- Android direct playback is unverified.
- Headers and cookies are unverified and unsupported by the current contract.

### Conditions/blockers

Phase 2.2 is conditional on completing priority real-provider and Android experiments. No provider may be declared compatible based only on M3U/Xtream type.

The following are hard blockers for a provider/channel combination:

- reusable account credentials required in mobile playback;
- active desktop session required after publication;
- mobile cannot reproduce required headers/cookies;
- authorization lifetime is shorter than the required offline window and cannot be refreshed independently;
- stable identity cannot be established with acceptable confidence.

### Recommended next phase

Do not begin Stream Package implementation automatically. First run the priority real-provider and Android experiments using an authorized sanitized fixture. Only then proceed to:

```text
Phase 2.2 - Freeze the Stream Package contract
```

## 21. Files changed, tests, and experiments

### Files changed by this phase

- `docs/PHASE-2.1A-CONTROLLED-PROVIDER-EXPERIMENTS.md`

No source, UI, schema, database, configuration, environment, or dependency files were changed.

### Executed

- Git/worktree safety inspection: **PASS**.
- Decision/task/source inspection: **PASS**.
- Synthetic M3U identity model: **PASS WITH CONDITIONS**.
- Synthetic Xtream identity model: **PASS WITH CONDITIONS**.
- Synthetic URL replacement model: **PASS**.
- Synthetic authorization lifecycle: **PASS**.
- Local-loopback direct playback after simulated desktop close: **PASS**.
- Local-loopback expired authorization: **PASS**; expired request rejected and no offline refresh available.
- Current credential exposure source audit: **FAIL for raw credential-bearing URLs**.
- Real demo-provider experiment: **INCONCLUSIVE; not run**.
- Android direct playback experiment: **INCONCLUSIVE; no device/fixture run**.
- Headers experiment: **INCONCLUSIVE**.
- Cookies/session experiment: **INCONCLUSIVE**.

No production or mutating database tests were run.
