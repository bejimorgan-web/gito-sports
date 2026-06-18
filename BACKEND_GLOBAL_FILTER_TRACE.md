# BACKEND_GLOBAL_FILTER_TRACE

## Summary
- There is no global filtering middleware for these endpoints in `apps/backend/src/app.ts`.
- There is no active `catalog mode` or `phase lock` filter applied to `/sports`, `/iptv/providers`, `/iptv/channels`, `/streams`, or `/live-matches/current`.
- The primary runtime filters are in individual repository SQL queries and route implementation logic.
- `/streams` is hidden by the route implementation itself: `apps/backend/src/routes/streams.ts` returns `data: []` unconditionally.

---

## Endpoint trace

### 1. `listSports()`
- Location: `apps/backend/src/repositories/sports-repository.ts`
- Raw SQL:
  ```sql
  SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports ORDER BY name
  ```
- WHERE clause:
  - none
- JOIN conditions:
  - none
- Runtime JS filters:
  - none on the main query
  - `mapSport()` enriches each sport with country IDs via:
    ```sql
    SELECT country_id FROM sport_countries WHERE sport_id = ? ORDER BY country_id
    ```
  - this is a secondary lookup and does not filter out sports; it only attaches `countryIds`.

### 2. `listProviders()`
- Location: `apps/backend/src/repositories/provider-repository.ts`
- Raw SQL:
  ```sql
  SELECT id, name, base_url, type, auth_type, status, availability_status,
        failed_channel_loads, health_score, last_successful_stream_load_at, created_at, updated_at
      FROM providers WHERE deleted = 0 ORDER BY name
  ```
- WHERE clause:
  - `deleted = 0`
- JOIN conditions:
  - none
- Runtime JS filters:
  - none; providers are returned directly via `mapProvider()`.
- Conclusion: providers are hidden only if they are deleted or absent from the runtime DB. There is no status-based exclusion in this method.

### 3. `listChannels()`
- Location: `apps/backend/src/repositories/provider-repository.ts`
- Raw SQL template:
  ```sql
  SELECT c.* FROM channels c JOIN providers p ON p.id = c.provider_id WHERE p.deleted = 0 ORDER BY c.group_name, c.name
  ```
- Full WHERE clause (base case):
  - `p.deleted = 0`
- Optional runtime filters added by JS when query params exist:
  - `c.provider_id = ?` when `providerId` is provided
  - `c.group_name = ?` when `category` is provided
  - `(c.name LIKE ? OR c.external_ref LIKE ? OR c.url LIKE ?)` when `q` is provided
- JOIN conditions:
  - inner join: `JOIN providers p ON p.id = c.provider_id`
- Runtime JS filters:
  - dynamic construction of `clauses` based on request query params
- Conclusion:
  - channels are excluded when their provider row is missing or deleted, because the inner join requires a matching provider.
  - `listChannels()` does not reject providers by `status` or `availability_status`.

### 4. `listStreams()`
- There is no repository function named `listStreams()` in the backend repository files.
- The `/streams` endpoint in `apps/backend/src/routes/streams.ts` is implemented as:
  ```ts
  streamsRouter.get("/", (_request, response) => {
    response.json({ data: [] });
  });
  ```
- Final SQL executed:
  - none
- Conclusion:
  - streams are hidden because the route returns an empty array explicitly. This is the direct root cause for `/streams` being empty.

