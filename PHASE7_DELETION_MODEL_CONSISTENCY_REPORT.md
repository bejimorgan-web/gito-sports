# PHASE7 DELETION MODEL CONSISTENCY REPORT

## Summary

The current backend implements a hybrid deletion model with strong cascade cleanup for operational entities and link tables, while still preserving IPTV provider/channel catalog objects. This is not a pure catalog-first implementation because the legacy `teams` table and associated competition relations are still treated as owned/dependent data.

---

## 1 — Model Classification

| Entity | Current Role | Notes |
|---|---|---|
| Sport | Catalog Entity | Primary catalog master for competitions and team membership. Delete behavior currently cascades dependent operational and legacy entities. |
| Host | Catalog Entity | Represented by `countries`. Host-related catalog links exist through `sport_host_links` and `host_competition_links`. |
| Competition | Catalog Entity | Managed by `competitions`; deletion cascades operational schedule and match assets. |
| Club | Catalog Entity (catalog intent) / Dependent in practice | Conceptually a catalog object, but currently persisted in legacy `teams` table and removed when sport or competition deletes. |
| National Team | Catalog Entity (catalog intent) / Dependent in practice | Same as Club: catalog semantics exist, but physical storage is in `teams` and treated as owned. |
| Team (legacy) | Operational Entity | `teams` table is used by runtime scheduling and matches, representing both clubs and national teams in practice. It is tightly coupled to sport via `sport_id`.

**Key classification observation:** the codebase is blending catalog and legacy operational models. `Club` and `National Team` are conceptually catalog objects, but because they live in the legacy `teams` table and are cascaded with sport deletion, they behave as dependent entities.

---

## 2 — Delete Behavior Review

### Sport
- Current behavior: cascade delete of
  - `teams` with `sport_id`
  - `competitions`
  - `competition_teams`
  - `competition_club_links`
  - `competition_national_team_links`
  - `host_competition_links`
  - `sport_competition_links`
  - `sport_club_links`
  - `sport_national_team_links`
  - `sport_countries`
  - `scheduling_matches`
  - `match_streams`
  - `matches`
  - `streams`
- Classification: currently behaves as **full cascade ownership**.
- Consistency: conflicts with catalog-first, because sport deletion removes catalog-linked teams and competitions rather than preserving independent catalog entities.

### Host
- Current behavior: delete of a country/host
  - deletes `sport_host_links` and `host_competition_links`
  - deletes runtime `scheduling_matches` and `match_streams` tied to the country
  - nullifies `country_id` on `competitions` and `teams`
- Classification: closer to **hybrid catalog-first** for competitions/teams, but still cascades runtime scheduling.
- Consistency: partially consistent, but there is a risk of losing scheduling history when a host is deleted.

### Competition
- Current behavior: cascade delete of
  - `competition_teams`
  - `competition_club_links`
  - `competition_national_team_links`
  - `host_competition_links`
  - `sport_competition_links`
  - `scheduling_matches`
  - `match_streams`
  - `matches`
  - `streams`
- Classification: operational entity mixture with catalog links.
- Consistency: reasonable for a competition delete if the competition is truly being removed, but current cascade is destructive and not catalog-first because it hard-deletes legacy runtime associations.

### Club
- Current behavior: deleting a club goes through legacy `team` deletion and cascades
  - `competition_teams`
  - `sport_club_links`
  - `competition_club_links`
  - `scheduling_matches`
  - `match_streams`
  - `matches`
  - `streams`
- Classification: conceptually catalog, implemented as **dependent legacy operational**.
- Consistency: inconsistent with catalog-first because deletion removes what could be a reusable catalog object and destroys runtime match data.

### National Team
- Current behavior: same as Club, via `team` deletion branch.
- Classification: conceptually catalog, implemented as dependent.
- Consistency: same conflict as Club.

### Team (legacy)
- Current behavior: hard delete of legacy team rows and all connected operational match and schedule rows.
- Classification: Operational Entity.
- Consistency: consistent in the sense that runtime team rows are cleaned up, but the model is inconsistent with a catalog-first goal because `teams` are also being used as catalog objects.

---

## 3 — Impact Analysis

### teams.sport_id dependency
- `teams.sport_id` is `NOT NULL` in schema.
- This makes team records owned by sports at the DB level.
- Current delete logic confirms this dependency by removing teams when a sport is deleted.
- Conflict: catalog-first should allow teams to exist as independent catalog objects or be soft-associated, not strictly owned by sport.

### competition_teams relationship
- `competition_teams` is cleaned on competition/team/sport deletion.
- Good: no orphan rows remain in `competition_teams`.
- Risk: deleting a competition or team erases membership history rather than preserving catalog links or historical records.
- Conflict: the architecture mixes catalog link tables with hard deletes, so the relationship is not retained as catalog metadata.

