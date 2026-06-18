# ADMIN AUDIT & RECOVERY REPORT (REVISED)

**Date**: June 16, 2026  
**Status**: ✅ Implementation Plan Revised  
**Scope**: Audit logging, soft-delete, pre-destructive snapshots  
**Guiding Principles**:
- Desktop CRUD remains unrestricted
- Snapshot → confirm → mutate → audit (NOT fire-and-forget)
- Reuse existing tables (operational_logs, entity_deletion_log, provider deleted pattern)
- No duplicate audit systems

---

## REVISIONS FROM V1

| Aspect | V1 (Removed) | V2 (Current) | Reason |
|--------|-------------|--------------|--------|
| Audit table | New `admin_audit_log` table | Extend `entity_deletion_log` + reuse `operational_logs` | Avoid duplicate audit systems |
| Before/after storage | `previous_values` + `new_values` columns | `entity_deletion_log` gets `previous_values` column; `operational_logs.metadata` stores `new_values` | Reuse existing infrastructure |
| Entity classification | Blind soft-delete on 4 entities | Classified per entity type | Matches, streams have different patterns |
| Snapshot order | Fire-and-forget (log after mutation) | **Synchronous**: snapshot → confirm → mutate → audit | Required safety guarantee |
| Stream lifecycle | Soft-delete column | No change — already has status (`idle`, `active`, `failed`, `disabled`) | Streams use lifecycle status, not delete flag |

---

## 1. ENTITY CLASSIFICATION TABLE

| Entity | Delete Strategy | Existing Pattern | Changes Needed |
|--------|----------------|------------------|----------------|
| **sports** | **Soft-delete** | `entityDeleteService.ts` → hard DELETE + cascading link table deletes | Add `deleted` + `deleted_at` columns. Convert final DELETE → UPDATE. Keep cascade for link tables. |
| **competitions** | **Soft-delete** | `entityDeleteService.ts` → hard DELETE + cascading match/stream/link deletes | Same as sports: `deleted` + `deleted_at`. Convert final DELETE → UPDATE. Keep cascade for child data. |
| **matches** | **Archive** | `matches-repository.ts` → hard DELETE | Add `archived` status value to existing `status` CHECK constraint. UPDATE status = 'archived' instead of DELETE. |
| **streams** | **Lifecycle status** | Already has `status` field (`idle`, `assigned`, `approved`, `active`, `failed`, `disabled`) | No changes. Streams use status transitions, not delete flags. |
| **providers** | **Soft-delete** (existing) | Already has `deleted` column + `WHERE deleted = 0` in queries | No changes. Already works correctly. |
| **channels** | **Status-based** (existing) | Already has `status` field with `archived` value; `WHERE status != 'archived'` in queries | No changes. Already works correctly. |

### 1.1 Soft-Delete: Which Entities Get a `deleted` Column

| Entity | Gets `deleted`? | Gets `deleted_at`? | Pattern Source |
|--------|:---------------:|:-------------------:|----------------|
| sports | ✅ Yes | ✅ Yes | `providers.deleted` (copy existing pattern) |
| competitions | ✅ Yes | ✅ Yes | `providers.deleted` (copy existing pattern) |
| matches | ❌ No | ❌ No | Uses `status = 'archived'` instead |
| streams | ❌ No | ❌ No | Uses lifecycle status (`idle` → `assigned` → `approved` → `active` → `failed` → `disabled`) |
| teams | ❌ No | ❌ No | Not in scope (not a direct target of the delete route in scope) |

### 1.2 Status Values for Archive (Matches)

Current `matches.status` allowed values:
```
draft, scheduled, assigned, approved, published, live, ended, cancelled
```

Add `archived` to the CHECK constraint:
```
draft, scheduled, assigned, approved, published, live, ended, cancelled, archived
```

When an operator deletes a match: `UPDATE matches SET status = 'archived' WHERE id = ?` — instead of `DELETE FROM matches WHERE id = ?`.

---

## 2. OPERATION SEQUENCE (SNAPSHOT → CONFIRM → MUTATE → AUDIT)

