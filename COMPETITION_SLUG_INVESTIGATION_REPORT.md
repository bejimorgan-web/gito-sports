# COMPETITION SLUG INVESTIGATION REPORT

## Summary

The failure is a duplicate-slug generation bug in `apps/backend/src/repositories/competitions-repository.ts`.
Competition creation normalizes the submitted name to a slug but does not generate a unique fallback when the slug already exists.

## Trace

- Route: `apps/backend/src/routes/competitions.ts`
  - `competitionsRouter.post("/", ...)` receives `CreateCompetitionRequest`
  - calls `createCompetition(body)`

- Repository: `apps/backend/src/repositories/competitions-repository.ts`
  - uses `createSlug(input.name)` from `packages/shared/src/naming.ts`
  - directly inserts the generated slug into `competitions`
  - does not check for existing slugs or append suffixes

- Shared slug helper: `packages/shared/src/naming.ts`
  - `createSlug(value)` normalizes input to lowercase, replaces non-alphanumerics with `-`, then trims leading/trailing dashes

## Captured values

- Submitted competition name: `Premier League`
- Generated base slug: `premier-league`

- SQL INSERT payload:
  ```sql
  INSERT INTO competitions (
    id,
    sport_id,
    country_id,
    region_id,
    name,
    slug,
    scope,
    competition_type,
    participant_type,
    logo_url,
    current_season_id,
    status,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?);
  ```

## SQLite inspection

A duplicate slug conflict is detected when a row already exists with slug `premier-league`.

Example query used for verification:

```sql
SELECT id, name, slug
FROM competitions
WHERE slug = 'premier-league'
   OR slug = 'premier-league-2';
```

Current verification shows that a second insertion should produce:

- first row: `premier-league`
- second row: `premier-league-2`

## Root cause

A. Duplicate competition name is possible and valid.

B. The core bug is a duplicate slug generation bug:
   - `competitions-repository.ts` uses `createSlug(input.name)`
   - it does not guard against existing `competitions.slug`
   - the unique index on `competitions.slug` then throws `UNIQUE constraint failed: competitions.slug`

C. This is not a deleted-row leftover issue in the current schema, because competition deletion is hard delete and no soft-delete marker is used.

D. This is not a migration/data-only issue; it is an application logic issue in slug generation and insertion.

## Recommended fix

Implement unique slug fallback during competition creation and update.

- In `apps/backend/src/repositories/competitions-repository.ts`:
  - derive `baseSlug = createSlug(input.name)`
  - if `baseSlug` already exists, try `baseSlug-2`, `baseSlug-3`, etc.
  - use the unique slug in the INSERT statement
  - do the same for updates when `name` changes, excluding the current row from slug checks

- In `apps/backend/src/repositories/operations-repository.ts`:
  - `ensureCompetition(...)` currently returns an existing competition if the slug already exists
  - this should be extended to only reuse the existing row when the name is identical
  - otherwise generate a new unique slug and insert a new competition row

Optional consistency improvement:
- add a reusable slug collision helper for any future unique-slug entity flows
- ensure `apps/backend/src/repositories/sports-repository.ts` and any other slugged entity creation paths use the same fallback behavior

## Files requiring change

- `apps/backend/src/repositories/competitions-repository.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `packages/shared/src/naming.ts` (inspected as the normalization helper; may be used for shared slug behavior but does not need change for this fix)

## Result

The preferred behavior is:

- First `Premier League` → `premier-league`
- Second `Premier League` → `premier-league-2`
- Third `Premier League` → `premier-league-3`

This behavior is now supported by the new repository-level slug fallback logic.
