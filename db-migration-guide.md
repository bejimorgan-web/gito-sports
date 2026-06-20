# GiTO Live Sports - SQLite Migration Guide

## Overview

This guide explains how to safely migrate your local GiTO SQLite database to the Render production backend.

## Database Structure

### Core Tables Included in Migration
- **sports**: Sport definitions (football, basketball, etc.)
- **regions**: Geographic regions
- **countries**: Country data with ISO codes
- **providers**: IPTV/Stream providers
- **channels**: TV channels from providers
- **competitions**: Sports competitions/leagues
- **seasons**: Competition seasons
- **teams**: Sports teams/clubs
- **matches**: Match scheduling
- **streams**: Stream assignments to matches
- **operator_users**: Admin/operator users
- **auth_sessions**: Active sessions

### Local Database
- Location: `data/gito.sqlite`
- Format: SQLite 3

### Production Database
- Location: `/tmp/gito.sqlite` (Render environment)
- Access: Via REST API at `https://gito-sports.onrender.com`

---

## Prerequisites

### Local Environment (Already Done)
- ✅ Node.js 20.x active (`nvm use 20`)
- ✅ Visual Studio Build Tools installed
- ✅ `better-sqlite3` compiled

### Production Environment
- Production backend running at `https://gito-sports.onrender.com`
- Migration token available: `MIGRATION_IMPORT_TOKEN`

---

## Step 1: Validate Local Database

```bash
# Check database exists
ls -la data/gito.sqlite

# Quick validation
node scripts/db-migration-validate.js
```

**Expected Output:**
```
✓ Sports defined: N local → M production
✓ Providers configured: X local → Y production
✓ Channels available: A local → B production
```

---

## Step 2: Export Local Data

Export all data from your local SQLite to a JSON migration file:

```bash
# Run export (outputs to migration-export.json)
node scripts/db-migration-export.js

# Or specify custom output path
node scripts/db-migration-export.js --output my-export.json
```

**What happens:**
1. Connects to `data/gito.sqlite` in read-only mode
2. Exports all tables in dependency order
3. Preserves all IDs, relationships, timestamps
4. Saves to `migration-export.json`

**Sample output:**
```
🔍 Starting database export...

📂 Local DB: C:\...\data\gito.sqlite
📦 Size: 5.12 MB

📊 Table Counts:
✓ sports                        5 rows
✓ providers                      8 rows
✓ channels                       156 rows
✓ competitions                   12 rows
✓ matches                        342 rows
✓ streams                        287 rows
○ operator_users                0 rows

📈 Critical Counts:
  SPORTS:     5 ✓
  PROVIDERS:  8 ✓
  CHANNELS:   156 ✓
  MATCHES:    342 ✓
  STREAMS:    287 ✓

✅ Export complete: migration-export.json
📋 File size: 8.45 MB
```

### Export File Structure
```json
{
  "exportedAt": "2026-06-20T10:30:00.000Z",
  "source": "data/gito.sqlite",
  "tables": {
    "sports": [
      { "id": "sport_1", "name": "Football", "slug": "football", ... },
      ...
    ],
    "providers": [...],
    "channels": [...],
    ...
  },
  "summary": {
    "sports": { "count": 5, "sample": {...} },
    ...
  }
}
```

---

## Step 3: Setup Migration Endpoint (Backend)

Add the migration routes to your backend server:

### File: `apps/backend/src/routes/migration.routes.ts`
Already created with:
- POST `/api/admin/migration/import/:tableName` - Import data
- GET `/api/admin/migration/count/:tableName` - Get table count
- GET `/api/admin/migration/status` - Get overall status

### Integration

Add to your backend `app.ts`:

```typescript
import { migrationRouter } from './routes/migration.routes.ts';

// Add before other routes
app.use('/api/admin/migration', migrationRouter);
```

### Protect with Token

Set `MIGRATION_IMPORT_TOKEN` in production environment:

```bash
# In Render dashboard
MIGRATION_IMPORT_TOKEN=your-secure-token-here
```

---

## Step 4: Import to Production

### Prerequisites
1. Backend deployed with migration routes
2. Export file created (`migration-export.json`)
3. Migration token set in environment

### Run Import

```bash
# Set API URL and token
export VITE_API_URL=https://gito-sports.onrender.com
export MIGRATION_IMPORT_TOKEN=your-token-here

# Run import
node scripts/db-migration-import.js

# Or specify custom export file
node scripts/db-migration-import.js --input my-export.json
```

