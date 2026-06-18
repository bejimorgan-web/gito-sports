# REAL_STREAM_PREVIEW_AUDIT_REPORT

Date: 2026-06-01
Workspace: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports`

## Test summary

A real IPTV channel was selected and previewed in `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`.

- Selected channel: `ANIME x HIDIVE (720p) [Geo-blocked]`
- `selectedChannel.id`: `f2c9283a-7010-4cec-bceb-c2a47f7fb940`
- `previewedChannelId`: became `f2c9283a-7010-4cec-bceb-c2a47f7fb940`
- `previewConfirmed`: became `true`

## Trace points

### Before preview load

The preview panel was rendered with the selected IPTV channel.
At the earliest observable point after the fresh channel selection, the preview pipeline had started and the page showed:
- `selectedChannel.id` set to the new stream
- `previewConfirmed` initial state transitioning from `false` toward `true`

### During preview load

Captured events in `StreamPreviewPanel.tsx`:
- `preview started`
- `HLS manifest parsed`
- `onPreviewReady fired`
- `player waiting`
- `player degraded`
- `metadata loaded`

At this stage, `previewedChannelId` was updated and `previewConfirmed` became `true`.

### After preview load

The UI reached a ready/failed playback state with:
- `previewStatus`: `bufferAppendError` / `Playback stalled for too long.`
- `previewConfirmed`: `true`
- `selectedChannel.id` and `previewedChannelId` matched

## Console / playback errors captured

- HLS error: `fragLoadError (networkError)`
- HLS error: `bufferAppendError (mediaError)`
- Video error: `PipelineStatus::DECODER_ERROR_NOT_SUPPORTED: audio decoder initialization failed with DecoderStatus::Codes::kUnsupportedConfig`
- Browser network errors: multiple `Failed to load resource: 403 (Forbidden)`

## Answers

A. Does `onPreviewReady` actually fire?
- Yes. The trace log shows `onPreviewReady fired - channel id=f2c9283a-7010-4cec-bceb-c2a47f7fb940`.

B. If not, what exact event is missing?
- Not applicable: `onPreviewReady` fired. The missing issue is not `onPreviewReady`, but successful playback after preview readiness.

C. Is preview panel rendering without reaching ready state?
- No. The preview panel does render and reaches the ready-confirmation path. It advances to `onPreviewReady` and sets `previewConfirmed=true`.

D. Is the selected stream playable?
- Not fully. The stream triggers preview confirmation, but playback fails due to HLS/network errors and an unsupported audio decoder.

E. What exact condition prevents `previewConfirmed` from becoming true?
- In this test, no condition prevented it. `previewConfirmed` became true as soon as the stream reached the preview-ready callback.
- The eventual failure is caused by playback errors after confirmation, not by the preview confirmation gating itself.
