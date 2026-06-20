# GiTO SQLite Migration - Command Reference

## Files Created

```
✅ CREATED: scripts/db-migration-export.js
✅ CREATED: scripts/db-migration-import.js  
✅ CREATED: scripts/db-migration-validate.js
✅ CREATED: apps/backend/src/routes/migration.routes.ts
✅ GENERATED: migration-export.json (14,819 rows, 6.59 MB)
✅ CREATED: db-migration-guide.md
✅ CREATED: MIGRATION_QUICKSTART.md
✅ CREATED: MIGRATION_STATUS_REPORT.md
✅ CREATED: MIGRATION_COMMANDS.md (this file)
```

---

## Command Checklist

### ✅ COMPLETED: Step 1 - Export Local Data

```bash
# Already ran - export complete
node scripts/db-migration-export.js

# Results:
# ✓ 14,819 total rows exported
# ✓ migration-export.json created (6.59 MB)
```

### ⏳ TODO: Step 2 - Add Backend Migration Routes

**Edit**: `apps/backend/src/main.ts` (or `app.ts`)

Find your Express app initialization and add:

```typescript
// Add import at the top
import { migrationRouter } from './routes/migration.routes.ts';

// Add this line BEFORE app.listen() or app.use(/* existing routes */)
app.use('/api/admin/migration', migrationRouter);

// Example location (adjust for your code):
app.get('/api/health', ...);
app.use('/api/admin/migration', migrationRouter);  // <-- ADD HERE
app.use('/api/data', dataRouter);
```

Then redeploy to Render (push to git or use Render CLI).

### ⏳ TODO: Step 3 - Generate Secure Token

```bash
# On your local machine - generate secure random token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Example output:
# a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1

# Copy this token
```

### ⏳ TODO: Step 4 - Set Production Environment Variable

In Render Dashboard:

1. Go to: Backend Service → Environment
2. Add new environment variable:
   ```
   Name: MIGRATION_IMPORT_TOKEN
   Value: <paste-token-from-step-3>
   ```
3. Deploy backend again

### ⏳ TODO: Step 5 - Run Production Import

```bash
# Set local environment variables
export VITE_API_URL=https://gito-sports.onrender.com
export MIGRATION_IMPORT_TOKEN=<token-from-step-3>

# Run import from project root
node scripts/db-migration-import.js

# This will output:
# ✓ Connects to production
# ✓ Imports all 14,819 records
# ✓ Generates migration-import-report.json
```

### ⏳ TODO: Step 6 - Validate Migration

```bash
# Validate local vs production counts
node scripts/db-migration-validate.js

# Expected output:
# ✓ Sports: 1 rows
# ✓ Providers: 13 rows  
# ✓ Channels: 14,783 rows
# ✓ Matches: 10 rows
# ✓ Streams: 1 row
# ✅ Validation passed!
```

---

## One-Liner Quick Commands

### Verify export is complete
```bash
ls -la migration-export.json
```

### Deploy with migration routes (from project root)
```bash
git add apps/backend/src/routes/migration.routes.ts
git commit -m "Add database migration endpoints"
git push
```

### Quickly test production API
```bash
curl -X GET https://gito-sports.onrender.com/api/health
```

### Check if migration token is set
```bash
echo $MIGRATION_IMPORT_TOKEN
```

### Run all 3 validation steps
```bash
echo "1. Export:" && test -f migration-export.json && echo "✓ Found" || echo "✗ Missing"
echo "2. Export size:" && stat --format=%s migration-export.json 2>/dev/null || stat -f%z migration-export.json
echo "3. Export records:" && node -e "const j=require('./migration-export.json'); console.log('Records:', Object.values(j.tables).reduce((s,t)=>s+t.length,0))"
```

---

## Expected Outputs

### Export Output
```
🔍 Starting database export...
📊 Table Counts:
✓ sports                         1 rows
✓ providers                      13 rows
✓ channels                       14783 rows
✓ matches                        10 rows
✓ streams                        1 rows
✅ Export complete: migration-export.json
📋 File size: 6.59 MB
```

