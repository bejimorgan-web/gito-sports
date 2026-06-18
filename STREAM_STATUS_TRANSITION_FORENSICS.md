# STREAM_STATUS_TRANSITION_FORENSICS

## 1. Source of truth for publish transition

### publishStream()
Location: `apps/backend/src/repositories/operations-repository.ts`

Expected stream state after successful publish:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at` = non-null timestamp
- `updated_at` = publish timestamp
- `created_at` remains unchanged

Expected match state after successful publish:
- `status = 'published'`
- `updated_at` = publish timestamp

Additional conditions required for publish:
- stream must currently be `status = 'approved'`
- match must currently be `status = 'published'` (via `assertMatchTransition`)
- stream health must not be `failed`
- channel status must be `active`
- provider status must be `active`

### approveStream()
Location: `apps/backend/src/repositories/operations-repository.ts`

Expected stream state after approve:
- `status = 'approved'`
- `approval_status = 'approved'`
- `approved_at` = approval timestamp
- `updated_at` = approval timestamp

Expected match state after approve:
- `status = 'approved'`
- `updated_at` = approval timestamp

### assignStream equivalent
The repository does not expose `assignStream()` by that exact name.
The function that creates a new assignment is `assignChannelToMatch()` in the same file.
It inserts:
- `matches.status = 'assigned'`
- `streams.status = 'assigned'`
- `streams.approval_status = 'assigned'`

### unpublishStream()
No `unpublishStream()` repository function exists.
The route `POST /live-matches/:matchId/unpublish` explicitly returns `405` with `unpublish_not_supported`.

### endMatch()
No `endMatch()` repository function exists in the backend source.

## 2. Exact live feed WHERE clause

From `listPublishedLiveMatches()` in `apps/backend/src/repositories/operations-repository.ts`:

```sql
WHERE s.status = 'active'
  AND s.published_at IS NOT NULL
  AND m.status = 'published'
  AND s.health_status != 'failed'
  AND c.status = 'active'
  AND p.status = 'active'
  AND p.availability_status != 'offline'
```

## 3. Expected final values after publish

For a stream to be successfully published and visible in the live feed, the repository expects:
- `stream.status = 'active'`
- `stream.approval_status = 'active'`
- `stream.published_at` non-null
- `match.status = 'published'`
- `stream.health_status` not `failed`
- `channel.status = 'active'`
- `provider.status = 'active'`
- `provider.availability_status != 'offline'`

## 4. Stream row transition forensic summary

### Stream 317c18d1-9e58-454e-8458-5f78db5f5223
- `match_id`: a1d8012f-6319-4b77-9995-0d7cbb6521fb
- `status`: failed
- `approval_status`: failed
- `health_status`: failed
- `published_at`: 2026-05-29T17:44:33.328Z
- `created_at`: 2026-05-29T17:44:31.527Z
- `updated_at`: 2026-05-29T17:44:34.235Z
- `match.status`: cancelled
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: online

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `health_status != 'failed'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'failed'`
- `approval_status = 'failed'`
- `published_at` is set, but stream is failed
- `match.status = 'cancelled'`
- `health_status = 'failed'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `s.status = 'active'`
- `m.status = 'published'`
- `s.health_status != 'failed'`
- `p.status = 'active'`

---

### Stream 044b95c1-7d78-4f67-b686-b20793210e54
- `match_id`: 881a801d-40d7-46fb-9549-f7db712e5a02
- `status`: assigned
- `approval_status`: assigned
- `health_status`: unknown
- `published_at`: null
- `created_at`: 2026-05-31T22:45:49.196Z
- `updated_at`: 2026-05-31T22:45:49.196Z
- `match.status`: assigned
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: unknown

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'assigned'`
- `approval_status = 'assigned'`
- `published_at = NULL`
- `match.status = 'assigned'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

---

### Stream 2953b8fd-9208-4740-acd7-fe3b04536770
- `match_id`: cd750548-76f0-497f-93c2-b0d65c75ac2f
- `status`: assigned
- `approval_status`: assigned
- `health_status`: unknown
- `published_at`: null
- `created_at`: 2026-05-31T22:45:53.340Z
- `updated_at`: 2026-05-31T22:45:53.340Z
- `match.status`: assigned
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: unknown

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'assigned'`
- `approval_status = 'assigned'`
- `published_at = NULL`
- `match.status = 'assigned'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

---

### Stream 7d7d19b7-723c-4087-b9d4-d05118aa658f
- `match_id`: eff04bb3-d47e-4924-9d8d-ecd4cac2f5b4
- `status`: assigned
- `approval_status`: assigned
- `health_status`: unknown
- `published_at`: null
- `created_at`: 2026-05-31T22:46:58.094Z
- `updated_at`: 2026-05-31T22:46:58.094Z
- `match.status`: assigned
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: unknown

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'assigned'`
- `approval_status = 'assigned'`
- `published_at = NULL`
- `match.status = 'assigned'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

---

### Stream f9813da7-7d9e-49dd-a457-c45d5fa13c8e
- `match_id`: 6959d368-f8ba-4637-97cb-ce3ceef045fb
- `status`: assigned
- `approval_status`: assigned
- `health_status`: unknown
- `published_at`: null
- `created_at`: 2026-05-31T22:47:07.023Z
- `updated_at`: 2026-05-31T22:47:07.023Z
- `match.status`: assigned
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: unknown

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'assigned'`
- `approval_status = 'assigned'`
- `published_at = NULL`
- `match.status = 'assigned'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `s.status = 'active'`
- `s.published_at IS NOT NULL`
- `m.status = 'published'`
- `p.status = 'active'`

---

### Stream efb314bd-a4e5-4c65-8a1d-173151cfc4c6
- `match_id`: 50f95111-571d-437f-9046-cfcd70209eba
- `status`: active
- `approval_status`: active
- `health_status`: unknown
- `published_at`: 2026-06-01T00:49:11.018Z
- `created_at`: 2026-06-01T00:49:08.950Z
- `updated_at`: 2026-06-01T00:49:11.018Z
- `match.status`: published
- `channel.status`: active
- `provider.status`: failed
- `provider.availability_status`: online

EXPECTED:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at != NULL`
- `match.status = 'published'`
- `provider.status = 'active'`

ACTUAL:
- `status = 'active'`
- `approval_status = 'active'`
- `published_at` is set
- `match.status = 'published'`
- `provider.status = 'failed'`

FAILING FILTERS:
- `p.status = 'active'`

## 5. Conclusion and recommendation

- The repository code is not using a bad feed query: `listPublishedLiveMatches()` correctly checks published/active states.
- Most streams are excluded because they never reached the publish transition at all.
- The one stream that has been published successfully from the stream/match perspective (`efb314bd...`) is still excluded due to provider state.

FINAL RECOMMENDATION:
- **A. Fix publish transition.**
- The current data indicates that publish workflow is incomplete for most streams.
- A second issue is provider lifecycle correctness, which should be resolved so published streams can actually appear in the feed.
