# RESTORE WORKFLOW & VALIDATION REPORT

**Date**: June 16, 2026  
**Status**: ✅ Final Design Complete  
**Scope**: Archive/restore, state preservation, relationship validation, full-chain testing, desktop recovery UI, detailed restore responses  
**Prerequisite**: Must be read after `ADMIN_AUDIT_RECOVERY_IMPLEMENTATION_PLAN.md`

---

## 1. ENTITY ARCHIVE/RESTORE DESIGN

### 1.1 Current State

| Entity | Delete Strategy | Status Model | Archive Exists? | Restore Exists? |
|--------|----------------|--------------|:---------------:|:----------------:|
| **sports** | Hard DELETE via `entityDeleteService.ts` | `EntityStatus` = `active \| inactive \| archived` | ✅ Status `archived` exists in type system | ❌ No endpoint to restore |
| **competitions** | Hard DELETE via `entityDeleteService.ts` | `EntityStatus` = `active \| inactive \| archived` | ✅ Status `archived` exists in type system | ❌ No endpoint to restore |
| **matches** (scheduling_matches) | Hard DELETE via `matches-repository.ts` | `MatchLifecycleStatus` = `draft \| scheduled \| assigned \| approved \| published \| live \| ended \| cancelled` | ❌ No `archived` status | ❌ No endpoint to restore |

### 1.2 Proposed Archive/Restore Routes

| Entity | Archive | Restore | List Archived |
|--------|---------|---------|---------------|
| **sports** | `DELETE /sports/:id` → soft-delete (deleted=1) | `POST /sports/:id/restore` → restore with recovery report | `GET /sports?includeArchived=true` |
| **competitions** | `DELETE /competitions/:id` → soft-delete (deleted=1) | `POST /competitions/:id/restore` → restore with recovery report | `GET /competitions?includeArchived=true` |
| **matches** | `DELETE /matches/:id` → archive (status='archived') | `POST /matches/:id/restore` → restore with recovery report | `GET /matches?includeArchived=true` |

**Key design decision**: `DELETE` continues to return `204 No Content`. The change is internal — DELETE now archives instead of hard-deleting. Operators see no difference.

---

## 2. RESTORE RESPONSE SHAPES (STANDARDIZED)

All three restore endpoints (`POST /sports/:id/restore`, `POST /competitions/:id/restore`, `POST /matches/:id/restore`) return exactly **three** possible response shapes.

### 2.1 Shape 1: Success (HTTP 200)

The main entity was restored. Related records may have been partially skipped.

```json
{
  "success": true,
  "restored": {
    "sport": true,
    "competitions": 3
  },
  "warnings": [
    "2 competitions were not restored because they are linked to other sports"
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` |
| `restored` | object | Keys are entity types, values are `true` (main entity) or number (related records relinked) |
| `warnings` | string[] | Explanations for skipped records. Empty array if everything was fully restored. |

**The main entity is always restored.** `success` is `true` even when some related records were skipped — the operator can see what was skipped and make manual decisions.

### 2.2 Shape 2: Not Found (HTTP 404)

The entity does not exist, or exists but is not in an archived/soft-deleted state (nothing to restore).

