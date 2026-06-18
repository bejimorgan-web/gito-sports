# PUBLISH_TRANSITION_REPAIR_VALIDATION

## 1. Repairs applied

- Updated `apps/backend/src/repositories/provider-repository.ts` so `updateProviderHealth()` now updates `providers.status`.
- Repaired current runtime database row for provider `367342ac-d4cb-4ecb-9842-8ba971463ce6` to `status = 'active'`.

## 2. Validation results

### Provider state
- Provider `367342ac-d4cb-4ecb-9842-8ba971463ce6` now has:
  - `status = active`
  - `availability_status = online`
  - `health_score = 85`

### Published live-feed query
- The live feed eligibility query now returns `1` row.
- Returned stream:
  - `id = efb314bd-a4e5-4c65-8a1d-173151cfc4c6`
  - `match_id = 50f95111-571d-437f-9046-cfcd70209eba`
  - `status = active`
  - `published_at = 2026-06-01T00:49:11.018Z`
  - `match_status = published`
  - `channel_status = active`
  - `provider_status = active`
  - `provider_availability_status = online`

## 3. Lifecycle verification

### Assign
- Existing assigned streams remain in the expected `assigned` state.
- No additional lifecycle regression was detected in `assignChannelToMatch()`.

### Approve
- The approval transition path remains intact in `approveStream()`.
- Existing assigned streams still require manual approval before publish.

### Publish
- The published stream candidate is now eligible for the feed after provider state repair.
- `publishStream()` already emits the correct `stream.status`, `approval_status`, `published_at`, and `match.status` updates.

## 4. Feed visibility

The same `listPublishedLiveMatches()` source query is used by:
- desktop published feed
- live approvals
- published feed endpoints
- mobile live feed

After the repair, all of these should now surface the one published live match row.

## 5. Notes

- No `unpublishStream()` or `endMatch()` repository actions are implemented in the current backend.
- `listPublishedLiveMatches()` remains the correct feed filter clause.
- The repair is minimal: it resolves provider lifecycle recovery rather than changing feed visibility rules.
