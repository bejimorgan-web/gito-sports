# ADMIN AUDIT & RECOVERY — IMPLEMENTATION PLAN

**Date**: June 16, 2026  
**Status**: ✅ Plan Ready for Execution  
**Total Effort**: ~90 lines across 11 files (1 new file)  
**Risk**: Low. No API contracts change. No operator workflow changes.

---

## PREREQUISITE: ENTITY CLASSIFICATION

Before writing code, confirm this classification is correct:

| Entity | Strategy | What Changes |
|--------|----------|-------------|
| **sports** | Soft-delete | Add `deleted` + `deleted_at` columns. Final DELETE becomes UPDATE. |
| **competitions** | Soft-delete | Add `deleted` + `deleted_at` columns. Final DELETE becomes UPDATE. |
| **matches** | Archive | Add `archived` to status CHECK. DELETE becomes `UPDATE status='archived'`. |
| **streams** | No change | Already has lifecycle status (`idle`→`active`→`failed`→`disabled`). |
| **providers** | No change | Already has `deleted` column + `WHERE deleted = 0`. |
| **channels** | No change | Already has `status='archived'` + `WHERE status != 'archived'`. |

---

## STEP 1: ALTER SCHEMA (connection.ts)

Add to `migrateExistingOperationalState()`. All are idempotent (guard with `hasColumn()` check).

**5 ALTER TABLE statements** in this order:

```
1. ALTER TABLE entity_deletion_log ADD COLUMN previous_values TEXT;
2. ALTER TABLE sports ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
3. ALTER TABLE sports ADD COLUMN deleted_at TEXT;
4. ALTER TABLE competitions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
5. ALTER TABLE competitions ADD COLUMN deleted_at TEXT;
```

Also update `initial-schema.sql`:
- Add `'archived'` to the `matches.status` CHECK constraint (currently allows: `draft, scheduled, assigned, approved, published, live, ended, cancelled`)

---

## STEP 2: CREATE SNAPSHOT SERVICE (NEW FILE)

**File**: `apps/backend/src/services/snapshot-service.ts`

**Purpose**: A single function `capturePreDeleteSnapshot()` that:
1. Reads the full entity row (`SELECT * FROM table WHERE id = ?`)
2. Reads related child records (competitions linked to a sport, matches linked to a competition)
3. Writes to `entity_deletion_log` with:
   - `previous_values` = full JSON of entity row + related records
   - `affected_records` = `'{}'` (empty — will be updated by the mutation step)
   - `operator_id` (passed in)
4. Returns the `entity_deletion_log.id` (snapshot_id) for audit correlation

**Signature**:
```typescript
export function capturePreDeleteSnapshot(
  tableName: 'sports' | 'competitions',
  recordId: string,
  operatorId?: string
): string  // returns snapshot_id
```

**Per-entity behavior**:

| tableName | Read entity | Read related | Save as |
|-----------|-------------|--------------|---------|
| `sports` | `SELECT * FROM sports WHERE id = ?` | competitions, teams with this sport_id | `{ row: {...}, competitions: [...], teams: [...], linkTableCounts: {...} }` |
| `competitions` | `SELECT * FROM competitions WHERE id = ?` | matches, scheduling_matches with this competition_id | `{ row: {...}, matches: [...], scheduling_matches: [...] }` |

---

## STEP 3: MODIFY ENTITY DELETE SERVICE (entityDeleteService.ts)

**File**: `apps/backend/src/services/entityDeleteService.ts`

**Change**: In `deleteEntity()`, before the `DELETE FROM ${tableByEntity[entityType]} WHERE id = ?` step:

For `entityType = 'sport'` or `entityType = 'competition'`:
1. **Before the transaction**: Call `capturePreDeleteSnapshot(tableName, entityId, operatorId)` → get snapshot_id
2. **Inside the transaction**: Replace the final `DELETE FROM ${table} WHERE id = ?` with:
   ```sql
   UPDATE ${table} SET deleted = 1, deleted_at = ? WHERE id = ?
   ```
