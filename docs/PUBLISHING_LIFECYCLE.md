# Publishing Lifecycle

This document is the canonical lifecycle definition for match and stream behavior.

## Match Lifecycle

- Draft: match metadata exists but is not ready for scheduling.
- Scheduled: kickoff and participants are known.
- Assigned: an IPTV channel has been attached to the match.
- Approved: the assigned stream has passed operator approval.
- Published: the match is available through backend and mobile live feed endpoints.
- Live: the event is actively underway after publication.
- Ended: the event has completed.
- Cancelled: the event has been stopped before completion.

Allowed transitions:

- Draft -> Scheduled, Cancelled
- Scheduled -> Assigned, Cancelled
- Assigned -> Approved, Cancelled
- Approved -> Published, Cancelled
- Published -> Live, Cancelled
- Live -> Ended
- Ended -> no transitions
- Cancelled -> no transitions

## Stream Lifecycle

- Idle: stream record is not attached to operational review.
- Assigned: stream is attached to a match.
- Testing: stream is being previewed or validated.
- Approved: operator has approved the stream for publication.
- Active: stream is published and available for delivery.
- Failed: stream validation or playback failed.
- Disabled: stream is blocked from use.

Allowed transitions:

- Idle -> Assigned, Disabled
- Assigned -> Testing, Approved, Failed, Disabled
- Testing -> Approved, Failed, Disabled
- Approved -> Active, Failed, Disabled
- Active -> Failed, Disabled
- Failed -> Testing, Disabled
- Disabled -> no transitions

## System Flow

1. IPTV ingestion creates providers and channels.
2. Operator selects a channel.
3. Operator previews the channel.
4. Operator creates match metadata and assigns the previewed channel.
5. Backend creates an assigned match and assigned stream.
6. Operator approves the stream.
7. Backend changes the stream to approved and the match to approved.
8. Operator publishes the stream.
9. Backend changes the stream to active and the match to published.
10. Mobile feed endpoints expose only the published match and active stream.

## Failure Handling

- Failed streams are never exposed to mobile clients.
- Disabled streams are terminal in the MVP.
- Publishing an unapproved stream is rejected.
- Publishing a match without an approved active provider channel is rejected.
- Rollback or unpublish is not supported in the MVP lifecycle.

