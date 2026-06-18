# Workflows

GiTO Live Sports keeps MVP workflows explicit and operator-driven. The desktop app remains the operational authority, while the backend stores state and exposes mobile-safe live feeds.

## IPTV Ingestion Workflow

1. Operator creates an IPTV provider in the desktop console.
2. Operator tests provider connectivity.
3. For M3U providers, operator submits playlist content for parsing.
4. For Xtream Codes providers, backend calls the provider API and extracts live channels.
5. Backend stores providers and channels in SQLite.
6. Channels are grouped by playlist or Xtream category when available.

## Stream Approval Workflow

1. Operator selects an IPTV channel.
2. Operator previews the channel in the desktop app.
3. Operator attaches sport, competition, team, and kickoff metadata.
4. Backend creates an assigned match and assigned stream.
5. Operator approves the stream, which moves both stream and match to approved.
6. Operator publishes the approved stream, which moves the match to published and the stream to active.

## Backend Publishing Workflow

1. Backend accepts approval for a pending stream.
2. Backend stores approval status, operator id, and approval timestamp.
3. Backend publishes only approved streams attached to approved matches.
4. Publishing sets the stream publication timestamp, marks the stream active, and marks the match published.
5. Published matches with active streams are serialized through `/live-matches/current`, `/live-matches/feed`, and `/mobile/matches/live`.

## Mobile Consumption Workflow

1. Mobile app requests the current live match feed.
2. Backend returns only published matches with active streams.
3. Provider credentials are never included in mobile responses.
4. Mobile displays match metadata and playback URL.
5. If no streams are published, mobile displays an empty live state.

## Authentication Workflow

1. Desktop operator logs in through `/auth/login`.
2. Backend returns a short-lived local JWT for protected operator actions.
3. Desktop sends the JWT when approving or publishing streams.
4. Backend middleware validates the JWT before mutating approval or publication state.
5. Logout is local and can later be extended to persisted session revocation.
