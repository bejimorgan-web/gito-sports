# GI_TO_FINAL_ARCHITECTURE_SPEC

**Decision:** Pure Catalog-First — authoritative system architecture for GiTO.

**Sources reviewed:**
- `apps/backend/src/services/entityDeleteService.ts`
- `apps/backend/src/services/catalog_rules.ts`
- `docs/DATABASE_SCHEMA.md`
- `CATALOG_FIRST_ARCHITECTURE_REPORT.md`
- `DELETION_ARCHITECTURE_PROPOSAL.md`
- `DELETION_RULES_MATRIX.md`
- `docs/WORKFLOWS.md`
- `docs/ARCHITECTURE.md`

---

## Executive summary

GiTO must adopt a Pure Catalog-First architecture: master catalog entities are independent, deletions must unlink assignments or nullify references rather than destroy related masters, and IPTV/scheduling artifacts must be managed as operational data with explicit review and audit control.

---

## STEP 1 — SYSTEM STATE ANALYSIS

### Actual runtime behavior

- `entityDeleteService.ts` currently performs destructive delete workflows for `sport`, `competition`, and `team`, removing master records and operational artifacts in a way that matches legacy hierarchical ownership.
- `catalog_rules.ts` expresses mixed intent: it lists both `cascadeTargets` and `orphanTargets`, leaving actual behavior ambiguous. The runtime code favors cascade behavior.
- The documented database schema is hybrid: it defines catalog assignments (`competitions.sport_id`, `teams.country_id`) but does not consistently enforce a catalog-first orphaning strategy.
- UI and product documentation (`CATALOG_FIRST_ARCHITECTURE_REPORT.md`, `WORKFLOWS.md`) are catalog-first in intent, describing independent master entities and assignment cleanup.
- IPTV flow is operational and should not treat catalog taxonomy deletions as permission to destroy active streams.
- Match scheduling depends on stable IDs and requires tolerance for orphaned references when catalog metadata changes.

### Behavior classification

- Catalog-first behavior: UI/product docs, deletion matrix intent.
- Hybrid behavior: `catalog_rules.ts` internal model.
- Legacy behavior: actual `entityDeleteService.ts` deletes and current runtime semantics.

---

## STEP 2 — IMPACT MODEL SIMULATION

### Delete Sport
- Current runtime deletes: sport row, associated competitions, associated teams, `matches`, `scheduling_matches`, `streams`, `match_streams`, and category link rows.
- Current orphans: none; related catalog masters are removed.
- Preserved: hosts only.
- IPTV impact: active/published streams are deleted.
- Match impact: schedule and published match history are destructively removed.

### Delete Host
- Current runtime deletes: host row, associated `sport_host_links`, `host_competition_links`, and scheduling/stream records tied to the host.
- Current orphans: competitions and teams are orphaned by nullifying `country_id`, but scheduling matches are deleted.
- Preserved: sports, competitions, teams.
- IPTV impact: affected streams are removed if they belong to deleted scheduling records.
- Match impact: some operational matches disappear.

### Delete Competition
- Current runtime deletes: competition row, membership links, host/sport link rows, `matches`, `scheduling_matches`, `streams`, and `match_streams`.
- Current orphans: none.
- Preserved: teams, sports, hosts.
- IPTV impact: all streams for that competition are deleted.
- Match impact: all schedules for that competition are removed.

### Delete Club
- Current runtime deletes: team row, membership and catalog links, `matches`, `scheduling_matches`, `streams`, and `match_streams`.
- Current orphans: none.
- Preserved: competitions, sports, hosts.
- IPTV impact: streams for matches involving the club are removed.
- Match impact: match history for that club is removed.

### Delete National Team
- Current runtime deletes: same as club deletion.
- Current orphans: none.
- Preserved: competitions, sports, hosts.
- IPTV impact: streams for matches involving the national team are removed.
- Match impact: match history for that national team is removed.

---

## STEP 3 — CONSISTENCY CHECK

### UI model vs backend model

- UI/docs demand independent catalog masters and assignment cleanup.
- Backend delete code destroys catalog masters and related operational artifacts.
- Contradiction: the UI expects preserved competitions/teams after sport or host deletion; the backend does not.

