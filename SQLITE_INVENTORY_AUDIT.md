# SQLITE_INVENTORY_AUDIT

## Summary
- Total SQLite files scanned under `data/` directories: 25
- Backend runtime configuration defaults to `data/gito.sqlite` in `apps/backend/src/config/env.ts`.
- The backend currently uses `data/gito.sqlite` unless `DATABASE_PATH` is explicitly overridden at runtime.
- The latest modified runtime DB is `data/gito.sqlite` (`2026-06-01T18:36:01.701165Z`).
- The most complete recent operator snapshot is `data/gito-backup-20260601-200650.sqlite`.

## File inventory

| Filename | Size | Modified UTC | sports | providers | channels | competitions | matches | streams | Classification |
|---|---|---|---|---|---|---|---|---|---|
| `data/gito.sqlite` | 1,085,440 | 2026-06-01T18:36:01Z | 0 | 12 | 2411 | 10 | 6 | 6 | PRODUCTION |
| `data/gito-backup-20260601-200650.sqlite` | 1,077,248 | 2026-06-01T17:07:19Z | 12 | 12 | 2411 | 10 | 6 | 6 | BACKUP |
| `apps/backend/data/gito-backup-20260601-200650.sqlite` | 6,377,472 | 2026-06-01T16:37:07Z | 1 | 25 | 19253 | 5 | 6 | 5 | BACKUP |
| `apps/backend/data/gito-archived.sqlite` | 6,377,472 | 2026-06-01T16:37:07Z | 1 | 25 | 19253 | 5 | 6 | 5 | BACKUP |
| `data/production-validation-1780078463969.sqlite` | 167,936 | 2026-06-01T17:07:20Z | 1 | 6 | 18 | 1 | 14 | 14 | VALIDATION |
| `data/production-validation-1780078604176.sqlite` | 147,456 | 2026-05-29T18:16:56Z | 0 | 1 | 0 | 0 | 0 | 0 | VALIDATION |
| `data/production-validation-1780082887843.sqlite` | 167,936 | 2026-05-29T19:29:24Z | 1 | 6 | 14 | 1 | 13 | 13 | VALIDATION |
| `data/production-validation-1780086769467.sqlite` | 167,936 | 2026-05-29T20:33:49Z | 1 | 6 | 14 | 1 | 13 | 13 | VALIDATION |
| `data/production-validation-1780086891842.sqlite` | 167,936 | 2026-05-29T20:35:27Z | 1 | 6 | 14 | 1 | 13 | 13 | VALIDATION |
| `data/production-validation-1780088144031.sqlite` | 167,936 | 2026-05-29T20:56:44Z | 1 | 6 | 14 | 1 | 13 | 13 | VALIDATION |
| `data/production-validation-1780089268775.sqlite` | 167,936 | 2026-05-29T21:15:17Z | 1 | 6 | 14 | 1 | 13 | 13 | VALIDATION |
| `data/enforcement-validation-1780267841260.sqlite` | 307,200 | 2026-05-31T22:51:12Z | 5 | 5 | 5 | 4 | 2 | 2 | VALIDATION |
| `data/enforcement-validation-1780268374304.sqlite` | 307,200 | 2026-05-31T22:59:54Z | 4 | 5 | 5 | 3 | 1 | 1 | VALIDATION |
| `data/enforcement-validation-1780268503331.sqlite` | 307,200 | 2026-05-31T23:02:04Z | 4 | 5 | 5 | 3 | 1 | 1 | VALIDATION |
| `data/enforcement-validation-1780271579886.sqlite` | 307,200 | 2026-05-31T23:53:32Z | 4 | 5 | 5 | 4 | 2 | 2 | VALIDATION |
| `data/enforcement-validation-1780271648113.sqlite` | 307,200 | 2026-05-31T23:54:39Z | 4 | 5 | 5 | 4 | 2 | 2 | VALIDATION |
| `data/gito-backup-20260601-200650.sqlite` | 1,077,248 | 2026-06-01T17:07:19Z | 12 | 12 | 2411 | 10 | 6 | 6 | BACKUP |
| `data/repro-sport-delete-1780268053332.sqlite` | 307,200 | 2026-05-31T22:54:26Z | 1 | 1 | 1 | 1 | 1 | 1 | TEST |
| `data/repro-sport-delete-1780268126741.sqlite` | 307,200 | 2026-05-31T22:55:36Z | 1 | 1 | 1 | 1 | 1 | 1 | TEST |
| `data/repro-sport-delete-1780268168665.sqlite` | 307,200 | 2026-05-31T22:58:27Z | 1 | 1 | 1 | 0 | 0 | 0 | TEST |
| `data/repro-sport-delete-1780268353117.sqlite` | 307,200 | 2026-05-31T22:59:19Z | 0 | 1 | 1 | 0 | 0 | 0 | TEST |
| `data/stress-validation-1780084502414.sqlite` | 237,568 | 2026-06-01T17:07:23Z | 1 | 1 | 50 | 1 | 36 | 36 | VALIDATION |
| `data/stress-validation-1780084939212.sqlite` | 344,064 | 2026-05-29T20:07:56Z | 1 | 4 | 61 | 1 | 61 | 61 | VALIDATION |
| `data/stress-validation-1780085352944.sqlite` | 458,752 | 2026-05-29T20:18:56Z | 1 | 5 | 111 | 1 | 111 | 111 | VALIDATION |
| `data/stress-validation-1780086937497.sqlite` | 450,560 | 2026-05-29T20:41:03Z | 1 | 5 | 111 | 1 | 111 | 111 | VALIDATION |
| `data/stress-validation-1780089339815.sqlite` | 450,560 | 2026-05-29T21:21:29Z | 1 | 5 | 111 | 1 | 111 | 111 | VALIDATION |
| `data/stress-validation-1780089733414.sqlite` | 450,560 | 2026-05-29T21:27:47Z | 1 | 5 | 111 | 1 | 111 | 111 | VALIDATION |