```json
{
  "success": false,
  "error": "not_found",
  "warnings": [
    "Sport 'football-id' was not found or is not archived."
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `false` |
| `error` | string | Always `"not_found"` |
| `warnings` | string[] | Human-readable explanation. |

**When this is returned:**

| Scenario | API | Reason |
|----------|-----|--------|
| Entity UUID does not exist in any table | All | Never created |
| Entity exists but is NOT archived (active) | `POST /sports/:id/restore` | `deleted = 0` — nothing to restore |
| Entity exists but is NOT archived (active) | `POST /matches/:id/restore` | `status != 'archived'` — nothing to restore |
| Entity exists but is NOT archived (soft-deleted) | `POST /matches/:id/restore` | Matches use `status='archived'` not `deleted=1` — mismatch of strategies |

### 2.3 Shape 3: Restore Conflict (HTTP 409)

The entity exists but cannot be restored due to a conflict that prevents the operation.

```json
{
  "success": false,
  "error": "restore_conflict",
  "warnings": [
    "Cannot restore: the sport is already active.",
    "Restore is only available for archived sports."
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `false` |
| `error` | string | Always `"restore_conflict"` |
| `warnings` | string[] | Reasons the restore could not proceed. |

**When this is returned:**

| Scenario | Conflict Reason |
|----------|-----------------|
| Entity is already active (not archived) | `"Cannot restore: the sport is already active. Restore is only available for archived sports."` |
| Entity has pre-conditions that prevent safe restore | `"Cannot restore: required snapshot data is missing from the audit log."` |
| Entity type does not support restore | `"Cannot restore: this entity type does not support restore operations."` |

### 2.4 Response Shape Decision Matrix

| Condition | HTTP Code | `success` | `error` | Desktop Action |
|-----------|:---------:|:---------:|---------|----------------|
| Entity restored successfully | **200** | `true` | absent | ✅ Show recovery report with restored counts and warnings |
| Entity not found / not archived | **404** | `false` | `"not_found"` | ❌ Show "Not found" message. Entity may have been permanently deleted. |
| Restore pre-conditions not met | **409** | `false` | `"restore_conflict"` | ⚠️ Show conflict details. Entity exists but cannot be restored. |

**Desktop should check `success` first, then `error`.** Each `error` value maps to a specific UI handling path — never show raw JSON to the operator.

### 2.5 Examples of Each Shape

```
POST /sports/existing-archived-id/restore  → 200
{
  "success": true,
  "restored": { "sport": true, "competitions": 3 },
  "warnings": ["2 competitions were not restored because they are linked to other sports"]
}

POST /sports/non-existent-id/restore  → 404
{
  "success": false,
  "error": "not_found",
  "warnings": ["Sport 'non-existent-id' was not found or is not archived."]
}

POST /sports/already-active-id/restore  → 409
{
  "success": false,
  "error": "restore_conflict",
  "warnings": ["Cannot restore: the sport is already active. Restore is only available for archived sports."]
}
```

---

## 3. RESTORE IMPLEMENTATION

### 3.1 Sport Restore

```typescript
export function restoreSport(sportId: string): RestoreResponse {
  const database = getDatabase();
  
  // Verify sport exists and is soft-deleted
  const existing = database.prepare("SELECT * FROM sports WHERE id = ?").get(sportId);
  if (!existing) {
    return {
      success: false,
      error: "not_found",
      warnings: [`Sport '${sportId}' was not found or is not archived.`]
    };
  }
  
  if (existing.deleted !== 1) {
    return {
      success: false,
      error: "restore_conflict",
      warnings: ["Cannot restore: the sport is already active. Restore is only available for archived sports."]
    };
  }
  
  const warnings: string[] = [];
  const restored: Record<string, number | boolean> = {};
  
  // Load snapshot to know which competitions/teams were originally linked
  const snapshot = database.prepare(`
    SELECT previous_values FROM entity_deletion_log 
    WHERE entity_type = 'sport' AND entity_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(sportId);
  
  let originallyLinkedCompetitionIds: string[] = [];
  let originallyLinkedTeamIds: string[] = [];
  
  if (snapshot) {
    const prev = JSON.parse(snapshot.previous_values);
    originallyLinkedCompetitionIds = (prev.competitions || []).map(c => c.id);
    originallyLinkedTeamIds = (prev.teams || []).map(t => t.id);
  } else {
    warnings.push("No snapshot found in audit log — sport restored without competition/team relinking.");
  }
  
  // Restore the sport row
  database.prepare("UPDATE sports SET deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ?")
    .run(now(), sportId);
  restored.sport = true;
  
  // Restore linked competitions — ONLY if truly orphaned
  let restoredCompetitions = 0;
  for (const compId of originallyLinkedCompetitionIds) {
    const competition = database.prepare("SELECT id, name, sport_id FROM competitions WHERE id = ?").get(compId) as any;
    
    if (!competition) {
      warnings.push(`Competition '${compId}' could not be found (may have been permanently deleted)`);
      continue;
    }
    
    if (competition.sport_id === null) {
      // Orphaned — safe to restore
      database.prepare("UPDATE competitions SET sport_id = ? WHERE id = ?").run(sportId, compId);
      restoredCompetitions++;
    } else if (competition.sport_id !== sportId) {
      // Re-linked to a different sport — NEVER overwrite
      const otherSport = database.prepare("SELECT name FROM sports WHERE id = ?").get(competition.sport_id) as any;
      const sportName = otherSport ? `'${otherSport.name}'` : 'another sport';
      warnings.push(`Competition '${competition.name}' was not restored because it is already linked to ${sportName}`);
    }
    // If sport_id already matches restored sport, nothing to do
  }
  
  if (restoredCompetitions > 0) {
    restored.competitions = restoredCompetitions;
  }
  
  // Restore linked teams — same orphan-only logic
  let restoredTeams = 0;
  for (const teamId of originallyLinkedTeamIds) {
    const team = database.prepare("SELECT id, name, sport_id FROM teams WHERE id = ?").get(teamId) as any;
    
    if (!team) continue;
    
    if (team.sport_id === null) {
      database.prepare("UPDATE teams SET sport_id = ? WHERE id = ?").run(sportId, teamId);
      restoredTeams++;
    }
  }
  
  if (restoredTeams > 0) {
    restored.teams = restoredTeams;
  }
  
  // Log
  logOperationalEvent({
    eventType: 'sport_restored',
    entityType: 'sport',
    entityId: sportId,
    severity: warnings.length > 0 ? 'warning' : 'info',
    message: `Sport '${existing.name}' restored`,
    metadata: { restored, warnings }
  });
  
  return { success: true, restored, warnings };
}
```

### 3.2 Competition Restore

```typescript
export function restoreCompetition(competitionId: string): RestoreResponse {
  const database = getDatabase();
  
  const existing = database.prepare("SELECT * FROM competitions WHERE id = ?").get(competitionId);
  if (!existing) {
    return {
      success: false,
      error: "not_found",
      warnings: [`Competition '${competitionId}' was not found or is not archived.`]
    };
  }
  
  if (existing.deleted !== 1) {
    return {
      success: false,
      error: "restore_conflict",
      warnings: ["Cannot restore: the competition is already active. Restore is only available for archived competitions."]
    };
  }
  
  const warnings: string[] = [];
  const restored: Record<string, number | boolean> = {};
  
  // Load snapshot for linked matches
  const snapshot = database.prepare(`
    SELECT previous_values FROM entity_deletion_log 
    WHERE entity_type = 'competition' AND entity_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(competitionId);
  
  let originallyLinkedMatchIds: string[] = [];
  if (snapshot) {
    const prev = JSON.parse(snapshot.previous_values);
    originallyLinkedMatchIds = (prev.matches || []).map(m => m.id);
  } else {
    warnings.push("No snapshot found in audit log — competition restored without match relinking.");
  }
  
  // Restore the competition row
  database.prepare("UPDATE competitions SET deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ?")
    .run(now(), competitionId);
  restored.competition = true;
  
  // Restore linked matches — ONLY if orphaned
  let restoredMatches = 0;
  for (const matchId of originallyLinkedMatchIds) {
    const match = database.prepare("SELECT id, status, competition_id FROM scheduling_matches WHERE id = ?").get(matchId) as any;
    
    if (!match) {
      warnings.push(`Match '${matchId}' could not be found (may have been permanently deleted)`);
      continue;
    }
    
    if (match.competition_id === null) {
      database.prepare("UPDATE scheduling_matches SET competition_id = ? WHERE id = ?").run(competitionId, matchId);
      restoredMatches++;
    } else if (match.competition_id !== competitionId) {
      const otherComp = database.prepare("SELECT name FROM competitions WHERE id = ?").get(match.competition_id) as any;
      const compName = otherComp ? `'${otherComp.name}'` : 'another competition';
      warnings.push(`Match was not restored because it is already linked to ${compName}`);
    }
  }
  
  if (restoredMatches > 0) {
    restored.matches = restoredMatches;
  }
  
  logOperationalEvent({
    eventType: 'competition_restored',
    entityType: 'competition',
    entityId: competitionId,
    severity: warnings.length > 0 ? 'warning' : 'info',
    message: `Competition '${existing.name}' restored`,
    metadata: { restored, warnings }
  });
  
  return { success: true, restored, warnings };
}
```

### 3.3 Match Restore

```typescript
export function restoreMatch(matchId: string): RestoreResponse {
  const database = getDatabase();
  
  const match = database.prepare("SELECT status, kickoff_time FROM scheduling_matches WHERE id = ?").get(matchId) as any;
  if (!match) {
    return {
      success: false,
      error: "not_found",
      warnings: [`Match '${matchId}' was not found or is not archived.`]
    };
  }
  
  if (match.status !== 'archived') {
    return {
      success: false,
      error: "restore_conflict",
      warnings: ["Cannot restore: the match is not archived. Restore is only available for archived matches."]
    };
  }
  
  const warnings: string[] = [];
  const restored: Record<string, number | boolean> = {};
  
  // Load previous status from operational_logs
  const log = database.prepare(`
    SELECT metadata FROM operational_logs 
    WHERE event_type = 'match_archived' AND entity_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(matchId);
  
  let restoreStatus = 'scheduled';
  
  if (log) {
    const metadata = JSON.parse(log.metadata);
    const storedStatus = metadata.previousStatus;
    
    if (matchLifecycleStates.includes(storedStatus) && storedStatus !== 'archived') {
      restoreStatus = storedStatus;
    } else {
      warnings.push(`Match restored to 'scheduled' (previous status '${storedStatus}' was not a valid lifecycle status)`);
    }
  } else {
    warnings.push("Match restored to 'scheduled' (no archive log found — previous status unknown)");
  }
  
  database.prepare("UPDATE scheduling_matches SET status = ?, updated_at = ? WHERE id = ?")
    .run(restoreStatus, now(), matchId);
  restored.match = true;
  
  logOperationalEvent({
    eventType: 'match_restored',
    entityType: 'match',
    entityId: matchId,
    severity: warnings.length > 0 ? 'warning' : 'info',
    message: `Match restored to '${restoreStatus}'`,
    metadata: { restored, warnings }
  });
  
  return { success: true, restored, warnings };
}
```

### 3.4 Route Handler (Standard Pattern)

```typescript
// sports.ts — all three routes follow this exact pattern
sportsRouter.post("/:sportId/restore", (request, response) => {
  const result = CatalogService.restoreSport(request.params.sportId);
  
  if (result.success) {
    response.json(result);               // 200
  } else if (result.error === "not_found") {
    response.status(404).json(result);   // 404
  } else {
    response.status(409).json(result);   // 409 for "restore_conflict"
  }
});
```

---

## 4. STATE PRESERVATION ON ARCHIVE

### 4.1 Matches: Store Previous Status Before Archive

```typescript
const match = database.prepare("SELECT status FROM scheduling_matches WHERE id = ?").get(matchId);
const previousStatus = match.status;

logOperationalEvent({
  eventType: 'match_archived',
  entityType: 'match',
  entityId: matchId,
  severity: 'warning',
  message: `Match archived (was '${previousStatus}')`,
  metadata: { previousStatus, matchId, previousKickoffTime: existingMatch.kickoff_time }
});

database.prepare("UPDATE scheduling_matches SET status = 'archived', updated_at = ? WHERE id = ?")
  .run(timestamp, matchId);
```

### 4.2 Sports and Competitions: Previous Values in Snapshot

```json
// sports snapshot in entity_deletion_log.previous_values:
{
  "row": { "id": "uuid", "name": "Football", "slug": "football", ... },
  "competitions": [
    { "id": "uuid1", "name": "Premier League", "status": "active" }
  ],
  "teams": [
    { "id": "uuid3", "name": "Team A", "status": "active" }
  ]
}
```

---

## 5. RESTORE RELATIONSHIP SAFETY RULES

### 5.1 Never Overwrite Newer Relationships

| Scenario | Behavior | Warning? |
|----------|----------|:--------:|
| `sport_id = NULL` (orphaned) | ✅ Safe to restore | No |
| `sport_id = <other-sport>` (re-linked) | ❌ Never overwrite | Yes |
| `sport_id` already matches | ✅ No-op, counted in restored count | No |
| Entity hard-deleted | ❌ Skip | Yes |

### 5.2 Safe-Only Restoration

Restore is **conservative by design**:
- Main entity restored unconditionally
- Related entities relinked ONLY if confirmed orphaned
- Never overwrites existing FK values
- Warnings explain every skipped record

---

## 6. PERMANENT DELETION POLICY

### 6.1 Desktop UI: No Permanent Delete

| Desktop Action | API Route | Behavior |
|----------------|-----------|----------|
| Archive sport | `DELETE /sports/:id` | Soft-delete (deleted=1). Reversible. |
| Archive competition | `DELETE /competitions/:id` | Soft-delete (deleted=1). Reversible. |
| Archive match | `DELETE /matches/:id` | Archive (status='archived'). Reversible. |
| **Permanent delete** | **No route exists** | ❌ Not possible from desktop UI |

### 6.2 Permanent Deletion: Developer/DB Maintenance Only

```sql
DELETE FROM sports WHERE id = ? AND deleted = 1;
DELETE FROM competitions WHERE id = ? AND deleted = 1;
DELETE FROM scheduling_matches WHERE id = ? AND status = 'archived';
```

---

## 7. DESKTOP RECOVERY UI

### 7.1 `includeArchived` Query Parameter

```
GET /sports           → Active tab (deleted=0 only)
GET /sports?includeArchived=true → Archived tab (all)

GET /competitions         → Active tab
GET /competitions?includeArchived=true → Archived tab

GET /matches              → Active statuses
GET /matches?includeArchived=true → Archived tab
```

### 7.2 Desktop UI Tab Structure

```
┌─────────────────────────────────────────────────────┐
│  SPORTS                                              │
│  ┌──────────┬────────────┐                           │
│  │ Active   │ Archived   │  ← Tabs                   │
│  └──────────┴────────────┘                           │
│  Active Tab:  [Edit] [Archive] per item               │
│  Archived Tab: [Restore] per item                     │
│                                                      │
│  Restore Result Popup:                                │
│  ┌─────────────────────────────────────────────┐    │
│  │ ✅ Restore Successful                        │    │
│  │ Recovered: Sport, 3 competitions             │    │
│  │ ⚠️ 2 competitions skipped (linked elsewhere) │    │
│  │ [OK]                                         │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 7.3 Desktop Error Handling per `error` value

| `error` value | HTTP | Desktop Action |
|---------------|:----:|----------------|
| *(absent — success)* | 200 | Show restore report with `restored` counts and `warnings` |
| `"not_found"` | 404 | Show "Sport not found. It may have been permanently deleted." |
| `"restore_conflict"` | 409 | Show "Cannot restore: the sport is already active." |

---

## 8. FULL CHAIN TEST

### 8.1 Complete Workflow

```
Setup:
  POST /sports  → "Test Football"
  POST /competitions  → "Test League" (sportId = sport.id)
  POST /competitions  → "Other Cup" (sportId = sport.id)
  POST /matches  → match (competitionId = comp.id)

Archive:
  DELETE /sports/:id  → 204

Verify hidden:
  GET /sports                    → "Test Football" absent
  GET /competitions              → Both absent
  GET /sports?includeArchived=true  → "Test Football" present (deleted=1)

Relink (simulate operator):
  POST /sports  → "Basketball"
  PUT /competitions/Other-Cup → sportId = basketball.id

Restore:
  POST /sports/:id/restore  → 200
  {
    "success": true,
    "restored": { "sport": true, "competitions": 1 },
    "warnings": ["Competition 'Other Cup' was not restored because it is linked to sport 'Basketball'"]
  }

Verify restored:
  GET /competitions/Test-League → sportId = "Test Football"   ✅
  GET /competitions/Other-Cup   → sportId = "Basketball"       ✅ NOT overwritten
```

### 8.2 Expected Results

| Step | Result |
|:----:|--------|
| Archive | 204 |
| Restore (found, archived) | 200 with `success: true` |
| Restore (not found) | 404 with `success: false, error: "not_found"` |
| Restore (already active) | 409 with `success: false, error: "restore_conflict"` |
| Relinked competition | sport_id preserved (NOT overwritten) |

---

## 9. COMPLETE ROUTE TABLE

### 9.1 Sports

| Method | Path | Response | When |
|--------|------|----------|------|
| GET | `/sports` | `{ data: Sport[] }` | Active list |
| GET | `/sports?includeArchived=true` | `{ data: Sport[] }` | All sports |
| POST | `/sports` | `{ data: Sport }` | Create |
| PUT | `/sports/:id` | `{ data: Sport }` | Update |
| DELETE | `/sports/:id` | `204` **(unchanged)** | Archive |
| POST | `/sports/:id/restore` | `{ success, restored, warnings }` | **200**: restored |
| | | `{ success:false, error:"not_found", warnings }` | **404**: not found |
| | | `{ success:false, error:"restore_conflict", warnings }` | **409**: conflict |

### 9.2 Competitions

| Method | Path | Response | When |
|--------|------|----------|------|
| DELETE | `/competitions/:id` | `204` **(unchanged)** | Archive |
| POST | `/competitions/:id/restore` | `{ success, restored, warnings }` | **200**: restored |
| | | `{ success:false, error:"not_found", warnings }` | **404**: not found |
| | | `{ success:false, error:"restore_conflict", warnings }` | **409**: conflict |

### 9.3 Matches

| Method | Path | Response | When |
|--------|------|----------|------|
| DELETE | `/matches/:id` | `204` **(unchanged)** | Archive |
| POST | `/matches/:id/restore` | `{ success, restored, warnings }` | **200**: restored |
| | | `{ success:false, error:"not_found", warnings }` | **404**: not found |
| | | `{ success:false, error:"restore_conflict", warnings }` | **409**: conflict |

---

## 10. SHARED TYPES

### 10.1 Add `archived` to Match Lifecycle

**File**: `packages/shared/src/lifecycle.ts`

```typescript
export const matchLifecycleStates = [
  "draft", "scheduled", "assigned", "approved",
  "published", "live", "ended", "cancelled",
  "archived"
] as const;
```

### 10.2 RestoreResponse Type

**File**: `packages/shared/src/sports.ts`

```typescript
export interface RestoreResponse {
  success: boolean;
  error?: "not_found" | "restore_conflict";
  restored?: Record<string, number | boolean>;
  warnings: string[];
}
```

---

## 11. SUMMARY

### Three Standardized Response Shapes

| Shape | HTTP | `success` | `error` | Returned When |
|-------|:----:|:---------:|---------|---------------|
| Success | **200** | `true` | *(absent)* | Main entity restored. `restored` has counts. `warnings` for skipped records. |
| Not found | **404** | `false` | `"not_found"` | Entity doesn't exist or isn't archived. |
| Restore conflict | **409** | `false` | `"restore_conflict"` | Entity exists but restore conditions not met (e.g., already active). |

### Safety Rules
- ✅ Never overwrite newer FK relationships — skipped records return warnings
- ✅ No 404 for relationship conflicts — only for missing/unarchived entities
- ✅ Desktop checks `success` first, then `error` for UI routing
- ✅ DELETE remains `204` (unchanged)
- ✅ No permanent delete from desktop UI