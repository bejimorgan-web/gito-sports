# Operational Reliability

GiTO Live Sports treats failures as visible operational state. Reliability metadata does not replace the match or stream lifecycle; it sits beside it and explains whether a stream or provider is safe to trust.

## Stream Health

Stream health states:

- Active: playback is currently progressing.
- Degraded: playback is buffering, stalled, or warning but not fully failed.
- Failed: playback failed or stalled beyond recovery.
- Unknown: no recent playback signal is available.

Desktop preview reports health changes to the backend. The backend persists health status, failure count, last health timestamp, and failure reason in SQLite.

## Provider Health

Providers track:

- last successful stream load
- failed channel load count
- health score
- availability status: online, offline, degraded, unknown

The score is intentionally simple for the MVP. Successful stream loads improve the score. Degraded or failed stream reports reduce it.

## Feed Integrity

Mobile and live feed endpoints must only expose:

- published matches
- active lifecycle streams
- streams whose health is not failed
- active channels
- active providers that are not offline

Failed streams are removed from live delivery by backend serialization rules.

## Safe Failure Handling

When an active stream reports failed health:

1. The stream health is persisted as failed.
2. The stream lifecycle moves to failed when it was active.
3. The published match moves to cancelled as a safe terminal state.
4. The failure is recorded in operational logs.
5. The stream no longer appears in live or mobile feeds.

Rollback and unpublish remain unsupported in the MVP.

## Backend Connectivity

The desktop app monitors backend health. When backend connectivity is interrupted:

- approvals, assignments, and publishing are blocked in the UI
- the last known operational state remains visible
- the app periodically attempts reconnection
- restored connectivity refreshes providers, channels, and live matches

## Operational Logs

Operational logs are stored in SQLite for local debugging. Logged events include stream assignment, approval, publication, health changes, failure detection, and related state changes.

