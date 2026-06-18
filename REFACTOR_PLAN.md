# PRODUCTION REFACTORING PLAN

**Date**: 2026-06-01  
**Status**: 🚨 CRITICAL ISSUES BLOCK PRODUCTION  
**Priority**: P0 - Blocking all sport-based features

---

## OVERVIEW

This plan remediates critical architectural and data issues identified in SYSTEM_DATA_FLOW_AUDIT.md.

### Issues to Fix

1. **Sports data loss** (0/12 rows) - BLOCKING
2. **Cascading channel filters** (INNER JOIN hides orphans) - HIGH
3. **Over-filtering live feed** (7 conditions all required) - CRITICAL
4. **Mixed architecture layers** (logic scattered across files) - MEDIUM
5. **No soft-delete consistency** (some entities, not others) - MEDIUM
6. **No lifecycle state machine** (transitions not validated) - MEDIUM
7. **Mobile/Desktop misalignment** (different cache/fetch patterns) - MEDIUM

---

## PHASE 1: IMMEDIATE DATA RECOVERY (Hours 1-2)

### 1.1 Recover Sports Data from Backup

**Objective**: Restore 12 sports from backup to production database

**Action**:
```bash
# Backup current production DB first
cp data/gito.sqlite data/gito-corrupted-20260601.sqlite

# Extract sports from backup
sqlite3 data/gito-backup-20260601-200650.sqlite \
  ".mode insert sports" \
  "SELECT * FROM sports;" > /tmp/sports-restore.sql

# Insert into production DB
sqlite3 data/gito.sqlite < /tmp/sports-restore.sql
```

**Verification**:
```sql
SELECT COUNT(*) FROM sports;  -- Should return 12
SELECT name FROM sports ORDER BY name;  -- Should show all 12 sports
```

**Risk**: None (inserting missing data, no overwrites)  
**Rollback**: `cp data/gito-corrupted-20260601.sqlite data/gito.sqlite`

### 1.2 Verify Data Integrity Post-Recovery

**Check**:
- ✅ 12 sports restored
- ✅ 10 competitions still linked to sports
- ✅ 6 matches still linked to competitions
- ✅ 6 streams still linked to matches
- ✅ 4507 channels still intact
- ✅ 13 providers still intact

---

## PHASE 2: ARCHITECTURE LAYER CLEANUP (Hours 3-4)

### 2.1 Standardize Repository Layer

**Objective**: Ensure all repositories follow clean patterns

**Current State**:
- ✅ sports-repository.ts - Clean CRUD
- ✅ provider-repository.ts - Mostly clean (INNER JOIN issue exists)
- ✅ streams-repository.ts - Clean read-only
- ⚠️ operations-repository.ts - Mixed read/write with complex logic
- ⚠️ matches-repository.ts - Mostly clean
- Others: Need review

**Action**: 
1. Review each repository file
2. Ensure no business logic in repository layer
3. Ensure all reads/writes use soft-delete consistently
4. Document any WHERE clauses

**Files to Review**:
- [sports-repository.ts](apps/backend/src/repositories/sports-repository.ts)
- [provider-repository.ts](apps/backend/src/repositories/provider-repository.ts)
- [streams-repository.ts](apps/backend/src/repositories/streams-repository.ts)
- [matches-repository.ts](apps/backend/src/repositories/matches-repository.ts)
- [operations-repository.ts](apps/backend/src/repositories/operations-repository.ts)
- [competitions-repository.ts](apps/backend/src/repositories/competitions-repository.ts)
- [teams-repository.ts](apps/backend/src/repositories/teams-repository.ts)

### 2.2 Fix Cascading Delete Filter in Channels

**Objective**: Replace INNER JOIN with LEFT JOIN to show orphaned channels

**Current Code** (provider-repository.ts):
```typescript
const where = `WHERE p.deleted = 0 ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}`;
const rows = getDatabase()
  .prepare(
    `SELECT c.* FROM channels c
     JOIN providers p ON p.id = c.provider_id
     ${where}
```

**Fix**:
```typescript
// Return all channels, even if provider deleted
// Clients should handle null provider gracefully
const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
const rows = getDatabase()
  .prepare(
    `SELECT c.*, p.id as provider_id, p.status as provider_status
     FROM channels c
     LEFT JOIN providers p ON p.id = c.provider_id
     ${where}
     ORDER BY c.group_name, c.name`
  )
  .all(...params) as Record<string, string | number | null>[];
