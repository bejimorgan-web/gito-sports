# Mobile UX

The mobile app is the viewer-facing layer of GiTO Live Sports. It consumes the backend mobile feed as read-only data and never performs operator actions.

## Home Structure

The landing screen prioritizes:

1. Live Matches
2. Starting Soon
3. Competitions

The home feed keeps text short, preserves scroll position during refreshes, and avoids replacing cached content during temporary backend outages.

## Navigation Structure

Mobile navigation is intentionally simple:

- Live: live-first home feed and match cards.
- Competitions: sport hierarchy and competition grouping.

Competition hierarchy follows the product model:

Sport -> Region/Continent -> Country -> Competition -> Matches

The current backend mobile feed exposes competition and team identifiers. The UI presents stable readable fallback labels until enriched public names are available through the mobile feed contract.

## Match Status System

Viewer-facing states:

- LIVE: match has a published match state and active playable stream.
- STARTING SOON: playable stream is available and kickoff is within 30 minutes.
- ENDED: match is completed or cancelled.
- STREAM ISSUE: match exists in local/cached state, but stream is unavailable or failed.
- OFFLINE: backend feed is unreachable and no current confirmation is available.

The mobile app must never show draft, assigned, approved-only, failed, disabled, or cancelled feed entries as live. Backend feed filtering remains the source of truth.

## Match Cards

Cards show:

- competition
- home team
- away team
- kickoff time
- status pill
- stream availability icon

Cards are optimized for quick scanning and route to match details.

## Match Details

The match details screen focuses on:

- teams
- competition
- kickoff
- match/stream status
- WATCH LIVE action

Secondary metadata stays below the primary viewing action.

## Playback States

Playback UX states:

- Loading: preparing stream.
- Connecting: opening live connection.
- Playing: live feed is available.
- Buffering: temporary connection instability.
- Failure: stream unavailable with recovery guidance.

The MVP playback screen avoids technical jargon and never leaves users on a frozen or ambiguous state.

## Real-Time Updates

The mobile app polls the mobile feed on a short interval and updates in place. Existing content remains visible during reconnecting states to avoid flicker and preserve trust.

## Network Degradation

When the feed is slow or unreachable:

- cached matches remain visible if available
- a reconnect banner explains the state
- pull-to-refresh remains available
- empty offline state appears only when no cached feed exists

## Performance Considerations

- Feed refreshes reuse one list state to avoid visible jumps.
- Scroll positions are preserved with page storage keys.
- Match cards use stable IDs and compact layouts.
- No backend polling is performed from secondary details/playback screens.
- The app uses no image/logo network loading in the MVP to avoid avoidable startup delays.
