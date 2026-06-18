# Live Score Production Audit

Audit date: 2026-06-03

Scope: audit only. No implementation code was modified.

## Executive Summary

The Live Scores module preserves the required architecture boundary:

```text
Mobile -> GiTO Backend -> Football-Data.org
```

The Football-Data.org API key remains server-side. Mobile calls only GiTO `/scores/*` routes.

Production readiness status: **partially ready**.

The module is safe for the mobile app in common failures because Flutter request errors are caught and rendered as loading, empty, or unavailable states. The main production gaps are backend-side: no explicit upstream timeout, no stale-cache fallback on upstream failure, no in-flight request de-duplication, and no runtime cache metrics.

Sources checked:

- Football-Data.org pricing: https://www.football-data.org/pricing
- Football-Data.org API reference: https://www.football-data.org/documentation/api
- Local implementation:
  - `apps/backend/src/services/score-service.ts`
  - `apps/backend/src/routes/scores.ts`
  - `apps/mobile/lib/main.dart`

## 1. API Rate Limits

Football-Data.org currently publishes these plan limits:

| Plan | Published calls/minute | Notes |
| --- | ---: | --- |
| Free | 10 | Scores delayed; live scores are not included on the pricing page |
| Free w/ Livescores | 20 | Live scores included |
| ML Pack Light | 20 | Live scores included |
| Free + Deep Data | 30 | Live scores included |
| Standard | 60 | Live scores included |
| Advanced | 100 | Live scores included |
| Pro | 120 | Live scores included |

The API reference also states authenticated clients have per-minute throttling and unauthenticated clients are limited to 100 requests per 24 hours for a narrow resource set.

### Current GiTO Cache TTLs

| GiTO route | Upstream endpoint | Cache key scope | TTL | Max upstream requests/minute | Max upstream requests/hour | Max upstream requests/day |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `GET /scores/live` | `/matches?status=LIVE` | Global | 20s | 3 | 180 | 4,320 |
| `GET /scores/match/:id` | `/matches/:id` | Per match id | 30s | 2 per id | 120 per id | 2,880 per id |
| `GET /scores/competitions` | `/competitions` | Global | 6h | 0.0028 | 0.1667 | 4 |

### Quota Fit

For the primary live-score feed:

- 20s TTL produces a maximum of 3 upstream calls/minute per backend instance.
- This is below the Free plan 10 calls/minute threshold.
- It is also below the Free w/ Livescores 20 calls/minute threshold, which is the relevant paid entry plan if real live scores are required.

Important production caveats:

- These calculations are per backend process. Multiple backend instances multiply upstream usage unless a shared cache is added.
- `GET /scores/match/:id` is per match id. Heavy detail-page traffic across many match ids can exceed quota even though each individual id is cached.
- The current code does not read `X-Requests-Available-Minute` or `X-RequestCounter-Reset`, so it cannot adapt polling based on remaining quota.

## 2. Cache Validation

Implementation verified:

- Cache is an in-memory `Map<string, CacheEntry<unknown>>`.
- `getCached()` returns a value only before `expiresAt`.
- `setCached()` stores values after successful upstream responses.
- Cache prevents duplicate upstream calls after a value has been stored and while TTL remains valid.

### Cache Hit and Miss Percentages

There is no built-in cache instrumentation, so exact production hit/miss percentages are not observable from the current code. The numbers below are calculated from TTL and request cadence.

For `/scores/live`:

| Scenario | Backend requests/minute | Upstream misses/minute | Cache hit % | Cache miss % |
| --- | ---: | ---: | ---: | ---: |
| One mobile client, ideal 20s cadence | 3 | about 1.5 to 3 | 0% to 50% | 50% to 100% |
| 10 mobile clients, staggered | 30 | up to 3 | about 90% | about 10% |
| 60 backend requests/minute | 60 | up to 3 | about 95% | about 5% |
| 300 backend requests/minute | 300 | up to 3 | about 99% | about 1% |

For `/scores/match/:id`:

| Scenario | Backend requests/minute for same id | Upstream misses/minute | Cache hit % | Cache miss % |
| --- | ---: | ---: | ---: | ---: |
| 2 requests/minute for same id | 2 | about 1 to 2 | 0% to 50% | 50% to 100% |
| 20 requests/minute for same id | 20 | up to 2 | about 90% | about 10% |

For `/scores/competitions`:

| Scenario | Backend requests/day | Upstream misses/day | Cache hit % | Cache miss % |
| --- | ---: | ---: | ---: | ---: |
| 24 requests/day | up to 24 | 4 | about 83% | about 17% |
| 240 requests/day | up to 240 | 4 | about 98% | about 2% |

### TTL Effectiveness

Effective:

- For multiple mobile users, the global `/scores/live` cache meaningfully reduces Football-Data.org calls.
- The 6h competitions TTL is effective.
- Per-match detail caching is effective for repeated views of the same match id.

Needs hardening:

- The mobile refresh interval is also 20s, equal to the live-score TTL. With one client, jitter can cause every poll to land after expiry. A 25s or 30s TTL would improve single-client hit rate.
- The cache does not implement stale-while-revalidate or stale-if-error.
- The cache does not de-duplicate concurrent cold misses. If many requests arrive before the first upstream response populates the cache, duplicate upstream calls can occur.
- Cache contents are process-local and disappear on backend restart.

