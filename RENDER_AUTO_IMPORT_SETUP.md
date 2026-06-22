# Render Production Auto-Import Setup

## Overview
This document explains how to configure Render to automatically import seed data (migration-export.json) into the production SQLite database on first startup.

## Problem Statement
Previously, the Render production database remained empty because:
- SQLite runs in ephemeral `/tmp/` storage on Render
- Database is recreated on each deployment/restart
- No automatic seed data import on startup
- Manual API calls to populate database were required

## Solution Architecture
The solution implements automatic import on database startup:

1. **Build-time bundling**: `migration-export.json` is copied to `dist/` during the backend build
2. **Runtime detection**: On startup, the backend checks if the database is empty
3. **Auto-import**: If `AUTO_IMPORT_MIGRATION=true` and database is empty, seed data is imported
4. **Idempotency**: `migration_meta` table tracks import completion to prevent re-imports on restarts
5. **Health visibility**: `/health` and `/api/admin/migration/status` endpoints show import status

## Files Changed

### 1. `.gitignore`
**Change**: Removed `migration-export.json` from ignored files
**Reason**: Need to track the seed data file in git for Render deployment
**Note**: Still ignore compressed version (`migration-export.json.gz`) and actual SQLite files

```diff
- migration-export.json   # REMOVED
  migration-export.json.gz # Still ignored (compressed backups)
```

### 2. `apps/backend/package.json`
**Change**: Updated build script to copy `migration-export.json` to `dist/`
**Impact**: Migration data is now bundled with the backend build

```json
"build": "tsc -b tsconfig.json && node --input-type=module -e \"... copy schema files ... copy migration-export.json ...\""
```

### 3. `apps/backend/src/config/env.ts`
**Changes**:
- Added `import fs from "node:fs"`
- Updated migration import file path resolution to check `dist/migration-export.json` first
- Falls back to workspace root for development

**Path Resolution Order**:
1. `MIGRATION_IMPORT_FILE` env var (if explicitly set)
2. `dist/migration-export.json` (production builds)
3. `{workspaceRoot}/migration-export.json` (development)

### 4. `apps/backend/src/db/connection.ts`
**Existing**: Already contains auto-import logic on startup when:
- `AUTO_IMPORT_MIGRATION=true`
- Database is empty
- Migration not already imported

### 5. `apps/backend/src/routes/health.ts`
**Existing**: Already reports:
- `databaseReady` (all critical tables have data)
- `migrationImported` (whether seed data was imported)
- `migrationMeta` (import timestamp and version)
- `recordCounts` (table row counts)

## Render Environment Variables

Set these on Render dashboard or in `render.yaml`:

```bash
# Database
DATABASE_PATH=/tmp/gito.sqlite

# Auto-import seed data on first startup
AUTO_IMPORT_MIGRATION=true

# Optional: Explicit path to migration file (defaults to bundled dist/migration-export.json)
# MIGRATION_IMPORT_FILE=/path/to/migration-export.json

# JWT Secret (required for production)
JWT_SECRET=<generate-secure-random-32-char-string>

# Other required vars
NODE_ENV=production
FOOTBALL_DATA_API_KEY=<your-api-key>
CORS_ORIGINS=https://gito-sports.onrender.com,https://yourfrontend.com
```

## Deployment Steps

### 1. Local Verification
```bash
# Clean build
npm run build:clean

# Verify migration file is bundled
ls -lah apps/backend/dist/migration-export.json

# Test bootstrap locally
AUTO_IMPORT_MIGRATION=true npm run db:bootstrap

# Verify data was imported
curl http://localhost:4100/api/admin/migration/status
```

### 2. Git Configuration
```bash
# Ensure migration-export.json is tracked
git add migration-export.json
git status  # should show migration-export.json as staged

# Commit changes
git commit -m "feat: auto-import seed data on Render startup"
```

### 3. Render Dashboard Configuration

1. Go to Render dashboard
2. Select your backend service
3. Go to **Settings** → **Environment**
4. Add/update these variables:
   - `AUTO_IMPORT_MIGRATION=true`
   - `DATABASE_PATH=/tmp/gito.sqlite`
   - `NODE_ENV=production`
   - `JWT_SECRET=<secure-32-char-string>`

5. Trigger manual deployment or push to trigger auto-deploy:
   ```bash
   git push origin main
   ```

### 4. Verification on Render

After deployment, check:

