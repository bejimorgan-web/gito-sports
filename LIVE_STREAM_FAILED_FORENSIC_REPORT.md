LIVE STREAM FAILED FORENSIC REPORT

Summary:
- Investigated operator-visible failure: "Stream failed. Remove from live operations."
- Focus: exact active assignment state, DB record, timeline, code path, legitimacy, remediation.

A. Exact record causing the warning
- Stream row (from `streams` table):
  - id: 28ddc271-9ece-4b2e-ac0d-35bdef373cde
  - match_id: 216c6b84-81f2-4009-beb0-71467b90d7bb
  - channel_id: b6b3910a-b090-4cbf-88ef-ab82938dc5c5
  - protocol: hls
  - status: failed
  - health_status: unknown
  - health_reason: "Loading stream."
  - failure_count: 2
  - created_at: 2026-05-30T12:19:08.910Z
  - updated_at: 2026-05-30T18:24:46.934Z
  - last_health_at: 2026-05-30T18:24:46.934Z

B. Exact field value triggering UI `streamFailed`
- UI evaluates `streamFailed` as `assignment.stream.healthStatus === 'failed' || assignment.stream.status === 'failed'`.
- For this record: `status === 'failed'` is true — this is the field that triggers the warning.

C. Exact code path that set the value
- Frontend `StreamPreviewPanel` -> `markFailed(reason)` (on HLS fatal error, playback stall, playback errors).
- This calls the App-level `reportStreamHealth` which calls `apiClient.reportStreamHealth`.
- Backend path: `POST /streams/:streamId/health` (router `apps/backend/src/routes/streams.ts`) -> `reportStreamHealth` in `apps/backend/src/repositories/operations-repository.ts`.
- `reportStreamHealth` updates `health_status`, `health_reason`, `failure_count`, `last_health_at`, `updated_at`.
- If `input.status === 'failed'` and existing stream `status === 'active'`, the repository additionally runs:
  - `UPDATE streams SET status = 'failed', approval_status = 'failed' WHERE id = ? AND status = 'active'`
  - And sets `matches.status = 'cancelled'` for published matches.
- Evidence in logs: operational log entry `stream_failure_detected` for stream `28ddc271-...` at 2026-05-30T16:23:43.246Z with message "Playback stalled for too long." and metadata `{"healthStatus":"failed", ...}`.

D. Timeline and analysis — legitimate vs stale
- 2026-05-30T12:19:09Z: stream assigned and later approved/published (operational logs show assignment/approval/publish around 12:19Z).
- 2026-05-30T16:23:43.246Z: `stream_failure_detected` logged (severity error) — `reportStreamHealth` set `health_status='failed'` and (if stream was `active`) set `status='failed'`.
- Immediately after (16:23:50Z): several `stream_health_updated` entries show `healthStatus: active` — the stream briefly recovered, but repository does not auto-reset `status` back to `active` when health recovers.
- 2026-05-30T18:24:46.934Z: stream row shows `updated_at` at this timestamp with `health_status='unknown'` and `health_reason='Loading stream.'` (operational log at 18:24:46.973Z shows the frontend emitted `Loading stream.`). However `status` remains `failed`.
- Conclusion: initial failure detection at 16:23:43 was legitimate (playback stall reported by preview player). Subsequent health reports indicate recovery and later transient unknown/loading; but `status='failed'` remained set by the initial failing code path and was not cleared when health recovered — causing a stale UI warning even after temporary recovery.

E. Safe remediation
- Immediate operator remediation (no code change required):
  1. Reassign the stream to the same channel via `POST /streams/:streamId/reassign` (backend `reassignStream`) — this resets `status='assigned'`, `health_status='unknown'`, and `failure_count=0`.
  2. Or, if appropriate, `approve` + `publish` flows can be used to re-activate a recovered stream (but publishing is blocked while `status === 'failed'`). Reassign is safest.
- Suggested code improvement (medium-term):
  - Update `reportStreamHealth` to consider clearing `status='failed'` when a subsequent `input.status === 'active'` is received and the operator did not manually disable the stream. Example: if `row.status === 'failed'` and `input.status === 'active'` and `failure_count` below a threshold, consider updating `status='active'` or `status='assigned'` depending on workflow. Add audit/logging when auto-recovery occurs.

Appendix — Evidence snippets
- DB stream row (from `SELECT ... FROM streams WHERE id = '28ddc271-9e...';`):
  - ('28ddc271-9ece-4b2e-ac0d-35bdef373cde','216c6b84-81f2-4009-beb0-71467b90d7bb','b6b3910a-b090-4cbf-88ef-ab82938dc5c5','hls','failed',NULL,NULL,NULL,'2026-05-30T12:19:08.910Z','2026-05-30T18:24:46.934Z','2026-05-30T18:24:46.934Z','failed','unknown','Loading stream.',2,'2026-05-30T18:24:46.934Z')
  (Note: columns shown in report were selected in script output; schema uses snake_case: `match_id`, `health_status`, `health_reason`, `failure_count`, `last_health_at`.)

- Key operational log entries (selected):
  - 2026-05-30T16:23:43.246Z | `stream_failure_detected` | "Playback stalled for too long." | metadata includes `{"healthStatus":"failed"}`
  - 2026-05-30T16:23:50.512Z | `stream_health_updated` | "Stream health changed to active." (recovery)
  - 2026-05-30T18:24:46.973Z | `stream_health_updated` | "Loading stream." (health set to `unknown`)

Recommendations & Next Steps
- Operator: run a reassign to clear `failed` status for streams that recovered:
  - `POST /streams/:streamId/reassign` with a valid `channelId` (can be same channel) from operator tooling.
- Engineering: consider one of the following:
  - Auto-clear `status='failed'` on `reportStreamHealth(..., 'active')` with safe checks, or add an operator-reset API endpoint.
  - Add visibility in UI which field triggered `streamFailed` (status vs health) so operators can decide whether to reassign or ignore.

End of report.
