# RENDER DEPLOYMENT CHECKLIST

## Status
- PASS/FAIL: FAIL
- Primary blocker: Desktop production build fails during Vite resolution of `@gito/shared/hooks/useRealtimeSync`.
- Secondary concern: desktop client has a localhost API fallback when `VITE_GITO_API_BASE_URL` is unset.

## 1. Environment
- `DATABASE_PATH` production safe: defaults to `/data/gito.sqlite` when `NODE_ENV=production`.
- `BACKUP_DIR` production safe: defaults to `/data/backups`.
- `JWT_SECRET` is required in production and rejects the default local secret.
- `DATABASE_PATH` override must be absolute; relative paths are rejected.
- Localhost assumption found in desktop client defaults for API base URL, so production must set `VITE_GITO_API_BASE_URL`.

## 2. SQLite
- Verified startup with existing `data/gito.sqlite`.
- Schema version check passed: expected `1`.
- Startup validation passed: DB file exists, non-empty, required row counts are present.
- No additional schema migration work was added in this audit.

## 3. Backup
- Manual backup test: `POST /system/backup` returned 200 and created a backup.
- Confirmed backup file exists and reported size: `4,939,776` bytes.
- Backup file listing is available via `GET /system/backups`.

## 4. Restore validation
- Restore validation test: `POST /system/restore/check` returned `valid=true` and `integrity=ok` for the created backup file.
- Backup is readable and passes SQLite integrity check.

## 5. Runtime health
- Verified `GET /system/health` returned:
  - `status: "ok"`
  - `db: "ok"`
  - `iptv: "ok"`
  - `liveScores: "ok"`
  - `databaseBackup.status: "ok"`
- Backend health endpoint is operational.

## 6. Endpoint smoke tests
- `GET /iptv/providers` returned 200 with provider data.
- `GET /iptv/channels?mode=active` returned 200 with channel data.
- `GET /iptv/channels?mode=debug` returned 200 with debug channel data.
- `GET /scores/live` returned 200 with an empty `data` array and cache metadata.

## 7. Build checks
- Backend typecheck: passed.
- Desktop typecheck: passed.
- Backend production build: passed.
- Desktop production build: failed.
  - Error: Vite could not resolve import `@gito/shared/hooks/useRealtimeSync` from `apps/desktop/src/renderer/App.tsx`.

## 8. Deployment steps
1. Ensure Render environment variables are set:
   - `NODE_ENV=production`
   - `DATABASE_PATH=/data/gito.sqlite` (or another absolute writable path)
   - `BACKUP_DIR=/data/backups`
   - `JWT_SECRET=<secure-secret>`
   - `VITE_GITO_API_BASE_URL=https://<backend-host>` for desktop clients
    - `VITE_GITO_API_BASE_URL=https://<backend-host>` for desktop clients

  Desktop environment variables
  - `VITE_GITO_API_BASE_URL` (required in production) — base URL for API endpoints used by the desktop app

  Backend environment variables (recommended production locations)
  - `DATABASE_PATH=/var/data/gito.sqlite`
  - `BACKUP_DIR=/var/data/backups`
2. Deploy backend and confirm container has writable `/data`.
3. Start backend and confirm log output from startup validation.
4. Call `GET /system/health` and verify production-ready JSON.
5. Execute `POST /system/backup` and confirm backup creation in `/data/backups`.
6. Execute `POST /system/restore/check` for the backup file and verify `integrity=ok`.

## 9. First boot checks
- Backend starts successfully with production env.
- Database file is present or created at `/data/gito.sqlite`.
- Startup validation logs show schema version and row counts.
- Health endpoint returns OK state.
- Backup directory exists and contains at least one backup after initial `POST /system/backup`.

## 10. Backup verification
- Confirm the `/data/backups` directory is writable.
- Use `POST /system/backup` to create a new backup.
- Use `GET /system/backups` to list backups.
- Use `POST /system/restore/check` with a backup filename to verify integrity.

## 11. Rollback procedure
1. If production deployment fails, stop the backend service.
2. Restore the previous SQLite file from the latest known-good backup in `/data/backups`.
3. Set `DATABASE_PATH` to a safe, absolute path and restart.
4. Verify startup and health endpoint again.
5. If desktop release is blocked by build issues, do not deploy desktop until the import resolution issue is fixed.