### match dependencies
- `matches` and `scheduling_matches` are both deleted when upstream entities are removed.
- `stream` rows and `match_streams` are also deleted.
- This preserves foreign-key integrity, but it means match history is lost as soon as the parent entity is deleted.
- In a true catalog-first model, schedules/matches may be operational constructs that should be deleted, which is acceptable, but catalog relationships should remain separate.

### IPTV dependencies
- `providers` and `channels` are preserved on all entity deletions.
- Only assignments and runtime stream records (`streams`, `match_streams`) are removed.
- This is the least risky part of the model: IPTV catalog objects are retained while runtime assignments are cleaned.
- Still, because `match_streams` and `streams` are hard-deleted, event replay or audit reconstruction is limited.

---

## 4 — Conflict Map

| Area | Current Behavior | Catalog-First Conflict |
|---|---|---|
| Sport → Team | `teams` deleted when sport deleted | Teams are treated as owned, not independent catalog items |
| Team/catalog links | `sport_club_links` / `competition_club_links` exist alongside hard-deleted `teams` | Mixed catalog and legacy runtime model |
| Competition delete | runtime schedule and match data destroyed | Catalog metadata should be separable from runtime state |
| Host delete | schedule and stream assignments deleted, competition/team country refs nulled | Host deletion is partly catalog-first, partly destructive |
| IPTV | provider/channel kept, runtime stream assignments deleted | Mostly consistent, but audit recovery is limited |

---

## 5 — Recommendation

### Final architecture: B. Hybrid model (limited ownership)

The current backend should remain hybrid, with the following clarified division:

- Catalog Entities: `sports`, `countries` (`hosts`), `competitions`, and the conceptual club/national team catalog.
- Operational Entities: `teams` (legacy runtime), `competition_teams`, `matches`, `scheduling_matches`, `match_streams`, `streams`.

This hybrid recommendation fits the existing codebase and avoids the largest rewrite required by pure catalog-first.

### Why hybrid
- It preserves IPTV provider/channel catalog integrity.
- It allows aggressive cleanup of runtime schedule and match state.
- It accepts that the legacy `teams` table is an operational runtime model with catalog shadowing.
- It avoids the risk of accidental data loss from a full hierarchical model while still keeping deletion rules explicit.

### Impact analysis
- IPTV system: stable. Provider/channel catalogs are preserved, only runtime assignment data is deleted.
- Scheduling: explicit cleanup works, but destructive deletion means schedules are not recoverable once parents are deleted.
- Match integrity: maintained via cascade cleanup, but there is no long-term archival of deleted match state.
- UI complexity: moderate. The UI must present clubs/national teams as catalog objects, while also exposing runtime teams and schedule cleanup.
- Future scalability: hybrid is safer than full hierarchical, but the current tight coupling of `teams.sport_id` remains a scalability risk.

---

## 6 — Migration / Correction Steps

### Required corrections
1. **Treat `teams` as legacy runtime objects, not pure catalog entities**
   - Document that `Club` and `National Team` are conceptually catalog entities, but physical legacy state lives in `teams`.
   - Prevent sport deletion from silently deleting catalog-level club/national team metadata unless explicitly desired.

2. **Add explicit delete restrictions or soft delete for catalog parents**
   - For `sport`, require explicit deletion of dependent competitions/teams before sport deletion, or
   - Introduce soft delete for `sports` and `competitions` if they need to be kept as catalog history.

3. **Formalize `competition_teams` as relationship cleanup only**
   - Keep the table as operational membership, not as the canonical catalog link source.
   - If club/national team catalog is needed, create separate catalog-only team records instead of reusing `teams`.

4. **Enforce catalog separation in schema**
   - Consider adding separate `clubs` and `national_teams` catalog tables if the project intends to fully separate catalog entities from runtime teams.
   - Otherwise, clearly label `teams` as legacy/operational and avoid using it as a direct catalog abstraction.

### Recommended migration path
- Step 1: audit existing `teams` rows and identify which are catalog clubs versus national teams.
- Step 2: introduce a catalog shadow layer or separate reference table for club/national team metadata.
- Step 3: update deletion service so sport deletion only cascades operational runtime state, not catalog objects.
- Step 4: keep `providers` and `channels` untouched while deleting only stream assignment rows.
- Step 5: add `entity_deletion_log` or a separate archive mechanism for deleted schedule/match state if recovery is needed.

---

## 7 — Conclusion

The system should not be pushed to pure catalog-first without refactoring the legacy `teams` model. The safest path is a **hybrid model** that preserves IPTV catalog data, treats match/schedule rows as operational, and clearly separates catalog links from legacy runtime tables.

If a stronger catalog-first future is required, the next architecture step is to split legacy `teams` into a dedicated catalog layer and decouple `sport_id` ownership from hard delete semantics.
