# UI Restructure Plan

## Objective

Refactor the desktop operator UI to support a catalog-first sports architecture with independent master entities and assignment-driven relationships.

The new UI must provide:

- a Global Catalog View for all master entities
- Sport-focused dashboards showing only sport-linked masters
- modal CRUD for all catalog entities
- searchable, alphabetical, logo-first lists
- clear deletion workflows with assignment cleanup behavior

---

## Global Catalog View

### Primary navigation

Add a top-level menu area called `Catalog` or `Sports Catalog` with the following sections:

- Sports
- Hosts
- Competitions
- Clubs
- National Teams

### Layout and behavior

Each catalog list should include:

- a full-width search input
- alphabetical sorting by name
- logo/avatar first in each row
- status badge and small metadata counts
- Create button that opens a modal
- Edit action in row or card
- Delete action in row or card

### Row/card details

For each master entity:

- Sport
  - logo
  - name
  - status
  - linked competitions count
- Host
  - flag/logo
  - name
  - status
  - linked competitions + teams count
- Competition
  - logo
  - name
  - sport name
  - host name
  - type badge
  - participant type badge
- Club
  - logo
  - name
  - sport name
  - host name
  - competitions count
- National Team
  - logo
  - name
  - sport name
  - host name
  - competitions count

### Modal CRUD

Use modal dialogs for create/edit workflows:

- Create and Edit forms should be consistent across entities.
- Forms should include logo upload, name, assignment selectors, status, and type selectors where applicable.
- Delete should display a confirmation modal with impact summary.

### Search behavior

- Search should filter by name and related labels (sport, host, competition type).
- Search results should update in real time.
- Each list should support keyboard navigation and highlights.

---

## Sport Dashboard View

### Purpose

When a sport is selected, the sport dashboard shows only entities linked to that sport.

### Sections

- Hosts linked to this sport
- Competitions linked to this sport
- Clubs linked to this sport
- National Teams linked to this sport

### Layout

Display four responsive cards or panels, each with:

- section header
- logo-first list of linked entities
- search/filter within section
- Add button for related assignment actions

### Behavior

- If a host is linked to the selected sport via teams or competitions, show it in the Hosts section.
- Include quick filters to see only linked competitions, clubs, or national teams.
- Allow creation of new entities scoped to the selected sport.

---

## Catalog CRUD forms

### Sport modal

Fields:

- Name
- Logo upload
- Status (active/inactive/archive)

### Host modal

Fields:

- Name
- Flag/Logo upload
- ISO2 code
- ISO3 code
- Region (optional)
- Status

### Competition modal

Fields:

- Name
- Sport selector (nullable)
- Host selector (nullable)
- Type selector (`league`, `cup`, `friendly`, `tournament`)
- Participant Type selector (`clubs`, `nationalTeams`)
- Logo upload
- Status

### Team modal (Club / National Team)

Fields:

- Name
- Type selector (`club`, `national`)
- Sport selector (nullable)
- Host selector (nullable)
- Logo upload
- Status

### Delete confirmation modal

Each delete modal should include:

- entity name
- entity type
- impact summary of related assignments to be removed or nullified
- explicit statement that other master entities will be kept
- action buttons: Cancel, Confirm Delete

Example impact summary for deleting a sport:

- Sport assignments removed from X competitions
- Sport assignments removed from Y clubs
- No hosts, competitions, clubs, or national teams will be deleted
- Operational records may cascade deleted if they are linked to removed assignments

---

## Sport-specific dashboard UX

### Primary flows

- Select a sport
- View sport-linked hosts, competitions, clubs, and national teams
- Use inline search and filtering within each section
- Add or edit linked entities from within the sport context
- Delete the sport with clear assignment cleanup messaging

### Data presentation

For each linked entity panel:

- use logo-first rows
- show assignment context: host for competitions and teams
- surface participant counts on competitions
- surface role type on teams (`club` or `national`)

---

## Competition membership and team participation

### Competition roster panel

Each competition details screen should include a `Teams` roster panel.

Features:

- list assigned clubs or national teams with logos
- search available teams for assignment
- add/remove team membership
- prevent duplicate assignments
- show membership status and updated timestamp

### Assignment semantics

- Competition membership is managed through `competition_teams`.
- Deleting a competition removes its membership records but keeps teams.
- Deleting a team removes its competition membership records but keeps competitions.

---

## Delete behavior in the UI

### Delete Sport

- Remove sport assignments from competitions and teams
- Keep hosts, competitions, clubs, and national teams
- Provide a preview of the assignment cleanup

### Delete Host

- Remove host assignments from competitions and teams
- Keep sports, competitions, clubs, and national teams
- Provide a preview of the assignment cleanup

### Delete Competition

- Remove competition-team assignments
- Keep clubs and national teams
- Optionally cascade delete operational data tied to the competition

### Delete Club

- Remove competition-team assignments
- Keep competitions
- Optionally cascade delete operational data tied to matches involving the club

### Delete National Team

- Remove competition-team assignments
- Keep competitions
- Optionally cascade delete operational data tied to matches involving the national team

---

## Integration with existing screens

### Replace current sports workflow

- Refactor `SportsManagementScreen` to become the aggregated catalog entry point.
- Add Hosts as a first-class catalog section alongside Sports, Competitions, Clubs, and National Teams.
- Preserve existing competition and team management screens, but convert them to catalog CRUD surfaces.

### Preserve operational flows

- Maintain separate Match Operations and Live Approvals workflows.
- Use catalog entities as source data for scheduling and stream assignment rather than free-form text.

### Logo-first list styling

- Use circular logo/avatar containers.
- Keep row heights compact while prioritizing visual identity.
- Ensure logos render reliably across desktop and mobile views.

---

## UI validation checklist

- [ ] Global Catalog view contains Sports, Hosts, Competitions, Clubs, and National Teams
- [ ] Each list is alphabetical and searchable
- [ ] CRUD operations are modal-driven and consistent
- [ ] Sport dashboard shows only sport-linked Hosts, Competitions, Clubs, and National Teams
- [ ] Delete modals clearly explain assignment cleanup and master preservation
- [ ] Competition roster management is supported via membership assignment
- [ ] Logo upload fields exist on all master entity forms
- [ ] Host terminology is used consistently instead of Country
