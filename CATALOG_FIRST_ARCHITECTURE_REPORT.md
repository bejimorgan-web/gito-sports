# Catalog-First Architecture Report

## Executive Summary

The current sports architecture is built around a match-centric import workflow that auto-creates sport taxonomy records during stream assignment. This leads to weak operator control, duplicate entities, and incomplete entity management.

A catalog-first refactor shifts the system to reusable, independent master entities with assignment relationships only. The five master entities are:

- Sport
- Host (renamed from Country)
- Competition
- Club
- National Team

This proposal defines a catalog-first domain model, master-entity independence principles, and the architectural changes needed to support operator CRUD, searchable catalog views, and robust deletion semantics.

---

## Current State Overview

### What exists today

The backend schema already includes the core domain tables:

- `sports`
- `regions`
- `countries`
- `competitions`
- `seasons`
- `teams`
- `matches`
- `streams`

The current relationship model is:

- `competitions.sport_id` → `sports.id`
- `competitions.region_id` → `regions.id`
- `teams.sport_id` → `sports.id`
- `teams.country_id` → `countries.id`
- `matches.competition_id` → `competitions.id`
- `matches.home_team_id` / `away_team_id` → `teams.id`
- `streams.match_id` → `matches.id`

### Key shortcomings

- Taxonomy entities are implicitly created by stream assignment (`ensureSport`, `ensureCompetition`, `ensureTeam`).
- Countries are not operator-managed and are used inconsistently.
- Teams do not clearly differentiate clubs from national teams.
- Competitions are only indirectly linked to participants through matches.
- Logos are missing from hosts, competitions, and teams.
- Master entity deletion is currently blocked by foreign relationships rather than cleaning assignments.

---

## Catalog-First Architecture Principles

### Master Entities are independent

No master entity should own another master entity. Each entity must be independently creatable, editable, and deletable.

### Relationships are assignments only

All links between masters are assignment fields or join records, not ownership hierarchies.

### Deletion semantics

Deleting a master entity must:

- remove or nullify assignments
- preserve other master entities
- allow operational data to cascade delete when defined by system rules

### Allowed cascade deletion

Operational records may cascade delete: match schedules, match stream assignments, published match records, and relationship/join table records.

---

## Master Entity Definitions

### Sport

- Independent catalog item
- Fields: `name`, `logo_url`, `status`, timestamps
- Role: sport taxonomy for all competitions and teams

### Host

- Independent catalog item (rename of Country concept)
- Fields: `name`, `logo_url`, optional ISO/reference codes, `status`, timestamps
- Role: geographic or host identity for competitions and teams

### Competition

- Fields: `name`, `logo_url`, `sport_id` (nullable), `host_id` (nullable), `type`, `participant_type`, `status`, timestamps
- Role: competition taxonomy and context for matches
- Participant type: `clubs` or `nationalTeams`

### Club

- A `team` record with `type = club`
- Fields: `name`, `logo_url`, `sport_id` (nullable), `host_id` (nullable), `status`, timestamps
- Role: club-level match participant

### National Team

- A `team` record with `type = national`
- Fields: `name`, `logo_url`, `sport_id` (nullable), `host_id` (nullable), `status`, timestamps
- Role: national-level match participant

---

## Target Relationship Model

### Assignment semantics

- `competition.sport_id` assigns a sport to the competition.
- `competition.host_id` assigns a host to the competition.
- `team.sport_id` assigns a sport to the club or national team.
- `team.host_id` assigns a host to the club or national team.
- `competition_teams` assigns teams to competitions.

### Master independence rules

- Sport is not the owner of competitions, teams, or hosts.
- Host is not the owner of competitions, teams, or sports.
- Competition is not the owner of teams or hosts.
- Club and National Team are not owners of competitions.

### Deletion behavior

- Delete Sport: nullify `sport_id` on competitions and teams, remove sport assignment links, keep hosts, competitions, clubs, and national teams.
- Delete Host: nullify `host_id` on competitions and teams, remove host assignment links, keep sports, competitions, clubs, and national teams.
- Delete Competition: delete competition assignment links, keep clubs and national teams.
- Delete Club: delete competition membership links, keep competitions.
- Delete National Team: delete competition membership links, keep competitions.

---

## Operational Data Rules

### Assigned cascade deletion

Operational records may cascade as follows:

- `matches` may cascade when their parent competition is deleted.
- `scheduling_matches` may cascade when their competition or team is deleted.
- `streams` may cascade when their match is deleted.
- `match_streams` may cascade when their scheduling match is deleted.

### Assignment cleanup

- Relationship/join table records should be automatically removed when a parent master entity is deleted.
- Assignment references should be set null, not cascade delete other master entities.

---

## Impact on UX and Data Management

### Global Catalog View

A catalog-first system requires a unified operator experience for:

- Sports
- Hosts
- Competitions
- Clubs
- National Teams

Each catalog list must be:

- alphabetical
- searchable
- logo-first
- modal CRUD-based
- supporting edit and delete actions

### Sport Dashboard View

When a sport is selected, show only:

- Hosts linked to that sport
- Competitions linked to that sport
- Clubs linked to that sport
- National Teams linked to that sport

### Delete confirmations

Deletion must show impact details and explicitly state that related master entities are preserved while assignments are removed or orphaned.

---

## Implementation Summary

The catalog-first refactor requires:

- explicit CRUD for all master entities
- host renaming and host-first relationship terminology
- nullable assignment fields for `sport_id` and `host_id`
- explicit participant-type semantics for competitions and teams
- logo metadata on all master entities
- cleanup of assignment records on delete
- cascade deletion only for operational records, not for master entities

This architecture report sets the foundation for the migration plan, UI restructure, and deletion rules needed to move GiTO Live Sports into a fully catalog-first sports domain.
