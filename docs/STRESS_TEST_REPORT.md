# Stress Test Report

Generated: 2026-05-29T21:27:48.107Z

## Before Remediation

- Multi-match stress simulation passed, but workflow P95 latency was 3537 ms.
- Concurrent `/streams/:streamId/health` reporting produced transport failures.
- LIVE MODE 50-match validation timed out during health reporting.
- `/mobile/matches/live` became unreachable after sustained stress.

## Changes Applied

- Collapsed stream health updates, provider health impact, failure lifecycle changes, and health logging into one SQLite transaction.
- Coalesced repeated non-critical health reports inside a short interval.
- Reduced provider health score impact for degraded reports so mixed degraded and failed streams do not unnecessarily remove all provider channels from live delivery.
- Reduced duplicate health-update operational logs while preserving assignment, approval, publish, and failure audit events.
- Added endpoint request counts, success/failure counts, and P95 latency summaries to the stress harness.

## Readiness Assessment

PASS WITH WARNINGS

## Test Coverage

| Scenario | Status | Scale | Duration | Key Metrics |
| --- | --- | --- | ---: | --- |
| Multi-match stress simulation | PASS | 10, 25, and 50 simultaneous live matches | 161183 ms | liveMatches: 50, workflowP95Ms: 1780, feedP95Ms: 3, workflowRequests: 150 |
| Multi-stream failure simulation | PASS | 5 simultaneous failures, then 10 total failures with mixed degraded updates | 5631 ms | failedStreams: 10, degradedStreams: 10, remainingFeedMatches: 40 |
| Provider outage chaos test | WARN | single and multiple provider outages during active matches | 25035 ms | outageProviders: 2, outageMatches: 10, feedAfterOutages: 40 |
| Backend degradation and recovery | PASS | temporary backend unavailability during approved publish | 2832 ms | unavailableDetected: yes, recoveredPublishStatus: active |
| Long-run session validation | WARN | accelerated 4h, 8h, and 12h polling equivalents | 514 ms | pollingCycles: 240, simulatedHours: 4/8/12 checkpoints via 240 feed polls, feedP95Ms: 3, heapDeltaMb: 3.19 |
| High-frequency event simulation | PASS | 120 rapid health updates and repeated lifecycle attempts | 24717 ms | healthUpdates: 120, duplicatePublishAttempts: 3, healthUpdateP95Ms: 416, validFeedCount: 41 |
| Operator error injection | PASS | invalid assignment, duplicate actions, and rapid invalid publish attempts | 15 ms | invalidAssignments: 1, rapidInvalidPublishes: 10, validFeedCount: 41 |
| LIVE MODE readability validation | WARN | 50 live items with 20 alert-producing states | 114426 ms | visibleLiveMatches: 50, alertProducingStates: 20, atRiskTrackedLocally: 20 |
| Continuous feed consistency verification | PASS | SQLite, backend, and mobile feed checks after stress | 6 ms | mobileFeedCount: 91, sqliteMatches: 111, sqliteStreams: 111, failedStreams: 10, cancelledMatches: 10 |
| Primary provider health scoring | PASS | provider health after mixed active, degraded, and failed stream reports | 2 ms | availabilityStatus: online, healthScore: 100, failedChannelLoads: 60 |

## Endpoint Latency Summary

| Endpoint | Requests | Successes | Failures | P95 Latency |
| --- | ---: | ---: | ---: | ---: |
| /auth/login | 2 | 2 | 0 | 45 ms |
| /iptv/channels?providerId=062ddfd3-afcc-4065-ae81-610f1ac4c655 | 1 | 1 | 0 | 2 ms |
| /iptv/channels?providerId=105501cb-473f-46d2-b2a5-60aa3ce39947 | 1 | 1 | 0 | 1 ms |
| /iptv/channels?providerId=57fb1ffb-7072-4467-acba-36e0638a945a | 1 | 1 | 0 | 8 ms |
| /iptv/channels?providerId=5b9ffde9-8421-45e2-9f4e-35921178955f | 1 | 1 | 0 | 1 ms |
| /iptv/channels?providerId=6fcb1dac-4aa4-4c46-b54c-d96632052f20 | 1 | 1 | 0 | 2 ms |
| /iptv/providers | 6 | 6 | 0 | 4210 ms |
| /iptv/providers/062ddfd3-afcc-4065-ae81-610f1ac4c655/m3u | 1 | 1 | 0 | 200 ms |
| /iptv/providers/105501cb-473f-46d2-b2a5-60aa3ce39947/m3u | 1 | 1 | 0 | 1217 ms |
| /iptv/providers/57fb1ffb-7072-4467-acba-36e0638a945a/m3u | 1 | 1 | 0 | 10990 ms |
| /iptv/providers/5b9ffde9-8421-45e2-9f4e-35921178955f/m3u | 1 | 1 | 0 | 1055 ms |
| /iptv/providers/6fcb1dac-4aa4-4c46-b54c-d96632052f20/m3u | 1 | 1 | 0 | 9775 ms |
| /live-matches/current | 243 | 243 | 0 | 3 ms |
| /matches/assign-stream | 112 | 112 | 0 | 1768 ms |
| /mobile/matches/live | 5 | 5 | 0 | 4 ms |
| POST /streams/:streamId/approve | 111 | 111 | 0 | 1142 ms |
| POST /streams/:streamId/health | 160 | 160 | 0 | 5908 ms |
| POST /streams/:streamId/publish | 125 | 124 | 1 | 1119 ms |

## Findings

- WARN: Provider outage chaos test: Provider outage feed exclusion is immediate, but match lifecycle remains published because direct provider outage does not trigger automatic cancellation without stream health failure.
- WARN: Long-run session validation: Long-run preview playback stability requires manual or browser-based verification because this harness validates backend/session polling only.
- WARN: LIVE MODE readability validation: LIVE MODE remains data-consistent at high scale, but 40+ visible live rows should receive hands-on UI readability review before event-day use.

## Recommendations

- Keep `/streams/:streamId/health` endpoint latency under observation; the remediated run removed transport failures, but concurrent health waves still produce the highest endpoint P95.
- Add explicit capacity expectations for rapid health reporting and LIVE MODE alert density before event-day use.
- Keep `/mobile/matches/live` in every stress gate; it remained reachable after remediation and must stay prioritized over background health traffic.
- Run the stress harness before deployment using `npm run stress:operations`.
- Perform a hands-on browser/Electron LIVE MODE readability review at 40+ visible live rows.
- Add browser-level memory instrumentation before relying on automated 8-12 hour preview playback results.
- Treat direct provider outage as feed-exclusion state; match cancellation remains tied to explicit stream failure health reports.

## Notes

- Simulations use an isolated SQLite database under `data/` and do not modify production data.
- Long-run validation is accelerated through repeated feed polling; it verifies backend/session stability, not real media playback duration.
- The harness preserves the existing architecture, schema, lifecycle rules, and backend routes.
