# Environment Configuration Audit

Audit date: 2026-06-03

Scope: audit only. No implementation code was modified.

## Summary

The backend configuration system reads directly from `process.env` in `apps/backend/src/config/env.ts`.

The current backend code does **not** load `.env` files. A root `.env` file exists and contains a non-empty `FOOTBALL_DATA_API_KEY` entry, but that value is not currently available in the process environment checked during this audit. Therefore, `FOOTBALL_DATA_API_KEY` is **not currently being read successfully by the backend runtime path unless the launch process injects it another way**.

## 1. Which File Loads Environment Variables

Environment variables are read in:

```text
apps/backend/src/config/env.ts
```

That file reads:

```ts
process.env.NODE_ENV
process.env.PORT
process.env.DATABASE_PATH
process.env.JWT_SECRET
process.env.FOOTBALL_DATA_API_KEY
process.env.FOOTBALL_DATA_BASE_URL
```

The backend imports this config from:

```text
apps/backend/src/server.ts
apps/backend/src/app.ts
apps/backend/src/services/score-service.ts
```

`server.ts` imports `env` before starting the app and listens on `env.port`.

## 2. Whether Dotenv Is Used

Status: **dotenv is not used by the backend startup/config code**.

Evidence:

- `apps/backend/src/config/env.ts` does not import `dotenv`.
- `apps/backend/src/server.ts` does not import `dotenv/config`.
- `apps/backend/src/app.ts` does not import `dotenv/config`.
- `apps/backend/package.json` has no `dotenv` dependency and no script preloading dotenv.
- Backend dev script is:

```json
"dev": "tsx watch src/server.ts"
```

- Backend start script is:

```json
"start": "node dist/apps/backend/src/server.js"
```

`package-lock.json` contains a `dotenv` dependency through another package path, but it is not wired into the backend configuration system.

Conclusion: `.env` files are not automatically loaded by the current backend.

## 3. Exact Location Expected for the `.env` File

There is currently **no `.env` file location expected by the backend code**, because no dotenv loader is configured.

Observed files:

```text
.env
.env.example
```

The root `.env` file exists at:

```text
C:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\.env
```

However, because the backend reads only `process.env`, placing values in this root `.env` file is not enough. The variables must be injected into the backend process environment by the shell, process manager, deployment platform, or an explicit dotenv loader.

## 4. Variables Required for ScoreService

`ScoreService` uses:

| Variable | Required? | Current default | Purpose |
| --- | --- | --- | --- |
| `FOOTBALL_DATA_API_KEY` | Required for live API calls | Empty string | Sent to Football-Data.org as `X-Auth-Token` |
| `FOOTBALL_DATA_BASE_URL` | Optional | `https://api.football-data.org/v4` | Base URL for Football-Data.org API requests |

Behavior when missing:

- `FOOTBALL_DATA_API_KEY` is not required at backend startup.
- It is checked lazily only when a score route calls Football-Data.org.
- If missing, `ScoreService` throws `football_data_api_key_missing` with HTTP 503.

## 5. Is `FOOTBALL_DATA_API_KEY` Currently Being Read Successfully?

Status: **no, not from the current backend process environment**.

Audit checks:

- Root `.env` exists.
- Root `.env` contains a `FOOTBALL_DATA_API_KEY=` entry.
- The entry is non-empty.
- The current process environment check returned:

```text
FOOTBALL_DATA_API_KEY_MISSING_IN_PROCESS_ENV
```

Because `env.ts` reads `process.env.FOOTBALL_DATA_API_KEY`, and because dotenv is not loaded, the backend will see:

```ts
footballDataApiKey = ""
```

unless the key is exported/injected into the process before backend startup.

## Operational Impact

Current expected behavior:

- Backend startup is unaffected.
- `/scores/live`, `/scores/match/:id`, and `/scores/competitions` will return HTTP 503 `football_data_api_key_missing` if the key is not injected into `process.env`.
- The root `.env` file alone will not activate Football-Data.org integration.

## Final Verdict

The backend configuration system is process-environment based, not dotenv-based.

`FOOTBALL_DATA_API_KEY` is present in the root `.env` file but is not currently being read successfully by the backend runtime path because no code loads `.env` into `process.env`.
