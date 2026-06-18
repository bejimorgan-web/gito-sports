# TASK 0016: Electron Production Loading Fix

## Problem
Electron production builds were incorrectly attempting to load the development server URL (`http://localhost:4200`), causing `ERR_CONNECTION_REFUSED` and a blank application window when running production builds or the packaged app.

## Root Cause
The Electron main process used `app.isPackaged` to detect development mode. That detection is unreliable for `npm start` and local production builds, because `electron .` can run outside of a packaged app while still requiring production asset loading.

## Fix Applied
- Updated `apps/desktop/electron/main.ts` to use environment detection based on `VITE_DEV_SERVER_URL` only.
- In DEV mode, Electron loads `http://localhost:4200` when `VITE_DEV_SERVER_URL` is explicitly provided.
- In PROD mode, Electron loads the built `dist/index.html` file via `loadFile()`.
- Added robust path resolution using `fileURLToPath(new URL("../index.html", import.meta.url))` to locate the production HTML correctly after build.
- Added a fallback error screen if the production file is missing or cannot be loaded.
- Updated Electron preload handling to generate a CommonJS `preload.cjs` runtime file and load it via the runtime main process, avoiding ESM preload syntax issues.
- Updated `apps/desktop/package.json` start and serve scripts to use `npx electron .` for reliable local binary resolution.

## Verification
- `npm run build` — verified
- `npm start` — verified production asset loading from `dist/index.html`
- `npm run electron:build` — verified build/package process
- Packaged app launch — verified executable starts without a blank window

## Notes
- No backend, SQLite, IPTV provider logic, or provider system changes were made.
- This fix is isolated to Electron main process loading and environment detection.
