# DATABASE_LINEAGE_REPORT

## Purpose
Perform a complete lineage forensic investigation of all SQLite database files found in the workspace.

## Discovery summary
- Total database files discovered: 29
- File types: `.sqlite` only
- No `.db` files were found
- Key directories scanned:
  - `data/`
  - `archive/sqlite-backups/`

## Comparison table
| File path | Size (bytes) | Modified | sports | providers | channels | matches | streams | Notes |
|---|---|---|---|---|---|---|---|---|
| `data/gito.sqlite` | 6,045,696 | 2026-06-02T22:44:53.661644 | 1 | 15 | 17,986 | 9 | 6 | Current runtime DB |
| `data/gito-FORENSIC-BACKUP.sqlite` | 6,045,696 | 2026-06-02T22:44:53.661644 | 1 | 15 | 17,986 | 9 | 6 | Forensic copy of current runtime DB |
| `archive/sqlite-backups/gito-backup-20260601-200650.sqlite` | 1,077,248 | 2026-06-01T19:07:19.131185 | 12 | 12 | 2,411 | 6 | 6 | Historical operator backup |
| `archive/sqlite-backups/gito-archived-1.sqlite` | 6,377,472 | 2026-06-01T18:37:07.537384 | 1 | 25 | 19,253 | 6 | 5 | Stale/test alternate DB artifact |
| `archive/sqlite-backups/gito-backup-20260601-200650-1.sqlite` | 6,377,472 | 2026-06-01T18:37:07.537384 | 1 | 25 | 19,253 | 6 | 5 | Duplicate of stale/test alternate DB |
| `archive/sqlite-backups/gito-corrupted-20260601-223302.sqlite` | 1,744,896 | 2026-06-01T21:47:38.497938 | 0 | 13 | 4,507 | 6 | 6 | Corrupted/production validation artifact |
| `archive/sqlite-backups/production-validation-1780078463969.sqlite` | 167,936 | 2026-06-01T19:07:20.537470 | 1 | 6 | 18 | 14 | 14 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780078604176.sqlite` | 147,456 | 2026-05-29T20:16:56.327900 | 0 | 1 | 0 | 0 | 0 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780082887843.sqlite` | 167,936 | 2026-05-29T21:29:24.374124 | 1 | 6 | 14 | 13 | 13 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780086769467.sqlite` | 167,936 | 2026-05-29T22:33:49.647777 | 1 | 6 | 14 | 13 | 13 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780086891842.sqlite` | 167,936 | 2026-05-29T22:35:27.766151 | 1 | 6 | 14 | 13 | 13 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780088144031.sqlite` | 167,936 | 2026-05-29T22:56:44.825460 | 1 | 6 | 14 | 13 | 13 | Small production validation artifact |
| `archive/sqlite-backups/production-validation-1780089268775.sqlite` | 167,936 | 2026-05-29T23:15:17.441036 | 1 | 6 | 14 | 13 | 13 | Small production validation artifact |
| `archive/sqlite-backups/repro-sport-delete-1780268053332.sqlite` | 307,200 | 2026-06-01T00:54:26.224872 | 1 | 1 | 1 | 1 | 1 | Repro artifact |
| `archive/sqlite-backups/repro-sport-delete-1780268126741.sqlite` | 307,200 | 2026-06-01T00:55:36.663835 | 1 | 1 | 1 | 1 | 1 | Repro artifact |
| `archive/sqlite-backups/repro-sport-delete-1780268168665.sqlite` | 307,200 | 2026-06-01T00:58:27.642118 | 1 | 1 | 1 | 0 | 0 | Repro artifact |
| `archive/sqlite-backups/repro-sport-delete-1780268353117.sqlite` | 307,200 | 2026-06-01T00:59:19.822272 | 0 | 1 | 1 | 0 | 0 | Repro artifact |
| `archive/sqlite-backups/stress-validation-1780084502414.sqlite` | 237,568 | 2026-06-01T19:07:23.992175 | 1 | 1 | 50 | 36 | 36 | Stress test artifact |
| `archive/sqlite-backups/stress-validation-1780084939212.sqlite` | 344,064 | 2026-05-29T22:07:56.544020 | 1 | 4 | 61 | 61 | 61 | Stress test artifact |
| `archive/sqlite-backups/stress-validation-1780085352944.sqlite` | 458,752 | 2026-05-29T22:18:56.090384 | 1 | 5 | 111 | 111 | 111 | Stress test artifact |
| `archive/sqlite-backups/stress-validation-1780086937497.sqlite` | 450,560 | 2026-05-29T22:41:03.018577 | 1 | 5 | 111 | 111 | 111 | Stress test artifact |
| `archive/sqlite-backups/stress-validation-1780089339815.sqlite` | 450,560 | 2026-05-29T23:21:29.156258 | 1 | 5 | 111 | 111 | 111 | Stress test artifact |
| `archive/sqlite-backups/stress-validation-1780089733414.sqlite` | 450,560 | 2026-05-29T23:27:47.982736 | 1 | 5 | 111 | 111 | 111 | Stress test artifact |
| `archive/sqlite-backups/tmp-phase6a-audit-1.sqlite` | 196,608 | 2026-05-31T12:45:25.009732 | 0 | 0 | 0 | 0 | 0 | Audit artifact |
| `archive/sqlite-backups/enforcement-validation-1780267841260.sqlite` | 307,200 | 2026-06-01T00:51:12.368527 | 5 | 5 | 5 | 2 | 2 | Enforcement validation artifact |
| `archive/sqlite-backups/enforcement-validation-1780268374304.sqlite` | 307,200 | 2026-06-01T00:59:54.743605 | 4 | 5 | 5 | 1 | 1 | Enforcement validation artifact |
| `archive/sqlite-backups/enforcement-validation-1780268503331.sqlite` | 307,200 | 2026-06-01T01:02:04.230614 | 4 | 5 | 5 | 1 | 1 | Enforcement validation artifact |
| `archive/sqlite-backups/enforcement-validation-1780271579886.sqlite` | 307,200 | 2026-06-01T01:53:32.021561 | 4 | 5 | 5 | 2 | 2 | Enforcement validation artifact |
| `archive/sqlite-backups/enforcement-validation-1780271648113.sqlite` | 307,200 | 2026-06-01T01:54:39.251344 | 4 | 5 | 5 | 2 | 2 | Enforcement validation artifact |

## Historic production state matching
- The historic production state counts (`SPORT_COUNT=12`, `PROVIDER_COUNT=13`, `CHANNEL_COUNT=4507`) were not found in any discovered database file.
- No discovered file has the exact triple `sports=12`, `providers=13`, `channels=4507`.
- Therefore, the exact historic production image is not present in the current workspace artifacts.

## Current runtime state matching
- Current runtime state counts (`sports=1`, `providers=15`, `channels=17,986`, `matches=9`, `streams=6`) match only:
  - `data/gito.sqlite`
  - `data/gito-FORENSIC-BACKUP.sqlite`
- `data/gito-FORENSIC-BACKUP.sqlite` is a direct forensic snapshot of the current runtime database, not a different production dataset.

## Lineage findings
- The current `data/gito.sqlite` is the active runtime database and has been overwritten or replaced with a dataset that does not match the historic expected production state.
- The only exact match for the current runtime counts is the forensic backup file created at the same timestamp.
- The historic operator backup file `archive/sqlite-backup-20260601-200650.sqlite` contains a different dataset (`12/12/2411`), so it is not the same as the current runtime DB.
- The corrupted artifact `archive/sqlite-backups/gito-corrupted-20260601-223302.sqlite` contains the `0/13/4507` counts seen in a prior broken production state, but again it does not match the current runtime state.

## Likely replacement event
- The evidence strongly suggests the current runtime DB was replaced by a copy or restore event, not by a standard migration.
- Reasoning:
  - A restored production image would likely preserve the historic `12/13/4507` pattern, but no file with that pattern is present.
  - The current dataset is instead a distinct alternate image with `1/15/17,986`.
  - The presence of `data/gito-FORENSIC-BACKUP.sqlite` indicates a copy/snapshot operation of the runtime DB at the moment the current state existed.
- Most likely event type: **copy/restore of a wrong or stale database into `data/gito.sqlite`**, followed by a forensic snapshot.
- Less likely: a migration event, because there is no incremental transition path between the historic production set and the current state in the discovered artifacts.

## Recommendation
- Do not keep the current runtime database if the goal is to preserve the historic production state.
- Recommend restoring the previous verified production database from a known-good archive snapshot, if one is available outside the current workspace.
- The current runtime DB appears inconsistent with production expectations and should be treated as a contaminated or wrong dataset.

## Audit notes
- No `.db` files were present in the workspace; all artifacts are `.sqlite` files.
- The workspace contains a number of validation and repro artifacts, but only two files represent the current runtime lineage: `data/gito.sqlite` and `data/gito-FORENSIC-BACKUP.sqlite`.
- Any restoration should be based on a verified backup outside this workspace or a backup created before `2026-06-02T22:44:53`.
