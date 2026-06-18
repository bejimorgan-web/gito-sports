# DATABASE OVERWRITE ROOT CAUSE REPORT

**Date**: June 16, 2026  
**Status**: ✅ Investigation Complete  
**Scope**: All source code, scripts, npm scripts, scheduled tasks, and node_modules

---

## EXECUTIVE FINDING

**The database was NOT overwritten by a file copy.** The evidence shows `data/gito.sqlite` was **modified in-place** through SQL operations executed by the running backend application. There is no code path that replaces `data/gito.sqlite` with a different file. The data transformation from 12 sports / 2,411 channels → 1 sport / 36,343 channels happened through two additive processes:

1. **M3U/Xtream provider syncs** (channel imports) — adds thousands of channels per import
2. **API data operations** — creates, deletes, and modifies sports, providers, competitions

---

## 1. INVESTIGATION SCOPE

### 1.1 Files Searched

| Pattern | Scope | Result |
|---------|-------|--------|
| `copyFile`, `copyFileSync` | All `.ts`, `.js`, `.py`, `.ps1` | **No matches outside `scripts/recover-sports-data.py`** |
| `writeFile`, `writeFileSync` | All source files | **No matches** |
| `fs.copy`, `fs.write` | All source files | **No matches** |
| `shutil.copy`, `shutil.copy2` | All Python files | **Only in `scripts/recover-sports-data.py`** (intentional, documented) |
| `gito.sqlite` | All source files | **6 matches** (see below) |
| `PRODUCTION_DB`, `BACKUP_DB` | All source files | **Only in `scripts/recover-sports-data.py`** |
| `data/gito` | All source files | **Only in `apps/backend/src/config/env.ts`** (path reference) |
| New `DatabaseSync()` | All `.ts` files | **Only in `apps/backend/src/db/connection.ts`** (guarded by `allowSqliteInstantiation`) |
| `BetterSqlite3`, `sqlite3.Database` | All files | **No matches** |

### 1.2 All References to `gito.sqlite` in Source Code

| File | Line | Usage | Risk |
|------|------|-------|------|
| `apps/backend/src/config/env.ts` | 13 | `canonicalDatabasePath = path.resolve(workspaceRoot, "data", "gito.sqlite")` | ✅ Path definition only |
| `apps/backend/src/db/connection.ts` | 85 | `expectedDatabasePath = path.resolve(...)` | ✅ Backend opens this file at startup |
| `apps/backend/src/db/connection.ts` | 104 | `new DatabaseSync(resolvedDatabasePath)` | ✅ Creates SQLite connection |
| `scripts/recover-sports-data.py` | 23 | `PRODUCTION_DB = "data/gito.sqlite"` | ✅ Intentional recovery script |
| `node_modules/@gito/backend/src/db/connection.ts` | 85 | Same as `apps/backend/src/db/connection.ts` | ✅ Duplicate in node_modules (not loaded) |
| `node_modules/@gito/backend/src/config/env.ts` | 13 | Same as `apps/backend/src/config/env.ts` | ✅ Duplicate in node_modules (not loaded) |

### 1.3 All Mechanisms That Write to the Database

| Mechanism | File | Type | Risk Level |
|-----------|------|------|:----------:|
| `getDatabase()` startup | `apps/backend/src/db/connection.ts` | Opens file, runs schema, migrates columns | 🟢 Low (read-only after migrations) |
| `migrateExistingOperationalState()` | `apps/backend/src/db/connection.ts` | ALTER TABLE (adds columns, seeds shadow catalog) | 🟢 Low (additive only) |
| `seedShadowCatalogLayer()` | `apps/backend/src/db/connection.ts` | INSERT INTO for shadow catalog | 🟢 Low (one-time seed) |
| `syncProviderChannels()` | `apps/backend/src/repositories/provider-repository.ts` | INSERT/UPDATE channels in batch | 🔴 **CRITICAL** — bulk channel import |
| `softDeleteProvider()` | `apps/backend/src/repositories/provider-repository.ts` | UPDATE providers SET deleted=1, channels archived | 🟡 Medium |
| `createProvider()` | `apps/backend/src/repositories/provider-repository.ts` | INSERT INTO providers | 🟢 Low |
| `createSport()` | `apps/backend/src/repositories/sports-repository.ts` | INSERT INTO sports | 🟢 Low |
| `deleteSport()` | `apps/backend/src/repositories/sports-repository.ts` | Hard DELETE | 🟡 Medium |
| API PUT/POST routes | `apps/backend/src/routes/*.ts` | CRUD operations via repositories | 🟡 Medium |
| `scripts/recover-sports-data.py` | `scripts/` | INSERT INTO sports from backup | 🟢 Low (intentional, once) |

---

## 2. EVIDENCE: BULK CHANNEL IMPORT MECHANISM

### 2.1 The Critical Code Path

The ONLY mechanism capable of adding 36,000+ channels is `syncProviderChannels()` in `apps/backend/src/repositories/provider-repository.ts`.

This function is called from three API endpoints:

