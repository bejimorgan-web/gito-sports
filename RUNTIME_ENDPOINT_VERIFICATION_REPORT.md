# RUNTIME_ENDPOINT_VERIFICATION_REPORT

## Desktop API URL
- Desktop runtime API base URL is determined in `apps/desktop/src/renderer/services/api-client.ts`.
- Default value: `http://localhost:4100`
- No workspace source override for `VITE_GITO_API_BASE_URL` was found.

## Backend instances observed

| Port | PID   | Command line | Creation time | Health status | Inferred DB path | Startup counts | Runtime /sports count | Runtime /providers count | Runtime /channels count |
|------|-------|--------------|---------------|---------------|------------------|----------------|-----------------------|--------------------------|-------------------------|
| 4100 | 11924 | `node.exe ... tsx ... src/server.ts` | 2026-06-01 20:28:37 | OK | not directly captured | not captured | 0 | 1 | 2400 |
| 4101 | 12224 | `node.exe ... tsx ... src/server.ts` | 2026-06-01 20:29:27 | OK | `C:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite` | `SPORT_COUNT=12`, `PROVIDER_COUNT=12`, `CHANNEL_COUNT=2411` | 0 | 1 | 2400 |

## Observations

- The desktop app is configured to call `http://localhost:4100` by default.
- Port `4100` is actively listened by PID `11924`.
- Port `4101` is actively listened by PID `12224`.
- Both ports are running the same backend startup command (`node.exe ... tsx ... src/server.ts`).
- Only the `4101` instance had visible startup validation logs during this audit.
- The `4100` instance was already running and did not expose captured startup logs here.

## Endpoint verification

- `http://127.0.0.1:4100/health` returned:
  - `status: ok`
  - `service: gito-backend`
  - `database: ok`
  - timestamp: `2026-06-01T18:33:46.901Z`
- `http://127.0.0.1:4101/health` returned:
  - `status: ok`
  - `service: gito-backend`
  - `database: ok`
  - timestamp: `2026-06-01T18:33:46.946Z`

## Runtime data observations

- `GET /sports` on both endpoints currently returns `{"data": []}`.
- `GET /iptv/providers` on both endpoints currently returns a single provider record.
- `GET /iptv/channels` on both endpoints currently returns 2400 channel records.
- A direct query of the active repository file `data/gito.sqlite` returned 12 sports rows, confirming the runtime API state is not matching the expected local DB content.

## Conclusion

- The desktop app is most likely calling the backend instance on `http://localhost:4100`.
- That instance is PID `11924` on port `4100`.
- The `4101` instance is a separate backend process started after `4100` and has confirmed startup logs for the same repo.
- There is a runtime mismatch between the expected DB state and the current `/sports` response: startup validation for `4101` showed 12 sports, but both endpoints now return 0 sports at `/sports`.
- This suggests the issue is at runtime state or database resolution, not at the desktop app API URL layer.
