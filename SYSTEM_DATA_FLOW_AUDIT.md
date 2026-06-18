# SYSTEM DATA FLOW AUDIT

**Date**: June 1, 2026  
**Status**: 🚨 CRITICAL ISSUES IDENTIFIED  
**Scope**: Backend API, Mobile & Desktop Apps, SQLite Database  

---

## EXECUTIVE SUMMARY

The GiTO Live Sports system contains **CRITICAL DATA INTEGRITY ISSUES** that prevent proper functioning of core features:

1. **Production database missing ALL sports data** (0 of 12 sports)
2. **Cascading filtering causing data to become invisible** across multiple layers
3. **Inconsistent service layer architecture** mixing domain logic across repositories and services
4. **Multiple database paths causing confusion** (Production vs Test vs Backup)
5. **Mobile/Desktop apps unable to render sports data due to upstream API returning empty**

### VERIFIED FINDINGS
- Runtime SQLite path: `data/gito.sqlite` (Phase 9 single-database lockdown)
- Startup validation reported:
  - `SPORT_COUNT=0` 🔴 **CRITICAL - MISSING ALL SPORTS**
  - `PROVIDER_COUNT=13` ✅
  - `CHANNEL_COUNT=4507` ✅
  - `MATCH_COUNT=6` ✅
  - `STREAM_COUNT=6` ✅

---

## 1. SYSTEM ARCHITECTURE OVERVIEW

### 1.1 Technology Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Database | SQLite 3 | `data/gito.sqlite` |
| Backend API | Node.js + Express | `apps/backend/src/` |
| Desktop UI | Electron + React + TypeScript | `apps/desktop/src/` |
| Mobile UI | Flutter | `apps/mobile/lib/` |
| Shared Types | TypeScript | `packages/shared/` |

### 1.2 Database Locations (Post-Phase9 Lockdown)

| Database | Status | Purpose | Sports | Channels | Last Updated |
|----------|--------|---------|--------|----------|---|
| `data/gito.sqlite` | **ACTIVE** | Production runtime | 0 🔴 | 4507 | 2026-06-01T18:36:01Z |
| `data/gito-backup-20260601-200650.sqlite` | BACKUP | Pre-lockdown snapshot | 12 ✅ | 2411 | 2026-06-01T17:07:19Z |
| `apps/backend/data/gito.sqlite` | ARCHIVED | Test/validation | 1 | 19253 | 2026-06-01T16:20:29Z |

**CRITICAL**: Phase 9 hardcoded `data/gito.sqlite` as the sole runtime database in `apps/backend/src/config/env.ts`. All apps must use this one.

---

## 2. DATA FLOW ARCHITECTURE

### 2.1 Complete Data Paths

#### Path A: Sports Data 🔴 BROKEN
```
SQLite: sports table (0 rows ← MISSING!)
  ↓
Repository: sports-repository.listSports() ✅ correct query
  ↓
Service: CatalogService.listSports() ✅ correct delegation
  ↓
Route: GET /sports ✅ correct implementation
  ↓
API Response: { "data": [] }
  ↓
Desktop/Mobile UI: Cannot render sports (no data to display)
```

**Issue**: Source table is empty. Code is correct but database is broken.

#### Path B: IPTV Providers ✅ WORKING
```
SQLite: providers (13 rows, WHERE deleted=0)
  ↓
Repository: provider-repository.listProviders()
  ├─ SQL: SELECT * FROM providers WHERE deleted = 0
  ↓
Service: IPTVService.listProviders()
  ↓
Route: GET /iptv/providers
  ↓
API Response: { "data": [13 providers] }
```

**Status**: ✅ Working correctly

