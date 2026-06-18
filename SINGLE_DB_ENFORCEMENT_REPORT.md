# SINGLE_DB_ENFORCEMENT_REPORT

## Objective

Eliminate all secondary SQLite connections in the backend and ensure the backend uses only the shared `getDatabase()` connection from `apps/backend/src/db/connection.ts`.

## 1. Scan results

### Direct SQLite instantiation locations

- `apps/backend/src/db/connection.ts`
  - Only place in backend that creates a `DatabaseSync` instance.
  - Import currently came from `node:sqlite`.

### Search results

- `new Database` / `new DatabaseSync` / `sqlite3.Database`: only found in `apps/backend/src/db/connection.ts`.
- `node:sqlite` import: only found in `apps/backend/src/db/connection.ts`.

## 2. Enforcement implementation

### New file

- `apps/backend/src/db/sqlite.ts`
  - Wraps the native `DatabaseSync` class.
  - Exports `DatabaseSync` and `allowSqliteInstantiation()`.
  - Throws an error when `DatabaseSync` is instantiated without the explicit allow lock.

### Connection change

- `apps/backend/src/db/connection.ts`
  - Replaced direct `node:sqlite` import with `import { DatabaseSync, allowSqliteInstantiation } from "./sqlite";`
  - Instantiates the shared database using:
    ```ts
    database = allowSqliteInstantiation(() => new DatabaseSync(resolvedDatabasePath));
    ```
  - This makes direct instantiation outside this module impossible without runtime failure.

### TS path enforcement

- `apps/backend/tsconfig.json`
  - Added paths alias:
    ```json
    "node:sqlite": ["src/db/sqlite.ts"]
    ```
  - This routes backend `node:sqlite` imports to the wrapper at compile-time.

## 3. Repository verification

### Sports repository

- File: `apps/backend/src/repositories/sports-repository.ts`
- Uses only:
  - `import { getDatabase } from "../db/connection";`
  - `getDatabase()` in every DB access path
- No custom DB instantiation.

### Competitions repository

- File: `apps/backend/src/repositories/competitions-repository.ts`
- Uses only:
  - `import { getDatabase } from "../db/connection";`
  - `database.prepare(...)` via shared connection
- No custom DB instantiation.

### Teams repository

- File: `apps/backend/src/repositories/teams-repository.ts`
- Uses only shared `getDatabase()`.
- No direct sqlite instantiation.

### Countries repository

- File: `apps/backend/src/repositories/countries-repository.ts`
- Uses only shared `getDatabase()`.
- No direct sqlite instantiation.

## 4. Validation

### Backend runtime validation

- Started backend via `npm run dev:backend`.
- Backend reached startup validation and logged:
  - `DATABASE_PATH=data/gito.sqlite`
  - `RESOLVED_DATABASE_PATH=C:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`
  - `SPORT_COUNT=12`
  - `PROVIDER_COUNT=12`
  - `CHANNEL_COUNT=2411`
  - `MATCH_COUNT=6`
  - `STREAM_COUNT=6`
- No sqlite wrapper error occurred during startup.
- The run was aborted because port `4100` was already in use, not because of a database enforcement failure.

### Sports route validation

- `GET /sports` is implemented in `apps/backend/src/routes/sports.ts`.
- It calls `listSports()` in `apps/backend/src/repositories/sports-repository.ts`.
- `listSports()` executes a direct SQL query against the shared connection:
  ```sql
  SELECT id, name, slug, logo_url, status, created_at, updated_at
  FROM sports
  ORDER BY name
  ```
- Therefore sports created by a user through the backend data layer should appear in `GET /sports` as long as they exist in the shared database.

### IPTV provider validation

- `/iptv/providers` uses `listProviders()` from `apps/backend/src/repositories/provider-repository.ts`.
- That repository also uses only `getDatabase()`.
- No duplicate or secondary database is used for IPTV provider reads.

### Duplicate DB usage

- No duplicate database connections were found.
- All backend database access paths use the shared `getDatabase()` connection.
- Secondary sqlite instantiation outside `apps/backend/src/db/connection.ts` is now blocked by runtime enforcement.

## 5. Compliance

- No schema changes.
- No migrations.
- No UI changes.
- Audit + enforcement only.

## 6. Files changed

- `apps/backend/src/db/connection.ts`
- `apps/backend/src/db/sqlite.ts`
- `apps/backend/tsconfig.json`

## 7. Result

The backend now enforces a single sqlite connection source, and all checked repository modules use the shared connection only.
