# PUBLISH_TRANSITION_REPAIR_PLAN

## 1. Expected lifecycle states

### After Assign
- `match.status = 'assigned'`
- `stream.status = 'assigned'`
- `stream.approval_status = 'assigned'`
- `stream.published_at = NULL`
- `stream.health_status = 'unknown'` (default)
- `match.updated_at` = assignment time
- `stream.updated_at` = assignment time

### After Approve
- `match.status = 'approved'`
- `stream.status = 'approved'`
- `stream.approval_status = 'approved'`
- `stream.approved_at` = approval time
- `stream.updated_at` = approval time
- `match.updated_at` = approval time

### After Publish
- `stream.status = 'active'`
- `stream.approval_status = 'active'`
- `stream.published_at` = publish time
- `match.status = 'published'`
- `match.updated_at` = publish time
- `stream.updated_at` = publish time
- `stream.health_status != 'failed'`
- `channel.status = 'active'`
- `provider.status = 'active'`
- `provider.availability_status != 'offline'`

## 2. Current feed eligibility clause

The published live feed is selected by `listPublishedLiveMatches()`:

```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

## 3. Streams currently excluded and state comparison

### Stream 317c18d1-9e58-454e-8458-5f78db5f5223
- `match.status = cancelled`
- `stream.status = failed`
- `stream.approval_status = failed`
- `stream.health_status = failed`
- `stream.published_at = 2026-05-29T17:44:33.328Z`
- `provider.status = failed`
- `provider.availability_status = online`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.health_status != failed`
- `provider.status = active`

ACTUAL STATE
- `match.status = cancelled`
- `stream.status = failed`
- `stream.approval_status = failed`
- `stream.health_status = failed`

FAILING FILTERS
- `s.status = 'active'`
- `m.status = 'published'`
- `s.health_status != 'failed'`
- `p.status = 'active'`

### Stream 044b95c1-7d78-4f67-b686-b20793210e54
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`
- `provider.status = failed`
- `provider.availability_status = unknown`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at != NULL`
- `provider.status = active`

ACTUAL STATE
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`

FAILING FILTERS
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### Stream 2953b8fd-9208-4740-acd7-fe3b04536770
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`
- `provider.status = failed`
- `provider.availability_status = unknown`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at != NULL`
- `provider.status = active`

ACTUAL STATE
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`

FAILING FILTERS
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### Stream 7d7d19b7-723c-4087-b9d4-d05118aa658f
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`
- `provider.status = failed`
- `provider.availability_status = unknown`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at != NULL`
- `provider.status = active`

ACTUAL STATE
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`

FAILING FILTERS
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### Stream f9813da7-7d9e-49dd-a457-c45d5fa13c8e
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`
- `provider.status = failed`
- `provider.availability_status = unknown`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at != NULL`
- `provider.status = active`

ACTUAL STATE
- `match.status = assigned`
- `stream.status = assigned`
- `stream.approval_status = assigned`
- `stream.published_at = NULL`

FAILING FILTERS
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### Stream efb314bd-a4e5-4c65-8a1d-173151cfc4c6
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at = 2026-06-01T00:49:11.018Z`
- `provider.status = failed`
- `provider.availability_status = online`

EXPECTED STATE AFTER PUBLISH
- `match.status = published`
- `stream.status = active`
- `stream.approval_status = active`
- `stream.published_at != NULL`
- `provider.status = active`

ACTUAL STATE
- `provider.status = failed`

FAILING FILTERS
- `p.status = 'active'`

## 4. Root causes

- **Publish transition logic itself appears complete.** `publishStream()` correctly updates `stream.status`, `stream.approval_status`, `stream.published_at`, and `match.status`.
- **The one published candidate is excluded by provider lifecycle state.** Provider health is good, but `provider.status` remains `failed`.
- **Most streams have not reached publish.** They are still in `assigned` state, so their exclusion is expected until approval/publish happens.
- **There is no `unpublishStream()` or `endMatch()` implementation.** These lifecycle actions are not available in the current backend.

## 5. Repair actions

### A. Fix publish transition
- The publish workflow is logically correct.
- No missing `stream.status` / `approval_status` / `match.status` updates are present in `publishStream()`.

### B. Fix approval transition
- Approval workflow is logically correct.
- The currently excluded assigned streams have not yet been approved or published; this is not a code bug for `approveStream()` itself.

### C. Fix query filter
- The feed WHERE clause is consistent with publish eligibility.
- It should remain unchanged.

### D. Data repair needed
- Restore provider state for the currently published candidate provider.
- Ensure providers whose health recovers from failure can regain `status = active` so a published stream becomes feed-visible.

### E. Minimal implementation plan
1. Update `updateProviderHealth()` in `apps/backend/src/repositories/provider-repository.ts` to recover providers from `failed` when health reports success or degraded operation.
2. Repair the current runtime database for provider `367342ac-d4cb-4ecb-9842-8ba971463ce6` (the provider attached to the currently published stream) to `status = 'active'`.
3. Revalidate the published/live feed query.

## 6. Expected outcome

- The currently published stream `efb314bd-a4e5-4c65-8a1d-173151cfc4c6` should become visible in the feed.
- Other assigned streams remain excluded until they complete approval/publish transitions.
- The backend lifecycle becomes consistent by aligning provider status with provider health.