### Backend deletion vs DB constraints

- Current backend bypasses a catalog-first nullable assignment model with explicit deletes.
- Contradiction: schema assignment fields exist, but delete service treats the relationships as ownership.

### IPTV dependency

- IPTV requires stable operational artifacts and must not lose streams solely due to catalog taxonomy changes.
- Current delete path deletes streams aggressively.

### Match system assumptions

- Scheduling references teams and competitions by ID; it assumes these IDs are stable or can be orphaned safely.
- Current delete path violates this by deleting referenced competitions/teams.

### Identified contradictions

- `entityDeleteService.ts` contradicts catalog-first design.
- `catalog_rules.ts` is internally inconsistent.
- `docs/DATABASE_SCHEMA.md` and runtime delete behavior do not align.
- IPTV and match systems are at odds with legacy delete semantics.

---

## STEP 4 — FINAL ARCHITECTURE DECISION

**Final decision:** Pure Catalog-First.

### Why Pure Catalog-First

- It matches product and UX intent.
- It preserves master catalog entities that are valuable beyond a single delete event.
- It isolates operational data cleanup from taxonomy changes.
- It reduces risk for IPTV and live-match workflows.

### Risks of rejecting alternatives

- Hybrid:
  - increases complexity by requiring mixed ownership semantics,
  - makes deletion behavior unpredictable,
  - leaves active streams and schedules vulnerable.

- Legacy Hierarchical:
  - causes data loss,
  - breaks operator expectations,
  - undermines historical match and IPTV artifact integrity.

### Migration guidance

- Publish this spec as the single source of truth.
- Pause UI workflows that invoke direct destructive delete operations for catalog deletes until refactored.
- Introduce a maintenance workflow for explicit operational cleanup.

---

## STEP 5 — LOCK SPECIFICATION

### Entity rules

- `Sports`, `Hosts` (`countries` used as hosts), `Competitions`, and `Teams` are master catalog entities.
- `Teams` are typed as `club` or `national`.
- `Matches`, `scheduling_matches`, `streams`, and `match_streams` are operational artifacts.

### Deletion rules

- Delete Sport:
  - `competitions.sport_id = NULL`
  - `teams.sport_id = NULL`
  - remove sport-specific links
  - preserve `competitions`, `teams`, `hosts`
  - do not auto-delete operational artifacts

- Delete Host:
  - `competitions.country_id = NULL`
  - `teams.country_id = NULL`
  - remove host-specific links
  - preserve `sports`, `competitions`, `teams`
  - do not auto-delete operational artifacts

- Delete Competition:
  - remove competition membership and link rows
  - preserve `teams`, `sports`, `hosts`
  - require explicit operator action for operational cleanup

- Delete Club/National Team:
  - remove membership and link rows
  - preserve `competitions`, `sports`, `hosts`
  - require explicit operator action for operational cleanup

### Relationship rules

- Associations are assignments only: `competition.sport_id`, `competition.host_id`, `team.sport_id`, `team.country_id`.
- `competition_teams` is a membership assignment table, not ownership.
- Link tables may clean up when a parent master is removed, but they do not imply deletion of related masters.

### IPTV safety rules

- Streams and `match_streams` are operational artifacts.
- Do not auto-delete streams because a catalog entity is deleted.
- Preserve approved/published audit metadata.
- Flag affected streams for review rather than deleting automatically.

### Match integrity rules

- Keep `scheduling_matches` and `matches` queryable when catalog references are deleted.
- The match system must tolerate missing master metadata.
- Orphaned schedules must be surfaced for operator reconciliation.

### UI behavior rules

- UI deletion flows must show assignment unlinking and catalog preservation separately.
- Deleting a Sport/Host must update related assignment fields rather than removing catalog entries.
- Orphaned matches and streams must appear as review-required.

---

## Final lock

This document is the authoritative architecture specification for GiTO.
No code, schema, or UI changes are made in this document. Implementation must follow separate tracked work.

**Owner:** Data & Platform Architecture
**Version:** 1.0
**Adopted:** 2026-06-01
