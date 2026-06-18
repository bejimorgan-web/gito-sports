# RENDER_DEPLOYMENT_READINESS

## Scope

This report audits the backend persistence path, IPTV debug readiness, live score route readiness, and Render deployment compatibility for `GiTO Live Sports`.

## Findings

### 1. Backend persistence readiness

- `apps/backend/src/db/connection.ts` is the single-entry database connector.
- `getDatabase()` resolves `env.absoluteDatabasePath` and uses a singleton `DatabaseSync` instance.
- Startup behavior:
  - creates parent directories as needed
  - copies `data/gito-seed.sqlite` into place when the DB file is absent
  - applies initial schema when a new empty file is created
  - enables `PRAGMA foreign_keys = ON`
  - validates `PRAGMA user_version` against expected schema version
  - logs table counts for `sports`, `providers`, `channels`, `matches`, `streams`, and legacy tables
- All repository and service modules use `getDatabase()` for database access, including IPTV, match, team, score, stream, and background jobs.
- `apps/backend/src/system/startup.ts` rehydrates provider state at startup and updates provider availability based on channel counts.

### 2. Health probe and Render compatibility

- `apps/backend/src/routes/system.ts` exposes `GET /system/health`.
- `startupHealthCheck()` in `apps/backend/src/system/startup.ts` validates:
  - DB file exists
  - DB file size > 0
  - `getDatabase()` can open the database
- Runtime values from the latest health probe:
  - `status: ok`
  - `db: ok`
  - `iptv: ok`
  - `liveScores: ok`
  - `renderMode: false`
- `apps/backend/src/config/env.ts` resolves the production DB path as:
  - `process.env.DATABASE_PATH` if set and absolute
  - otherwise `/data/gito.sqlite` in production
  - otherwise local workspace `data/gito.sqlite`
- The env loader enforces:
  - absolute `DATABASE_PATH` when provided
  - non-empty database path
  - strong `JWT_SECRET` in production

### 3. IPTV debug and sync readiness

- `apps/backend/src/routes/iptv.ts` supports:
  - `GET /iptv/providers`
  - `GET /iptv/channels` with `mode=debug` or `mode=raw`
  - `GET /iptv/channels/debug`
  - `GET /iptv/providers/:providerId/diagnostics`
- `apps/backend/src/repositories/provider-repository.ts` `syncProviderChannels()` logic:
  - deduplicates incoming channels by normalized `externalRef`, normalized URL, or name+URL
  - updates existing channels when external ref matches
  - inserts new channels when there is no match
  - marks missing channels as `stale` under `partial` sync or `inactive` under `full` sync
  - preserves existing non-active rows when the provider is in partial sync mode
- Latest debug counts from runtime channel output:
  - total channels: 14,783
  - active: 3,862
  - archived: 10,921
  - provider_deleted: 10,932
- Provider debug output shows one active `IPTV` provider of type `m3u` in `partial` sync mode.

### 4. Live score readiness

- `apps/backend/src/routes/scores.ts` exposes:
  - `GET /scores/live`
  - `GET /scores/match/:id`
  - `GET /scores/competitions`
- `apps/backend/src/services/score-service.ts` implements:
  - in-memory TTL cache for live scores, match details, and competitions
  - background refresh for cache hits to avoid blocking requests
  - stale-cache fallback for cold misses when cached data has just expired
- Latest runtime score probe shows:
  - `meta.source: cache`
  - `data.length: 0`
- This indicates the route is operational and returning cached payloads; empty live data is expected when no live matches are available.

### 5. Stream preview recovery readiness

- `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx` contains recovery logic:
  - detects `waiting`, `stalled`, `ended`, and `error` playback events
  - marks degraded and failed preview states
  - retries up to 3 reconnect attempts with incremental delays
  - exposes a manual `Reconnect stream` action when retries exhaust
- The preview panel supports HLS and direct video URLs and emits health status events for UI monitoring.

## Conclusion

PASS: The backend persistence path and health endpoint are ready for Render deployment.

PASS: The IPTV debug and provider channel listing routes are available and reflect stored DB state.

PASS: The live score service route is implemented and currently returns cached responses.

PASS: The desktop preview recovery path includes reconnect logic for stream playback failure.

## Deployment notes

- For Render, set `DATABASE_PATH=/data/gito.sqlite` or rely on the default production fallback.
- Ensure `JWT_SECRET` is configured in production.
- If using read-only mode, set `DB_READONLY_MODE=true`.
- Monitor the external IPTV provider and Football-Data.org upstream services separately; the health probe currently validates only DB persistence and not external live endpoints.

## Recommendations

- Add explicit Render-side monitoring for external IPTV provider reachability and live score upstream availability.
- Consider adding a shared cache or persistence layer for score caching if multiple backend instances are deployed.
