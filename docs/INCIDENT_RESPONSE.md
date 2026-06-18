# Incident Response

Failures must be visible, explainable, and recoverable.

## Stream Failure

Symptoms:

- Stream status shows failed.
- Match disappears from mobile feed.
- Operator alert appears.

Actions:

1. Do not republish the failed stream.
2. Select another IPTV channel.
3. Preview the replacement.
4. Assign, approve, and publish through the normal workflow.
5. Record the provider/channel that failed.

## Provider Failure

Symptoms:

- Provider status is offline or degraded.
- Multiple channels become unavailable.
- Mobile feed excludes streams from offline provider.

Actions:

1. Switch to an alternate provider if available.
2. Do not assume published streams from the failed provider are safe.
3. Verify provider credentials and network access.
4. Restart provider ingestion only after connection is stable.

## Backend Downtime

Symptoms:

- Desktop shows backend offline/reconnecting.
- Approval and publish actions are blocked.
- Mobile feed may be unavailable.

Actions:

1. Do not close the desktop if it has useful last-known state.
2. Restart backend service.
3. Verify `/health`.
4. Refresh desktop state.
5. Verify `/mobile/matches/live`.
6. Continue only after backend is online.

## Feed Inconsistency

Symptoms:

- Desktop shows published but mobile feed does not.
- Mobile shows fewer matches than expected.

Actions:

1. Verify stream is active and match is published.
2. Verify stream health is not failed.
3. Verify provider is active and not offline.
4. Run production validation when safe.
5. If state remains inconsistent, stop publishing new matches and inspect SQLite.

## Mobile Playback Failure

Symptoms:

- Mobile app shows stream unavailable.
- Playback remains loading or connecting.

Actions:

1. Verify backend mobile feed is reachable.
2. Verify playback URL from feed.
3. Test stream in desktop preview.
4. If desktop preview fails, treat as stream/provider failure.
5. If desktop preview works, rebuild mobile with correct API base URL.

## Database Recovery

Actions:

1. Stop backend.
2. Copy current database aside.
3. Restore the latest known-good SQLite backup to `DATABASE_PATH`.
4. Start backend.
5. Verify health, providers, channels, matches, and mobile feed.
6. Resume operations only after state is coherent.
