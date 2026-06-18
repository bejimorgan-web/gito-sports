# 0014 — Stream Delivery Invariant

Date: 2026-05-30
Author: Automated documentation change (assistant)

## Summary

Add and document a non-negotiable architectural invariant specifying that GiTO Live Sports does NOT proxy, relay, retransmit, or transcode media streams. The backend remains a management and orchestration platform; clients connect directly to approved stream source URLs.

## Rationale

- Protects operator privacy and credentials by keeping playback endpoints client-to-source.
- Avoids operational and legal complexity of media transit, scaling, and DRM/transcoding responsibilities.
- Keeps the MVP focused on metadata, lifecycle, validation, and health management.

## Files Updated

- docs/INVARIANTS.md (added `Stream Delivery Invariant` section)
- docs/ARCHITECTURE.md (added `Stream Delivery` section)

## Acceptance Criteria

1. The invariant text appears in `docs/INVARIANTS.md` and `docs/ARCHITECTURE.md`.
2. Documentation clearly states the backend will not proxy or transcode streams.
3. Any future request to proxy/transcode tracks a documented architectural change and security/operational review.

## Follow-ups (not part of this task)

- If operators require proxying or CDN-edge features, open a design task that enumerates requirements (auth, logging, scaling, caching, legal, and cost).
- Consider adding optional runtime toggle and enterprise feature set guarded by policy and additional infra.