```

**Alternative: Soft-Delete Consistency**:
If providers have soft-delete, apply it:
```sql
SELECT c.* FROM channels c
LEFT JOIN providers p ON p.id = c.provider_id
WHERE p.id IS NULL OR p.deleted = 0
```

**Testing**:
- Create provider
- Assign channels to provider
- Delete provider
- Query GET /iptv/channels → should still return those channels with status warning

---

## PHASE 3: DOMAIN SERVICE LAYER ENFORCEMENT (Hours 5-8)

### 3.1 Refactor CatalogService

**Current**: Thin wrapper  
**Target**: Domain logic enforcement

**Implementation**:

```typescript
// apps/backend/src/services/catalog-service.ts

export const CatalogService = {
  listSports(): Sport[] {
    return listSports();
  },

  getSport(sportId: string): Sport | undefined {
    return getSportById(sportId);
  },

  createSport(input: CreateSportRequest): Sport {
    // ADD: Validate name is unique
    if (listSports().some(s => s.slug === slugify(input.name))) {
      throw new ValidationError("sport_slug_already_exists");
    }
    
    // ADD: Validate logo URL format
    if (input.logoUrl && !isValidUrl(input.logoUrl)) {
      throw new ValidationError("invalid_logo_url");
    }
    
    return createSport(input);
  },

  updateSport(sportId: string, input: UpdateSportRequest): Sport | undefined {
    const existing = getSportById(sportId);
    if (!existing) return undefined;
    
    // ADD: Validate slug change doesn't conflict
    if (input.name) {
      const newSlug = slugify(input.name);
      if (newSlug !== existing.slug && listSports().some(s => s.slug === newSlug)) {
        throw new ValidationError("sport_slug_already_exists");
      }
    }
    
    return updateSport(sportId, input);
  },

  deleteSport(sportId: string, operatorId?: string): boolean {
    // ADD: Check no competitions reference this sport
    const competitions = listCompetitions({ sportId });
    if (competitions.length > 0) {
      throw new ValidationError(
        "sport_in_use",
        "Cannot delete sport with active competitions"
      );
    }
    
    return deleteSport(sportId, operatorId);
  }
};
```

**Key Additions**:
- ✅ Input validation
- ✅ Business rule enforcement (e.g., no duplicate slugs)
- ✅ Dependency checking (competitions reference sport)
- ✅ Error handling with domain-specific error types

### 3.2 Refactor IPTVService

**Current**: Channel listing with cascading filter  
**Target**: Show all channels with provider status

```typescript
export const IPTVService = {
  listChannels(opts?: { providerId?: string; q?: string; category?: string }) {
    // Get channels with optional provider data
    const channels = listChannels(opts);
    
    // Enrich with provider status
    return channels.map(channel => ({
      ...channel,
      providerStatus: channel.provider_id 
        ? getProvider(channel.provider_id)?.status ?? "deleted"
        : "unknown",
      providerHealth: channel.provider_id
        ? getProvider(channel.provider_id)?.health_score ?? 0
        : 0
    }));
  },
  
  listOrphanedChannels() {
    // Channels whose provider is deleted
    return getDatabase()
      .prepare(`
        SELECT c.* FROM channels c
        WHERE c.provider_id NOT IN (
          SELECT id FROM providers WHERE deleted = 0
        )
      `)
      .all();
  }
};
```

### 3.3 Refactor MatchService for Partial Data Rendering

**Current**: Over-filtered live feed  
**Target**: Show matches with status/warnings

```typescript
export const MatchService = {
  listPublishedLiveMatches() {
    // Get published matches
    const published = listPublishedLiveMatches();
    
    // PLUS: Get partially-ready matches with status
    const almostReady = getDatabase()
      .prepare(`
        SELECT m.*, s.status, s.health_status, c.status as channel_status, p.status as provider_status
        FROM matches m
        LEFT JOIN streams s ON s.match_id = m.id
        LEFT JOIN channels c ON c.id = s.channel_id
        LEFT JOIN providers p ON p.id = c.provider_id
        WHERE m.status = 'published' AND s.status != 'failed'
        ORDER BY m.starts_at DESC
      `)
      .all();
    
    return {
      live: published,
      almostReady: almostReady.filter(m => !published.find(p => p.id === m.id)),
      degradation: {
        missingChannelStatus: almostReady.filter(m => m.channel_status !== 'active').length,
        missingProviderStatus: almostReady.filter(m => m.provider_status !== 'active').length,
        unhealthyStreams: almostReady.filter(m => m.health_status === 'failed').length
      }
    };
  }
};
```

**Key Addition**: Return degradation status instead of hiding data

---

## PHASE 4: LIVE FEED REFACTORING (Hours 9-12)

### 4.1 Replace Over-Filtering with Visible Status

**Current Problem**:
```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

