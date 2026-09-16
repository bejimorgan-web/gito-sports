# Direct Xtream Publication Decision

## Decision

Published deliveries support two explicit playback modes:

- `DIRECT_SAFE`: existing credential-free HTTPS delivery validation.
- `DIRECT_XTREAM`: HTTPS Xtream provider playback URLs selected by Desktop publication assignment.

The backend stores delivery metadata only. It does not own IPTV providers, credentials, catalogues, or stream transport. Mobile receives the selected playback URL and uses the existing direct video player.

## Boundary

Desktop remains the source of truth for IPTV accounts, credentials, channel selection, validation, catalogue synchronization, and preview. The publication handoff is the only Desktop integration point changed.

`DIRECT_XTREAM` is narrowly accepted only for HTTPS URLs with an Xtream media path (`/live`, `/movie`, or `/series`) and a stream filename. HTTP URLs, unsupported protocols, userinfo, and sensitive query parameters remain rejected.

## Compatibility

M3U and credential-free Xtream `direct_source` URLs continue using `DIRECT_SAFE`. Existing delivery rows migrate to `DIRECT_SAFE`.

## Security tradeoff

This mode intentionally permits the selected Xtream playback URL to be returned to Mobile because the requested architecture uses direct provider-to-Mobile playback. Provider credentials embedded in that URL are therefore client-visible by design. A future relay architecture would be required to remove that exposure; this change does not implement a relay.
