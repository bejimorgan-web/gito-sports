# PHASE8_PERSISTENCE_HARDENING_REPORT

## Objective

Guarantee that backend, desktop app, and mobile feed always use the same SQLite database after restart.

## Changes made

### 1. Audit connection.ts and DATABASE_PATH resolution

- `apps/backend/src/config/env.ts`
  - Added project-root resolution for relative `DATABASE_PATH` values.
  - Computed `absoluteDatabasePath` from the repository root.
  - Preserved raw `databasePath` for startup logging.

- `apps/backend/src/db/connection.ts`
  - Switched database opening from `env.databasePath` to `env.absoluteDatabasePath`.
  - Logged both raw `DATABASE_PATH` and resolved absolute path at startup.
  - Added startup validation for:
    - database file existence
    - database file size
    - schema version via `PRAGMA user_version`
    - row counts for `matches`, `streams`, `scheduling_matches`, and `match_streams`
  - Set `PRAGMA user_version = 1` automatically when no schema version was present.

- `apps/backend/src/server.ts`
  - Forced early database initialization by calling `getDatabase()` before the server listens.
  - This guarantees startup path logging and validation before backend begins accepting requests.

## Startup logging

On backend startup, the following messages are now emitted:

- `[startup] DATABASE_PATH=<raw value>`
- `[startup] RESOLVED_DATABASE_PATH=<absolute path>`
- `[startup] schema version=<value> expected=1`
- `[startup] table row counts: matches=<n>, streams=<n>, scheduling_matches=<n>, match_streams=<n>`

## Verification plan

1. Start backend and confirm logs show the same resolved path before and after restart.
2. Confirm raw path and absolute path values are printed.
3. Create a match, assign a stream, approve, and publish live.
4. Restart backend.
5. Restart desktop app.
6. Restart mobile app or re-fetch mobile feed.
7. Confirm published feed is still visible in:
   - `/live-matches/current`
   - `/mobile/matches/live`
8. Confirm live operations remain visible and do not open a different database file.

## Files changed

- `apps/backend/src/config/env.ts`
- `apps/backend/src/db/connection.ts`
- `apps/backend/src/server.ts`

## Notes

- The desktop and mobile feeds both depend on the backend live feed API, so ensuring backend database path stability is the key hardening step.
- This change does not alter desktop or mobile client code directly; it guarantees the backend always resolves the same SQLite file from the project root.
