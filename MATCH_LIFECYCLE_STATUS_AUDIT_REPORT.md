# MATCH_LIFECYCLE_STATUS_AUDIT_REPORT

## Summary

This audit verifies the end-to-end lifecycle from stream assignment through approval and live publication.

It uses the backend routes and repository logic implemented in:
- `apps/backend/src/routes/matches.ts`
- `apps/backend/src/routes/streams.ts`
- `apps/backend/src/repositories/operations-repository.ts`
- `apps/backend/src/middleware/transition-guards.ts`
- `apps/backend/src/db/schema/initial-schema.sql`

UI gating behavior is derived from:
- `apps/desktop/src/renderer/features/broadcast/BroadcastConsoleScreen.tsx`
- `apps/desktop/src/renderer/features/approvals/LiveMatchApprovalScreen.tsx`

## Test data

### Selected active channel/provider
- `channel.id`: `0eb77c59-5959-4857-9725-0b844032c38f`
- `channel.url`: `https://example.com/live/reliability-inline.m3u8`
- `provider.id`: `367342ac-d4cb-4ecb-9842-8ba971463ce6`
- `provider.status`: `active`
- `provider.deleted`: `0`
- `provider.availability_status`: `online`

### Audit payload
```json
{
  "sportName": "Lifecycle Audit Sport",
  "competitionName": "Lifecycle Audit Competition",
  "homeTeamName": "Lifecycle Audit Home",
  "awayTeamName": "Lifecycle Audit Away",
  "startsAt": "2026-06-01T00:49:07.443Z",
  "channelId": "0eb77c59-5959-4857-9725-0b844032c38f"
}
```

## Step 1: create a test match via assignment

### Backend action
Route: `POST /matches/assign-stream`
Repository: `assignChannelToMatch()`

### Resulting match row
- `match.id`: `50f95111-571d-437f-9046-cfcd70209eba`
- `match.status`: `assigned`
- `competition_id`: `ea9c05e9-f411-45d2-9cb5-2371cdd7b61e`
- `home_team_id`: `5960e4c4-76f0-40ee-bc84-24dd58851a9b`
- `away_team_id`: `da80764e-39c0-4864-be6d-eabf06cb0c01`
- `starts_at`: `2026-06-01T00:49:07.443Z`
- `created_at`: `2026-06-01T00:49:08.950Z`
- `updated_at`: `2026-06-01T00:49:08.950Z`

### Stored stream row after assignment
- `stream.id`: `efb314bd-a4e5-4c65-8a1d-173151cfc4c6`
- `stream.match_id`: `50f95111-571d-437f-9046-cfcd70209eba`
- `stream.channel_id`: `0eb77c59-5959-4857-9725-0b844032c38f`
- `status`: `assigned`
- `approval_status`: `assigned`
- `health_status`: `unknown`
- `published_at`: `null`

## Step 2: assign preview stream

### UI expected state
In `BroadcastConsoleScreen.tsx`: 
- `previewConfirmed` must be true
- `canAssign` is true when:
  - selected channel exists
  - previewConfirmed is true
  - `assignment` is undefined

This matches the route used by the UI to assign the previewed stream.

### Verification
The audit directly invoked `assignChannelToMatch()`.
After assignment, both the match and stream were created with `assigned` status.

## Step 3: approve stream

### API request
Route: `POST /streams/:streamId/approve`
Middleware: `requireStreamTransition('approved')`

#### Preconditions
`requireStreamTransition()` verifies:
- stream exists
- channel is active
- provider is active and not deleted
- current stream status can transition to `approved`
- current match status can transition to `approved`

### Audit API payload
- `streamId`: `efb314bd-a4e5-4c65-8a1d-173151cfc4c6`
- operatorId: `audit-operator`