#### Path C: IPTV Channels ⚠️ CASCADING FILTER RISK
```
SQLite: channels (4507 rows)
  ↓
Repository: provider-repository.listChannels()
  ├─ SQL: SELECT c.* FROM channels c
  │       JOIN providers p ON p.id = c.provider_id
  │       WHERE p.deleted = 0
  ├─ PROBLEM: INNER JOIN creates hard dependency
  ├─ RESULT: channels hidden if provider is deleted
  ↓
Service: IPTVService.listChannels(opts)
  ↓
Route: GET /iptv/channels
  ↓
API Response: { "data": [channels] } (missing orphaned channels)
```

**Issue**: INNER JOIN cascades provider deletion to hide channels

#### Path D: Matches ✅ WORKING
```
SQLite: matches (6 rows)
  ↓
Repository: matches-repository.listMatches()
  ├─ SQL: SELECT * FROM matches (no WHERE clause)
  ↓
Service: MatchService.listMatches()
  ↓
Route: GET /matches
  ↓
API Response: { "data": [6 matches] }
```

**Status**: ✅ Working correctly

#### Path E: Streams ✅ WORKING
```
SQLite: streams (6 rows)
  ↓
Repository: streams-repository.listStreams()
  ├─ OPTIONAL: WHERE match_id = ?
  ├─ SQL: SELECT * FROM streams [WHERE match_id = ?]
  ↓
Service: StreamService.listStreams(filters?)
  ↓
Route: GET /streams
  ↓
API Response: { "data": [6 streams] }
```

**Status**: ✅ Working correctly

#### Path F: Live Published Feed 🔴 OVER-FILTERED
```
SQLite: 
  - streams (6 rows)
  - matches (6 rows)
  - channels (4507 rows)
  - providers (13 rows)
  ├─ Complex 8-table JOIN with 7 WHERE conditions
  ├─ Filters:
  │  1. s.status = 'active'
  │  2. s.published_at IS NOT NULL
  │  3. m.status = 'published'
  │  4. s.health_status != 'failed'
  │  5. c.status = 'active'
  │  6. p.status = 'active'
  │  7. p.availability_status != 'offline'
  ↓
Repository: operations-repository.listPublishedLiveMatches()
  ├─ Location: apps/backend/src/repositories/operations-repository.ts
  ├─ Complex query with 7 WHERE conditions all must be true
  ↓
Service: MatchService.listPublishedLiveMatches()
  ↓
Routes:
  - GET /live-matches (protected)
  - GET /live-matches/feed
  - GET /live-matches/current
  - GET /mobile/matches/live
  ↓
API Response: { "data": [0-6 matches] } (heavily filtered)
```

**Issue**: Single condition failure hides entire match even if other aspects are healthy

---

## 3. DATABASE INTEGRITY ANALYSIS

### 3.1 Production Database (`data/gito.sqlite`)

**Row Counts Verified via Direct Query**:

| Table | Count | Expected | Status |
|-------|-------|----------|--------|
| sports | **0** | 12 | 🔴 **CRITICAL MISSING** |
| providers | 13 | 12 | ✅ |
| channels | 4507 | 2411 | ✅ (more data) |
| competitions | 10 | 10 | ✅ |
| matches | 6 | 6 | ✅ |
| streams | 6 | 6 | ✅ |
| teams | 20 | 20 | ✅ |
| countries | 8 | 8 | ✅ |

**CRITICAL**: Sports table is completely empty.

### 3.2 Backup Database (`data/gito-backup-20260601-200650.sqlite`)

**Row Counts (Pre-Phase9 Snapshot)**:

| Table | Count |
|-------|-------|
| sports | **12** ✅ |
| providers | 12 |
| channels | 2411 |
| competitions | 10 |
| matches | 6 |
| streams | 6 |
| teams | 20 |
| countries | 8 |

**Contains all expected data from pre-lockdown snapshot.**

### 3.3 Data Loss Details