### 5. `listPublishedLiveMatches()`
- Location: `apps/backend/src/repositories/operations-repository.ts`
- Raw SQL:
  ```sql
  SELECT
        m.id AS match_id, m.competition_id, m.season_id, m.home_team_id, m.away_team_id,
        m.starts_at, m.venue_name, m.status AS match_status, m.created_at AS match_created_at,
        m.updated_at AS match_updated_at,
        h.name AS home_team_name, h.logo_url AS home_team_logo_url,
        a.name AS away_team_name, a.logo_url AS away_team_logo_url,
        comp.name AS competition_name, comp.logo_url AS competition_logo_url,
        comp.sport_id AS competition_sport_id, comp.country_id AS competition_country_id,
        sp.name AS sport_name, sp.logo_url AS sport_logo_url,
        cnt.name AS country_name, cnt.flag_url AS country_flag_url,
        s.id AS stream_id, s.channel_id, s.protocol, s.status AS stream_status, s.health_status,
        s.health_reason, s.failure_count, s.last_health_at, s.approval_status, s.approved_by_user_id,
        s.approved_at, s.rejection_reason, s.published_at, s.created_at AS stream_created_at,
        s.updated_at AS stream_updated_at,
        c.id AS channel_id, c.provider_id, c.name AS channel_name, c.external_ref, c.group_name,
        c.url, c.status AS channel_status, c.created_at AS channel_created_at, c.updated_at AS channel_updated_at,
        p.id AS provider_id, p.name AS provider_name, p.type AS provider_type, p.status AS provider_status,
        p.availability_status AS provider_availability_status, p.health_score AS provider_health_score
      FROM streams s
      JOIN matches m ON m.id = s.match_id
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
      JOIN competitions comp ON comp.id = m.competition_id
      LEFT JOIN sports sp ON sp.id = comp.sport_id
      LEFT JOIN countries cnt ON cnt.id = comp.country_id
      JOIN channels c ON c.id = s.channel_id
      JOIN providers p ON p.id = c.provider_id
      WHERE s.status = 'active' AND s.published_at IS NOT NULL AND m.status = 'published'
        AND s.health_status != 'failed'
        AND c.status = 'active' AND p.status = 'active' AND p.availability_status != 'offline'
      ORDER BY m.starts_at
  ```
- WHERE clause:
  - `s.status = 'active'`
  - `s.published_at IS NOT NULL`
  - `m.status = 'published'`
  - `s.health_status != 'failed'`
  - `c.status = 'active'`
  - `p.status = 'active'`
  - `p.availability_status != 'offline'`
- JOIN conditions:
  - `JOIN matches m ON m.id = s.match_id`
  - `JOIN teams h ON h.id = m.home_team_id`
  - `JOIN teams a ON a.id = m.away_team_id`
  - `JOIN competitions comp ON comp.id = m.competition_id`
  - `LEFT JOIN sports sp ON sp.id = comp.sport_id`
  - `LEFT JOIN countries cnt ON cnt.id = comp.country_id`
  - `JOIN channels c ON c.id = s.channel_id`
  - `JOIN providers p ON p.id = c.provider_id`
- Runtime JS filters:
  - none beyond SQL row selection; the JS layer only maps SQL rows into the `PublishedLiveMatch` response shape.
- Conclusion:
  - live matches are hidden if any of the required stream/channel/provider conditions fail.
  - In the runtime DB state, a published stream may still be excluded because `p.status` is not `active` or `p.availability_status` is `offline`.

---

## Global filter / catalog mode / phase lock checks

### A. Global filter middleware?
- `apps/backend/src/app.ts` registers only:
  - `helmet()`
  - `cors()`
  - `express.json()`
  - static upload middleware
  - route routers
  - `workflowErrorHandler`
- There is no global query filter middleware that rewrites or filters entity query results for `/sports`, `/iptv`, `/streams`, or `/live-matches`.
- Answer: **No global filter middleware is active.**

### B. Catalog mode / phase lock filter?
- `catalog mode` is present in other routes like `teams`, `countries`, and `competitions` via `request.query.mode === 'catalog'`.
- The inspected endpoints do not use `catalog mode` or `phase lock`.
- `catalog_rules.ts` only defines delete/cascade/orphan semantics, not runtime visibility filters.
- Answer: **No catalog-mode or phase-lock filter is applied to these endpoints.**

### C. Providers excluded due to status?
- `listProviders()` does not exclude providers by `status`.
- It only excludes `deleted = 0`.
- Providers are excluded from `listPublishedLiveMatches()` only if `p.status != 'active'` or `p.availability_status == 'offline'`.
- Answer: **Not in `listProviders()`; yes in published live match feed.**

