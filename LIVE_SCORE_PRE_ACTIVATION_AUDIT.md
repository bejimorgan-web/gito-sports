# Live Score Pre-Activation Audit

Audit date: 2026-06-03

Scope: audit only. No implementation code was modified.

## Summary

The Live Scores integration is safe to leave present before activating a Football-Data.org API key. The backend starts with `FOOTBALL_DATA_API_KEY` missing because the key is not validated at module initialization or app startup. Score requests fail gracefully through the `/scores` route handlers, and the mobile Live Scores UI catches score API failures instead of crashing.

Pre-activation verdict: **safe to ship inactive**, with one expected behavior: `/scores/*` endpoints return service errors until `FOOTBALL_DATA_API_KEY` is configured.

Verification performed:

- Source inspection of `apps/backend/src/app.ts`.
- Source inspection of `apps/backend/src/routes/scores.ts`.
- Source inspection of `apps/backend/src/services/score-service.ts`.
- Source inspection of `apps/mobile/lib/main.dart`.
- `npm run typecheck -w @gito/backend`: passed.
- `flutter analyze`: passed.

## 1. Route Verification

Status: **passed**.

Routes exist in `apps/backend/src/routes/scores.ts`:

| Required route | Verified handler | Behavior |
| --- | --- | --- |
| `GET /scores/live` | `scoresRouter.get("/live", ...)` | Calls `ScoreService.listLiveScores()` and returns `{ data }` |
| `GET /scores/match/:id` | `scoresRouter.get("/match/:id", ...)` | Calls `ScoreService.getMatch(id)` and returns `{ data }` or 404 |
| `GET /scores/competitions` | `scoresRouter.get("/competitions", ...)` | Calls `ScoreService.listCompetitions()` and returns `{ data }` |

Route mounting exists in `apps/backend/src/app.ts`:

```ts
app.use("/scores", scoresRouter);
```

Conclusion: all required public GiTO backend routes are present and mounted.

## 2. Missing API Key Initialization

Status: **passed**.

`apps/backend/src/config/env.ts` assigns:

```ts
const footballDataApiKey = process.env.FOOTBALL_DATA_API_KEY ?? "";
```

This means a missing API key resolves to an empty string, not a startup exception.

`ScoreService` does not call Football-Data.org during import or app startup. The key is checked lazily inside `footballDataGet()` only when a score route invokes an upstream request:

```ts
if (!env.footballDataApiKey) {
  throw Object.assign(new Error("FOOTBALL_DATA_API_KEY is not configured."), {
    statusCode: 503,
    code: "football_data_api_key_missing"
  });
}
```

Conclusion: backend initialization is unaffected when `FOOTBALL_DATA_API_KEY` is missing. Score routes become unavailable gracefully, but the app can still start.

## 3. Backend Graceful Error Behavior

Status: **passed with caveat**.

All score routes are wrapped in `try/catch` and call `handleScoreError()` on failure.

Graceful responses:

| Failure | Backend response |
| --- | --- |
| Missing `FOOTBALL_DATA_API_KEY` | HTTP 503, `football_data_api_key_missing` |
| Football-Data.org 4xx, including invalid key or quota exceeded | Same upstream HTTP status, `football_data_request_failed` |
| Football-Data.org 5xx | HTTP 502, `football_data_request_failed` |
| Unclassified runtime/network error | HTTP 500, `score_service_error` |
| Unknown match detail payload | HTTP 404, `score_match_not_found` when service returns null |

Caveat:

- The backend does not configure an explicit timeout for `fetch()`. A stalled Football-Data.org request may remain open until Node or infrastructure times it out. This does not block app startup, but it is a production hardening item.

Conclusion: backend errors are JSON responses rather than unhandled crashes.

## 4. Mobile Live Scores Screen

Status: **passed**.

Verified mobile behavior in `apps/mobile/lib/main.dart`:

- The `Live Scores` tab exists through a `NavigationDestination` with `Icons.scoreboard_rounded`.
- `LiveScoresScreen` starts a refresh in `initState()`.
- It refreshes every 20 seconds.
- It supports pull-to-refresh through `RefreshIndicator`.
- It shows a loading state with `CircularProgressIndicator`.
- It shows an empty/error state with `EmptyPanel`.
- It stores successful results in `_scores`.
- On refresh failure, it catches all errors and does not clear existing scores.
- The detail screen uses `FutureBuilder<ScoreMatch>`.
- The detail screen shows loading while waiting and `Score details are unavailable.` on error.

Crash assessment:

- `ScoreService._getJson()` throws on non-2xx responses or timeout.
- `LiveScoresScreen._refreshScores()` catches those failures.
- `MatchScoreDetailsScreen` renders `snapshot.hasError` as a visible unavailable state.

Conclusion: the Live Scores screen can load, show loading/error states, retain previous in-memory scores after refresh failure, and should not crash when the score API is unavailable.

## 5. App Startup When Score API Is Unavailable

Status: **passed**.

Backend:

- Score API key validation is lazy, not part of backend startup.
- `/scores` route registration does not call Football-Data.org.
- Backend typecheck passes with the score integration present.

Mobile:

- The app starts at `LiveHomeScreen`.
- The score tab is one of three tabs and does not block construction of the home screen.
- Score fetching is scoped to `LiveScoresScreen.initState()`, so score API failure does not prevent the app from launching.
- Flutter analyzer reports no issues.

Conclusion: score API unavailability should not prevent backend startup or mobile app startup.

## Pre-Activation Risks

These are acceptable before activation but should be known:

- `/scores/live`, `/scores/match/:id`, and `/scores/competitions` will return HTTP 503 until `FOOTBALL_DATA_API_KEY` is configured.
- The mobile Live Scores tab will show no scores on first load while inactive.
- There is no explicit user-facing banner explaining that the score API is not configured.
- Backend upstream timeout handling is not yet hardened.

## Activation Checklist

Before enabling live use:

1. Set `FOOTBALL_DATA_API_KEY` in the backend runtime environment only.
2. Confirm the selected Football-Data.org plan includes live scores.
3. Start the backend and verify `GET /scores/live` returns `{ data: [] }` or live matches, not `football_data_api_key_missing`.
4. Open the mobile app and verify the Live Scores tab renders without errors.
5. Monitor backend logs for upstream 401/403/429/5xx responses after activation.

## Final Verdict

The Live Scores integration is **pre-activation safe**.

No code changes are required before adding the API key. The inactive state is graceful: score routes return structured errors, mobile catches failures, and app startup remains unaffected.
