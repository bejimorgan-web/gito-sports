# GiTO Live Sports - Phase 2.1D Real-Provider Android Playback Validation

## Objective

Validate the original IPTV goal end to end:

```text
Desktop IPTV provider
  -> real channel selection and preview
  -> real match assignment/publication
  -> Render backend
  -> Android Mobile direct playback
  -> Desktop completely closed
```

This phase was validation only. No application code, UI, database, configuration, deployment, or Git history was changed.

## Environment

- Backend target: `https://gito-sports.onrender.com`
- Repository HEAD: `c995602e644d0830224986f1c7d39a81af26ff23`
- `origin/main`: `c995602e644d0830224986f1c7d39a81af26ff23`
- Android tooling: available
- Android device: `SM G985F`, Android 13 / API 33, connected and supported
- Authorized IPTV provider credentials: unavailable
- Authorized M3U playlist or Xtream configuration: unavailable
- Real playback authorization artifact: unavailable

The existing dirty worktree was preserved exactly. No unrelated files were staged or changed.

## Render health

The public endpoint `https://gito-sports.onrender.com/health` returned a response with:

```text
status: ok
databaseReady: true
service: gito-backend
```

The returned payload timestamp was `2026-09-12T19:46:36.686Z`, so this confirms a healthy response was available but is not evidence that a real test match was published during this phase. The response reported zero matches and zero streams.

## Test A - Real IPTV provider

Result: **INCONCLUSIVE - authorized provider unavailable**

Not executed:

- provider configuration;
- provider validation;
- real M3U/Xtream catalogue retrieval;
- real channel selection;
- real channel preview;
- safe real channel identifier capture.

No credentials were searched for, acquired, entered, printed, or stored.

## Test B - Publish a real test match

Result: **INCONCLUSIVE - real working channel unavailable**

No real match was created or modified. No real channel was assigned, approved, or published. No production or Render data was changed.

The current source flow remains documented as:

```text
POST /matches/assign-stream
POST /streams/:streamId/approve
POST /streams/:streamId/publish
GET /mobile/matches/live
```

Evidence is documented in the Phase 2.1C report and current source files:

- `apps/backend/src/routes/matches.ts`
- `apps/backend/src/routes/streams.ts`
- `apps/backend/src/routes/mobile.ts`
- `apps/backend/src/repositories/operations-repository.ts`

## Test C - Android playback

Result: **INCONCLUSIVE - real published playback unavailable**

The Android device was available, but no authorized provider playback artifact existed. The app was not changed, installed for this test, or pointed at an unapproved provider.

Source-verified player path:

```text
GET /mobile/matches/live
  -> LiveMatch.fromJson()
  -> PlaybackScreen
  -> VideoPlayerController.networkUrl(playbackUrl)
  -> direct provider destination
```

No actual video playback was observed.

## Test D - Desktop shutdown

Result: **INCONCLUSIVE - playback was not started**

Because no real stream was playing, the following were not tested:

- playback continuation after Desktop/browser shutdown;
- Desktop process termination verification during playback;
- Mobile playback stability while Desktop remained closed.

## Test E - Mobile restart with Desktop closed

Result: **INCONCLUSIVE - no published real match**

The following were not tested:

- Mobile restart while Desktop remained closed;
- retrieval of the same published match after restart;
- direct playback restart after Desktop shutdown.

## Test F - Credential exposure

Result: **INCONCLUSIVE for real runtime data; current source risk remains confirmed**

Source-verified current behavior:

- provider credentials are stored in backend provider records;
- channel playback URLs are persisted as `channels.url`;
- the mobile read model exposes `playbackUrl` derived from `channels.url`;
- Xtream-style generated URLs can contain reusable authentication material.

No real URL, credential, token, cookie, or authorization header was inspected or printed.

Because no real provider artifact was available, runtime exposure could not be measured. The current raw credential-bearing URL path remains a security concern, but this phase did not redesign it.

## Test results

| Test | Result | Evidence/limitation |
|---|---|---|
| Real authorized IPTV provider | INCONCLUSIVE | No authorized credentials/configuration available |
| Real channel selection and preview | INCONCLUSIVE | No real catalogue available |
| Real match assignment/publication | INCONCLUSIVE | No real working channel available |
| Render backend health | OBSERVED | `/health` returned `status: ok`, `databaseReady: true` |
| Android direct playback | INCONCLUSIVE | No authorized playback artifact |
| Desktop shutdown during playback | INCONCLUSIVE | Playback never started |
| Mobile restart with Desktop closed | INCONCLUSIVE | No published real match |
| Reusable credential exposure | INCONCLUSIVE at runtime | Source risk confirmed; no real artifact inspected |
| Backend persistence with Desktop closed | INCONCLUSIVE for real match | No real publication performed |

## Limitations

- Authorized provider access was not present.
- Android hardware was available, but a provider artifact is required to test playback.
- No real match was published.
- No production data was changed.
- No Render redeploy or manual deployment was performed.
- No source code or UI was changed.
- Synthetic tests from earlier phases cannot establish real-provider playback success.

## Final gate

```text
INCONCLUSIVE
```

The required real-provider and Android playback conditions were not available. This is not evidence of provider failure; it is an incomplete test environment.

## Phase 2.2 recommendation

```text
PHASE 2.2 BLOCKED - TEST ENVIRONMENT INCOMPLETE
```

Phase 2.2 must not proceed until an authorized provider account or sanitized authorized playback artifact is available and the following are completed:

1. real provider validation;
2. real channel preview;
3. real assignment, approval, and publication;
4. Android direct playback;
5. Desktop shutdown with playback continuing;
6. Mobile restart with Desktop closed;
7. runtime inspection confirming no reusable IPTV credentials reach Mobile;
8. backend publication retrieval while Desktop remains closed.

## Files changed

- `docs/PHASE-2.1D-REAL-PROVIDER-ANDROID-PLAYBACK.md`

No application files, UI files, database files, configuration, deployment settings, or tests were changed.