> Note: `gito.sqlite` is the configured runtime path in `apps/backend/src/config/env.ts` and is the backend source unless `DATABASE_PATH` is overridden.

## Classification rationale
- `PRODUCTION`: `data/gito.sqlite` is the default runtime database and should be treated as the active source of truth.
- `BACKUP`: named backups and archive snapshots; these are not runtime files and should be preserved or archived.
- `VALIDATION`: the `*-validation-*.sqlite` files contain purpose-built test/validation datasets.
- `TEST`: the `repro-sport-delete-*` files are clearly reproduction/test artifacts.

## Recommendations
1. Current backend DB: `data/gito.sqlite`.
2. Latest modified runtime DB: `data/gito.sqlite`.
3. Latest operator snapshot by content: `data/gito-backup-20260601-200650.sqlite` (12 sports, 2411 channels, 10 competitions, 6 matches, 6 streams).
4. Archive safely:
   - `data/gito-backup-20260601-200650.sqlite`
   - `apps/backend/data/gito-backup-20260601-200650.sqlite`
   - `apps/backend/data/gito-archived.sqlite`
   - all `data/production-validation-*.sqlite`
   - all `data/enforcement-validation-*.sqlite`
   - all `data/stress-validation-*.sqlite`
   - all `data/repro-sport-delete-*.sqlite`
5. Never use at runtime:
   - all validation and repro/test DBs (`production-validation-*`, `enforcement-validation-*`, `stress-validation-*`, `repro-sport-delete-*`)
   - all archive/backup snapshots (`apps/backend/data/gito-archived.sqlite`, any `*.backup-*.sqlite` copies)

## Important observation
- The runtime database `data/gito.sqlite` currently contains `0` sports rows while `data/gito-backup-20260601-200650.sqlite` contains `12` sports rows, despite both sharing the same provider/channel counts. This suggests the active DB may have diverged from the most recent backup snapshot.