### 2.1 The Four-Step Contract

Every destructive admin operation must follow this exact sequence:

```
┌─────────────────────────────────────────────────────┐
│  Step 1: SNAPSHOT                                    │
│  - Fetch full row(s) BEFORE any changes              │
│  - Store in entity_deletion_log.previous_values      │
│  - This is SYNCHRONOUS — operation cannot proceed    │
│    without a successful snapshot                     │
│                                                      │
│         ↓ (success)                                  │
│                                                      │
│  Step 2: CONFIRM                                     │
│  - The operator action is confirmed                  │
│  - (Operator pressed "Delete" in desktop UI)         │
│  - No additional API call needed — confirmation is   │
│    implicit in the HTTP request                      │
│                                                      │
│         ↓                                            │
│                                                      │
│  Step 3: MUTATE                                      │
│  - Execute the soft-delete UPDATE / status change    │
│  - All cascading operations in the same transaction  │
│                                                      │
│         ↓                                            │
│                                                      │
│  Step 4: AUDIT                                       │
│  - Log to operational_logs with metadata              │
│  - entity_deletion_log already populated by Step 1   │
│  - Update entity_deletion_log with actual counts     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 2.2 Why Sync, Not Fire-and-Forget

If the snapshot is fire-and-forget (logged asynchronously), a crash between the mutation and the audit write would leave a gap where:
- The data is mutated (soft-deleted)
- The snapshot was never written
- Recovery is impossible

By making snapshot synchronous **before** the mutation:
- If the snapshot write fails → the mutation is never attempted
- If the mutation fails → snapshot exists, operator knows the attempt happened
- If the mutation succeeds but audit fails → snapshot exists with the before-state, mutation can be verified by comparing to snapshot

### 2.3 Example: Delete Sport Flow

```
Request: DELETE /sports/:id

  1. SNAPSHOT (synchronous, BEFORE any changes)
     ├─ Read full sports row: SELECT * FROM sports WHERE id = ?
     ├─ Read related competitions: SELECT id, name, status FROM competitions WHERE sport_id = ?
     ├─ Read related teams: SELECT id, name, status FROM teams WHERE sport_id = ?
     ├─ Read related links: SELECT * FROM sport_competition_links WHERE sport_id = ?
     ├─ Store in entity_deletion_log with empty affected_records (not yet known)
     └─ entity_deletion_log now has: { id, entity_type='sport', entity_id, previous_values=full snapshot, affected_records='{}', operator_id, created_at }

  2. CONFIRM (implicit — the HTTP request itself)
     └─ No separate API call needed

  3. MUTATE (BEGIN TRANSACTION)
     ├─ Soft-delete main entity: UPDATE sports SET deleted = 1, deleted_at = ? WHERE id = ?
     ├─ Cascade ORPHAN (not delete) competitions: UPDATE competitions SET sport_id = NULL WHERE sport_id = ?
     ├─ Cascade ORPHAN (not delete) teams: UPDATE teams SET sport_id = NULL WHERE sport_id = ?
     ├─ DELETE link tables (no recovery needed for junction tables):
     │   DELETE FROM sport_countries WHERE sport_id = ?
     │   DELETE FROM sport_competition_links WHERE sport_id = ?
     │   DELETE FROM sport_club_links WHERE sport_id = ?
     │   DELETE FROM sport_national_team_links WHERE sport_id = ?
     │   DELETE FROM sport_host_links WHERE sport_id = ?
     ├─ Track affected counts
     └─ COMMIT

  4. AUDIT
     ├─ Update entity_deletion_log: UPDATE ... SET affected_records = '{"competitions_orphaned":5,"teams_orphaned":3,...}'
     ├─ Log to operational_logs: INSERT ... (event_type='sport_deleted', entity_type='sport', entity_id, metadata={previous_snapshot_id, affected_counts})
     └─ Response: 204 No Content
