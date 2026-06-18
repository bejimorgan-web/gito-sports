# Production Validation

Production readiness is validated against the existing MVP architecture. Validation must not introduce product features, schema changes, or alternate workflow paths.

## Validation Scope

- IPTV ingestion through M3U provider persistence.
- Match assignment, stream approval, publication, and mobile feed exposure.
- Invalid publish attempts before approval.
- Stream failure during published operation.
- Provider outage during active operation.
- Missing provider or channel data.
- Invalid stream URLs during ingestion.
- Repeated publish attempts.
- Stale stream health updates after failure.
- LIVE MODE feed consistency under multiple active matches and rapid failures.
- Operational log coverage for assignment, approval, publish, and failure events.

## Required Guarantees

- Only published matches with active streams appear in live and mobile feeds.
- Failed streams are removed from delivery immediately.
- Offline providers remove their streams from delivery.
- Stale health signals must not revive failed lifecycle state.
- Repeated or premature publish attempts are rejected.
- Operational logs preserve enough local evidence to debug state transitions.
- Desktop optimistic state must roll back when backend confirmation fails.

## Validation Command

Run:

```bash
npm run validate:operations
```

The command starts the backend in-process against an isolated SQLite database under `data/`, executes production-readiness scenarios through HTTP routes, and reports each scenario as pass or fail.

## Operator Recovery Expectations

- Backend disconnection during approval or publishing leaves the desktop in the last confirmed safe state.
- The UI must show that the backend is reconnecting and avoid presenting unconfirmed publication as live truth.
- After restart, desktop state is restored from local session cache and then refreshed from backend SQLite state.

## Non-Goals

- No cloud synchronization tests.
- No distributed load testing.
- No mobile playback implementation tests until the Flutter app is implemented.
- No schema expansion or lifecycle redesign.
