# DATABASE WRITE CONTROL RULES REPORT

**Date**: June 16, 2026  
**Status**: ✅ Design Complete — Ready for Implementation  
**Scope**: Service-layer enforcement boundaries for IPTV import vs admin CRUD  
**Guiding Principle**: Desktop app remains unrestricted. Automated imports are constrained.

---

## EXECUTIVE SUMMARY

The GiTO backend has two categories of write operations:
1. **Admin CRUD** (desktop operators managing sports, competitions, matches, streams, providers) — must remain unrestricted
2. **Automated imports** (M3U playlist sync, Xtream API sync, bulk channel ingestion) — must be constrained to channels/providers only

**The problem**: `ensureSport()`, `ensureCompetition()`, and `ensureTeam()` exist inside `assignChannelToMatch()` in `operations-repository.ts` and are reachable from import code paths. This means an M3U import can trigger creation of sports, competitions, and teams.

**The fix**: Enforce at the IPTV service layer that import operations cannot create or modify sports, competitions, or matches. The existing API structure, repository layer, and architecture are preserved.

---

## 1. CURRENT ARCHITECTURE — ALL WRITE PATHS

### 1.1 Admin CRUD Paths (MUST remain fully functional)

| Operation | Route | Service | Repository | Writes |
|-----------|-------|---------|------------|--------|
| Create sport | `POST /sports` | `CatalogService.createSport()` | `sports-repository.createSport()` | sports |
| Update sport | `PUT /sports/:id` | `CatalogService.updateSport()` | `sports-repository.updateSport()` | sports |
| Delete sport | `DELETE /sports/:id` | `CatalogService.deleteSport()` | `sports-repository.deleteSport()` | sports |
| Create competition | `POST /competitions` | Direct repository call | `competitions-repository.*` | competitions |
| Create match | `POST /matches` | `MatchService.createMatch()` | `matches-repository.createMatch()` | matches |
| Assign stream | `POST /matches/assign-stream` | `MatchService.assignChannelToMatch()` | `operations-repository.assignChannelToMatch()` | matches, streams |
| Approve stream | `POST /streams/:id/approve` | `StreamService.approveStream()` | `operations-repository.approveStream()` | streams |
| Publish stream | `POST /streams/:id/publish` | `StreamService.publishStream()` | `operations-repository.publishStream()` | streams |
| Create provider | `POST /iptv/providers` | `IPTVService.createProvider()` | `provider-repository.createProvider()` | providers |
| Delete provider | `DELETE /iptv/providers/:id` | `IPTVService.deleteProvider()` | `provider-repository.softDeleteProvider()` | providers, channels |

### 1.2 Automated Import Paths (MUST be restricted)

| Operation | Route | Service | Repository | Currently Writes | SHOULD WRITE ONLY |
|-----------|-------|---------|------------|:----------------:|:------------------:|
| Test & sync M3U | `POST /iptv/providers/:id/test` | `IPTVService.syncProviderChannels()` | `provider-repository.syncProviderChannels()` | channels, providers | channels, providers |
| Upload M3U text | `POST /iptv/providers/:id/m3u` | `IPTVService.syncProviderChannels()` | `provider-repository.syncProviderChannels()` | channels, providers | channels, providers |
| Xtream sync | `POST /iptv/providers/:id/xtream/sync` | `IPTVService.syncProviderChannels()` | `provider-repository.syncProviderChannels()` | channels, providers | channels, providers |
| Assign-stream (from import context) | `POST /matches/assign-stream` | `MatchService.assignChannelToMatch()` | `operations-repository.assignChannelToMatch()` | **sports, competitions, matches, streams** | **matches, streams** (BUT this is admin CRUD, not import) |

---

## 2. THE CRITICAL CODE PATH — `assignChannelToMatch()`

### 2.1 What It Does

`assignChannelToMatch()` in `apps/backend/src/repositories/operations-repository.ts` creates **four entities in one call**:

```typescript
// Line 189-192: Creates sports, competitions, teams if they don't exist
const sportId = ensureSport(input.sportName);          // ← CREATES sports row
const competitionId = ensureCompetition(sportId, input.competitionName);  // ← CREATES competitions row
const homeTeamId = ensureTeam(sportId, input.homeTeamName);  // ← CREATES teams row
const awayTeamId = ensureTeam(sportId, input.awayTeamName);  // ← CREATES teams row

// Line 197-213: Creates match
// Line 215-221: Creates stream + assignment
```

This design is intentional — it allows an operator to assign a match to a channel without having to pre-create all catalog entities. It is an **admin convenience function**, not an import function.

### 2.2 Why This Is Not the Problem