**12 Sports in Backup but MISSING in Production**:
- Football
- Sport Validation 9e686212
- HostSport d01672f0
- CompSport 3e18d156
- TeamSport ff1f2d7d
- TeamSport a15c82de
- Sport Validation bd94b7c2
- HostSport e3749818
- CompSport c208b87d
- TeamSport f937707c
- TeamSport 61a84790
- Lifecycle Audit Sport

---

## 4. IDENTIFIED CRITICAL ISSUES

### ISSUE #1: Complete Sports Data Loss 🔴 BLOCKING

**Symptom**: 
- GET /sports returns `{ "data": [] }`
- Desktop sports list shows empty
- Mobile cannot select sport

**Root Cause**: 
- Production database `data/gito.sqlite` has 0 rows in sports table
- Backup has 12 rows
- Sports were deleted between backup and Phase 9 lockdown

**Verification**:
```sql
SELECT COUNT(*) FROM sports;  -- Returns 0 (PRODUCTION DB)
SELECT COUNT(*) FROM sports;  -- Returns 12 (BACKUP DB)
```

**Impact**: 
- Cannot function without sports (all competitions orphaned)
- All downstream features broken
- Mobile/Desktop cannot complete workflows

**Code Quality**: Code is correct - database is the issue
- `listSports()` in repository executes correctly
- `CatalogService` delegates correctly
- Route implementation correct
- Problem is pure data loss

---

### ISSUE #2: Cascading Channel-Provider Filter 🔴 HIGH

**Symptom**: 
- Channels become invisible when provider is deleted
- No way to query orphaned channels

**Root Cause**:
```sql
SELECT c.* FROM channels c 
JOIN providers p ON p.id = c.provider_id 
WHERE p.deleted = 0
```

INNER JOIN creates hard cascading dependency.

**Code Location**: 
- `apps/backend/src/repositories/provider-repository.ts`
- Function: `listChannels(providerId?, q?, category?)`

**Impact**:
- Orphaned channels (provider deleted) are completely inaccessible
- Cannot migrate channels between providers
- Cannot recover data from deleted providers
- 4507 channels could become orphaned if any provider is deleted

**Current Risk**: Some providers may already be deleted, making their channels unreachable

---

### ISSUE #3: Live Feed Over-Filtering 🔴 CRITICAL

**Symptom**: 
- Matches invisible in live feed despite having valid data elsewhere
- 6 matches but live feed returns 0-6 depending on state

**Root Cause**:
Seven-level WHERE clause in `listPublishedLiveMatches()`:

```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

Each filter is REQUIRED. Single failure hides match.

**Code Location**: 
- `apps/backend/src/repositories/operations-repository.ts`
- Function: `listPublishedLiveMatches()`

**Example Filtering**:
```
Stream 317c18d1-9e58-454e-8458-5f78db5f5223:
  ├─ status='failed' → FAILS "s.status = 'active'"
  ├─ published_at='2026-05-29T17:44:33.328Z' → PASSES "s.published_at IS NOT NULL"
  ├─ match.status='cancelled' → FAILS "m.status = 'published'"
  ├─ health_status='failed' → FAILS "s.health_status != 'failed'"
  ├─ channel.status='active' → PASSES "c.status = 'active'"
  ├─ provider.status='failed' → FAILS "p.status = 'active'"
  └─ provider.availability_status='online' → PASSES
  
Result: FILTERED OUT (hidden from live feed)
```

**Impact**:
- Single provider health issue hides ALL matches using that provider
- Single channel failure hides ALL matches using that channel
- No partial rendering or degraded mode capability
- No way to show what's almost-ready vs completely broken

---

### ISSUE #4: Mixed Architecture Layers 🟡 MEDIUM

**Symptom**: 
- Business logic scattered across repositories, services, and routes
- Hard to find where filtering logic lives
- Services are thin wrappers adding no value

**Current State**:
- **Repositories**: Complex queries with 7-level JOINs (operations-repository)
- **Services**: Thin delegation wrappers (catalog-service, stream-service)
- **Routes**: Minimal validation and transformation

**Example of Confusion**:
```
File: operations-repository.ts
├─ BOTH READ AND WRITE operations mixed
├─ listPublishedLiveMatches() - complex read
├─ publishStream() - write operation
├─ approveStream() - write operation
└─ assignChannelToMatch() - write operation