### API response
```json
{
  "id": "efb314bd-a4e5-4c65-8a1d-173151cfc4c6",
  "matchId": "50f95111-571d-437f-9046-cfcd70209eba",
  "channelId": "0eb77c59-5959-4857-9725-0b844032c38f",
  "protocol": "hls",
  "status": "approved",
  "approvalStatus": "approved",
  "healthStatus": "unknown",
  "failureCount": 0,
  "createdAt": "2026-06-01T00:49:08.950Z",
  "updatedAt": "2026-06-01T00:49:10.058Z",
  "approvedByUserId": "audit-operator",
  "approvedAt": "2026-06-01T00:49:10.058Z"
}
```

### DB verification before approval
- `stream.status`: `assigned`
- `match.status`: `assigned`

### DB verification after approval
- `stream.status`: `approved`
- `approval_status`: `approved`
- `approved_by_user_id`: `audit-operator`
- `approved_at`: `2026-06-01T00:49:10.058Z`
- `match.status`: `approved`

## Step 4: publish live

### API request
Route: `POST /streams/:streamId/publish`
Middleware: `requireStreamTransition('active')`

#### Preconditions
`requireStreamTransition('active')` validates:
- stream exists
- channel is active
- provider is active
- stream status can transition to `active`

Repository `publishStream()` additionally validates:
- stream health is not `failed`
- channel URL is valid HTTP or HTTPS
- current match status can transition to `published`

### API response
```json
{
  "id": "efb314bd-a4e5-4c65-8a1d-173151cfc4c6",
  "matchId": "50f95111-571d-437f-9046-cfcd70209eba",
  "channelId": "0eb77c59-5959-4857-9725-0b844032c38f",
  "protocol": "hls",
  "status": "active",
  "approvalStatus": "active",
  "healthStatus": "unknown",
  "failureCount": 0,
  "createdAt": "2026-06-01T00:49:08.950Z",
  "updatedAt": "2026-06-01T00:49:11.018Z",
  "approvedByUserId": "audit-operator",
  "approvedAt": "2026-06-01T00:49:10.058Z",
  "publishedAt": "2026-06-01T00:49:11.018Z"
}
```

### DB verification before publish
- `stream.status`: `approved`
- `match.status`: `approved`

### DB verification after publish
- `stream.status`: `active`
- `approval_status`: `active`
- `published_at`: `2026-06-01T00:49:11.018Z`
- `match.status`: `published`

## Step 5: UI expectation vs backend stored status

| Action | UI Expected Status | Backend Stored Status | Pass/Fail |
|---|---|---|---|
| Assign Previewed Stream | assignment undefined → stream assigned | stream status `assigned`, match status `assigned` | Pass |
| Approve Stream | enabled when stream status `assigned` or `testing` | stream status `approved`, match status `approved` | Pass |
| Publish Live | enabled when stream status `approved` and match status `approved` | stream status `active`, match status `published` | Pass |

## Step 6: first lifecycle transition failure mode

### Findings
The first potential failure point in the UI is not backend status mismatch; it is pre-assign gating logic.

In `BroadcastConsoleScreen.tsx`, `Assign Previewed Stream` is enabled by:
- selected channel exists
- previewConfirmed is true
- no current assignment

But `handleAssign()` also requires:
- selectedCompetition
- selectedHomeTeam
- selectedAwayTeam

So the UI may show the button as enabled while the backend will still reject the action if match metadata is incomplete.

### Root cause
The assignment button gating omits match metadata requirements, causing a UI/UX mismatch between allowed click state and actual assign request validity.

### Required fix
Update `BroadcastConsoleScreen.tsx` so `canAssign` also requires:
- `selectedCompetition` is set
- `selectedHomeTeam` is set
- `selectedAwayTeam` is set

That will align the UI control state with backend preconditions and prevent the first lifecycle transition from appearing ready when it is not.

## Notes on tables not used in this path

The audit path uses:
- `matches`
- `streams`

The tables `scheduling_matches` and `match_streams` are present in schema but are not used by the `POST /matches/assign-stream`, `POST /streams/:streamId/approve`, or `POST /streams/:streamId/publish` lifecycle path.