`assignChannelToMatch()` is called from `MatchService.assignChannelToMatch()`, which is called from `POST /matches/assign-stream`. This is an **admin-only route** (requires operator authentication). Imports do NOT call this route — they call `syncProviderChannels()` which only writes to `channels` and `providers` tables.

### 2.3 What IS the Problem

The import routes (`POST /iptv/providers/:id/test`, `/m3u`, `/xtream/sync`) call `IPTVService.syncProviderChannels()` → `provider-repository.syncProviderChannels()`. This function writes **only** to the `channels` table and the `providers` table. **It does not touch sports, competitions, or matches.**

However, the import routes also call `setProviderStatus()` which updates provider status — this is correct and expected.

**Verdict**: The current codebase ALREADY prevents imports from writing to sports/competitions/matches at the repository level. The risk is not in the current code — it's in **future code** and **indirect side effects**.

---

## 3. ENFORCEMENT POINTS

### 3.1 Zone 1: IPTV Service Layer (FIRST LINE OF DEFENSE)

`apps/backend/src/services/iptv-service.ts` — already clean. Only delegates to:
- `provider-repository.listProviders()`
- `provider-repository.getProviderById()`
- `provider-repository.createProvider()`
- `provider-repository.updateProvider()`
- `provider-repository.softDeleteProvider()`
- `provider-repository.listChannels()`
- `provider-repository.listChannelCategories()`
- `provider-repository.syncProviderChannels()`
- `provider-repository.setProviderStatus()`

**All of these operate only on `providers` and `channels` tables.** No sports, competitions, or matches.

**✅ Already compliant — no changes needed.**

### 3.2 Zone 2: IPTV Route Layer (SECOND LINE OF DEFENSE)

`apps/backend/src/routes/iptv.ts` — all import routes:
- `POST /iptv/providers/:id/test` (M3U) → line 259: calls `IPTVService.syncProviderChannels()`
- `POST /iptv/providers/:id/test` (Xtream) → line 209: calls `IPTVService.syncProviderChannels()`
- `POST /iptv/providers/:id/m3u` → line 311: calls `IPTVService.syncProviderChannels()`
- `POST /iptv/providers/:id/xtream/sync` → line 372: calls `IPTVService.syncProviderChannels()`

**None of these routes access sports, competitions, or matches.**

**✅ Already compliant — no changes needed.**

### 3.3 Zone 3: Repository Layer (THIRD LINE OF DEFENSE)

`apps/backend/src/repositories/provider-repository.ts`:
- `syncProviderChannels()` — writes only to `channels` table (INSERT/UPDATE)
- `softDeleteProvider()` — writes only to `providers` and `channels` tables (UPDATE)
- `createProvider()`, `updateProvider()`, `setProviderStatus()` — write only to `providers` table

**✅ Already compliant — no changes needed.**

### 3.4 Zone 4: Operations Repository (THE RISK ZONE)

`apps/backend/src/repositories/operations-repository.ts`:
- `assignChannelToMatch()` — writes to `sports`, `competitions`, `teams`, `matches`, `streams`
- This function is called ONLY from `MatchService.assignChannelToMatch()` → `POST /matches/assign-stream`

**This is the only code path that creates sports from a non-sports route.** It is intentional and serves the admin workflow. It should remain unchanged.

### 3.5 Zone 5: The `ensureSport()` Function (BOUNDARY FUNCTION)

`apps/backend/src/repositories/operations-repository.ts`, lines 37-55:

```typescript
function ensureSport(name: string): string {
  const database = getDatabase();
  const slug = createSlug(name);
  const existing = database.prepare("SELECT id FROM sports WHERE slug = ?").get(slug) as
    | { id: string }
    | undefined;
  if (existing) { return existing.id; }
  const id = crypto.randomUUID();
  const timestamp = now();
  database.prepare("INSERT INTO sports ...").run(id, name, slug, timestamp, timestamp);
  return id;
}
```

This function is **private to operations-repository.ts** — it cannot be called from provider-repository.ts or iptv-service.ts.

**✅ Already compliant — no changes needed.**

---

## 4. THE ACTUAL GAPS

### 4.1 Gap 1: No Explicit Boundary Documentation

There is no code-level marker that says "IPTV import operations shall NOT write to sports/competitions/matches." The current code happens to be correct, but there is no guard against future changes adding such writes.

### 4.2 Gap 2: No Prevention Against Swallowing Competition sport_id

In `operations-repository.ts`, line 189:
```typescript
const sportId = ensureSport(input.sportName);
```
This creates a sport if one doesn't exist. If an import operation were to call this (even indirectly), it could create sports with names from M3U playlists. Currently no import does this, but there is no compile-time or runtime protection.

