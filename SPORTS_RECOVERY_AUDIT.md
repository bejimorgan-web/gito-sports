# SPORTS_RECOVERY_AUDIT

## Compared databases
- Runtime DB: `data/gito.sqlite`
- Backup DB: `data/gito-backup-20260601-200650.sqlite`

## Full sports row counts
- Runtime sports count: `0`
- Backup sports count: `12`

## Sports IDs present only in backup
- 068c5180-65da-48b1-b465-2e7282e80ce6
- 13469952-f8ae-4b42-a87e-0e39c4c208e1
- 2640d102-249c-4f45-8515-d033b8f6be10
- 29b8cf69-c1ac-4ff0-b1a8-5821585e43f2
- 39d9a214-096a-4b70-97f6-dd38a692f831
- 5ccfe0df-ea14-479a-8885-80469223ce6a
- 736ac899-c8e5-40a6-b8a7-974a1414079e
- a5612cf8-05f2-488d-8c83-1a0d722afdc8
- bedcbb4b-9b6e-4279-bda3-2e661665d999
- c3ed08c2-5742-461f-91b6-0d032a919f89
- d55bce6a-d809-49d5-afc7-4ee8ba059631
- dc3450b1-1a6e-452d-9242-51c5e628c654

## Sports IDs present only in runtime
- None

## Sports names present only in backup
- CompSport 3e18d156
- CompSport c208b87d
- Football
- HostSport d01672f0
- HostSport e3749818
- Lifecycle Audit Sport
- Sport Validation 9e686212
- Sport Validation bd94b7c2
- TeamSport 61a84790
- TeamSport a15c82de
- TeamSport f937707c
- TeamSport ff1f2d7d

## Sports names present only in runtime
- None

## Dependent references for backup-only sports IDs
### In `data/gito-backup-20260601-200650.sqlite`
- `competitions` referencing these sport IDs: `10`
- `teams` referencing these sport IDs: `20`
- `scheduling_matches` referencing these sport IDs: `2`

### In `data/gito.sqlite`
- `competitions` referencing these sport IDs: `0`
- `teams` referencing these sport IDs: `0`
- `scheduling_matches` referencing these sport IDs: `0`

## Determinations
1. Runtime sports table completely empty: **Yes**.
2. Backup contains operator-created sports: **Yes**.
3. Restoring only sports rows is possible: **Yes, technically possible** because runtime currently has no sports and no dependent runtime rows reference those IDs.
4. Competitions, teams, or matches reference those sport IDs: **Yes, in the backup snapshot.**

## Recommendation
- Primary recommendation: **B. Restore sports + dependent relationships.**
  - Backup sports are not isolated: they have related competitions, teams, and scheduling match entries in the backup snapshot.
  - Restoring only sports rows would recover the missing sport definitions, but it would leave the recovered sports disconnected from the richer backup relationship graph.

## Notes
- Because `data/gito.sqlite` is missing all sports rows, restoring only sports would not conflict with existing runtime references.
- However, the backup snapshot shows a non-trivial dependency graph, so a more complete recovery should include the dependent relationships rather than sports alone.
