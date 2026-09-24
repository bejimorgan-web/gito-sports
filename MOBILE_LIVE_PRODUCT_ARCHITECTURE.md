# Mobile Live / Sports / Player Branding Architecture

## 1. Sports vs Live responsibilities

The Sports section remains the canonical published-match browsing hierarchy. It shows matches in the normal product ordering and is not treated as the live-streaming feed.

The Live section is a strict live-window view for matches that are within the allowed pre-kickoff/live period. The live window is driven by the canonical kickoff time and the match lifecycle state, not by a local device-only approximation.

## 2. 30-minute pre-kickoff rule

The mobile client uses a single authoritative rule:

- A match is eligible for Live only when its kickoff is within 30 minutes of now and it is not already ended/cancelled/postponed.
- A match may remain live after kickoff while it is still active.
- A match with missing or invalid kickoff data is not treated as live.

This is enforced in the shared `LiveEligibility` helper so Sports, Live tab membership, and Watch Now gating all use the same rule.

## 3. Desktop Live flag semantics

The desktop-controlled `navigation.live` flag remains the global authority for mobile live streaming. In the backend, it is persisted and exposed through the mobile feature endpoint. The mobile app reads that backend signal and treats it as the guard that can globally enable or disable playback.

When `Live = OFF`:

- the Live tab is not presented as a live experience;
- Match Details remains accessible for viewing match information;
- the `WATCH LIVE` action is hidden;
- no path can open a live playback screen from the app shell.

The flag is enforced at the application boundary so that hiding the UI alone cannot bypass it.

## 4. Watch Now gating

The `WATCH LIVE` button is only available when all of the following are true:

1. the backend Live feature is enabled;
2. the match has a valid playback URL;
3. the match is in the valid live window or still active;
4. the stream is not failed/invalid.

This prevents stale or invalid playback entries from being launched even when a match is visible elsewhere.

## 5. Feature-disabled vs no-data vs playback-unavailable vs network failure

These states are intentionally distinct:

- Feature disabled: the desktop Live feature is off, so all playback is blocked globally.
- No live data: Live is enabled but there are no eligible matches at the moment.
- Playback unavailable: a live-eligible match exists but its safe playback target is missing or failed.
- Network unavailable: the client cannot fetch fresh data and the UI falls back to reconnecting/offline messaging.

This prevents all empty states from being collapsed into a single message.

## 6. Match identity and publication boundary

The app keeps the canonical match identity and does not create a separate backend mobile entity for live. The viewer-facing match model is a composition of the same match/publication/playback-safe data already produced by the existing publication delivery pipeline.

The mobile player receives only the safe playback URL that is already part of the existing delivery architecture. No IPTV credentials, provider IDs, or Desktop-local paths are introduced into the app.

## 7. Player logo overlay architecture

The app adds a lightweight overlay around the existing native `video_player` instead of modifying the stream or introducing a second playback engine.

The player uses a `Stack` with the video surface and a `Positioned` top-right overlay. It preserves the native player and only adds a branded overlay if a safe logo source is configured. If no logo is available or the asset fails to load, playback continues normally.

This keeps the overlay viewer-safe and does not weaken the existing publication-delivery security boundary.