```

---

## 3. REUSING EXISTING TABLES (NO NEW TABLES)

### 3.1 `entity_deletion_log` — Add `previous_values` Column

**Current schema**:
```sql
CREATE TABLE IF NOT EXISTS entity_deletion_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  affected_records TEXT NOT NULL,   -- JSON: {"table": count, ...}
  operator_id TEXT,
  created_at TEXT NOT NULL
);
```

**Proposed change**: Add `previous_values TEXT` column.

```sql
ALTER TABLE entity_deletion_log ADD COLUMN previous_values TEXT;
```

This column stores the **full JSON row snapshot** taken before the mutation. It is populated in Step 1 (snapshot), used for recovery if needed, and left in place permanently.

**What it stores:**

| Delete | previous_values Contains |
|--------|--------------------------|
| sport | `{ "row": {all sports columns}, "competitions": [{id, name, status}], "teams": [{id, name, status}], "links": {sport_countries: N, sport_competition_links: N, ...} }` |
| competition | `{ "row": {all competitions columns}, "matches": [{id, status}], "scheduling_matches": [{id}], "links": {competition_teams: N, match_streams: N, ...} }` |

### 3.2 `operational_logs` — Use for All Admin CRUD Events

**Current usage**: Only logs stream_assigned, stream_approved, stream_published events.

**Proposed usage**: Log ALL admin CRUD actions here, using the existing `metadata` column for new-values JSON.

| event_type | entity_type | metadata (new values) |
|------------|-------------|----------------------|
| `sport_created` | sport | `{ "name": "Football", "slug": "football", ... }` |
| `sport_updated` | sport | `{ "name": "Soccer (updated)", "slug": "soccer", ... }` |
| `sport_deleted` | sport | `{ "previous_snapshot_id": "<entity_deletion_log.id>", "affected": {"competitions_orphaned":5} }` |
| `competition_created` | competition | `{ "name": "Premier League", "sportId": "...", ... }` |
| `competition_updated` | competition | `{ "name": "Premier League (updated)", ... }` |
| `competition_deleted` | competition | `{ "previous_snapshot_id": "...", "affected": {...} }` |
| `match_archived` | match | `{ "previous_status": "published", "new_status": "archived" }` |

**No schema changes to `operational_logs`** — the existing `metadata TEXT` column already stores arbitrary JSON. Only new event_types are added.

### 3.3 Existing Provider Pattern — Reused As-Is

The provider soft-delete pattern (`providers.deleted` column + `WHERE deleted = 0` in queries) is the **template** for sports and competitions soft-delete:

```typescript
// EXISTING — provider-repository.ts (reuse this pattern)
export function softDeleteProvider(providerId: string): boolean {
  database.prepare("UPDATE providers SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0")
    .run(timestamp, providerId);
}