Any single condition failure hides entire match.

**Solution**: Create three result sets with status

```typescript
export function listPublishedLiveMatches() {
  // 1. LIVE (all conditions met)
  const live = queryLiveMatches({
    streamStatus: 'active',
    publishedAt: 'NOT NULL',
    matchStatus: 'published',
    healthStatus: '!= failed',
    channelStatus: 'active',
    providerStatus: 'active',
    providerAvailability: '!= offline'
  });

  // 2. READY (can be made live with fixes)
  const ready = queryReadyMatches({
    streamStatus: 'approved',
    matchStatus: 'published',
    healthStatus: '!= failed',
    channelStatus: 'active',
    providerStatus: '!= offline'
  });

  // 3. ISSUES (has problems but visible)
  const issues = queryProblematicMatches({
    matchStatus: 'published',
    // at least one of:
    streamStatus: 'assigned|approved|failed',
    healthStatus: 'failed',
    channelStatus: '!= active',
    providerStatus: 'offline'
  });

  return {
    live,
    ready,
    issues,
    summary: {
      liveCount: live.length,
      readyCount: ready.length,
      issuesCount: issues.length,
      degradationReasons: {
        streamNotActive: ready.filter(m => m.stream.status !== 'active').length,
        notPublished: issues.filter(m => m.stream.published_at === null).length,
        healthFailed: issues.filter(m => m.stream.health_status === 'failed').length,
        channelInactive: issues.filter(m => m.channel.status !== 'active').length,
        providerInactive: issues.filter(m => m.provider.status !== 'active').length,
        providerOffline: issues.filter(m => m.provider.availability_status === 'offline').length
      }
    }
  };
}
```

### 4.2 Update Route Handlers for Partial Data

**Before**:
```typescript
liveMatchesRouter.get("/feed", (_request, response) => {
  response.json({ data: MatchService.listPublishedLiveMatches() });
});
```

**After**:
```typescript
liveMatchesRouter.get("/feed", (_request, response) => {
  const feed = MatchService.listPublishedLiveMatches();
  
  response.json({
    data: {
      live: feed.live,
      ready: feed.ready,
      issues: feed.issues,
      summary: feed.summary
    }
  });
});

liveMatchesRouter.get("/current", (_request, response) => {
  const feed = MatchService.listPublishedLiveMatches();
  
  // For "current" endpoint, only return actively streaming
  response.json({
    data: feed.live
  });
});
```

### 4.3 Update Mobile Endpoint

**Before**:
```typescript
mobileRouter.get("/matches/live", (_request, response) => {
  response.json({ data: MatchService.listPublishedLiveMatches() });
});
```

**After**:
```typescript
mobileRouter.get("/matches/live", (_request, response) => {
  const feed = MatchService.listPublishedLiveMatches();
  
  // Mobile gets live + ready for potential playback
  response.json({
    data: {
      available: [...feed.live, ...feed.ready],
      count: feed.live.length + feed.ready.length,
      streaming: feed.live.length
    }
  });
});
```

---

## PHASE 5: SOFT-DELETE CONSISTENCY (Hours 13-14)

### 5.1 Audit All Tables for Soft-Delete

**Action**: Document which entities support soft-delete

```typescript
// apps/backend/src/services/catalog_rules.ts

export const SOFT_DELETE_ENTITIES = {
  sports: false,        // Does NOT have 'deleted' column
  providers: true,      // Has 'deleted' column
  channels: true,       // Has 'deleted' column
  competitions: false,  // ??? Need to check
  matches: false,       // ??? Need to check
  streams: false,       // ??? Need to check
  teams: false,         // ??? Need to check
  countries: false      // ??? Need to check
};
```

### 5.2 Standardize Soft-Delete Pattern

**Pattern**:
```typescript
// For entities WITH soft-delete:
WHERE deleted = 0

// For entities WITHOUT soft-delete:
// Use hard delete OR add soft-delete column

// Consistency rule:
// All entity deletions should be recoverable
```