### 4.3 Gap 3: Provider Sync Does Not Validate Channel Data Scope

`syncProviderChannels()` only inserts/updates channels. But the function receives `ParsedChannel[]` which is just `{ name, url, externalRef?, groupName? }`. No sports or competition data leaks through this interface. **This is clean by design.**

---

## 5. PROPOSED ENFORCEMENT RULES

### 5.1 Rule 1: IPTV Service Must Never Reference Catalog Entities

**Scope**: `apps/backend/src/services/iptv-service.ts`

**Rule**: The IPTVService shall not import or call any function that reads or writes to `sports`, `competitions`, `matches`, or `teams` tables or their repositories.

**Enforcement**: Code review gate. If any of these imports appear in iptv-service.ts, the PR is rejected:
```
from "../repositories/sports-repository"
from "../repositories/competitions-repository"
from "../repositories/matches-repository"
from "../repositories/teams-repository"
from "./catalog-service"
from "./match-service"
from "./stream-service"
```

**Status**: ✅ Currently compliant. Maintain.

### 5.2 Rule 2: Provider Repository Must Never Reference Catalog Entities

**Scope**: `apps/backend/src/repositories/provider-repository.ts`

**Rule**: The provider-repository shall not import or call any function that reads or writes to `sports`, `competitions`, `matches`, or `teams` tables.

**Enforcement**: Same code review gate as Rule 1.

**Status**: ✅ Currently compliant. Maintain.

### 5.3 Rule 3: IPTV Routes Must Only Return Channel/Provider Data

**Scope**: `apps/backend/src/routes/iptv.ts`

**Rule**: IPTV routes shall not create, update, or delete sports, competitions, matches, or teams — directly or indirectly.

**Enforcement**: Route handlers in iptv.ts shall not call any service method outside of IPTVService. Currently all IPTV routes only call `IPTVService.*` methods.

**Status**: ✅ Currently compliant. Maintain.

### 5.4 Rule 4: `assignChannelToMatch()` Remains Admin-Only

**Scope**: `apps/backend/src/repositories/operations-repository.ts`

**Rule**: The `ensureSport()`, `ensureCompetition()`, `ensureTeam()` functions remain private to operations-repository.ts and are only reachable via `assignChannelToMatch()`.

**Enforcement**: These functions are already module-private (not exported). No change needed.

**Status**: ✅ Currently compliant. Maintain.

### 5.5 Rule 5: Import Must Never Call `assignChannelToMatch()`

**Scope**: All import code paths

**Rule**: No IPTV import operation shall call `assignChannelToMatch()` or any function that internally calls it.

**Enforcement**: Code review gate. Import handlers in iptv.ts shall not import `MatchService` or `StreamService`.

**Status**: ✅ Currently compliant. Maintain.

---

## 6. THE ASSIGN-STREAM BOUNDARY ISSUE

### 6.1 The Problem

`assignChannelToMatch()` at `operations-repository.ts:161` is the ONLY function that creates sports, competitions, AND matches in a single call. It is called from `POST /matches/assign-stream` which is used by the desktop app for operator match scheduling.

### 6.2 The Risk

The `ensureSport()` function (lines 37-55) creates a sport if the slug doesn't exist. This means if an operator misspells a sport name like "Soccer" as "Soccerr", a new sport with slug "soccerr" is created. This is by design for the admin flow but illustrates the danger of implicit catalog creation.

### 6.3 The Guard

`ensureSport()` is NOT exported from `operations-repository.ts`. It's a private function. It can only be executed via `assignChannelToMatch()`, `approveStream()`, and `publishStream()` — all of which are admin-only operations.

**No change needed.** The guard is already in place.

---

## 7. IMPLEMENTATION PLAN

### 7.1 What Must Be Done (Minimal Code Changes)

| # | Change | File | Lines | Risk | Effort |
|---|--------|------|:-----:|:----:|:------:|
| 1 | Make `ensureSport()` explicitly non-importable | `operations-repository.ts` | 37-55 | 🟢 None | Already private |
| 2 | Add module-level comment documenting the import boundary | `iptv-service.ts` | 1 | 🟢 None | 1 line |
| 3 | Add module-level comment documenting the import boundary | `provider-repository.ts` | 1 | 🟢 None | 1 line |
| 4 | Create shared documentation constant | `iptv-service.ts` | after imports | 🟢 None | 3 lines |
| 5 | Add TypeScript lint rule (optional) | `eslint.config.js` | new | 🟢 Low | Project-specific |

### 7.2 What Must NOT Change

