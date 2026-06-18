# Desktop Deployment Architecture Assessment

## Purpose

This document assesses the desktop deployment architecture of GiTO Live Sports against the original documented intent and the current implementation.

## Current architecture

- Desktop app is implemented as an Electron shell running a Vite/React renderer.
- The desktop UI communicates with a separate Node.js + Express backend API over HTTP.
- Operational persistence is handled by the backend using SQLite at `data/gito.sqlite`.
- The desktop package includes Electron source files in `apps/desktop/electron/` and packaging metadata in `apps/desktop/package.json`.
- Build output is generated into `apps/desktop/dist`, and packaged release artifacts are created in `apps/desktop/release/`.

## Original intended architecture

- The intended MVP architecture is an Electron desktop application that integrates with a separate backend service.
- The backend is a Node.js + Express API with SQLite local persistence.
- Desktop operators use Electron as the client, while the backend stores provider, channel, match, approval, and stream state.
- The architecture decision in `docs/DECISIONS/0001-mvp-architecture.md` explicitly calls for Electron + React + TypeScript on desktop and Node.js + Express backend API, with SQLite persistence.
- `docs/ARCHITECTURE.md` describes desktop app communication with the backend API and backend storage of operational data.

## Gap analysis

### 1. Architecture intent

- Original intent: Electron shell + separate backend. (Option A)
- Current implementation: matches that intent.
- Evidence:
  - `docs/ARCHITECTURE.md` describes desktop app communicating with the backend API.
  - `docs/DEPLOYMENT.md` documents a separate backend startup with `DATABASE_PATH=data/gito.sqlite` and desktop build-time `VITE_GITO_API_BASE_URL` configuration.
  - The frontend service code in `apps/desktop/src/renderer/services/api-client.ts` uses an HTTP API base URL rather than local DB access.

### 2. Architecture drift

- There is no fundamental architecture drift.
- Desktop remains a shell client and backend remains the SQLite authority.
- The implementation does not convert the app into a self-contained desktop app with embedded SQLite ownership.

### 3. Packaging drift

- There is packaging drift in how Electron output is built and packaged.
- `docs/DEPLOYMENT.md` says release builds should package `apps/desktop/dist` with Electron main/preload files, but the actual build output path required alignment and an `align-electron-output.js` step.
- The task record `docs/TASKS/0013-electron-packaging-alignment.md` documents that release artifacts are generated into `apps/desktop/release/` and that `dist/electron/main.js` is the packaged entry point.
- The drift is primarily in build/output organization, not runtime behavior.

### 4. Deployment drift

- Deployment documentation is largely accurate about the backend and desktop roles.
- The main deployment drift is that Electron packaging automation was not fully documented as completed until the packaging alignment task.
- The current implementation does support packaged installer creation, but release packaging required additional alignment work and exact build command definitions.

## Recommended path

1. Keep the current architecture:
   - Electron desktop shell + separate backend API.
   - Backend-owned SQLite persistence at `data/gito.sqlite`.

2. Resolve packaging drift:
   - Standardize the desktop build output so Electron entry files land in `apps/desktop/dist/electron/` consistently.
   - Ensure `docs/DEPLOYMENT.md` matches the actual packaging workflow and output paths.

3. Strengthen deployment documentation:
   - Explicitly document the required backend startup command and the desktop app backend URL configuration.
   - Record that the packaged desktop app relies on the backend API, not direct SQLite access.

4. Maintain operational separation:
   - Do not move SQLite access into the Electron app.
   - Preserve the backend as the single source of truth for providers, channels, matches, approvals, and streams.

## Conclusion

- Original documented intent was clearly Option A: Electron shell + separate backend.
- Current implementation is consistent with that architecture.
- The only meaningful drift is packaging/build output organization and deployment documentation precision.
- The recommended path is to retain the current architecture and align packaging docs and build output paths.