---

## PHASE 6: STATE MACHINE ENFORCEMENT (Hours 15-16)

### 6.1 Create Stream State Machine

```typescript
// apps/backend/src/services/stream-state-machine.ts

const VALID_TRANSITIONS: Record<StreamStatus, StreamStatus[]> = {
  'idle': ['assigned'],
  'assigned': ['approved', 'deleted'],
  'approved': ['active', 'deleted'],
  'active': ['failed', 'deleted'],
  'failed': ['assigned', 'deleted'],
  'deleted': []  // Terminal state
};

export function assertValidTransition(from: StreamStatus, to: StreamStatus) {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new WorkflowStateError(
      `stream_invalid_transition`,
      `Cannot transition stream from '${from}' to '${to}'`
    );
  }
}
```

### 6.2 Enforce in Stream Service

```typescript
export const StreamService = {
  approveStream(streamId: string, operatorId: string) {
    const stream = getStreamById(streamId);
    if (!stream) return null;
    
    // ADD: Validate transition
    assertValidTransition(stream.status, 'approved');
    
    return approveStream(streamId, operatorId);
  },
  
  publishStream(streamId: string) {
    const stream = getStreamById(streamId);
    if (!stream) return null;
    
    // ADD: Validate transition
    assertValidTransition(stream.status, 'active');
    
    // ADD: Validate match is publishable
    const match = getMatchById(stream.matchId);
    if (match?.status !== 'published') {
      throw new WorkflowStateError(
        `match_not_publishable`,
        `Match must be in 'published' state to publish stream`
      );
    }
    
    return publishStream(streamId);
  }
};
```

---

## PHASE 7: MOBILE/DESKTOP ALIGNMENT (Hours 17-18)

### 7.1 Standardize Cache Headers

**Desktop** ([api-client.ts](apps/desktop/src/renderer/services/api-client.ts)):
```typescript
const response = await fetch(url, {
  headers: {
    'Cache-Control': 'no-store',
    ...headers
  }
});
```

**Mobile** (main.dart):
```dart
final headers = {
  'Cache-Control': 'no-store',
  ...additionalHeaders
};
```

### 7.2 Synchronize API Base URL

**Both should default to**: `http://localhost:4100`

**Configuration files**:
- Desktop: `apps/desktop/src/renderer/services/api-client.ts`
- Mobile: `apps/mobile/lib/main.dart`

### 7.3 Implement Real-Time Invalidation

**Add WebSocket support** (optional, Phase 2):
```typescript
// apps/backend/src/routes/websocket.ts
// Broadcast when data changes to connected clients

wss.broadcast('sports:updated', { sportId });
wss.broadcast('providers:updated', { providerId });
wss.broadcast('matches:published', { matchId });
```

---

## PHASE 8: COMPREHENSIVE TESTING (Hours 19-20)

### 8.1 Endpoint Validation

**Before** (current state):
```
GET /sports → { "data": [] }  ❌ BROKEN
GET /iptv/providers → { "data": [13] }  ✅ WORKS
GET /iptv/channels → { "data": [4507] }  ✅ WORKS (with provider cascading risk)
GET /matches → { "data": [6] }  ✅ WORKS
GET /streams → { "data": [6] }  ✅ WORKS
GET /live-matches/feed → { "data": [0-6] }  ⚠️ OVER-FILTERED
```

**After** (target state):
```
GET /sports → { "data": [12] }  ✅ FIXED
GET /iptv/providers → { "data": [13] }  ✅ WORKS
GET /iptv/channels → { "data": [4507], "orphaned": [N] }  ✅ FIXED
GET /matches → { "data": [6] }  ✅ WORKS
GET /streams → { "data": [6] }  ✅ WORKS
GET /live-matches/feed → { "live": [N], "ready": [M], "issues": [K], "summary": {...} }  ✅ FIXED
```

### 8.2 Test Suite

```bash
# Unit tests
npm test --workspace=apps/backend

# Integration tests
npm run test:integration --workspace=apps/backend

# Database verification
./scripts/validate-operations.ts
./scripts/validate-enforcement.ts

# Endpoint smoke tests
curl http://localhost:4100/sports | jq '.data | length'  # Should be 12
curl http://localhost:4100/iptv/providers | jq '.data | length'  # Should be 13
curl http://localhost:4100/iptv/channels | jq '.data | length'  # Should be 4507
curl http://localhost:4100/matches | jq '.data | length'  # Should be 6
curl http://localhost:4100/streams | jq '.data | length'  # Should be 6
```

