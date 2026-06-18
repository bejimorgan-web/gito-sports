# Deletion Rules Matrix

## Purpose

Define consistent deletion rules for catalog-first sports mastery. This matrix ensures master entities are preserved and assignments are cleaned up while operational data may cascade where permitted.

---

## Master Entity Definitions

- Sport
- Host (formerly Country)
- Competition
- Club
- National Team

## Deletion Rule Principles

1. Master entities do not own other master entities.
2. Relationships are assignments only.
3. Deleting a master entity never deletes another master entity.
4. Deleting a master entity removes or nullifies assignment records.
5. Operational data may cascade delete when it is directly dependent on removed assignments.

---

## Rules Matrix

| Deleted Entity | Preserved Masters | Assignments Removed / Nullified | Operational Cascade | Notes |
|----------------|-------------------|----------------------------------|----------------------|-------|
| Sport | Hosts, Competitions, Clubs, National Teams | - `competitions.sport_id` → SET NULL<br>- `teams.sport_id` → SET NULL<br>- `competition_teams` remains unless competitions are deleted separately | - `matches` cascade if competition is later deleted<br>- `streams` cascade if match is deleted | Sport deletion removes sport assignments only; competitions and teams remain available as orphans. |
| Host | Sports, Competitions, Clubs, National Teams | - `competitions.host_id` → SET NULL<br>- `teams.host_id` → SET NULL<br>- no master deletions | - `matches` remain until explicit competition/team deletion or operational rules trigger cascade | Host deletion preserves sport and competition metadata while removing host assignments. |
| Competition | Sports, Hosts, Clubs, National Teams | - `competition_teams` rows deleted<br>- `matches` deleted (if operational rule applies)<br>- `scheduling_matches` deleted or orphaned depending on implementation | - `streams` cascade via `matches` or `scheduling_matches` deletion<br>- `match_streams` cascade | Competition deletion removes membership and operational schedule state, but does not delete teams. |
| Club | Sports, Hosts, Competitions | - `competition_teams` rows deleted<br>- `matches` deleted if the team is referenced as home or away<br>- `scheduling_matches` deleted or orphaned | - `streams` cascade via deleted matches<br>- `match_streams` cascade | Club deletion removes the club from competitions and cleans operational records tied to that club. Competitions remain. |
| National Team | Sports, Hosts, Competitions | - `competition_teams` rows deleted<br>- `matches` deleted if the team is referenced as home or away<br>- `scheduling_matches` deleted or orphaned | - `streams` cascade via deleted matches<br>- `match_streams` cascade | National team deletion behaves like club deletion with the same assignment cleanup rules. |

---

## Assignment Cleanup Rules

### Sport deletion

- `competitions.sport_id` should be set null.
- `teams.sport_id` should be set null.
- `competition_teams` should remain intact because the competition still exists; teams remain linked to the competition.
- `match` and `stream` cleanup occurs only if competitions or teams are later deleted.

### Host deletion

- `competitions.host_id` should be set null.
- `teams.host_id` should be set null.
- `competition_teams` remains because competition-team membership is independent of host assignment.

### Competition deletion

- `competition_teams` rows should be removed automatically.
- `matches` may be deleted automatically because they depend on the competition.
- `scheduling_matches` and downstream `match_streams` should cascade delete.

### Club deletion

- `competition_teams` rows should be removed automatically.
- `matches` where the club appears should be deleted or otherwise handled by operational rules.
- `scheduling_matches` and downstream `match_streams` cascade delete.

### National Team deletion

- `competition_teams` rows should be removed automatically.
- `matches` where the national team appears should be deleted or otherwise handled by operational rules.
- `scheduling_matches` and downstream `match_streams` cascade delete.

---

## Operational Data Cascade Rules

### Allowed cascade deletions

These tables may cascade when their parent assignment is removed:

- `matches` when parent `competition` or `team` is deleted
- `streams` when parent `match` is deleted
- `scheduling_matches` when parent `competition` or `team` is deleted
- `match_streams` when parent `scheduling_matches` is deleted

### Master preservation rules

- Deleting `sport` does NOT delete:
  - `hosts`
  - `competitions`
  - `teams`
- Deleting `host` does NOT delete:
  - `sports`
  - `competitions`
  - `teams`
- Deleting `competition` does NOT delete:
  - `sports`
  - `hosts`
  - `teams`
- Deleting `club` or `national team` does NOT delete:
  - `sports`
  - `hosts`
  - `competitions`

---

## Delete Impact Guidance

### User-facing deletion messages

For each delete action, the UI should communicate:

- the entity being deleted
- the assignments that will be removed or nullified
- which related master entities will remain
- whether operational records will also be deleted

### Example messages

**Delete Sport**

- "This will delete the sport and remove its assignments from competitions and teams. Hosts, competitions, clubs, and national teams will remain."

**Delete Host**

- "This will delete the host and remove its assignments from competitions and teams. Sports, competitions, clubs, and national teams will remain."

**Delete Competition**

- "This will delete the competition and remove its team membership assignments. Clubs and national teams will remain. Operational match and stream records may also be deleted."

**Delete Club / National Team**

- "This will delete the team and remove its competition membership assignments. Competitions will remain. Operational match and stream records may also be deleted."

---

## Implementation notes

- Use `ON DELETE SET NULL` for master assignment fields.
- Use `ON DELETE CASCADE` for join tables and operational records.
- Log deletion impact details in operational logs.
- Preserve master entity metadata and logos even when assignments are removed.

This matrix supports the catalog-first design and ensures master entities remain independent while assignment cleanup is automated and predictable.