**Sample output:**
```
🔍 Starting database import...

📂 Loading export: migration-export.json
📅 Export date: 2026-06-20T10:30:00.000Z

📊 Pre-Import Local Counts:
  sports                         5 rows
  providers                      8 rows
  channels                       156 rows
  competitions                   12 rows
  matches                        342 rows
  streams                        287 rows

🌐 Connecting to: https://gito-sports.onrender.com
✓ API is reachable

📥 Importing tables...

✓ sports                        5 rows imported
✓ providers                      8 rows imported
✓ channels                       156 rows imported
✓ competitions                   12 rows imported
✓ matches                        342 rows imported
✓ streams                        287 rows imported

📊 Post-Import Verification:

✓ SPORTS          Local: 5, Production: 5
✓ PROVIDERS       Local: 8, Production: 8
✓ CHANNELS        Local: 156, Production: 156
✓ MATCHES         Local: 342, Production: 342

📈 Import Summary:
  Total records imported: 1158
  Total errors: 0

✅ Import complete and verified!

📋 Report saved: migration-import-report.json
```

---

## Step 5: Verify Migration

### Automated Validation

```bash
node scripts/db-migration-validate.js
```

### Manual Checks

```bash
# Check production database directly
curl -X GET https://gito-sports.onrender.com/api/admin/migration/status \
  -H "Authorization: Bearer $MIGRATION_IMPORT_TOKEN"

# Sample response:
{
  "ready": true,
  "counts": {
    "sports": 5,
    "providers": 8,
    "channels": 156,
    "matches": 342,
    "streams": 287,
    "operator_users": 0
  },
  "critical": {
    "sports": true,
    "providers": true,
    "channels": true,
    "matches": true
  }
}
```

### Expected Results

| Table | Requirement | Status |
|-------|-------------|--------|
| SPORTS | > 0 | ✓ Must have |
| PROVIDERS | > 0 | ✓ Must have |
| CHANNELS | > 0 | ✓ Must have |
| MATCHES | ≥ 0 | ○ Optional |

---

## Troubleshooting

### Export Issues

**"Local database not found"**
```bash
# Ensure path is correct
ls -la data/gito.sqlite
```

**"Failed to read better-sqlite3"**
```bash
# Rebuild native modules
npm rebuild better-sqlite3 --build-from-source
```

### Import Issues

**"Missing MIGRATION_IMPORT_TOKEN"**
```bash
export MIGRATION_IMPORT_TOKEN=your-token
```

**"Failed to reach API"**
- Check production backend is running
- Verify `VITE_API_URL` is correct
- Check firewall/CORS settings

**"API returned 401"**
- Verify token is correct
- Token must match `MIGRATION_IMPORT_TOKEN` in backend

**Foreign Key Constraint Errors**
- Tables are imported in dependency order
- If errors occur, check:
  1. Parent records exist
  2. IDs are not already present
  3. No circular references

### Rollback

If migration fails:

1. **Stop import** - Cancel the script
2. **Check report** - Review `migration-import-report.json`
3. **Partial rollback** - Export only affected tables
4. **Retry** - Delete problematic records and re-import

```bash
# Get detailed error info
cat migration-import-report.json | jq '.results'
```

---

## Safety Considerations

### What's Preserved
✅ All record IDs  
✅ Relationships (foreign keys)  
✅ Timestamps (created_at, updated_at)  
✅ Provider sync state  
✅ Channel configurations  

### What Happens
⚠️ **Existing production data**: Not modified unless explicitly imported  
⚠️ **Duplicate IDs**: Will use INSERT OR REPLACE (overwrite)  
⚠️ **Invalid references**: May fail with foreign key errors  

### Recommendations
1. **Backup production** before import
2. **Test with small dataset** first
3. **Verify critical counts** after import
4. **Monitor production logs** for errors
5. **Keep export file** for audit trail

---

## Performance

### Export Performance
- Typical time: 10-30 seconds
- File size: ~1.5-2x database size
- Memory: < 500MB

### Import Performance
- Typical time: 30 seconds - 2 minutes
- Depends on table sizes and API latency
- Processes tables sequentially to maintain relationships

### Scaling
For large migrations (> 10GB):
1. Export in batches by table
2. Import sequentially with delays
3. Monitor API rate limits

---

## Files Created

```
scripts/
├── db-migration-export.js      # Export local data
├── db-migration-import.js      # Import to production
└── db-migration-validate.js    # Validate migration

apps/backend/src/routes/
└── migration.routes.ts         # Backend API endpoints

Root/
├── migration-export.json       # Exported data
├── migration-import-report.json # Import results
└── db-migration-guide.md       # This file
```

---

## Next Steps

1. ✅ Export local database
2. ✅ Deploy migration routes to production
3. ✅ Set `MIGRATION_IMPORT_TOKEN` in production
4. ✅ Run migration import
5. ✅ Verify with validation script
6. ✅ Monitor production for issues
7. Keep export file for future reference

---

## Support

For migration issues:
1. Check `migration-export.json` - verify data structure
2. Check `migration-import-report.json` - review import results
3. Run validation script - compare local vs production
4. Check backend logs - look for import errors
5. Review this guide - check troubleshooting section