### 8.3 Data Consistency Checks

```sql
-- Sports restored
SELECT COUNT(*) FROM sports;  -- Must be 12

-- Competitions linked to sports
SELECT COUNT(DISTINCT c.sport_id) FROM competitions c
JOIN sports s ON s.id = c.sport_id;  -- Must be 10

-- Matches linked to competitions
SELECT COUNT(DISTINCT m.competition_id) FROM matches m
JOIN competitions c ON c.id = m.competition_id;  -- Must be 6

-- Streams linked to matches
SELECT COUNT(DISTINCT s.match_id) FROM streams s
JOIN matches m ON m.id = s.match_id;  -- Must be 6

-- No orphaned channels
SELECT COUNT(*) FROM channels c
WHERE c.provider_id NOT IN (
  SELECT id FROM providers WHERE deleted = 0
);  -- Should be 0 or documented
```

---

## PHASE 9: DOCUMENTATION & CLEANUP (Hours 21-24)

### 9.1 Update Architecture Documentation

**Files to update**:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- [README.md](README.md)

**Add sections**:
- Data flow diagrams (text-based)
- Service layer responsibilities
- State machine documentation
- API endpoint specifications
- Mobile/Desktop alignment rules

### 9.2 Add Inline Documentation

**Repository files**: Document WHERE clauses  
**Service files**: Document business rules  
**Route files**: Document request/response shapes

### 9.3 Create Validation Scripts

```bash
# scripts/validate-system-integrity.ts
# Check:
# - All sports have associated data paths
# - No orphaned records
# - State machines are valid
# - Soft-delete consistency
```

---

## ROLLBACK PROCEDURES

### If Sports Recovery Fails
```bash
cp data/gito-corrupted-20260601.sqlite data/gito.sqlite
npm run backend:restart
```

### If Architecture Changes Break Endpoints
```bash
# Revert service layer changes
git checkout HEAD -- apps/backend/src/services/

# Revert route changes
git checkout HEAD -- apps/backend/src/routes/

# Restart backend
npm run backend:restart
```

### If Live Feed Refactoring Breaks Mobile
```bash
# Revert to simple array response
git checkout HEAD -- apps/backend/src/repositories/operations-repository.ts
npm run backend:restart

# Mobile will still function with old filtered data
```

---

## SUCCESS CRITERIA

### Must-Have (Blocking)
- ✅ Sports table has 12 rows
- ✅ GET /sports returns all 12 sports
- ✅ Competitions linked to sports
- ✅ Matches visible in live feed (or with degradation status)
- ✅ No orphaned channels from deleted providers

### Should-Have (High Priority)
- ✅ Service layer enforces business rules
- ✅ Stream state machine validated
- ✅ Soft-delete consistent across entities
- ✅ Desktop and mobile use same API base URL
- ✅ No cache-related data inconsistencies

### Nice-to-Have (Phase 2+)
- ✅ WebSocket real-time updates
- ✅ Comprehensive audit logging
- ✅ Advanced state machine transitions
- ✅ Offline-first mobile support

---

## IMPLEMENTATION TIMELINE

| Phase | Tasks | Hours | Status |
|-------|-------|-------|--------|
| 1 | Data recovery | 2 | 🔴 CRITICAL |
| 2 | Repository cleanup | 2 | 🔴 HIGH |
| 3 | Service layer | 4 | 🔴 HIGH |
| 4 | Live feed refactoring | 4 | 🔴 CRITICAL |
| 5 | Soft-delete consistency | 2 | 🟡 MEDIUM |
| 6 | State machine | 2 | 🟡 MEDIUM |
| 7 | Mobile/Desktop sync | 2 | 🟡 MEDIUM |
| 8 | Testing | 2 | ✅ ONGOING |
| 9 | Documentation | 4 | ✅ ONGOING |
| **TOTAL** | | **24 hours** | |

---

## NEXT STEP

**Execute Phase 1** → Recover sports data from backup immediately.

See FIX_APPLIED_REPORT.md for progress updates.

---

**Plan Created**: 2026-06-01  
**Status**: Ready for implementation  
**Risk Level**: MEDIUM (data recovery is safe, architecture changes are low-risk)
