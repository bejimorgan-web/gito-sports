# Deployment

GiTO Live Sports MVP deployment is a lightweight local/controlled-network deployment: one Node backend, one SQLite operational database, Electron desktop operator clients, and Flutter mobile clients consuming the mobile feed.

## Backend Deployment

Required runtime:

- Node.js 20 or newer
- Writable local disk for SQLite
- Network access from desktop and mobile clients

Environment variables:

- `PORT`: backend port. Default: `4100`.
- `DATABASE_PATH`: SQLite database path. Default: `data/gito.sqlite` in development. In production, if unset, the backend falls back to `/tmp/gito.sqlite`.
- `JWT_SECRET`: required in production. Must be unique per deployment and at least 24 characters.
- `ADMIN_EMAIL`: admin email used to bootstrap the default operator user when `operator_users` is empty.
- `ADMIN_PASSWORD`: admin password used to bootstrap the default operator user when `operator_users` is empty.
- `ADMIN_BOOTSTRAP_TOKEN`: token protecting the temporary admin bootstrap endpoint `/api/admin/create-admin`.
- `NODE_ENV`: set to `production` for production startup validation.

Startup:

```bash
npm install
npm run build --workspaces --if-present
NODE_ENV=production JWT_SECRET=<secret> ADMIN_EMAIL=operator@gito.local ADMIN_PASSWORD=change_me ADMIN_BOOTSTRAP_TOKEN=<token> DATABASE_PATH=/tmp/gito.sqlite npm run start -w @gito/backend
```

Temporary admin bootstrap endpoint:

- `POST /api/admin/create-admin`
- Protect with `Authorization: Bearer <ADMIN_BOOTSTRAP_TOKEN>` or `x-admin-bootstrap-token: <ADMIN_BOOTSTRAP_TOKEN>`
- Uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from env

Verify migration status after startup:

```bash
curl -X GET https://gito-sports.onrender.com/api/admin/migration/status
```

For a real deployment, run the backend with a supervised process manager or OS service. The backend should be restarted automatically on crash and logs should be retained.

Health checks:

```bash
GET /health
GET /mobile/matches/live
```

## Desktop Deployment

The desktop app is the operational authority. Operators use it to ingest IPTV providers, preview streams, assign matches, approve streams, publish live matches, and operate LIVE MODE.

Configuration:

- Development default backend URL: `http://localhost:4100`
- Desktop build override: `VITE_GITO_API_BASE_URL=http://backend-host:4100`

Build:

```bash
VITE_GITO_API_BASE_URL=http://backend-host:4100 npm run build -w @gito/desktop
```

Packaging:

- Electron packaging is not yet automated in the MVP repository.
- Release builds should package `apps/desktop/dist` with the Electron main/preload files.
- The installer must document the configured backend URL.

New operator PC workflow:

1. Install Node dependencies or packaged desktop app.
2. Configure backend URL.
3. Confirm backend `/health`.
4. Login as local operator.
5. Confirm providers, channels, live matches, and LIVE MODE status.

## Mobile Deployment

The mobile app reads only:

```bash
GET /mobile/matches/live
```

Build with the deployed backend URL:

```bash
flutter build apk --dart-define=GITO_API_BASE_URL=http://backend-host:4100
```

For Android emulator development, the default is:

```bash
http://10.0.2.2:4100
```

## SQLite Backup And Restore

Default database:

```bash
data/gito.sqlite
```

Backup:

1. Stop backend if possible.
2. Copy `data/gito.sqlite` to a timestamped backup location.
3. Store the backup on a different disk or secure storage.
4. Restart backend and verify `/health`.

Restore:

1. Stop backend.
2. Move the current database aside.
3. Copy the selected backup to `DATABASE_PATH`.
4. Start backend.
5. Verify `/health`, `/mobile/matches/live`, providers, and live match state.

## New PC Migration

1. Install application/runtime.
2. Copy database backup to the configured `DATABASE_PATH`.
3. Configure `JWT_SECRET`, `PORT`, and backend URL values.
4. Start backend.
5. Start desktop.
6. Login.
7. Verify providers, channels, matches, stream states, and LIVE MODE.

## Deployment Assumptions

- The MVP does not include cloud sync.
- SQLite is the local operational source of truth.
- Provider credentials remain in SQLite and must be protected with OS-level access controls.
- HTTPS, stronger auth, and installer automation are recommended before broad external distribution.
