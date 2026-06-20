# GiTO SQLite Migration - Quick Start

## One-Liner Summary

Migrate local SQLite → JSON → Production API with validation.

---

## Quick Commands

### 1. Export Local Data (60 seconds)
```bash
node scripts/db-migration-export.js
```
Creates: `migration-export.json` with all local data

### 2. Setup Production Routes
Add to backend `apps/backend/src/main.ts` or `app.ts`:
```typescript
import { migrationRouter } from './routes/migration.routes.ts';
app.use('/api/admin/migration', migrationRouter);
```

### 3. Set Environment Variables
```bash
export VITE_API_URL=https://gito-sports.onrender.com
export MIGRATION_IMPORT_TOKEN=your-secure-token-here
```

### 4. Import to Production (2-5 minutes)
```bash
node scripts/db-migration-import.js
```

### 5. Validate Migration
```bash
node scripts/db-migration-validate.js
```

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/db-migration-export.js` | Export local SQLite to JSON |
| `scripts/db-migration-import.js` | Import JSON to production API |
| `scripts/db-migration-validate.js` | Compare local vs production counts |
| `apps/backend/src/routes/migration.routes.ts` | REST API endpoints for import |
| `migration-export.json` | Exported data (auto-generated) |
| `migration-import-report.json` | Import results (auto-generated) |
| `db-migration-guide.md` | Detailed guide |

---

## What Gets Migrated

✅ All core tables:
- Sports, providers, channels
- Competitions, seasons, teams
- Matches, streams, scheduling
- User accounts, sessions

✅ Preserved:
- Record IDs
- Relationships & foreign keys
- Timestamps
- Provider sync state

---

## Database Counts (Expected)

From local `data/gito.sqlite`:
```
SPORTS:     5+
PROVIDERS:  8+
CHANNELS:   156+
MATCHES:    342+
STREAMS:    287+
```

Production API should match or exceed these.

---

## Troubleshooting

### Export fails: "better-sqlite3 not found"
```bash
npm rebuild better-sqlite3 --build-from-source
```

### Import fails: "401 Unauthorized"
```bash
# Check token
echo $MIGRATION_IMPORT_TOKEN

# Check backend has migration routes added
curl https://gito-sports.onrender.com/api/admin/migration/status \
  -H "Authorization: Bearer $MIGRATION_IMPORT_TOKEN"
```

### Validation shows mismatches
1. Run export again
2. Check production backend logs
3. Review `migration-import-report.json` for errors

---

## Full Documentation

See [db-migration-guide.md](./db-migration-guide.md) for:
- Detailed step-by-step process
- Database schema documentation
- Safety considerations
- Performance metrics
- Rollback procedures

---

## Next Action

Run the export now to see your data:
```bash
node scripts/db-migration-export.js
```

This will show you exactly what will be migrated.
