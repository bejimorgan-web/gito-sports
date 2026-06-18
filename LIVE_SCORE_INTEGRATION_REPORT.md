# Live Score Integration Report

## Scope

GiTO Live Sports now includes a production-ready Live Scores module backed by Football-Data.org. The module preserves the GiTO architecture boundary:

```text
Mobile
  -> GiTO Backend
    -> Football-Data.org
```

The mobile app never calls Football-Data.org directly and never receives the Football-Data.org API key.

## Backend Routes

- `GET /scores/live`
  - Returns normalized live football score snapshots from Football-Data.org `/matches?status=LIVE`.
  - Response shape: `{ data: ScoreMatchSummary[] }`.

- `GET /scores/match/:id`
  - Returns a normalized match score detail snapshot from Football-Data.org `/matches/:id`.
  - Response shape: `{ data: ScoreMatchSummary }`.

- `GET /scores/competitions`
  - Returns normalized Football-Data.org competition metadata.
  - Response shape: `{ data: ScoreCompetitionSummary[] }`.

## Services

`ScoreService` lives in `apps/backend/src/services/score-service.ts`.

Responsibilities:

- Holds all Football-Data.org API access server-side.
- Sends `X-Auth-Token` from `FOOTBALL_DATA_API_KEY`.
- Normalizes external match, team, competition, score, status, logo, and minute fields into GiTO-owned DTOs.
- Returns notification-ready score event descriptors without implementing notifications.
- Provides in-memory TTL caching to reduce Football-Data.org calls.

Environment variables:

- `FOOTBALL_DATA_API_KEY`: required for live score routes to call Football-Data.org.
- `FOOTBALL_DATA_BASE_URL`: optional, defaults to `https://api.football-data.org/v4`.

## Mobile App

The Flutter app adds a third bottom navigation tab:

- `Live Scores`

New screens:

- `LiveScoresScreen`
  - Calls `GET /scores/live`.
  - Refreshes every 20 seconds and supports pull-to-refresh.
  - Displays competition logo/name, home and away logos, score, match minute, and status.

- `MatchScoreDetailsScreen`
  - Calls `GET /scores/match/:id`.
  - Displays a detailed score snapshot for the selected match.

The existing IPTV, live stream, match approval, and publishing flows remain unchanged.

## Data Flow

1. Mobile opens the Live Scores tab.
2. Mobile calls GiTO Backend `/scores/live`.
3. Backend checks the `ScoreService` cache.
4. If cached data is fresh, backend returns it immediately.
5. If cache is expired or empty, backend calls Football-Data.org with the server-side token.
6. Backend normalizes the response into GiTO DTOs.
7. Mobile renders only GiTO DTOs.

## Cache Strategy

The cache is intentionally lightweight and in-memory to match the MVP backend architecture.

- Live scores: 20 seconds.
- Match details: 30 seconds per match id.
- Competitions: 6 hours.

This reduces Football-Data.org API usage while keeping live match UX responsive. For multi-instance deployments, replace the in-memory map with a shared cache such as Redis or a database-backed cache.

## Future Notification Integration

`ScoreMatchSummary.events` includes notification-ready descriptors for:

- `kickoff_reminder`
- `match_started`
- `goal`
- `halftime`
- `fulltime`

Notifications are not implemented yet. The prepared architecture allows a later notification worker to compare cached score snapshots over time and emit events when status, score, or kickoff thresholds change.

Recommended future worker behavior:

- Poll `/scores/live` or call `ScoreService.listLiveScores()`.
- Persist previous score snapshots.
- Emit `match_started` when status enters `IN_PLAY`.
- Emit `goal` when home or away score changes.
- Emit `halftime` when status enters `PAUSED`.
- Emit `fulltime` when status enters `FINISHED`.
- Emit `kickoff_reminder` based on `utcDate` thresholds before kickoff.

## Deployment Considerations

- Set `FOOTBALL_DATA_API_KEY` only in backend runtime environments.
- Do not include the key in Flutter build args, desktop env, checked-in files, or client logs.
- Monitor Football-Data.org rate limits and adjust TTLs if usage increases.
- Use HTTPS for production backend traffic.
- For scaled backend deployments, use a shared cache to avoid duplicated upstream calls.
- Keep score integration independent from IPTV provider, stream approval, match publishing, and playback systems.