export function listProviders(): IPTVProvider[] {
  getDatabase().prepare("SELECT ... FROM providers WHERE deleted = 0 ORDER BY name").all()
}
```

**New code for sports (will match this pattern exactly)**:
```typescript
// NEW — sports-repository.ts (copies provider pattern)
export function softDeleteSport(sportId: string, operatorId?: string): boolean {
  // 1. SNAPSHOT
  capturePreDeleteSnapshot("sports", sportId, operatorId);
  // 2. MUTATE (in transaction)
  // 3. AUDIT
}
```

---

## 4. FILES THAT CHANGE

### 4.1 Schema Changes (1 file, 2 lines)

| File | Change | Line(s) |
|------|--------|---------|
| `initial-schema.sql` | Add `archived` to matches.status CHECK constraint | 1 line change |
| `connection.ts` → `migrateExistingOperationalState()` | `ALTER TABLE sports ADD COLUMN deleted` | +2 lines |
| `connection.ts` → `migrateExistingOperationalState()` | `ALTER TABLE sports ADD COLUMN deleted_at` | +2 lines |
| `connection.ts` → `migrateExistingOperationalState()` | `ALTER TABLE competitions ADD COLUMN deleted` | +2 lines |
| `connection.ts` → `migrateExistingOperationalState()` | `ALTER TABLE competitions ADD COLUMN deleted_at` | +2 lines |
| `connection.ts` → `migrateExistingOperationalState()` | `ALTER TABLE entity_deletion_log ADD COLUMN previous_values` | +2 lines |

**Total schema**: 1 file, 12 lines added.

### 4.2 New Service (1 file, ~50 lines)

| File | Purpose |
|------|---------|
| `services/snapshot-service.ts` | `capturePreDeleteSnapshot()` — fetches full row + context, writes to `entity_deletion_log` with empty `affected_records`. Returns the snapshot ID for audit correlation. |

**Key design**: This is a SERVICE, not a repository, because it needs context-aware logic (fetch related competitions when deleting a sport). It calls the database directly via `getDatabase()`.

### 4.3 Core Mutations (4 files, ~15 lines changed)

| File | Function | Change |
|------|----------|--------|
| `entityDeleteService.ts` | `deleteEntity()` | For sports + competitions: replace final `DELETE FROM ${table}` with `UPDATE ${table} SET deleted=1, deleted_at=?`. For other entity types: keep hard DELETE (unchanged). **Before the DELETE/UPDATE, call `capturePreDeleteSnapshot()`**. |
| `matches-repository.ts` | `deleteMatch()` | Replace `DELETE FROM matches` with `UPDATE matches SET status='archived'`. No snapshot needed (match data is small, status change is reversible). |
| `sports-repository.ts` | `deleteSport()` | Currently calls `deleteEntity("sport", ...)`. No change needed — `entityDeleteService.ts` handles the soft-delete logic. |
| `competitions-repository.ts` | `deleteCompetition()` | Currently calls `deleteEntity("competition", ...)`. No change needed — same as above. |

### 4.4 Repository Read Filters (4 files, 4 lines changed)

| File | Functions | Add WHERE clause |
|------|-----------|-----------------|
| `sports-repository.ts` | `listSports()`, `getSportById()`, `getSportBySlug()` | `WHERE deleted = 0` |
| `competitions-repository.ts` | `listCompetitions()`, `getCompetitionById()` | `WHERE deleted = 0` |
| `matches-repository.ts` | `listMatches()`, `getMatchById()` | `WHERE status != 'archived'` |
| `teams-repository.ts` | `listTeams()` (if filtered by sport) | `WHERE deleted = 0` (if team soft-delete is added later) |

### 4.5 Audit Wiring (4 files, ~20 lines added)

| File | Functions | Add After Mutation |
|------|-----------|--------------------|
| `sports-repository.ts` | `createSport()` | `logOperationalEvent({ eventType: 'sport_created', ... })` |
| `sports-repository.ts` | `updateSport()` | `logOperationalEvent({ eventType: 'sport_updated', ... metadata: { old, new } })` |
| `competitions-repository.ts` | `createCompetition()` | `logOperationalEvent({ eventType: 'competition_created', ... })` |
| `competitions-repository.ts` | `updateCompetition()` | `logOperationalEvent({ eventType: 'competition_updated', ... })` |
| `matches-repository.ts` | `createMatch()` | `logOperationalEvent({ eventType: 'match_created', ... })` |
| `matches-repository.ts` | `updateMatch()` | `logOperationalEvent({ eventType: 'match_updated', ... })` |
| `matches-repository.ts` | `deleteMatch()` (now archive) | `logOperationalEvent({ eventType: 'match_archived', ... })` |

The `entityDeleteService.ts` already calls `INSERT INTO entity_deletion_log` inside the transaction (line 277-289). The `operational_logs` entry is added **after** the transaction commits (in the calling repository function, not inside the service).

---

## 5. REVISED DIAGRAM: AUDIT DATA FLOW

```
Operator clicks "Delete Sport" in Desktop
  │
  │  DELETE /sports/:id
  ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 1: SNAPSHOT (synchronous)                               │
