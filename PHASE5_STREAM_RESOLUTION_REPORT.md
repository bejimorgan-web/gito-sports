# PHASE5_STREAM_RESOLUTION_REPORT

Date: 2026-05-30

## Summary

Phase 5 implements a read-only, deterministic stream resolution and failover engine that decides which IPTV channel (stream) should be used for a scheduled match at decision-time.

## Algorithm

- Gather all `match_streams` assignments for the given match.
- Filter assignments where `is_active = 1`.
- Validate each assignment:
  - Provider must exist, have `deleted = 0`, and `status = 'active'`.
  - Channel must exist and have `status = 'active'`.
  - Channel URL must be a valid HTTP/HTTPS stream URL (existing validator used).
- Valid streams become candidates. Order candidates by `priority` (DESC), then by newest `created_at` (most recent wins on tie).
- `resolveActiveStream` returns the top candidate or `null` if none.
- `computeStreamFailoverChain` returns the ordered list of candidates (failover order) and invalid assignments.

This logic is intentionally read-only and does not perform any streaming or playback operations.

## Failover Logic

- When the current active stream is considered invalid (provider down, channel inactive, or URL invalid), it is skipped.
- The next candidate in the ordered failover chain is selected as the new active stream.
- No automatic switching is performed; this is purely a decision layer.

## API Endpoints Added

- `GET /matches/:matchId/active-stream` — returns the resolved active stream assignment (or `null`).
- `GET /matches/:matchId/stream-options` — returns ordered failover chain (valid candidates).
- `GET /matches/:matchId/stream-status` — returns:
  - `active`: resolved active stream (object or null)
  - `fallback`: ordered failover chain
  - `invalid`: list of invalid assignments with reasons

All endpoints are read-only and consult existing tables and repositories.

## Backend Service Design

- File: `apps/backend/src/services/stream-resolution-service.ts`
- Key functions:
  - `resolveActiveStream(matchId)`
  - `getAllValidStreams(matchId)`
  - `computeStreamFailoverChain(matchId)`
  - `detectInvalidStreams(matchId)`
- Uses `match_streams` repository and existing provider/channel data (read-only).

## UI Changes

- Minimal UI added to `MatchSchedulerScreen` at `apps/desktop/src/renderer/features/matches/MatchSchedulerScreen.tsx`:
  - Panel: `Active Stream Status`
  - Button per match: `Recompute Active Stream` — calls `GET /matches/:id/stream-status` and displays results.

No IPTV management or playback UI was modified.

## Tests Performed

1. Create a scheduling match via API (`POST /matches`).
2. Assign multiple streams with different priorities via `POST /matches/:matchId/streams`.
3. Mark one provider inactive via the provider API (`POST /iptv/providers/:id/status`).
4. Call `GET /matches/:matchId/active-stream` and verify the returned stream reflects the configured priorities and excludes inactive provider streams.
5. Restart backend and call `GET /matches/:matchId/active-stream` again — resolution recomputes and matches pre-restart expected result.
6. Verified the `match_streams` table and `streams`/`channels` tables were unchanged except for read-only queries.

## SQLite Persistence Proof

- No destructive migrations were applied. `match_streams` already exists and remained unchanged.
- Resolution uses SELECT queries and repository helpers. No data writes occurred during resolution.

## IPTV Regression Validation

- IPTV provider ingestion and channel sync were not modified.
- Provider and channel tables were read but not written.
- Existing endpoints under `/iptv` and channel sync flows remain intact.

## Final Verdict

PASS — The Phase 5 decision layer deterministically computes active streams and a failover chain based on `match_streams`, provider/channel status, and priority rules. The system is read-only with respect to IPTV ingestion and streaming, and backend restarts preserve resolution integrity.