```
POST /iptv/providers/:providerId/test  (M3U type → syncs channels)
POST /iptv/providers/:providerId/m3u   (raw M3U upload → syncs channels)
POST /iptv/providers/:providerId/xtream/sync  (Xtream → syncs channels)
```

Each call can insert thousands of channels from an M3U playlist or Xtream API response. The function:
1. Parses all channels from the playlist
2. Validates URLs
3. Inserts new channels
4. Updates existing channels
5. Marks removed channels as inactive

**Evidence from the route code** (`apps/backend/src/routes/iptv.ts`, line 209):
```typescript
const channels = validChannels.length > 0
  ? IPTVService.syncProviderChannels(request.params.providerId, validChannels)
  : [];
```

**Evidence from the repository** (`apps/backend/src/repositories/provider-repository.ts`, lines 299-306):
```typescript
const insertStmt = database.prepare(
  `INSERT INTO channels (id, provider_id, name, external_ref, group_name, url, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
);
```

### 2.2 Timeline Reconstruction

| Date/Time | Event | Sports | Channels | Source |
|-----------|-------|:------:|:--------:|--------|
| Pre-June 1 | Stable operator dataset | 12 | 2,411 | `gito-backup-20260601-200650.sqlite` |
| June 1 ~21:47 | Phase 9 lockdown — sports deleted | 0 | 4,507 | `gito-corrupted-20260601-223302.sqlite` |
| June 1 ~22:33 | Recovery script inserts 12 sports | 12 | 4,507 | `scripts/recover-sports-data.py` |
| June 1-June 2 | **M3U/Xtream imports** via API (17,986-4,507=13,479 new channels) | 12→1 | 4,507→17,986 | Jump 1 — API sync operations |
| June 2-June 16 | **More M3U/Xtream imports** (36,343-17,986=18,357 new channels) + API operations | 1 | 17,986→36,343 | Jump 2 — API sync operations |

**Note**: The channel counts correlate with M3U/Xtream provider syncs. Each provider can have thousands of channels. The data shows 18 providers in the current runtime, up from 12 in the golden backup.

### 2.3 What Happened to the Sports

The current runtime has exactly **1 sport**: "Soccer" (UUID `d5ae7781-d5c2-4b04-9f99-3f98d18b9300`). This UUID appears in **no backup** — it was created fresh via the API.

The 10 orphaned competitions (sport_id=NULL) were explicitly set to NULL, likely as a side effect of:
1. A competition update that cleared sport_id
2. A test script that modified competition records
3. An AI agent execution that manipulated competition data during earlier phases

The `validate-api-endpoints.py` script (from FIX_APPLIED_REPORT.md) and other validation scripts executed by AI agents during Phases 3-9 could have issued DELETE/UPDATE commands via the API.

---

## 3. INVESTIGATED AND ELIMINATED CAUSES

### 3.1 Eliminated: File-Level Database Replacement

| Hypothesis | Evidence Against |
|------------|-----------------|
| `node_modules/@gito/backend` writes to `data/gito.sqlite` | Duplicate source, but the backend loads from `apps/backend/src/`, NOT from `node_modules/`. Confirmed by Phase 9 lockdown path enforcement in `connection.ts`. |
| A scheduled task copies a file | No Windows scheduled tasks reference gito, sqlite, or the workspace path. |
| An npm script replaces the database | No npm scripts use `cp`, `copy`, or any file-copy command. Only `dev`, `start`, `build`, `typecheck`. |
| A `.bat` or `.sh` script copies the file | No `.bat` or `.sh` file in the workspace references `gito.sqlite` or `data/`. |
| A Python script replaces the file | Only `scripts/recover-sports-data.py` copies the database, and it only runs when explicitly invoked. It creates a backup BEFORE any changes, and only INSERTs sports. |
| A CI/CD pipeline overwrites the file | No CI/CD configuration files found in the workspace. |

### 3.2 Eliminated: Git Restore

| Hypothesis | Evidence Against |
|------------|-----------------|
| `git checkout` restored an old database | `.gitignore` includes `data/*.sqlite` — the database is NOT tracked in Git. |

### 3.3 Eliminated: Database Corruption

| Hypothesis | Evidence Against |
|------------|-----------------|
| SQLite file was corrupted | The current `data/gito.sqlite` passes all SQLite integrity checks. It is a valid, well-formed database — just a different dataset. |

---

## 4. ROOT CAUSE: IN-PLACE MODIFICATION VIA API

### 4.1 What Happened

The database was **not replaced** — it was **modified incrementally** through the running backend API:

1. **Channel inflation**: An operator or automated process called `POST /iptv/providers/:providerId/test` (or `/m3u` or `/xtream/sync`) with large M3U playlists multiple times. Each call added thousands of channels. This explains the progression: 2,411 → 4,507 → 17,986 → 36,343.

2. **Sport deletion**: The original 12 sports were deleted via `DELETE /sports/:sportId` (or `DELETE FROM sports` executed directly). The single remaining sport "Soccer" was created later via `POST /sports`.

3. **Competition disconnection**: Competition `sport_id` values were set to NULL, likely by competition update operations that didn't preserve the sport_id.

4. **Provider state changes**: Providers were created, tested, and soft-deleted through the IPTV management API.

### 4.2 When It Happens

The database modification is **not a one-time event** — it's an **ongoing process** that happens whenever:
- An operator tests an M3U provider (bulk channel import)
- An operator tests an Xtream provider (bulk channel import)
- An operator uploads an M3U playlist (bulk channel import)
- An operator creates/deletes sports via API
- An operator creates/deletes providers via API
- An AI validation script runs (which may call the API)

### 4.3 Who/What Triggered It

The most likely trigger is a combination of:
1. **AI agent validation scripts** from Phases 3-9 (the `scripts/validate-*.ts` and `scripts/validate-*.py` files) that created test data and called API endpoints
2. **Manual operator testing** of IPTV providers with large M3U playlists
3. **The integration test script** (`node_modules/@gito/backend/.integration-test.ts`) which creates providers, syncs channels, creates matches, and modifies stream status

---

## 5. RECOMMENDED PREVENTIONS

### 5.1 Immediate (No Code Changes)

| Action | Why |
|--------|-----|
| **Backup the known-good database** | Copy `archive/sqlite-backups/gito-backup-20260601-200650.sqlite` to a safe location (already done) |
| **Add a `.gitignore` exception** | Consider tracking a known-good database snapshot in Git (e.g., `data/gito-baseline.sqlite` with a special exclusion rule) |
| **Make `data/gito.sqlite` read-only when backend is stopped** | `attrib +R data\gito.sqlite` — prevents any non-backend process from modifying it |

### 5.2 Medium-Term (Minimal Code Changes)

| Change | File | What To Do |
|--------|------|------------|
| **Add a startup stale-data warning** | `apps/backend/src/db/connection.ts` | Compare current `sport_count + channel_count` against expected ranges. If sports < 10 or channels > 10,000, log a CRITICAL WARNING |
| **Rate-limit provider syncs** | `apps/backend/src/routes/iptv.ts` | Add max channel count per sync (e.g., warn if > 5,000 channels in a single import) |
| **Log operator actions** | Already exists in `operational-log-repository.ts` | Verify logging is capturing all Provider sync operations |

### 5.3 Long-Term (Requires Architecture Approval)

| Change | Description |
|--------|-------------|
| **Snapshot versioning** | Store a schema version + data checksum in the database. On startup, warn if drift exceeds thresholds |
| **Provider sync limits** | Cap the number of channels that can be imported from a single provider sync (configurable) |
| **Database backup cron** | Automatically back up `data/gito.sqlite` before any provider sync or bulk operation |

---

## 6. CONCLUSION

| Question | Answer |
|----------|--------|
| **What created the bulk-import database?** | Repeated M3U/Xtream provider sync operations via `POST /iptv/providers/:providerId/test` and `/m3u` endpoints. Each import adds thousands of channels. |
| **What process replaced gito.sqlite?** | **No file replacement.** The database was modified **in-place** through SQL INSERT/UPDATE/DELETE operations executed by the running backend. |
| **When does it happen?** | Whenever an operator or automated script: (1) syncs channels from an M3U/Xtream provider, (2) creates/deletes sports/providers via the API, (3) runs validation scripts that call the API. |
| **How to prevent it?** | (1) Add startup data-integrity warnings, (2) rate-limit channel imports, (3) log all provider syncs, (4) make the database read-only when the backend is stopped. |
| **Is the database corrupt?** | No. The current `data/gito.sqlite` is valid — it's just a different dataset than the production operator database. |

### The Database is NOT "Corrupted" — It's "Diverged"

The current `data/gito.sqlite` is a valid, well-formed SQLite database. It has 1 sport, 18 providers, 36,343 channels, and all tables pass integrity checks. The problem is not corruption — it's that **operator API usage and automated tests have modified the production database in-place**, gradually transforming it from the operator dataset into a test/bulk-import dataset.

The production database can be restored by copying the known-good golden backup (`gito-backup-20260601-200650.sqlite`) to `data/gito.sqlite`, but **the root cause (unrestricted API modifications) will remain** unless the recommended preventions are implemented.

---

## APPENDIX: Evidence Files Searched

| File Pattern | Count | Relevant Hits |
|-------------|:-----:|---------------|
| `apps/backend/src/**/*.ts` | ~55 files | All analyzed (see above) |
| `scripts/*.py` | 8 files | Only `scripts/recover-sports-data.py` writes to DB |
| `scripts/*.ts` | 3 files | `stress-operations.ts`, `validate-operations.ts`, `validate-enforcement.ts` — call API endpoints |
| `scripts/*.ps1` | 1 file | `batch-upload.ps1` — uploads images only |
| `package.json` | 1 file | No database operations in scripts |
| `apps/backend/package.json` | 1 file | Only `dev`, `start`, `build` scripts |
| `node_modules/@gito/backend/` | Full duplicate | Mirrors `apps/backend/` but not loaded by the runtime |
| Windows Scheduled Tasks | System query | No matches for "gito" or "sqlite" |