| Area | Reason |
|------|--------|
| `assignChannelToMatch()` in operations-repository | Admin CRUD must remain unrestricted |
| `ensureSport()`, `ensureCompetition()`, `ensureTeam()` | Admin convenience functions, correctly scoped |
| `syncProviderChannels()` in provider-repository | Already restricted to channels/providers |
| All IPTV routes | Already only call IPTVService methods |
| All admin CRUD routes | Must remain unrestricted |
| Service layer structure | No new architecture layers |
| Repository layer structure | No new architecture layers |

---

## 8. VERIFICATION CHECKLIST

### 8.1 Code Review Gate Questions

For every PR that touches `apps/backend/src/routes/iptv.ts`, `apps/backend/src/services/iptv-service.ts`, or `apps/backend/src/repositories/provider-repository.ts`, ask:

1. Does this change add a call to a sports/competitions/matches repository?
   - ✅ Allow ONLY if it's read-only (e.g., displaying sport name on a channel)
   - ❌ **REJECT** if it creates/updates/deletes catalog entities

2. Does this change import anything from `CatalogService`, `MatchService`, or `StreamService`?
   - ❌ **REJECT** — IPTV layer must not call catalog or match services

3. Does this change call `assignChannelToMatch()`?
   - ❌ **REJECT** — imports must never create matches or catalog entities

4. Does this change modify `ensureSport()`, `ensureCompetition()`, or `ensureTeam()`?
   - ❌ **REJECT** unless reviewed by senior architect — these are sensitive boundary functions

### 8.2 Startup Validation (For Future Implementation)

If a startup check is added to `connection.ts`, the following range check would catch accidental data drift:

```
Expected range (operator dataset):
  sports: 10-12
  channels: 2,000-5,000

Warning thresholds:
  sports < 10  → "CRITICAL: Sports may have been deleted"
  channels > 10,000 → "WARNING: Channel count exceeds operator baseline"
```

---

## 9. DIAGRAM: WRITE BOUNDARIES

```
┌─────────────────────────────────────────────────────┐
│                   ADMIN CRUD ZONE                    │
│  (FULL ACCESS — desktop operators)                   │
│                                                      │
│  POST /sports          → sports table                │
│  POST /competitions    → competitions table           │
│  POST /matches         → matches table                │
│  POST /matches/assign-stream → sports, competitions,  │
│         teams, matches, streams                       │
│  POST /streams/:id/approve  → streams, matches        │
│  POST /streams/:id/publish  → streams, matches        │
│  POST /iptv/providers → providers table               │
│  DELETE /iptv/providers/:id → providers, channels     │
│                                                      │
└─────────────────────────────────────────────────────┘
                        │
                        │ BOUNDARY — NO CROSSING
                        ▼
┌─────────────────────────────────────────────────────┐
│                AUTOMATED IMPORT ZONE                  │
│  (RESTRICTED — channels/providers ONLY)              │
│                                                      │
│  ❌ NO access to sports, competitions, matches       │
│  ❌ NO access to CatalogService                      │
│  ❌ NO access to MatchService                        │
│  ❌ NO access to StreamService                        │
│                                                      │
│  POST /iptv/providers/:id/test  → channels, providers│
│  POST /iptv/providers/:id/m3u   → channels, providers│
│  POST /iptv/providers/:id/xtream/sync → channels     │
│                                                      │
│  ✅ providers table (create, update, soft-delete)    │
│  ✅ channels table (insert, update, mark inactive)   │
│  ❌ sports table                                     │
│  ❌ competitions table                               │
│  ❌ matches table                                    │
│  ❌ streams table                                    │
│  ❌ teams table                                      │
│  ❌ countries table                                  │
└─────────────────────────────────────────────────────┘
```

---

## 10. CONCLUSION

### Current State: ✅ The codebase is already compliant.

After thorough source code analysis of all write paths, the enforcement boundary is **already in place**:

1. `iptv-service.ts` only references `provider-repository` functions — no catalog entities
2. `provider-repository.ts` only writes to `providers` and `channels` tables — no catalog entities
3. `iptv.ts` routes only call `IPTVService.*` methods — no catalog service calls
4. `ensureSport()`, `ensureCompetition()`, `ensureTeam()` are private to `operations-repository.ts` — cannot be called from import code
5. `syncProviderChannels()` only inserts/updates channels and providers — no other tables

### What Is Needed

**No code changes are required** to enforce the write boundary. The existing architecture already separates admin CRUD from automated imports at the service layer.

The only deliverable is this report, which documents:
- The boundary rules
- The verification checklist for code reviews
- The write zone diagram
- The three import endpoints that are restricted

### Ongoing Maintenance

Every future PR that touches import code must pass the verification checklist in Section 8 before merging. This is a **process change**, not a code change.