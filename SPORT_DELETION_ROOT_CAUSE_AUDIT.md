# SPORT_DELETION_ROOT_CAUSE_AUDIT

## Summary

The missing sports in `data/gito.sqlite` were removed by the backend's existing sport deletion workflow, not by a spontaneous schema fault or database corruption.

## Evidence

- `data/gito.sqlite` currently contains:
  - `sports = 0`
  - `entity_deletion_log = 20`
  - `competitions = 10`
  - `teams = 20`
  - `scheduling_matches = 2`
- `data/gito-backup-20260601-200650.sqlite` contains:
  - `sports = 12`
  - `competitions = 10`
  - `teams = 20`
  - `scheduling_matches = 2`
- The runtime DB `entity_deletion_log` contains 12 sport deletion events dated `2026-06-01T18:32:22.065Z` through `2026-06-01T18:33:15.312Z`.
- One deleted sport ID in the runtime log corresponds to real data from backup: `a5612cf8-05f2-488d-8c83-1a0d722afdc8` = `Football`.
- Other deleted IDs correspond to validation/repro test sports (`Sport Validation ...`, `HostSport ...`, `TeamSport ...`, `CompSport ...`, `Lifecycle Audit Sport`).

## Code path

The deletion originates from the backend sports delete endpoint:

- `apps/backend/src/routes/sports.ts`
  - `DELETE /sports/:sportId` calls `deleteSport(request.params.sportId, operatorId)`.
- `apps/backend/src/repositories/sports-repository.ts`
  - `deleteSport(...)` returns `deleteEntity("sport", sportId, operatorId)`.
- `apps/backend/src/services/entityDeleteService.ts`
  - For entityType `sport`, the delete workflow:
    - nullifies `competitions.sport_id`
    - nullifies `teams.sport_id`
    - nullifies `scheduling_matches.sport_id`
    - deletes `sport_countries`, `sport_host_links`, `sport_competition_links`, `sport_club_links`, `sport_national_team_links`
    - deletes the `sports` row
    - inserts an `entity_deletion_log` row

## UI exposure

The desktop app exposes sport deletion controls in:

- `apps/desktop/src/renderer/features/sports/SportsManagementScreen.tsx`
- `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`

These components allow an operator to delete a sport by calling `apiClient.deleteSport(sport.id)`.

## Root cause

The runtime DB lost sports because a delete operation was executed against `DELETE /sports/:sportId`.

This is the explicit failure mode:

- `apps/backend/src/services/entityDeleteService.ts` intentionally allows hard deletion of sports and then cleans up related links.
- The runtime log proves sport deletion occurred, and the backup still contains the deleted sports.
- Therefore the production symptom is not a schema migration bug; it is a destructive delete event.

## Can it recur?

Yes. Any future invocation of `DELETE /sports/:sportId` in the current codebase can remove sports again.

The delete path is still active and exposed through the frontend UI, so recurrence is possible unless:

- the delete endpoint is restricted or hardened,
- UI delete actions are removed or gated,
- or the deletion workflow is changed to soft-delete instead of hard-delete.

## Recommendation

- Treat this as an operational deletion issue, not a DB corruption issue.
- If sport entities should not be permanently removed, change the backend deletion workflow to soft-delete or block deletion when a sport has active relationships.
- If hard deletion is intended, align frontend and API messaging with the actual destructive behavior and ensure operators understand the risk.
