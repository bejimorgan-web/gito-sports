# LIVE_SCORE_MAPPING_REPORT

## Scope

This report verifies the live score request chain and diagnoses why `/scores/live` returns an empty payload despite the Football-Data API being reachable.

## Live score request chain

1. Mobile or desktop client calls `GET /scores/live`.
2. `apps/backend/src/routes/scores.ts` forwards the request to `ScoreService.listLiveScores()`.
3. `apps/backend/src/services/score-service.ts` checks the in-memory cache.
4. If the cache is stale or missing, it calls `footballDataGet('/matches?status=LIVE')`.
5. `footballDataGet()` sends a request to `https://api.football-data.org/v4/matches?status=LIVE` with `X-Auth-Token`.
6. The returned Football-Data response is normalized by `normalizeMatch()`.
7. The backend returns normalized GiTO DTOs in the `matches` array.

## Verified behavior

- The configured `.env` contains a valid `FOOTBALL_DATA_API_KEY`.
- The Football-Data API endpoint is reachable and returns HTTP 200.
- A direct upstream call to `/matches?status=LIVE` returned zero matches.

Direct upstream check result:

- HTTP status: 200
- JSON keys: `filters`, `resultSet`, `matches`
- `matches` length: 0

## Competition mapping and database linkage

- `ScoreService` does not query the internal `competitions` database table when resolving `/scores/live`.
- `normalizeMatch()` maps the Football-Data competition object to a GiTO DTO with `id`, `name`, and `logoUrl`.
- The internal `competitions` table has only one row (`FIFA 2026 World Cup`) and does not include a Football-Data external reference field.
- There is no `competition.externalRef` field in the current live score adapter or in the internal competition schema.

## Root cause

The empty live score result is caused by the upstream Football-Data response containing no live matches at the time of the check.
This is not a failure in DB competition mapping or in the current `/scores/live` adapter logic.

## Internal DB state

- `sports` count: 1
- `competitions` count: 1
- The internal competition row is independent of the live-score adapter.

## Conclusion

- API reachability: confirmed.
- Football-Data authentication: confirmed.
- Live matches empty: confirmed upstream.
- Competition mapping failure: not present in the current implementation.

## Recommendation

If future production requirements demand persistent competition linkage between live-score payloads and internal DB competitions, add an explicit external reference field or mapping table between Football-Data competition IDs and GiTO competition IDs.