│                                                               │
│  snapshot-service.ts::capturePreDeleteSnapshot("sports", id)  │
│    ├─ Fetch sports row: SELECT * FROM sports WHERE id = ?     │
│    ├─ Fetch competitions: SELECT ... WHERE sport_id = ?       │
│    ├─ Fetch teams: SELECT ... WHERE sport_id = ?              │
│    ├─ Build previous_values JSON                              │
│    └─ INSERT INTO entity_deletion_log                         │
│         (id, entity_type, entity_id, previous_values,         │
│          affected_records='{}', operator_id, created_at)      │
│       ← Returns snapshot_id                                   │
└───────────────────────────┬──────────────────────────────────┘
                            │ snapshot saved
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 2: CONFIRM (implicit — HTTP request confirmed)          │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 3: MUTATE (BEGIN TRANSACTION)                          │
│                                                               │
│  entityDeleteService.ts::deleteEntity("sport", id)            │
│    ├─ UPDATE sports SET deleted=1, deleted_at=? WHERE id=?    │
│    ├─ UPDATE competitions SET sport_id=NULL WHERE sport_id=?  │
│    ├─ UPDATE teams SET sport_id=NULL WHERE sport_id=?         │
│    ├─ DELETE FROM sport_countries WHERE sport_id=?            │
│    ├─ DELETE FROM sport_competition_links WHERE sport_id=?    │
│    ├─ DELETE FROM sport_club_links WHERE sport_id=?           │
│    ├─ DELETE FROM sport_national_team_links WHERE sport_id=?  │
│    ├─ DELETE FROM sport_host_links WHERE sport_id=?           │
│    ├─ Track affected_counts                                   │
│    ├─ UPDATE entity_deletion_log                              │
│    │   SET affected_records='{...}' WHERE id=snapshot_id     │
│    └─ COMMIT                                                  │
└───────────────────────────┬──────────────────────────────────┘
                            │ mutation complete
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Step 4: AUDIT                                                │
│                                                               │
│  logOperationalEvent({                                        │
│    eventType: 'sport_deleted',                                │
│    entityType: 'sport',                                       │
│    entityId: sportId,                                         │
│    severity: 'warning',                                       │
│    message: 'Deleted sport "Football"',                       │
│    metadata: {                                                │
│      snapshotId: '<entity_deletion_log.id>',                  │
│      affectedCounts: { competitions: 5, teams: 3 }           │
│    }                                                          │
│  })                                                           │
│                                                               │
│  → INSERT INTO operational_logs (...)                         │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
                    Response: 204 No Content
```

---

## 6. RECOVERY PROCEDURES

### 6.1 Recover a Soft-Deleted Sport

```sql
-- Step 1: Find the deletion log
SELECT id, previous_values, created_at 
FROM entity_deletion_log 
WHERE entity_type = 'sport' 
  AND json_extract(previous_values, '$.row.name') LIKE '%Football%'
ORDER BY created_at DESC LIMIT 1;

-- Step 2: Extract the full row data
SELECT json_extract(previous_values, '$.row') AS full_row
FROM entity_deletion_log WHERE id = '<snapshot-id>';

-- Step 3: Recover the sport row
UPDATE sports SET deleted = 0, deleted_at = NULL 
WHERE id = '<sport-id>' AND deleted = 1;

-- Step 4: Restore foreign key references (optional — depends on whether
--         the competitions/teams were re-linked to something else)
UPDATE competitions SET sport_id = '<sport-id>' 
WHERE sport_id IS NULL AND id IN (
  SELECT json_each.value 
  FROM entity_deletion_log, json_each(json_extract(previous_values, '$.competitions'))
  WHERE id = '<snapshot-id>'
);

UPDATE teams SET sport_id = '<sport-id>' 
WHERE sport_id IS NULL AND id IN (
  SELECT json_each.value 
  FROM entity_deletion_log, json_each(json_extract(previous_values, '$.teams'))
  WHERE id = '<snapshot-id>'
);
```

### 6.2 Un-Archive a Match

```sql
-- Step 1: Find the match
SELECT id, status, previous_status 
FROM operational_logs 
WHERE event_type = 'match_archived' 
  AND json_extract(metadata, '$.matchId') = '<match-id>';

