# PHASE1_IMPLEMENTATION_GUARDRAILS

Purpose:

Define mandatory constraints for all Phase 1 implementation work.

This document becomes authoritative for implementation.

## SECTION 1 — SCOPE LOCK

Phase 1 may ONLY implement:

- Sports
- Countries
- Competitions
- Teams
- Logo support for those entities

Phase 1 must NOT modify:

- IPTV workflows
- IPTV providers
- IPTV channels
- Stream assignment
- Stream approval
- Stream publishing
- Mobile playback
- Authentication
- Electron architecture

## SECTION 2 — ARCHITECTURE INVARIANTS

Must preserve:

- Electron desktop shell
- Separate backend service
- SQLite persistence
- Existing provider lifecycle
- Existing channel lifecycle
- Existing match lifecycle
- Existing stream lifecycle

## SECTION 3 — STREAM DELIVERY INVARIANT

GiTO must NEVER proxy streams.

Required flow:

Viewer
→ Provider URL

Forbidden flow:

Viewer
→ GiTO Server
→ Provider URL

No Phase 1 work may introduce stream relay, proxying, transcoding, or media transport.

## SECTION 4 — DATABASE SAFETY

Requirements:

- Existing provider records survive
- Existing channel records survive
- Existing match records survive
- Existing stream records survive

No destructive migrations.

No table drops.

No data resets.

## SECTION 5 — UI SAFETY

Requirements:

- Existing IPTV screens remain functional.
- Existing scheduling screens remain functional.
- Existing stream workflows remain functional.

New screens may be added.

Existing working workflows must not regress.

## SECTION 6 — IMPLEMENTATION STRATEGY

Implementation order:

1. Shared types
2. Database additions
3. Backend repositories
4. Backend APIs
5. Desktop API client
6. Desktop screens
7. Logo upload support
8. Validation
9. Tests

No skipping layers.

## SECTION 7 — TEST REQUIREMENTS

Must verify:

- SQLite persistence
- Restart persistence
- CRUD operations
- Logo persistence
- Duplicate prevention

## SECTION 8 — DEFINITION OF DONE

Phase 1 is complete only if:

- Sports CRUD works
- Countries CRUD works
- Competitions CRUD works
- Teams CRUD works
- Logos persist
- SQLite persists
- Existing IPTV workflows still work
- Existing stream workflows still work
- Existing Electron packaging still works

## SECTION 9 — IMPLEMENTATION REPORT

When coding is complete, produce:

PHASE1_COMPLETION_REPORT.md

including:

- files changed
- migrations created
- APIs added
- screens added
- tests executed
- validation results
- regressions found

Do not begin implementation until these guardrails are acknowledged.
