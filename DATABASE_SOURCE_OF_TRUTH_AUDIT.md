# DATABASE_SOURCE_OF_TRUTH_AUDIT

## Executive Summary

**CRITICAL FINDING:** The operator data is present and intact in `data/gito.sqlite` at workspace root. A stale/test SQLite artifact exists at `apps/backend/data/gito.sqlite` and is the likely source of the unknown records and confusion.

---

## A. Which database contains operator data?

**ANSWER:** `data/gito.sqlite` at workspace root.

**Evidence:**
- Path: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`
- Size: 1,077,248 bytes
- Modified: `2026-06-01T19:07:19`
- `PRAGMA user_version = 1`
- Table row counts:
  - `sports`: 12
  - `countries`: 8
  - `competitions`: 10
  - `teams`: 57
  - `providers`: 12
  - `channels`: 2411
  - `matches`: 6
  - `streams`: 6

**Sample operator-created records:**
- Sports: `Football`, `Lifecycle Audit Sport`, `Sport Validation 9e686212`, `HostSport d01672f0`
- Providers: `Reliability Inline M3U`, `Provider Comp 3e18d156`, `Provider Host d01672f0`, `Provider Sport 9e686212`, `Provider Team 61a84790`, `API TV`
- Competitions: `Reliability Inline League`, `Lifecycle Audit Competition`, `Host Competition d01672f0`, `Host Competition e3749818`, `Team Competition 61a84790`

This database contains the operator’s configuration, provider metadata, and category data that should be the system-of-record.

---

## B. Which database is currently active?

**ANSWER:** `data/gito.sqlite` at workspace root is the intended active backend database.

**Code path:**
- `apps/backend/src/config/env.ts` reads `DATABASE_PATH` from environment or defaults to `"data/gito.sqlite"`.
- It resolves the value relative to `workspaceRoot` derived from the source file location.
- `workspaceRoot` resolves to `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports`.

Therefore, unless `DATABASE_PATH` is explicitly overridden externally, the backend is configured to use the root workspace database.

**Note:** A stale artifact still exists at `apps/backend/data/gito.sqlite`, but the backend source code does not intentionally target it.

---

## C. Why did unknown records appear?

**ANSWER:** Because there are multiple SQLite files with the same default filename, and the stale/test database contains unrelated `IPTV`/`Smoke Test` data.

**Supporting evidence:**
- `apps/backend/data/gito.sqlite` contains:
  - `sports`: 1 (`Soccer`)
  - `providers`: 25 (generic names like `IPTV`, `IPTV FREE`, `Smoke Test M3U`, `Governance M3U`)
  - `channels`: 19,253
  - `competitions`: 5 (`Smoke League`, `Governance League`, `Laliga`, `Premier League`, `World Cup`)
  - `streams`: active published matches such as `FIFA+ United States (720p)` and `Smoke Sports`
- `node_modules/@gito/backend/data/gito.sqlite` is a duplicate of the same stale/test DB.

**Conclusion:** The unknown records are from a stale/test dataset that shares the default path name. This creates a high risk of opening the wrong database if runtime configuration is ambiguous.

---

## D. Is data lost, hidden, or stored elsewhere?

**ANSWER:** Data is hidden, not lost.

**Evidence of preservation:**
- `data/gito.sqlite` exists and contains the operator database.
- This file is recent and contains operator-created sports, providers, competitions, and live-stream state.

**Evidence of hiding:**
- A duplicate/stale `gito.sqlite` exists in `apps/backend/data/`.
- The desktop UI uses backend API calls to refresh providers, channels, and live matches, so a backend database mismatch can hide the correct records.

---

## E. Exact recovery path

### 1. Confirm the actual backend path

The backend resolves the path like this:
```ts
const databasePath = process.env.DATABASE_PATH ?? "data/gito.sqlite";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const absoluteDatabasePath = path.isAbsolute(databasePath)
  ? databasePath
  : path.resolve(workspaceRoot, databasePath);
```

This resolves to `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`.

### 2. Recovery procedure

1. Backup both `data/gito.sqlite` and `apps/backend/data/gito.sqlite`.
2. Rename `apps/backend/data/gito.sqlite` to `apps/backend/data/gito.sqlite.backup`.
3. Restart the backend.
4. Verify startup logs show:
   - `[startup] DATABASE_PATH=data/gito.sqlite`
   - `[startup] RESOLVED_DATABASE_PATH=c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`
   - `[startup] schema version=1 expected=1`
5. Verify desktop API data matches operator records.

### 3. Hardening (audit-only)

- Keep `DATABASE_PATH` explicit in deployment scripts.
- Retire or archive stale `apps/backend/data/gito.sqlite`.
- Confirm the backend logs the resolved database path at startup.

---

## Database Inventory Summary

| File | Path | Size | Modified | user_version | Sports | Providers | Channels | Notes |
|------|------|------|----------|--------------|--------|-----------|----------|-------|
| Operator DB | `data/gito.sqlite` | 1,077,248 | 2026-06-01T19:07:19 | 1 | 12 | 12 | 2411 | Primary operator store |
| Stale/test DB | `apps/backend/data/gito.sqlite` | 6,377,472 | 2026-06-01T18:37:07 | 0 | 1 | 25 | 19,253 | Likely stale/test artifact |
| Duplicate stale DB | `node_modules/@gito/backend/data/gito.sqlite` | 6,377,472 | 2026-06-01T18:37:07 | 0 | 1 | 25 | 19,253 | Duplicate of stale/test DB |
| Audit artifact | `apps/backend/tmp-phase6a-audit.sqlite` | 196,608 | 2026-05-31T12:45:25 | 0 | 0 | 0 | 0 | Empty audit artifact |

---

## Backend source behavior

- `apps/backend/src/server.ts` calls `getDatabase()` at startup.
- `apps/backend/src/db/connection.ts` opens the resolved SQLite file, applies schema, runs migrations, and logs startup counts.
- `apps/backend/src/config/env.ts` is the only source of the runtime database path.

## Desktop source behavior

- `apps/desktop/src/renderer/App.tsx` loads persisted state from `window.localStorage`.
- It immediately refreshes providers, channels, and live matches from the backend API.
- LocalStorage is only a UI cache and does not contain authoritative persisted provider or competition state.
- No IndexedDB or Electron store is used in the renderer.

## Published feed source

- `apps/backend/src/repositories/operations-repository.ts` defines `listPublishedLiveMatches()`.
- The query joins `streams`, `matches`, `channels`, `providers`, `competitions`, `sports`, `countries`, and `teams`.
- `apps/backend/src/routes/live-matches.ts` and `apps/backend/src/routes/mobile.ts` expose this query.
- The published feed is therefore sourced from the backend SQLite database.

---

## Conclusions

A. Operator data is stored in `data/gito.sqlite` at workspace root.

B. The backend is configured to use `data/gito.sqlite` at workspace root, but a stale artifact exists at `apps/backend/data/gito.sqlite`.

C. Unknown records appeared because the same default SQLite filename exists in multiple directories; the stale/test database contains unrelated IPTV and smoke-test data.

D. The data is hidden, not lost.

E. Recovery path: back up both databases, remove or rename `apps/backend/data/gito.sqlite`, restart backend, and confirm the backend resolves to root `data/gito.sqlite`.