### D. Channels excluded due to provider join failure?
- Yes. `listChannels()` uses an inner join with `providers p ON p.id = c.provider_id` and `p.deleted = 0`.
- If a channel's provider row is missing or deleted, the channel is excluded.
- Answer: **Yes, channel visibility depends on a successful provider join.**

### E. Streams excluded due to health_status or approval_status?
- `/streams` is hardcoded to return `[]`, so no SQL-level health or approval filtering happens there.
- In `listPublishedLiveMatches()`, streams are excluded by:
  - `s.status = 'active'`
  - `s.published_at IS NOT NULL`
  - `s.health_status != 'failed'`
- There is no explicit `approval_status` check in the SQL, but `s.published_at IS NOT NULL` implies the stream has been published.
- Answer: **Yes for published live matches; no SQL executed for `/streams`.**

### F. Sports excluded due to empty join tables?
- `listSports()` does not join other tables; it selects directly from `sports`.
- The only related lookup is `sport_countries` in `mapSport()`, which does not remove sports.
- Answer: **No, sports are not hidden by empty joins; they would only be hidden if the `sports` table itself is empty.**

---

## Entity delete / catalog rules inspection

### `apps/backend/src/services/entityDeleteService.ts`
- The service checks `allowedDeletes.has(entityType)`.
- It then validates entity existence and performs delete/cascade operations.
- There are no visibility filters or query restrictions here.
- It is a delete/cascade service only.

### `apps/backend/src/services/catalog_rules.ts`
- Defines:
  - `allowedDeletes`
  - `protectedEntities`
  - `cascadeTargets`
  - `orphanTargets`
- No SQL queries or request-time filters are defined.
- This file is not a runtime filter chain; it is deletion/cascade metadata.

---

## Filter chain diagram

```
/request -> app.ts router -> selected route handler -> repository method / route logic

/sports -> sportsRouter -> listSports() -> SELECT FROM sports

/iptv/providers -> iptvRouter -> listProviders() -> SELECT FROM providers WHERE deleted = 0

/iptv/channels -> iptvRouter -> listChannels(opts) -> SELECT c.* FROM channels c
                                                  JOIN providers p ON p.id = c.provider_id
                                                  WHERE p.deleted = 0 [AND optional query filters]

/streams -> streamsRouter -> response.json({ data: [] })

/live-matches/current -> liveMatchesRouter -> listPublishedLiveMatches() ->
      SELECT FROM streams s
      JOIN matches m on m.id = s.match_id
      JOIN teams h/a
      JOIN competitions comp
      LEFT JOIN sports sp
      LEFT JOIN countries cnt
      JOIN channels c
      JOIN providers p
      WHERE s.status = 'active'
        AND s.published_at IS NOT NULL
        AND m.status = 'published'
        AND s.health_status != 'failed'
        AND c.status = 'active'
        AND p.status = 'active'
        AND p.availability_status != 'offline'
```

---

## Final reason why ALL entities except matches are hidden

- `/sports`: hidden because the SQL returns zero rows from `sports` itself. There is no filter in `listSports()`.
- `/iptv/providers`: hidden because `listProviders()` only returns non-deleted providers, and the runtime DB appears to have no non-deleted provider rows.
- `/iptv/channels`: hidden because the channel query requires a matching non-deleted provider row. If providers are absent or deleted, channels vanish.
- `/streams`: hidden because the endpoint is implemented to always return `[]`.
- `/live-matches/current`: hidden by strict publish feed filters on stream status, `published_at`, channel status, and provider state. A published stream with a failed provider will be excluded.

## Bottom line
- There is no backend-wide catalog/phase filter hiding these endpoints.
- The observed emptiness is caused by endpoint-specific implementations and repository WHERE filters.
- The biggest direct defect is `/streams` returning an empty array unconditionally.
- The second defect is the strict `listPublishedLiveMatches()` filter chain, which will hide live matches if provider state is not fully active.