## 3. Failure Handling

### Football-Data.org Unavailable

Backend behavior:

- Upstream 5xx responses are mapped to GiTO 502 with `football_data_request_failed`.
- Network-level fetch failures fall into route catch blocks and return 500 `score_service_error`.
- No stale cached response is served after TTL expiry.

Mobile behavior:

- `ScoreService._getJson()` throws on non-2xx or timeout.
- `LiveScoresScreen._refreshScores()` catches all errors.
- If previous scores exist, they remain in `_scores` and the connection state becomes reconnecting.
- If no previous scores exist, the screen shows an empty/offline state.

Result: mobile should not crash, but backend availability degradation is visible as empty or stale mobile data.

### API Key Invalid or Missing

Missing key:

- Backend throws `football_data_api_key_missing`.
- Route returns HTTP 503.
- Mobile catches and renders error/empty state.

Invalid key:

- Football-Data.org is expected to return a client error such as 403 restricted resource.
- Backend forwards the upstream status if it is below 500 and uses `football_data_request_failed`.
- Mobile catches and renders error/empty state.

Result: mobile should not crash. Operational visibility is limited because the backend response does not distinguish invalid key from other upstream request failures beyond HTTP status.

### Quota Exceeded

Football-Data.org documents `429 Too Many Requests` when quota is exceeded.

Backend behavior:

- 429 is forwarded as 429 with `football_data_request_failed`.
- The code does not parse `X-RequestCounter-Reset` or `X-Requests-Available-Minute`.
- No retry-after or backoff is applied.

Mobile behavior:

- Non-2xx response throws.
- Existing scores remain visible if previously loaded.
- First-load failure shows no scores.

Result: mobile should not crash. Production readiness would improve with quota-aware backoff and stale-cache fallback.

### Timeout Occurs

Backend behavior:

- No explicit timeout or `AbortController` is configured for the Football-Data.org `fetch()`.
- A stalled upstream request may remain open until the runtime or infrastructure closes it.

Mobile behavior:

- Mobile requests to GiTO backend have a 4s connection timeout and a 6s response timeout.
- Timeout is caught in both live scores and details flows.

Result: mobile should not crash, but backend timeout handling is incomplete for production.

## 4. Mobile Offline Behavior

Verified behavior:

- Cached scores remain visible after a successful load because `_scores` is not cleared on refresh failure.
- Initial loading state exists via `CircularProgressIndicator`.
- Pull-to-refresh exists via `RefreshIndicator`.
- Empty/error state exists for first-load or no-score scenarios via `EmptyPanel`.
- Details screen has a loading state and an unavailable state.

Gaps:

- The live scores screen shows only a connection dot for reconnecting/offline state; it does not display an explicit error banner.
- Cached scores are in-memory only and are lost when the app restarts.
- Details screen does not retain the previously viewed score detail if refresh fails.

Mobile crash risk: low. UX clarity during offline or quota failures: medium.

## 5. Future Notification Readiness

`ScoreMatchSummary` exposes:

- `id`
- `utcDate`
- `status`
- `minute`
- `score.home`
- `score.away`
- team identities and names
- competition identity and name
- event descriptors for:
  - `kickoff_reminder`
  - `match_started`
  - `goal`
  - `halftime`
  - `fulltime`

Readiness by notification type:

| Notification | Required data | Current readiness | Notes |
| --- | --- | --- | --- |
| Kickoff reminder | `utcDate`, match id, team names | Ready | Needs scheduler and subscription store later |
| Match started | status transition to `IN_PLAY` | Ready | Requires previous snapshot persistence |
| Goal notification | score transition | Mostly ready | Requires previous score persistence; scorer metadata is not present |
| Halftime | status transition to `PAUSED` | Ready | Requires previous snapshot persistence |
| Fulltime | status transition to `FINISHED` | Ready | Requires previous snapshot persistence |

The current `events` array is a capability descriptor, not an emitted event log. A future notification worker still needs:

- persistent previous snapshots
- user/team/match subscription preferences
- deduplication keys
- delivery status storage
- retry policy

## Production Readiness Verdict

Ready:

- Server-side API key boundary.
- Basic normalized score DTOs.
- Basic cache with TTLs.
- Mobile loading/error guards.
- Notification-ready data fields for major lifecycle events.

Not production-hard yet:

- No upstream timeout.
- No stale-if-error cache serving.
- No in-flight request de-duplication.
- No cache metrics, hit/miss counters, or quota telemetry.
- No shared cache for multi-instance deployments.
- Detail route quota can grow with unique match ids.

Recommended before production launch:

1. Add backend `AbortController` timeout around Football-Data.org calls.
2. Add stale-if-error response support for `/scores/live`.
3. Add in-flight promise coalescing per cache key.
4. Record cache hit/miss counters and upstream status counters.
5. Read Football-Data.org quota response headers and log remaining minute quota.
6. Use a shared cache if the backend runs more than one instance.
7. Increase live TTL above the mobile 20s refresh cadence, or reduce mobile polling, to improve single-client cache effectiveness.
