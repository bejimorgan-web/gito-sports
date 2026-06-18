# STREAM_FAILURE_GATE_AUDIT_REPORT

## 1. Summary

- The real IPTV preview reproduced playback failure conditions.
- The current live workflow gating does not block `Assign match` before an assignment exists.
- `streamFailed` is computed only from an existing assignment's stream state.
- Playback errors in `StreamPreviewPanel` are visible locally but do not set `assignment.stream.healthStatus` unless there is a matching assigned stream.

## 2. Runtime values captured

From the running desktop app at `http://localhost:4200`:

- `selectedCompetitionId`: ``
- `selectedHomeTeamId`: ``
- `selectedAwayTeamId`: ``
- `selectedChannelId`: `656772a7-c384-4288-97c6-38bb3c9cb544`
- `previewConfirmed`: `true`
- `backendOffline`: `false`
- `streamFailed`: `false`
- `canAssign`: `true`
- `canApprove`: `false`
- `canPublish`: `false`
- `assignButtonDisabled`: `false`
- `approveButtonDisabled`: `true`
- `publishButtonDisabled`: `true`

## 3. Reproduced preview playback trace

The preview trace logs show the failure sequence:

- `preview started` for channel `656772a7-c384-4288-97c6-38bb3c9cb544` (`ADN TV+ (720p)`)
- `time update` at `currentTime=0`
- `player active`
- `HLS manifest parsed`
- `onPreviewReady fired`
- `player waiting`
- `player degraded` due to `Buffering or waiting for stream data.`
- `metadata loaded` with `duration=60`
- `video error` with `PipelineStatus::DECODER_ERROR_NOT_SUPPORTED: audio decoder initialization failed with DecoderStatus::Codes::kUnsupportedConfig`
- `player failed` with same decoder error
- `time update` at `currentTime=42.019982`
- `player active`
- `HLS error` with `bufferAppendError (mediaError)`
- `player failed` with `bufferAppendError`
- `player failed` with `Playback stalled for too long.`

## 4. Code paths that compute `streamFailed`

In `apps/desktop/src/renderer/features/broadcast/BroadcastConsoleScreen.tsx`:

- `const streamFailed = assignment?.stream.healthStatus === "failed" || assignment?.stream.status === "failed"`
- `assignButtonDisabled`, `approveButtonDisabled`, and `publishButtonDisabled` all include `streamFailed`.

That means the failure gate is only active when an assignment exists and its stream is already failed.

## 5. Code paths that set `healthStatus`

In `apps/desktop/src/renderer/App.tsx`:

- `reportStreamHealth(status, reason?)` updates local `assignment.stream.healthStatus` when `currentAssignment` exists and matches the selected channel.
- It also sends `apiClient.reportStreamHealth` to the backend.

In `apps/backend/src/repositories/operations-repository.ts`:

- `reportStreamHealth(streamId, input)` updates `streams.health_status` and optionally `health_reason`, `failure_count`, and `last_health_at`.
- It can also log operational events for health updates.

In `apps/backend/src/routes/streams.ts`:

- `POST /:streamId/health` forwards the request to `reportStreamHealth`.

## 6. Code paths that set `stream.status`

In `apps/backend/src/repositories/operations-repository.ts`:

- `assignMatch` / `reassignStream` update a stream to `assigned` and reset `health_status` to `unknown`.
- `approveStream` updates a stream to `approved`.
- `publishStream` updates a stream to `active`.
- `reportStreamHealth` sets `status = 'failed'` when the reported health status is `failed` and the current stream status is `active`.

Specifically:
- `UPDATE streams SET status = 'approved', approval_status = 'approved' ...` in `approveStream`
- `UPDATE streams SET status = 'active', approval_status = 'active' ...` in `publishStream`
- `UPDATE streams SET channel_id = ?, status = 'assigned', approval_status = 'assigned', health_status = 'unknown', ...` in `reassignStream`
- `UPDATE streams SET status = 'failed', approval_status = 'failed', ... WHERE id = ? AND status = 'active'` in `reportStreamHealth`

## 7. Conclusion

The current failure gate is correct for assigned/published streams, but it does not block assignment on preview failures because assignment state is absent.

The runtime trace shows real playback errors in the preview implementation, yet `streamFailed` remains `false` because there is no active assignment to attach the health failure to.

## 8. Recommendation

If the intended behavior is to prevent assigning a channel after a failed preview, the gating logic must be extended to consider preview health before assignment, not only `assignment.stream` state.

If the intended behavior is only to stop workflows for already-assigned streams, then the current logic is consistent: preview playback failures do not automatically mark an unassigned stream as failed.
