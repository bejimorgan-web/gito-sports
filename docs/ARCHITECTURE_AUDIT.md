# Architecture Drift Audit

## Summary

This audit compares the documented GiTO Live Sports architecture against the current repository implementation.

Key conclusions:
- Electron is implemented.
- The desktop app is not browser-only, though the renderer is browser-friendly and can run in development via Vite.
- SQLite persistence is configured correctly in the backend.
- The database location is documented and matches source defaults.
- The backend is consistent with the documented Node.js + Express + SQLite MVP architecture.
- Most completed phases are compliant with the documented architecture.
- The main drift is in desktop build/output organization and packaging path expectations.

---

## 1. Is Electron actually implemented?

Yes.

Evidence:
- `apps/desktop/electron/main.ts` exists and creates an Electron `BrowserWindow`.
- `apps/desktop/electron/preload.ts` exposes a secure preload API via `contextBridge`.
- `apps/desktop/package.json` includes Electron lifecycle scripts: `electron:dev`, `electron:serve`, `electron:build`, and `start`.
- `apps/desktop/package.json` lists `electron` and `electron-builder` dependencies.

The implementation includes a real Electron main process and a preload bridge.

## 2. Is the desktop app currently browser-only?

No.

The desktop UI is a React/Vite renderer that can be served in a browser during development, but the project also contains an Electron shell.

Notes:
- The renderer is browser-first, which is normal for Electron apps that use Vite/React.
- The desktop app is not limited to browser-only execution because Electron startup logic is present and wired through package scripts.

## 3. Is SQLite persistence configured correctly?

Yes.

Evidence:
- `apps/backend/src/config/env.ts` sets `DATABASE_PATH` to `process.env.DATABASE_PATH ?? "data/gito.sqlite"`.
- It validates that `DATABASE_PATH` is non-empty and that `JWT_SECRET` is set in production.
- `apps/backend/src/db/connection.ts` creates the parent directory if needed, opens `DatabaseSync(env.databasePath)`, enables `PRAGMA foreign_keys = ON;`, applies the initial SQL schema, and runs idempotent schema migrations.
- There is no evidence of in-memory-only SQLite or destructive reset-on-start behavior.
- The path is file-backed, so data persists across process restarts.

## 4. Is the database location documented?

Yes.

Evidence:
- `docs/DEPLOYMENT.md` documents `DATABASE_PATH` and the default `data/gito.sqlite` location.
- The same document includes backup and restore procedures that explicitly reference `data/gito.sqlite`.
- Other documentation also refers to SQLite as the local operational source of truth.

## 5. Is the backend consistent with the original design?

Yes.

Documented design in `docs/ARCHITECTURE.md` and related docs calls for:
- Node.js + Express backend.
- SQLite local operational database.
- Explicit API routes.
- Shared TypeScript contracts.
- Modular backend capabilities.

Implementation evidence:
- Backend code lives under `apps/backend/src`.
- `apps/backend/src/config/env.ts` and `apps/backend/src/db/connection.ts` implement SQLite persistence and configuration.
- Repositories and routes separate business capabilities for providers, operations, and lifecycle state.
- The backend uses `node:sqlite` and Express-style routing.

## 6. Which completed phases are compliant with the documented architecture?

Compliant phases:
- Desktop architecture phase: Electron shell plus React/Vite renderer.
- Backend architecture phase: Node.js + Express API with SQLite persistence.
- Provider and channel persistence phase: backend repository code and lifecycle guards.
- Mobile delivery phase: mobile feed API route and documented `GET /mobile/matches/live` contract.
- Deployment documentation phase: `DATABASE_PATH` and default SQLite path are documented.
- State management and lifecycle phase: backend migration logic preserves and upgrades persisted state.

## 7. Which completed phases introduced architectural drift?

Minor drift exists in desktop packaging/build organization:
- Documentation expects release builds to package `apps/desktop/dist` with Electron main/preload files.
- Current compiled output appears under `apps/desktop/dist/apps/desktop/electron/main.js` rather than a flatter `apps/desktop/dist/electron/main.js` path.
- `apps/desktop/package.json` `main` entry now points to `dist/apps/desktop/electron/main.js`, which suggests the build output layout is different from the simplest documented packaging assumption.

This is a build artifact / packaging path drift, not a fundamental architectural mismatch in the runtime model.

## Recommendations

1. Keep the Electron shell and React renderer as the desktop architecture while preserving the current Electron implementation.
2. Align packaging documentation with the actual compiled output path, or update the build config so Electron output lands in `apps/desktop/dist/electron/`.
3. Retain the documented `DATABASE_PATH=data/gito.sqlite` default and ensure deployment commands continue to use it explicitly.
4. Continue to treat the backend as the SQLite-backed source of truth and avoid introducing distributed state or cloud sync into the MVP.

---

## Audit Evidence Summary

- `docs/ARCHITECTURE.md`
- `docs/DESKTOP_APP.md`
- `docs/DEPLOYMENT.md`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/db/connection.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/package.json`