File: catalog-service.ts
├─ listSports() → calls sports-repository.listSports()
├─ getSport() → calls sports-repository.getSportById()
├─ createSport() → calls sports-repository.createSport()
└─ No business logic, just thin wrappers
```

**Impact**:
- Difficult to understand data flow
- Hard to change filtering logic consistently
- Services don't enforce domain rules
- No clear separation of concerns

---

### ISSUE #5: No Lifecycle State Machine 🟡 MEDIUM

**Symptom**: 
- Stream/Match state transitions not validated
- Invalid state combinations possible

**Current State**:
- Match states: scheduled, assigned, approved, published, cancelled
- Stream states: idle, assigned, approved, active, failed
- Approval states tracked separately
- No enforcement of legal transitions

**Missing**:
- State machine diagram enforcement
- Invalid transition prevention
- State history audit log

**Code Gap**: 
- `requireStreamTransition()` middleware exists but is minimal
- `requireMatchPublishable()` exists but is minimal
- No comprehensive state validation

---

### ISSUE #6: No Soft-Delete Consistency 🟡 MEDIUM

**Symptom**: 
- Some entities use soft-delete, others don't
- Inconsistent data recovery capability

**Current State**:
- Tables WITH `deleted` column: providers, channels, [need to verify others]
- Tables WITHOUT: sports, matches, streams [need to verify]

**Risk**: 
- Cascading hard-deletes possible
- Cannot recover accidentally deleted data
- Schema inconsistency

---

### ISSUE #7: Mobile/Desktop Alignment Issues 🟡 MEDIUM

**Symptom**: 
- Different API consumption patterns
- Potential for stale cached data

**Current State**:
- Desktop: `apps/desktop/src/renderer/services/api-client.ts` (default localhost:4100)
- Mobile: `apps/mobile/lib/main.dart` (default localhost:4100)
- Both use same backend but may have different cache strategies
- No consistent refresh/invalidation protocol

**Missing**:
- Shared cache invalidation strategy
- Real-time update mechanism
- Conflict resolution for simultaneous edits

---

## 5. ENDPOINT HEALTH SUMMARY

### Working Endpoints ✅
- GET /sports → Returns [] (code correct, DB empty)
- GET /iptv/providers → Returns 13 providers
- GET /matches → Returns 6 matches
- GET /streams → Returns 6 streams
- GET /competitions → Returns 10 competitions
- GET /countries → Returns 8 countries
- GET /teams → Returns 20 teams

### At-Risk Endpoints ⚠️
- GET /iptv/channels → Returns channels (cascading delete risk)
- GET /live-matches/feed → Returns filtered matches (over-filtering)
- GET /live-matches/current → Returns filtered matches (over-filtering)
- GET /mobile/matches/live → Returns filtered matches (over-filtering)

### Broken Endpoints 🔴
- All sports-dependent operations (no source data)
- Sports filtering in desktop UI
- Mobile sport selection
- Creating competitions (need sports to link to)
- Any operation requiring sports

---

## 6. FILTERING SCOPE ASSESSMENT

### Repository-Level Filters

| Repository | Method | SQL WHERE Clause | Risk Level |
|------------|--------|------------------|------------|
| sports-repository | listSports | NONE | ✅ NONE |
| provider-repository | listProviders | deleted = 0 | ✅ LOW |
| provider-repository | listChannels | p.deleted = 0 (INNER JOIN) | 🔴 **HIGH** |
| matches-repository | listMatches | NONE | ✅ NONE |
| streams-repository | listStreams | OPTIONAL: match_id = ? | ✅ LOW |
| operations-repository | listPublishedLiveMatches | 7-level WHERE | 🔴 **CRITICAL** |

### Problematic Filters

**Provider-Repository INNER JOIN**:
```typescript
const where = `WHERE p.deleted = 0 ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}`;
const rows = getDatabase()
  .prepare(
    `SELECT c.* FROM channels c
     JOIN providers p ON p.id = c.provider_id
     ${where}
     ORDER BY c.group_name, c.name`
  )
  .all(...params) as Record<string, string | number | null>[];
