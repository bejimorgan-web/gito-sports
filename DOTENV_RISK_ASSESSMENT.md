# DOTENV RISK ASSESSMENT

## Summary
- `apps/backend/src/config/env.ts` explicitly loads the root `.env` via `dotenv.config({ path: path.join(workspaceRoot, ".env") })`.
- The backend startup path (`apps/backend/src/server.ts`) imports `./config/env` before using any runtime configuration.
- Therefore, the root `.env` is already part of the backend startup environment when running the current source tree.

## 1. Would loading the root `.env` activate `DATABASE_PATH`?
- Yes.
- `apps/backend/src/config/env.ts` reads `process.env.DATABASE_PATH` after loading `.env`.
- The root `.env` currently contains `DATABASE_PATH=data/gito.sqlite`.
- That means the `.env` file does not just define the default; it activates the `DATABASE_PATH` override path.

## 2. Does `DATABASE_PATH` exist in `.env`?
- Yes.
- The file contains:
  - `PORT=4100`
  - `DATABASE_PATH=data/gito.sqlite`
  - `FOOTBALL_DATA_API_KEY=ca31fc0b44644872a4acd5b5859423a4`
  - `FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4`

## 3. Would dotenv change current startup behavior?
- The code already loads `.env`, so dotenv is not an unconnected new addition; it is part of current startup behavior.
- However, the current `.env` contents do change startup behavior because `DATABASE_PATH` is present and subject to lockdown validation.
- In the backend config, any `DATABASE_PATH` value is validated as follows:
  - it must be absolute
  - it must resolve exactly to the canonical workspace database path
- Since `.env` currently provides a relative `DATABASE_PATH` (`data/gito.sqlite`), startup would fail with:
  - `[phase9-lockdown] DATABASE_PATH override must be absolute. Relative paths are not allowed.`
- Thus the presence of `.env` is a startup risk unless the `DATABASE_PATH` line is removed or corrected.

## 4. Can `ScoreService` safely receive `FOOTBALL_DATA_API_KEY` and `FOOTBALL_DATA_BASE_URL` without enabling any other `.env` variables?
- Yes, conceptually.
- `ScoreService` uses `env.footballDataApiKey` and `env.footballDataBaseUrl`.
- `FOOTBALL_DATA_API_KEY` is required only at runtime when live score requests are made; it is not required for backend startup.
- `FOOTBALL_DATA_BASE_URL` is optional; it defaults to `https://api.football-data.org/v4`.
- The backend also has safe defaults for `PORT` and `DATABASE_PATH`, and a development default JWT secret when `NODE_ENV !== "production"`.
- Caveat: in production, `JWT_SECRET` still must be set, but that is unrelated to ScoreService itself.
- Therefore, `ScoreService` can safely receive only the football API variables, as long as `DATABASE_PATH` is not injected from `.env` in a forbidden form.

## Database impact
- The root `.env` currently includes `DATABASE_PATH=data/gito.sqlite`, which is a relative override.
- `apps/backend/src/config/env.ts` will treat any `DATABASE_PATH` present as an override and enforce phase 9 lockdown rules.
- Because the override is relative, it would abort startup before the app can connect to the database.
- The code also defines `absoluteDatabasePath` as the canonical workspace path and later enforces that the resolved database path is exactly that value.
- This means the database lockdown is strict: only the single canonical file is allowed, and relative overrides are explicitly rejected.

## Lockdown impact
- The Phase 9 single database lockdown is active in `apps/backend/src/config/env.ts` and `apps/backend/src/db/connection.ts`.
- `DATABASE_PATH` override handling is a security gate, not a benign fallback.
- If root `.env` loads a non-absolute or non-canonical `DATABASE_PATH`, the backend startup will fail fast.
- The lockdown behavior is consistent with the intended single-source-of-truth database policy.

## Safest implementation path
- Do not keep `DATABASE_PATH` in the root `.env` unless it is the absolute canonical path.
- Preferred safe option:
  - remove `DATABASE_PATH` from `.env`
  - leave `FOOTBALL_DATA_API_KEY` and `FOOTBALL_DATA_BASE_URL` only
- If `.env` must contain database configuration, use the absolute canonical path exactly as required by the lockdown checks.
- For ScoreService only, the safest path is:
  1. keep `.env` limited to `FOOTBALL_DATA_API_KEY` and optionally `FOOTBALL_DATA_BASE_URL`
  2. rely on defaults for `DATABASE_PATH` and `PORT`
  3. set `JWT_SECRET` explicitly in production environments, not in a local score-only `.env`

## Conclusion
- The root `.env` is already wired into backend startup.
- It does contain `DATABASE_PATH` now, and that is a lockdown hazard.
- ScoreService can safely use `FOOTBALL_DATA_API_KEY` and `FOOTBALL_DATA_BASE_URL` by themselves, but only if `.env` does not also inject a forbidden `DATABASE_PATH` override.
