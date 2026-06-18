# Invariants

These rules are hard system guarantees. Code should enforce them wherever possible, and no workflow may intentionally bypass them.

## Match Invariants

- A match MUST belong to one competition.
- A match MUST have one home team and one away team.
- A match MUST use one lifecycle state: draft, scheduled, assigned, approved, published, live, ended, or cancelled.
- A published match MUST have at least one valid active stream.
- A live match MUST have previously passed through published state.
- A cancelled or ended match MUST NOT be published again.

## Stream Invariants

- A stream MUST belong to one match.
- A stream MUST belong to one channel.
- A stream MUST always resolve to a channel with a provider.
- A stream MUST use one lifecycle state: idle, assigned, testing, approved, active, failed, or disabled.
- Only approved streams can become active.
- Disabled streams MUST NOT be published.
- Failed streams MUST NOT be exposed to mobile clients.
- Streams with failed health MUST NOT be exposed to mobile clients.

## Provider And Channel Invariants

- A channel MUST belong to one provider.
- A stream assignment requires an active channel from an active provider.
- Provider credentials MUST remain backend-only.
- Mobile responses MUST NOT include provider credentials.

## Publishing Invariants

- Publishing requires an approved match and an approved stream.
- Publishing changes the match to published and the stream to active.
- Mobile feed endpoints ONLY expose published matches with active streams.
- Mobile feed endpoints MUST exclude failed stream health and offline providers.
- Draft, scheduled, assigned, approved-only, failed, idle, testing, disabled, ended, and cancelled states MUST NOT appear in mobile live feeds.

## Enforcement

- SQLite enforces lifecycle state values and foreign keys for new databases.
- Backend transition guards reject illegal workflow actions.
- Repository mutations re-check state before writing.
- Desktop controls disable invalid actions before the backend is called.

## Stream Delivery Invariant

- GiTO Live Sports does NOT proxy, relay, retransmit, or transcode media streams.
- The backend is a management and orchestration platform only.
- Clients connect directly to the approved stream source URL provided by the selected IPTV channel.
- The backend is responsible for metadata, lifecycle management, validation, health monitoring, assignment, approval, and publishing only.