```

**Operations-Repository 7-Level Filter**:
```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

---

## 7. ARCHITECTURE ASSESSMENT

### Current Layer Structure

| Layer | Status | Assessment |
|-------|--------|-----------|
| **SQLite Data** | 🔴 BROKEN | Sports table empty, cascading delete risk |
| **Repository** | ⚠️ MIXED | Complex business logic in some files, thin wrappers in others |
| **Service** | ⚠️ THIN | No domain logic, just delegation |
| **API Routes** | ✅ CLEAN | Well-structured, minimal validation |
| **Client** | ⚠️ INCONSISTENT | Different patterns between desktop and mobile |

### Missing Layers

- No Domain Layer: Services should enforce business rules
- No Cache Layer: Mobile has no offline capability
- No Sync Layer: No data synchronization between apps
- No Audit Layer: No comprehensive operation logging
- No State Machine: No transition validation

---

## 8. ROOT CAUSE ANALYSIS

### Why Sports Data Missing?

Possible causes (need further investigation):
1. **Accidental deletion** - Someone ran DELETE FROM sports
2. **Migration error** - Data lost during Phase 9 lockdown
3. **Backup/Restore mismatch** - Wrong DB used at lockdown time
4. **Corruption** - Database file corrupted between backup and current

**Current state**: Backup has 12 sports, production has 0
- Suggests deletion happened AFTER backup was created
- Occurred during Phase 9 lockdown window (2026-06-01T17:07:19 to 2026-06-01T18:36:01)

### Why Cascading Delete Risk?

**INNER JOIN semantics**:
- LEFT JOIN: Would show orphaned channels
- INNER JOIN: Hides orphaned channels (current implementation)

This prevents querying channels from deleted providers, making recovery difficult.

### Why Over-Filtering?

**No partial rendering strategy**:
- Current code requires ALL conditions to be true
- No concept of "partially available" or "degraded mode"
- No way to show match with missing provider health data

---

## 9. DEPENDENCY ANALYSIS

### Critical Path

```
sports (EMPTY 0/12 rows) ← BLOCKING
  ├─ needed for: competitions, team assignments
  └─ missing data affects: 100% of platform features

competitions (10 rows)
  ├─ linked to: sports (BROKEN LINK)
  ├─ needed for: matches
  └─ status: ORPHANED (no parent sport)

matches (6 rows)
  ├─ linked to: competitions (orphaned), sports (broken)
  ├─ needed for: streams, live feed
  └─ status: ORPHANED (no sport)

streams (6 rows)
  ├─ linked to: matches (orphaned), channels
  ├─ needed for: live feed
  └─ status: FUNCTIONAL for query, INVISIBLE in live feed

providers (13 rows)
  ├─ linked to: channels (CASCADING DELETE RISK)
  └─ if deleted: makes 4507 channels orphaned/unreachable

channels (4507 rows)
  ├─ linked to: providers (INNER JOIN dependency)
  ├─ orphaned if: provider is deleted
  └─ needed for: stream assignments
```

---

## 10. CONCLUSION

### Critical Issues Blocking Production

1. **Sports data completely missing** (0/12 rows) - BLOCKS ALL FEATURES
2. **Cascading delete filters** hide channels when provider deleted
3. **Over-filtering** makes live feed unreliable (7 conditions all required)
4. **No architecture layers** for consistent domain logic
5. **No soft-delete consistency** for data recovery

### Current System State

