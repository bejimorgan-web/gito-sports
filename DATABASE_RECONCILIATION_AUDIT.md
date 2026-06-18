# DATABASE_RECONCILIATION_AUDIT

## 1. Executive Summary

Databases A (`data\gito.sqlite`) and B (`apps\backend\data\gito.sqlite`) contain **completely separate datasets** with no record overlap across all audited tables.

- **Latest IPTV work**: Database A (2026-06-01T16:55:29.182Z vs. 2026-06-01T16:20:29.368Z)
- **Latest catalog work**: Database B (2026-06-01T10:17:10.728Z vs. 2026-06-01T00:49:07.447Z)
- **Latest published stream**: Database B (2026-06-01T16:04:47.413Z vs. 2026-06-01T00:49:11.018Z)
- **Merge required**: **NO** — These datasets represent different operational contexts and cannot be meaningfully merged due to complete ID divergence.

## 2. Record comparison by table

| Table | Database A | Database B | Only in A | Only in B | In Both | Status |
|---|---|---|---|---|---|---|
| sports | 12 | 1 | 12 | 1 | 0 | **Divergent** |
| countries | 8 | 2 | 8 | 2 | 0 | **Divergent** |
| competitions | 10 | 5 | 10 | 5 | 0 | **Divergent** |
| teams | 20 | 57 | 20 | 57 | 0 | **Divergent** |
| providers | 12 | 25 | 12 | 25 | 0 | **Divergent** |
| channels | 2411 | 19253 | 2411 | 19253 | 0 | **Divergent** |
| matches | 6 | 6 | 6 | 6 | 0 | **Divergent** |
| streams | 6 | 5 | 6 | 5 | 0 | **Divergent** |

### Record interpretation

- **Zero overlap on primary keys**: No two records share the same `id` across any table.
- **Slug-based matching check**: Sports in A include `football`, `sport-validation-9e686212`, `hostsport-d01672f0`. Sports in B include only `soccer`. No slug overlap either.
- **Provider name samples**: A contains `Reliability Inline M3U`, `Provider Sport 9e686212`, `Provider Host d01672f0`. B contains `Smoke Test M3U`, `Governance M3U`, `Free To Air`. Completely distinct.

## 3. Data categorization

### Database A (`data\gito.sqlite`) — OPERATOR_DB

**Content**: 12 sports with names like "Football", and validation/test data.

**Latest provider record**:
- ID: `78dc0da9-7a89-44ee-aee1-38431531f0c9`
- Updated: `2026-06-01T16:55:29.182Z`

**Latest sport record**:
- ID: `d55bce6a-d809-49d5-afc7-4ee8ba059631`
- Updated: `2026-06-01T00:49:07.447Z`

**Latest published stream**:
- ID: `efb314bd-a4e5-4c65-8a1d-173151cfc4c6`
- Published: `2026-06-01T00:49:11.018Z`

### Database B (`apps\backend\data\gito.sqlite`) — TEST_DB

**Content**: 1 sport ("Soccer"), 25 providers (smoke test, governance, free-to-air), 19253 channels, 57 teams.

**Latest provider record**:
- ID: `42e1071c-3da1-4588-a7ce-a13be00a9c87`
- Updated: `2026-06-01T16:20:29.368Z`

**Latest sport record**:
- ID: `40658823-67c2-4564-8974-3ac180f8bb4e`
- Updated: `2026-06-01T10:17:10.728Z`

**Latest published stream**:
- ID: `a3a8d413-1783-4102-9755-2bcb664f6824`
- Published: `2026-06-01T16:04:47.413Z`

## 4. Work type analysis

### 1. Latest IPTV work

**Winner**: Database A

- A latest provider update: `2026-06-01T16:55:29.182Z`
- B latest provider update: `2026-06-01T16:20:29.368Z`
- **A is 35 minutes newer** (most recent IPTV provider add/edit work).

### 2. Latest catalog work

**Winner**: Database B

- A latest sports update: `2026-06-01T00:49:07.447Z`
- B latest sports update: `2026-06-01T10:17:10.728Z`
- **B is 10 hours newer** (most recent catalog/sports organization work).

### 3. Latest published stream work

**Winner**: Database B

- A latest published stream: `2026-06-01T00:49:11.018Z`
- B latest published stream: `2026-06-01T16:04:47.413Z`
- **B is 15 hours newer** (most recent publish action).

## 5. Merge feasibility assessment

### Why no merge is recommended

1. **Complete ID divergence**: No shared record IDs across any table. A merge would require:
   - Creating a mapping between A and B records (no natural key alignment).
   - Deciding which version to keep when records are functionally similar (no common identifiers).
   - Handling orphaned references (e.g., if a match in A references a provider ID that doesn't exist in B).

2. **Separate operational contexts**: The data suggests:
   - A: Operator database with real sports (e.g., "Football") and operational data.
   - B: Test/smoke-test database with synthetic data (provider names like "Smoke Test M3U", "Governance M3U") and different channel counts (19253 vs. 2411).

3. **No deduplication criteria**: Without a shared business identifier (e.g., shared sport name + provider name + region), there is no safe way to identify which records represent the same real-world entity.

### If a merge were attempted

- **Data loss risk**: HIGH (overwriting real operator data with test data or vice versa).
- **Referential integrity risk**: HIGH (matches in A reference provider IDs that don't exist in B, and vice versa).
- **Operational impact**: **CRITICAL** — Publishing from a merged database could broadcast incorrect matches, streams, or provider configurations.

## 6. Recommendations

1. **Do NOT merge these databases.**
2. **Backend should use Database A** (`data\gito.sqlite`) as the active working database, which is already configured as the default `DATABASE_PATH`.
3. **Archive or isolate Database B** (`apps\backend\data\gito.sqlite`) as a test artifact to prevent accidental activation.
4. **If new IPTV provider work occurs** after this point, ensure all changes are made in Database A only.
5. **If Database B contains intended test data**, export it separately for regression testing, but do not merge into A.

---

> **Audit Status**: Read-only audit completed. No modifications, migrations, or deletes were performed on either database.