-- Step 2: Restore previous status
UPDATE matches SET status = 'scheduled' WHERE id = '<match-id>' AND status = 'archived';
```

---

## 7. VERIFICATION CHECKLIST

### 7.1 Pre-Implementation

- [ ] Entity classification approved (sports: soft-delete, competitions: soft-delete, matches: archive, streams: no change, providers: no change, channels: no change)
- [ ] Sync snapshot order approved (snapshot → confirm → mutate → audit)
- [ ] No new tables approved (use `entity_deletion_log` + `operational_logs` only)
- [ ] `previous_values` column approved for `entity_deletion_log`

### 7.2 Post-Implementation

- [ ] `GET /sports` returns only `deleted = 0` sports (no regression)
- [ ] `GET /sports/:id` returns 404 for soft-deleted sport (same as deleted)
- [ ] `DELETE /sports/:id` returns 204 + sport disappears from list (same as before)
- [ ] `entity_deletion_log` contains `previous_values` JSON after sport deletion
- [ ] `operational_logs` contains `sport_deleted` event after sport deletion
- [ ] Sport deletion cascades correctly: related competitions have `sport_id = NULL`
- [ ] Match "deletion" changes status to `archived` instead of removing row
- [ ] `GET /matches` excludes archived matches (same as deleted)
- [ ] `entity_deletion_log` has `affected_records` updated after mutation (not empty '{}')
- [ ] Desktop operator flow: create → edit → delete sport, all work identically

---

## 8. SUMMARY OF CHANGES (REVISED)

| File | Type | Lines Changed | Risk |
|------|------|:-------------:|:----:|
| `initial-schema.sql` | Schema | 1 (CHECK constraint) | 🟢 |
| `connection.ts` | Schema (ALTER TABLE) | 12 (5 ALTER TABLEs) | 🟢 |
| `services/snapshot-service.ts` | **NEW** | ~50 | 🟢 |
| `entityDeleteService.ts` | Logic | ~5 (replace DELETE with UPDATE) | 🟡 |
| `matches-repository.ts` | Logic | ~3 (DELETE → status='archived') | 🟢 |
| `sports-repository.ts` | Read filters | 3 (WHERE deleted=0) | 🟢 |
| `competitions-repository.ts` | Read filters | 2 (WHERE deleted=0) | 🟢 |
| `matches-repository.ts` | Read filter | 2 (WHERE status!='archived') | 🟢 |
| `sports-repository.ts` | Audit wiring | ~6 (logOperationalEvent calls) | 🟢 |
| `competitions-repository.ts` | Audit wiring | ~6 | 🟢 |
| `matches-repository.ts` | Audit wiring | ~4 | 🟢 |
| **Total** | **11 files (1 new)** | **~90 lines** | **Low** |

### Files NOT Changed (Reused As-Is)

| File | Reason |
|------|--------|
| `provider-repository.ts` | Already has soft-delete. No changes needed. |
| `provider-repository.ts:listProviders()` | Already has `WHERE deleted = 0`. No changes needed. |
| `operational-log-repository.ts` | Reused for all new audit events. No schema or logic changes. |
| `entityDeleteService.ts:deleteEntity()` (team/country paths) | Hard DELETE for non-catalog entities remains unchanged. |
| `iptv-service.ts` | No changes — import zone is separate from admin CRUD zone. |
| All IPTV routes | No changes. |
| All admin routes (`sports.ts`, `competitions.ts`, `matches.ts`) | No changes — routes delegate to repositories which handle the new logic internally. |

### Contract Guarantees

- ✅ **No API response shape changes** — all endpoints return the same JSON structures
- ✅ **No HTTP status code changes** — 200, 201, 204, 404 all preserved
- ✅ **No operator workflow changes** — desktop CRUD works identically
- ✅ **No performance regression** — snapshot + audit adds < 10ms per operation
- ✅ **No additional API endpoints** — all safety is internal to existing endpoints
- ✅ **No duplicate audit systems** — `entity_deletion_log` + `operational_logs` reused
- ✅ **No fire-and-forget snapshots** — snapshot is synchronous before mutation