```bash
# Check health endpoint
curl https://gito-sports.onrender.com/health

# Expected response (once auto-import completes):
{
  "status": "ok",
  "service": "gito-backend",
  "databaseReady": true,
  "migrationImported": true,
  "migrationMeta": {
    "id": "initial_import",
    "migration_version": "sha256hash...",
    "imported_at": "2026-06-22T12:34:56.000Z"
  },
  "recordCounts": {
    "sports": 1,
    "teams": 7,
    "matches": 10,
    "streams": 1,
    ...
  }
}

# Check migration status
curl https://gito-sports.onrender.com/api/admin/migration/status

# Expected response (ready=true when all critical tables have data):
{
  "ready": true,
  "counts": { ... },
  "critical": {
    "sports": true,
    "providers": true,
    "channels": true,
    "matches": true
  },
  "migrationImported": true,
  "migrationMeta": { ... }
}
```

## How Auto-Import Works

### Startup Flow
```
1. getDatabase() called in connection.ts
2. Database file opened (empty on first Render deploy)
3. Schema applied if database is empty
4. Admin user bootstrapped
5. Check AUTO_IMPORT_MIGRATION setting
   ├─ If false: Skip import
   ├─ If migration already imported: Skip (check migration_meta table)
   ├─ If database not empty: Skip (has existing data)
   └─ If all above false: Import migration-export.json
6. Create migration_meta entry to mark import complete
7. Validate database startup
8. Start services
```

### Migration Lock Table
The `migration_meta` table tracks imports to ensure idempotency:

```sql
CREATE TABLE IF NOT EXISTS migration_meta (
  id TEXT PRIMARY KEY,  -- "initial_import"
  migration_version TEXT NOT NULL,  -- SHA256 hash of export file
  imported_at TEXT NOT NULL  -- ISO timestamp
);
```

### Operator User Preservation
When importing, existing operator_users are preserved to prevent:
- Duplicate admin accounts
- Loss of custom operator configurations
- Database conflicts

## Troubleshooting

### Auto-import not running on Render

1. **Check env variables**:
   ```bash
   curl https://gito-sports.onrender.com/__debug/version
   ```
   Should show auto_import_migration in response

2. **Check Render logs**:
   - Go to Render dashboard
   - Select service
   - View logs
   - Look for `[startup] AUTO_IMPORT_MIGRATION` messages

3. **Common issues**:
   - `AUTO_IMPORT_MIGRATION` not set to `true`
   - `migration-export.json` not bundled (build script failed)
   - `DATABASE_PATH` not absolute or not writable
   - `MIGRATION_IMPORT_FILE` explicitly set to wrong path

### Migration file not found

```
[startup] AUTO_IMPORT_MIGRATION is enabled but import file was not found: ...
```

**Fix**:
1. Verify `migration-export.json` is in git repo: `git ls-files | grep migration-export`
2. Rebuild: `npm run build:clean && npm run build`
3. Verify file in dist: `ls apps/backend/dist/migration-export.json`
4. Commit and push again

### Database not populating

1. Check if import actually ran:
   ```bash
   curl https://gito-sports.onrender.com/api/admin/migration/status
   ```
   - If `ready: false` → import didn't complete
   - If `migrationImported: false` → check logs for errors

2. Check migration lock:
   ```bash
   # Can only do this with direct DB access (not available on Render)
   # Check via POST /api/admin/migration/import if needed
   ```

## Maintenance

### Updating seed data
1. Export fresh data from local database:
   ```bash
   npm run db:export
   ```
   (Assuming export script exists)

2. Replace `migration-export.json`
3. Rebuild:
   ```bash
   npm run build:clean && npm run build
   ```
4. Commit and push to trigger Render re-deployment

### Manually importing on production
Use migration API if needed:
```bash
curl -X POST https://gito-sports.onrender.com/api/admin/migration/import \
  -H "Authorization: Bearer $MIGRATION_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @migration-export.json
```

## Performance Implications

- **First startup**: +30-60 seconds for import (one-time)
- **Subsequent startups**: <1 second (import skipped)
- **Database size**: ~7MB for migration-export.json in git
- **Build time**: +1-2 seconds for file copy

## Security Considerations

- Migration data contains non-sensitive catalog information
- No passwords or API keys in migration-export.json
- Operator user credentials managed separately
- Import requires either valid JWT or `MIGRATION_IMPORT_TOKEN`

## Next Steps

1. ✅ Commit `migration-export.json` to git
2. ✅ Push to git
3. ✅ Render auto-deploys
4. ✅ Verify health endpoint shows `ready: true`
5. ✅ Test frontend login against populated database
6. ✅ Monitor for errors in Render logs