### Import Output
```
🔍 Starting database import...
📂 Loading export: migration-export.json
🌐 Connecting to: https://gito-sports.onrender.com
✓ API is reachable
📥 Importing tables...
✓ sports                        1 rows imported
✓ providers                      13 rows imported
✓ channels                       14783 rows imported
✓ matches                        10 rows imported
✓ streams                        1 rows imported
✅ Import complete and verified!
```

### Validate Output
```
🔍 Validation Report: Local vs Production
📊 Comparison:
✓ Sports: 1 rows
✓ Providers: 13 rows
✓ Channels: 14783 rows
✓ Matches: 10 rows
✓ Streams: 1 rows
📈 Critical Checks:
✓ Sports defined: 1 local → 1 production
✓ Providers configured: 13 local → 13 production
✓ Channels available: 14783 local → 14783 production
✅ Validation passed!
```

---

## Troubleshooting Commands

### If backend routes not found
```bash
# Check if migration.routes.ts was created
ls -la apps/backend/src/routes/migration.routes.ts

# Verify import was added to main app file
grep -n "migrationRouter" apps/backend/src/main.ts
grep -n "migrationRouter" apps/backend/src/app.ts
```

### If API unreachable
```bash
# Test connectivity
curl -I https://gito-sports.onrender.com

# Check Render status (optional)
curl https://www.rendeerstatus.com/api/v2/status.json 2>/dev/null | grep -o '"status":"[^"]*"'
```

### If token error
```bash
# Verify local token is set
echo $MIGRATION_IMPORT_TOKEN

# Verify token in production (via logs)
# Check Render dashboard: Logs → Backend
```

### If foreign key errors
```bash
# Review detailed error report
cat migration-import-report.json | grep -A5 -B5 "error"

# See import summary
cat migration-import-report.json | grep -E '"table|"imported|"errors'
```

---

## Environment Variable Cheat Sheet

### Windows PowerShell
```powershell
$env:VITE_API_URL="https://gito-sports.onrender.com"
$env:MIGRATION_IMPORT_TOKEN="your-token-here"
```

### macOS/Linux Bash
```bash
export VITE_API_URL=https://gito-sports.onrender.com
export MIGRATION_IMPORT_TOKEN=your-token-here
```

### Windows CMD (legacy)
```cmd
set VITE_API_URL=https://gito-sports.onrender.com
set MIGRATION_IMPORT_TOKEN=your-token-here
```

---

## Timeline

| Step | Command | Time | Status |
|------|---------|------|--------|
| 1 | `node scripts/db-migration-export.js` | 1 min | ✅ Done |
| 2 | Add routes & deploy | 5-10 min | ⏳ Next |
| 3 | Generate token | < 1 min | ⏳ Next |
| 4 | Set env variable | < 1 min | ⏳ Next |
| 5 | `node scripts/db-migration-import.js` | 2-5 min | ⏳ Next |
| 6 | `node scripts/db-migration-validate.js` | 1 min | ⏳ Final |

**Total Time**: ~20 minutes

---

## Next Action

**STEP 2 → STEP 6** (in order):

```bash
# After adding migration routes and deploying backend:
export MIGRATION_IMPORT_TOKEN=<your-secure-token>
export VITE_API_URL=https://gito-sports.onrender.com
node scripts/db-migration-import.js && node scripts/db-migration-validate.js
```

---

## Quick Reference URLs

- Backend routes: `https://gito-sports.onrender.com/api/admin/migration/`
- Status check: `https://gito-sports.onrender.com/api/admin/migration/status`
- Count check: `https://gito-sports.onrender.com/api/admin/migration/count/{table}`

---

## Help

- **Detailed steps**: See [db-migration-guide.md](./db-migration-guide.md)
- **Quick start**: See [MIGRATION_QUICKSTART.md](./MIGRATION_QUICKSTART.md)  
- **Status**: See [MIGRATION_STATUS_REPORT.md](./MIGRATION_STATUS_REPORT.md)
- **Commands**: See [MIGRATION_COMMANDS.md](./MIGRATION_COMMANDS.md) (this file)