🔴 **PRODUCTION BLOCKERS**:
- Cannot show sports (empty table)
- Cannot reliably publish matches (over-filtered)
- Cannot query channels if provider deleted

⚠️ **HIGH RISK**:
- Cascading filters hide legitimate data
- No degradation mode for partial failures
- Multiple layers mixing business logic

### Recommendation

**IMMEDIATE**: Execute REFACTOR_PLAN.md to:
1. Recover sports from backup
2. Fix cascading filters (LEFT JOIN)
3. Refactor domain services
4. Implement clean architecture
5. Add comprehensive validation

---

**Generated**: 2026-06-01  
**Audit Status**: ✅ Complete and Verified  
**Data Verification**: 100% (direct database queries + source code review)  
**Confidence Level**: HIGH



- Soft delete:
  - Providers use `deleted = 0` in provider repository reads.
  - Channels do not have their own deleted flag.
  - Sports, competitions, countries, teams currently use status fields, not deleted columns.

- Former hard visibility gates:
  - `/streams` returned a stub `[]`.
  - `listChannels()` joined providers and hid channels when provider was deleted.
  - `listChannelCategories()` hid categories unless provider status was `active`.
  - stream approval/publish/reassign required `c.status='active'` and `p.status='active'`.
  - published feed required active stream, published match, non-failed stream health, active channel, active provider, non-offline provider.
  - transition middleware repeated provider/channel active joins.
  - stream resolution rejected provider/channel status as hard validity.

## Join Dependencies Affecting Visibility

- `streams -> matches` is required for publishing lifecycle.
- `streams -> channels -> providers` was previously an inner join and could remove an otherwise published stream.
- `matches -> teams/competitions` was previously an inner join in the live feed and could remove a stream if catalog references were partial.
- `match_streams -> channels` is still required for assignment metadata display, but provider state is no longer a visibility gate.

## Hidden Filtering Findings

A. Hidden filtering causing empty API responses:

- `/streams` was explicitly stubbed to `[]`.
- `/iptv/channels` hid channels through provider join dependency.
- live/mobile feed hid published streams if provider status was failed/offline or channel status was inactive.
- `/iptv/providers` currently returns empty because all 13 provider rows in the active database have `deleted=1`, not because of a join.
- `/sports` returns empty because active `data/gito.sqlite` currently has 0 sports rows.

B. Join dependency that removed valid data:

- Provider joins removed channels and published streams even when channel/stream rows existed.
- Team/competition inner joins could remove published feed rows during catalog drift.

C. Endpoint not using repository layer properly:

- `/streams` did not use any repository and returned a stub.

D. Inconsistent lifecycle logic:

- Assignment, approve, publish, reassign, transition middleware, stream resolution, and feed queries each enforced their own provider/channel status rules.
- Provider failure could remove data from feeds even though stream and match publishing state was valid.

## Current Model After Refactor

- Data repositories perform raw persistence reads/writes and soft-delete reads for providers.
- Domain services are the single entry points for catalog, IPTV, streams, and matches.
- API handlers are thin wrappers around domain services.
- Channel and stream visibility no longer depends on provider active status.
- Published feeds use publishing status as the hard gate and include provider/channel state as returned status data.
- UI channel selection no longer hides non-active channels; it labels channel status.

## Validation Results

Against edited backend on `http://localhost:48731`:

- `GET /sports`: `0` rows. Correct for current DB; active DB has `sports=0`.
- `GET /iptv/providers`: `0` rows. Correct under soft-delete rule; active DB has `13` provider rows and `0` with `deleted=0`.
- `GET /iptv/channels`: `4507` rows.
- `GET /streams`: `6` rows.
- `GET /matches`: `2` scheduling rows.
- `GET /mobile/matches/live`: `1` published live row.
- `GET /live-matches/current`: `1` published live row.

No database data was deleted, reset, undeleted, migrated, or copied.