3. **Inside the transaction**: Update the `entity_deletion_log` row with actual affected_record counts:
   ```sql
   UPDATE entity_deletion_log SET affected_records = ? WHERE id = ?
   ```
4. **After the transaction**: Add logging to `operational_logs`

For other entity types (`'country'`, `'team'`): Keep existing hard DELETE unchanged.

**Important**: The cascading logic (setting foreign keys to NULL, deleting link tables) stays the same. Only the final `DELETE` changes to `UPDATE`.

**Before** (current, line 271-273):
```typescript
const deletionResult = database
  .prepare(`DELETE FROM ${tableByEntity[entityType]} WHERE id = ?`)
  .run(entityId);
```

**After**:
```typescript
if (entityType === 'sport' || entityType === 'competition') {
  const deletionResult = database
    .prepare(`UPDATE ${tableByEntity[entityType]} SET deleted = 1, deleted_at = ? WHERE id = ?`)
    .run(now(), entityId);
} else {
  const deletionResult = database
    .prepare(`DELETE FROM ${tableByEntity[entityType]} WHERE id = ?`)
    .run(entityId);
}
```

---

## STEP 4: MODIFY MATCHES REPOSITORY (matches-repository.ts)

**File**: `apps/backend/src/repositories/matches-repository.ts`

**Change**: Replace the hard DELETE with a status update.

Before:
```typescript
export function deleteMatch(matchId: string): boolean {
  const result = database.prepare("DELETE FROM matches WHERE id = ?").run(matchId);
  return result.changes > 0;
}
```

After:
```typescript
export function deleteMatch(matchId: string): boolean {
  const timestamp = now();
  const match = database.prepare("SELECT status FROM matches WHERE id = ?").get(matchId) as { status: string } | undefined;
  if (!match) return false;
  
  database.prepare("UPDATE matches SET status = 'archived', updated_at = ? WHERE id = ?").run(timestamp, matchId);
  
  logOperationalEvent({
    eventType: 'match_archived',
    entityType: 'match',
    entityId: matchId,
    severity: 'warning',
    message: `Match archived (was '${match.status}')`,
    metadata: { previousStatus: match.status }
  });
  
  return true;
}
```

---

## STEP 5: ADD READ FILTERS (4 repository files)

Add `WHERE deleted = 0` to existing SELECT queries.

| File | Functions to modify |
|------|---------------------|
| `sports-repository.ts` | `listSports()`: add `WHERE deleted = 0` before `ORDER BY name` |
| `sports-repository.ts` | `getSportById()`: add `AND deleted = 0` to existing `WHERE id = ?` |
| `sports-repository.ts` | `getSportBySlug()`: add `AND deleted = 0` to existing `WHERE slug = ?` |
| `competitions-repository.ts` | `listCompetitions()`: add `AND deleted = 0` to WHERE clause |
| `competitions-repository.ts` | `getCompetitionById()`: add `AND deleted = 0` to `WHERE id = ?` |
| `matches-repository.ts` | `listMatches()`: add `WHERE status != 'archived'` (if no WHERE exists) |
| `matches-repository.ts` | `getMatchById()`: add `AND status != 'archived'` |

**Pattern to follow** (from provider-repository.ts):
```typescript
// EXISTING — copy this
export function listProviders(): IPTVProvider[] {
  const rows = getDatabase()
    .prepare("SELECT ... FROM providers WHERE deleted = 0 ORDER BY name")
    .all() as ProviderRow[];
  return rows.map(mapProvider);
}
```

---

## STEP 6: ADD AUDIT LOGGING (3 repository files)

Import `logOperationalEvent` from `operational-log-repository` (already available, used in operations-repository.ts).

**Add these calls in the repository functions, AFTER the mutation succeeds**:

| Repository | Function | Event to Log |
|------------|----------|--------------|
| `sports-repository.ts` | `createSport()` | `eventType: 'sport_created'`, metadata: row values |
| `sports-repository.ts` | `updateSport()` | `eventType: 'sport_updated'`, metadata: `{ previousName, newName, ... }` |
| `competitions-repository.ts` | `createCompetition()` | `eventType: 'competition_created'`, metadata: row values |
| `competitions-repository.ts` | `updateCompetition()` | `eventType: 'competition_updated'`, metadata: changed values |
| `matches-repository.ts` | `createMatch()` | `eventType: 'match_created'`, metadata: row values |
| `matches-repository.ts` | `updateMatch()` | `eventType: 'match_updated'`, metadata: changed values |

For deletions: the `entityDeleteService.ts` already logs to `entity_deletion_log`. After the transaction commits, add:
```typescript
logOperationalEvent({
  eventType: 'sport_deleted',
  entityType: 'sport',
  entityId: sportId,
  severity: 'warning',
  message: `Deleted sport '${name}'`,
  metadata: { snapshotId, affectedCompetitions: N, affectedTeams: N }
});
```

---

## EXECUTION ORDER

| Order | Step | File(s) | Lines | Risk | Approx Time |
|:-----:|------|---------|:-----:|:----:|:-----------:|
| 1 | Schema ALTER TABLEs | `connection.ts` | 12 | 🟢 | 10 min |
| 2 | Schema CHECK constraint | `initial-schema.sql` | 1 | 🟢 | 2 min |
| 3 | New snapshot service | `services/snapshot-service.ts` | ~50 | 🟢 | 20 min |
| 4 | Modify entityDeleteService | `entityDeleteService.ts` | ~5 | 🟡 | 15 min |
| 5 | Convert match DELETE to archive | `matches-repository.ts` | ~3 | 🟢 | 10 min |
| 6 | Add read filters | `sports-repository.ts`, `competitions-repository.ts`, `matches-repository.ts` | 8 | 🟢 | 15 min |
| 7 | Add audit log calls | `sports-repository.ts`, `competitions-repository.ts`, `matches-repository.ts` | ~16 | 🟢 | 20 min |
| | **Total** | **11 files (1 new)** | **~90** | **Low** | **~90 min** |

---

## VERIFICATION COMMANDS

After implementation, verify with:

```bash
# 1. Sports still listable
curl http://localhost:4100/sports | python -c "import sys,json; d=json.load(sys.stdin); print(f'Sports: {len(d[\"data\"])}')"

# 2. Delete a sport, verify it disappears from list
SPORT_ID=$(curl -s http://localhost:4100/sports | python -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")
curl -s -X DELETE "http://localhost:4100/sports/$SPORT_ID" -w "\nHTTP %{http_code}\n"

# 3. Verify operational_logs has the deletion event
curl -s "http://localhost:4100/operations/logs?limit=5" | python -m json.tool

# 4. Verify entity_deletion_log has previous_values
sqlite3 data/gito.sqlite "SELECT entity_type, entity_id, length(previous_values) as snapshot_size FROM entity_deletion_log ORDER BY created_at DESC LIMIT 5;"

# 5. Verify the sport is still in the database (soft-deleted)
sqlite3 data/gito.sqlite "SELECT id, name, deleted, deleted_at FROM sports WHERE deleted = 1 LIMIT 5;"
```

---

## ROLLBACK

If any step causes issues:

```bash
# Revert code changes
git checkout HEAD -- apps/backend/src/services/entityDeleteService.ts
git checkout HEAD -- apps/backend/src/repositories/matches-repository.ts
git checkout HEAD -- apps/backend/src/repositories/sports-repository.ts
git checkout HEAD -- apps/backend/src/repositories/competitions-repository.ts

# Remove new file
rm apps/backend/src/services/snapshot-service.ts

# Restart backend
npm run dev:backend
```

Schema changes (ALTER TABLE ADD COLUMN) are not reversible without dropping tables — but they are additive and cannot break existing queries. The `deleted` column defaults to `0`, which means all existing rows appear as non-deleted.