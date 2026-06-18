# DATABASE_COUNT_DRIFT_FORENSICS

## Purpose
Audit the active runtime SQLite database and determine why the runtime counts drifted from previously validated values to the current state.

## Active runtime database
- Absolute database path in current backend startup: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`
- Current file size: `6,045,696` bytes
- Current last modified timestamp: `2026-06-02T22:44:53.661644`
- Current row counts in runtime database:
  - `sports`: 1
  - `providers`: 15
  - `channels`: 17,986
  - `matches`: 9
  - `streams`: 6
  - `scheduling_matches`: 2
  - `match_streams`: 2

## Runtime path enforcement
- `apps/backend/src/config/env.ts` resolves the runtime DB path to the canonical workspace root file:
  - default: `data/gito.sqlite`
  - `workspaceRoot` resolves to the workspace root directory
  - any `DATABASE_PATH` override must be absolute and identical to the canonical path
- `apps/backend/src/db/connection.ts` validates that the resolved path exactly matches the expected canonical path before opening the DB
- Startup logs from the backend confirm the active runtime path is the canonical path and not a different leaf path

## Historic validation comparison
### `SINGLE_DATABASE_ENFORCEMENT_FINAL_REPORT.md`
- Confirmed active runtime path: `C:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`
- Verified file size: `1,744,896` bytes
- Verified startup counts:
  - `SPORT_COUNT=12`
  - `PROVIDER_COUNT=13`
  - `CHANNEL_COUNT=4507`
  - `MATCH_COUNT=6`
  - `STREAM_COUNT=6`

### `SYSTEM_DATA_FLOW_AUDIT.md`
- Confirmed active runtime path: `data/gito.sqlite`
- Reported startup counts at that stage:
  - `SPORT_COUNT=0`
  - `PROVIDER_COUNT=13`
  - `CHANNEL_COUNT=4507`
  - `MATCH_COUNT=6`
  - `STREAM_COUNT=6`
- Marked the active production DB as broken and reported a separate backup snapshot with `12` sports and `2411` channels

### `DATABASE_SOURCE_OF_TRUTH_AUDIT.md`
- Identified the operator database as `data/gito.sqlite` at workspace root
- Reported operator DB size: `1,077,248` bytes
- Reported operator DB counts:
  - `sports`: 12
  - `providers`: 12
  - `channels`: 2411
- Documented a stale/test artifact at `apps/backend/data/gito.sqlite` with counts `sports=1`, `providers=25`, `channels=19253`

### `FIX_APPLIED_REPORT.md`
- Documented that missing sports were recovered from backup and the production DB was restored to `12` sports
- Described the data-recovery process and verified that sports recovery succeeded

## Drift analysis
### What changed
- The active runtime database file is still the canonical `data/gito.sqlite`
- The current file contents are drastically different from prior validated results
- The current file size is much larger than previous production or operator DB snapshots
- The current file was last modified after the previous validation reports were produced

### Comparison to prior states
| Source | Path | Size | Sports | Providers | Channels | Notes |
|---|---|---|---|---|---|---|
| Current runtime | `data/gito.sqlite` | `6,045,696` | `1` | `15` | `17,986` | Current forensic state |
| Single DB enforcement | `data/gito.sqlite` | `1,744,896` | `12` | `13` | `4,507` | Previously validated runtime DB |
| System data flow audit | `data/gito.sqlite` | not specified | `0` | `13` | `4,507` | Broken runtime DB state earlier |
| Operator truth audit | `data/gito.sqlite` | `1,077,248` | `12` | `12` | `2,411` | Operator dataset baseline |
| Stale/test artifact | `apps/backend/data/gito.sqlite` | `6,377,472` | `1` | `25` | `19,253` | Previously identified stale alternate DB |

### Key inference
- The change is not explained by a different runtime path currently being loaded.
- `apps/backend/data/gito.sqlite` and `node_modules/@gito/backend/data/gito.sqlite` do not exist in the current workspace, so the backend is not transparently opening those alternate artifacts.
- Therefore, the drift is caused by the canonical `data/gito.sqlite` file itself being replaced or overwritten with a different dataset after the prior validations.

## Current runtime DB contents
- The current database contains only one sport row: `Soccer`
- Provider names include both operator-like providers (`Provider Sport 9e686212`, `Provider Host d01672f0`, etc.) and generic IPTV/test providers (`API TV`, `IPTV`, `IPTV TEST`)
- Provider status counts: `deleted=0` → 1 provider, `deleted=1` → 14 providers
- This indicates the current database contents are not the same as the previously validated operator dataset, and are instead a different data image with mixed test/production-like records

## Forensic conclusion
- The runtime backend is still loading the canonical path `data/gito.sqlite`
- The canonical file contents have clearly changed since the prior validated state
- The evidence points to the canonical database being overwritten/replaced, not to the backend simply choosing a different runtime database path
- The exact mechanism is likely a file-level replacement of `data/gito.sqlite` with a different SQLite image after the earlier validation reports

## Recommended next forensic checkpoints (audit only)
- Compare the current `data/gito.sqlite` SHA256 hash against archived backup images
- Identify the timestamped operation or script that modified `data/gito.sqlite` on `2026-06-02T22:44:53`
- Inspect any deployment or maintenance logs around that timestamp for database restore/replace actions
- Restore a known-good backup and verify whether startup counts revert to `12/13/4507`
