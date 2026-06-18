# PUBLISHED_FEED_FILTER_FORENSICS

## 1. Runtime tables inspected

Database: `data/gito.sqlite`

### matches
- id: a1d8012f-6319-4b77-9995-0d7cbb6521fb, status: cancelled
- id: 881a801d-40d7-46fb-9549-f7db712e5a02, status: assigned
- id: cd750548-76f0-497f-93c2-b0d65c75ac2f, status: assigned
- id: eff04bb3-d47e-4924-9d8d-ecd4cac2f5b4, status: assigned
- id: 6959d368-f8ba-4637-97cb-ce3ceef045fb, status: assigned
- id: 50f95111-571d-437f-9046-cfcd70209eba, status: published

### streams
- id: 317c18d1-9e58-454e-8458-5f78db5f5223, match_id: a1d8012f-6319-4b77-9995-0d7cbb6521fb, status: failed, approval_status: failed, health_status: failed, published_at: 2026-05-29T17:44:33.328Z
- id: 044b95c1-7d78-4f67-b686-b20793210e54, match_id: 881a801d-40d7-46fb-9549-f7db712e5a02, status: assigned, approval_status: assigned, health_status: unknown, published_at: null
- id: 2953b8fd-9208-4740-acd7-fe3b04536770, match_id: cd750548-76f0-497f-93c2-b0d65c75ac2f, status: assigned, approval_status: assigned, health_status: unknown, published_at: null
- id: 7d7d19b7-723c-4087-b9d4-d05118aa658f, match_id: eff04bb3-d47e-4924-9d8d-ecd4cac2f5b4, status: assigned, approval_status: assigned, health_status: unknown, published_at: null
- id: f9813da7-7d9e-49dd-a457-c45d5fa13c8e, match_id: 6959d368-f8ba-4637-97cb-ce3ceef045fb, status: assigned, approval_status: assigned, health_status: unknown, published_at: null
- id: efb314bd-a4e5-4c65-8a1d-173151cfc4c6, match_id: 50f95111-571d-437f-9046-cfcd70209eba, status: active, approval_status: active, health_status: unknown, published_at: 2026-06-01T00:49:11.018Z

### scheduling_matches
- id: 57fbd3f0-5af6-48e8-b8f4-c48fa75d51da, status: scheduled
- id: db7ecab7-acbb-4012-93ec-a556240661cb, status: scheduled

### match_streams
- id: 483b98ea-6626-4491-8200-1df33c7b82f2, match_id: 57fbd3f0-5af6-48e8-b8f4-c48fa75d51da
- id: 3e8c7e15-2f15-4094-93ab-487d2f7e814b, match_id: db7ecab7-acbb-4012-93ec-a556240661cb

## 2. Exact published-live feed WHERE clause

The live feed is built by `apps/backend/src/repositories/operations-repository.ts`:

```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

This function is the source of truth for:
- `/live-matches/current`
- `/live-matches/feed`
- `/live-matches/` (protected route)
- `/mobile/matches/live`

All of these routes use `listPublishedLiveMatches()`.

## 3. Filter evaluation for each stream row

### stream 317c18d1-9e58-454e-8458-5f78db5f5223
- match_id: a1d8012f-6319-4b77-9995-0d7cbb6521fb
- stream_status: failed
- approval_status: failed
- health_status: failed
- published_at: 2026-05-29T17:44:33.328Z
- match_status: cancelled
- channel_status: active
- provider_status: failed
- provider_availability: online

Failed filters:
- `s.status = 'active'`
- `m.status = 'published'`
- `s.health_status != 'failed'`
- `p.status = 'active'`

### stream 044b95c1-7d78-4f67-b686-b20793210e54
- match_id: 881a801d-40d7-46fb-9549-f7db712e5a02
- stream_status: assigned
- approval_status: assigned
- health_status: unknown
- published_at: null
- match_status: assigned
- channel_status: active
- provider_status: failed
- provider_availability: unknown

Failed filters:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### stream 2953b8fd-9208-4740-acd7-fe3b04536770
- match_id: cd750548-76f0-497f-93c2-b0d65c75ac2f
- stream_status: assigned
- approval_status: assigned
- health_status: unknown
- published_at: null
- match_status: assigned
- channel_status: active
- provider_status: failed
- provider_availability: unknown

Failed filters:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### stream 7d7d19b7-723c-4087-b9d4-d05118aa658f
- match_id: eff04bb3-d47e-4924-9d8d-ecd4cac2f5b4
- stream_status: assigned
- approval_status: assigned
- health_status: unknown
- published_at: null
- match_status: assigned
- channel_status: active
- provider_status: failed
- provider_availability: unknown

Failed filters:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### stream f9813da7-7d9e-49dd-a457-c45d5fa13c8e
- match_id: 6959d368-f8ba-4637-97cb-ce3ceef045fb
- stream_status: assigned
- approval_status: assigned
- health_status: unknown
- published_at: null
- match_status: assigned
- channel_status: active
- provider_status: failed
- provider_availability: unknown

Failed filters:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

### stream efb314bd-a4e5-4c65-8a1d-173151cfc4c6
- match_id: 50f95111-571d-437f-9046-cfcd70209eba
- stream_status: active
- approval_status: active
- health_status: unknown
- published_at: 2026-06-01T00:49:11.018Z
- match_status: published
- channel_status: active
- provider_status: failed
- provider_availability: online

Failed filters:
- `p.status = 'active'`

## 4. Why zero rows are returned

- There are 6 stream rows in `streams`, but every one fails at least one feed filter.
- Only `efb314bd-a4e5-4c65-8a1d-173151cfc4c6` has all required stream/match conditions except provider status.
- The other 5 streams are excluded because they are not published and/or not active and/or their parent match is not published.
- In all 6 cases, provider state is also a failure point for all streams because the provider status is `failed`.

## 5. Data existence versus filtering

- Data exists in the runtime database.
- There is not a data absence issue in `matches` or `streams` generally.
- The published-live feed is empty because the current rows do not satisfy feed eligibility rules.
- In particular, the most promising candidate stream is blocked only by provider status.

## 6. Mobile/live approvals/current live match query alignment

All of these paths use the same source query:
- `apps/backend/src/repositories/operations-repository.ts` → `listPublishedLiveMatches()`
- `apps/backend/src/routes/live-matches.ts` → `/live-matches/current`, `/live-matches/feed`, `/live-matches/`
- `apps/backend/src/routes/mobile.ts` → `/mobile/matches/live`

There is no separate mobile-only feed query; mobile and desktop current live-match screens share the same repository filter.

## 7. Recommendation

**B. Data exists, fix status transitions.**

Rationale:
- The DB contains a published active stream with a published match.
- The only remaining failure for that row is `provider.status = 'failed'`.
- Several other streams are blocked by incomplete publish/approval transitions.

### Suggested next focus
- Restore or repair provider status for the candidate live stream(s).
- Confirm the transition path that should set `streams.status = 'active'`, `streams.published_at != NULL`, `matches.status = 'published'`, and `providers.status = 'active'`.
- Verify whether the provider health workflow should change `p.status` from `failed` to `active` when the stream is actually ready for live feed.
