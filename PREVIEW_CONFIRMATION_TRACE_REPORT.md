# PREVIEW_CONFIRMATION_TRACE_REPORT

Date: 2026-06-01
Workspace: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports`

## Trace Summary

This trace follows the preview confirmation lifecycle for `BroadcastConsoleScreen`.

## Where `previewConfirmed` is defined

In `apps/desktop/src/renderer/features/broadcast/BroadcastConsoleScreen.tsx`:

```tsx
const previewConfirmed = Boolean(selectedChannel) && previewedChannelId === selectedChannel?.id;
```

This is a derived boolean, not a separate React state variable.

## Where `previewConfirmed` becomes true

It becomes true when:
- `selectedChannel` is set to a channel, and
- `previewedChannelId` becomes equal to `selectedChannel.id`

That setter is `setPreviewedChannelId(channel.id)` via `onPreviewReady`.

## Every setter affecting `previewConfirmed`

In `apps/desktop/src/renderer/App.tsx`:

- `const [previewedChannelId, setPreviewedChannelId] = useState<string>();`
- `selectChannel = useCallback((channel: Channel) => { setSelectedChannel(channel); setPreviewedChannelId(undefined); }, []);`
  - resets preview confirmation whenever a new channel is selected
- `markPreviewReady: setPreviewedChannelId` in the `actions` object
  - this is passed to `StreamPreviewPanel` as `onPreviewReady`
- `setPreviewedChannelId(parsed.previewedChannelId)` when restoring session state from localStorage

In `apps/desktop/src/renderer/features/preview/StreamPreviewPanel.tsx`:

- `onPreviewReady(channel.id)` is called when the preview is ready:
  - after HLS manifest parsing: `hls.on(Hls.Events.MANIFEST_PARSED, ...)`
  - for non-HLS playback: after setting `video.src = channel.url`

## Runtime workflow trace

### Step 1: Select channel

- Action: click a channel button in the channel list
- Runtime state change:
  - `selectedChannelId` becomes a channel UUID
  - `previewedChannelId` becomes `undefined`
  - `previewConfirmed` remains `false`

### Step 2: Start preview

- Action: `StreamPreviewPanel` mounts or reloads with the selected channel
- Internal event: video source is set and preview begins
- At this point, the panel is loading the stream; `previewConfirmed` still may be `false` until preview becomes ready

### Step 3: Complete preview

- Action: `StreamPreviewPanel` calls `onPreviewReady(channel.id)`
- This happens when:
  - HLS manifest parsing completes, or
  - the browser video source is initialized for non-HLS playback
- Runtime state change:
  - `previewedChannelId` becomes equal to `selectedChannel.id`
  - `previewConfirmed` becomes `true`

### Step 4: Confirm preview

- There is no separate explicit user button for confirmation.
- The preview confirmation event is the callback from `StreamPreviewPanel` when the preview is ready.

## Runtime values captured

Captured from `window.__GITO_CONTROL_DIAGNOSTIC__` during runtime:

- After channel selection, before preview ready:
  - `selectedChannelId`: non-null
  - `previewedChannelId`: null/undefined
  - `previewConfirmed`: false

- After preview readiness:
  - `selectedChannelId`: same channel UUID
  - `previewedChannelId`: same channel UUID
  - `previewConfirmed`: true

## Answers

A. What user action sets `previewConfirmed=true`?
- The automatic preview-ready callback from `StreamPreviewPanel` when the selected channel preview is successfully initialized. In code, this is `onPreviewReady(channel.id)`.

B. Is that action visible in the UI?
- Yes indirectly. It is visible as the preview panel status changing to a ready/preview state, and the blocked assignment message changing from "Blocked: preview must be confirmed before assignment." to unlocked.

C. Is the action reachable?
- Yes. It is reachable by selecting a channel and allowing the preview panel to load the stream.

D. Is the state transition broken?
- No. The state transition is working. `previewConfirmed` becomes true after `StreamPreviewPanel` fires `onPreviewReady(channel.id)`.

E. Should `previewConfirmed` remain part of `canAssign`?
- Yes, if the intended UX requires a successful preview before assignment.
- If the operator should be allowed to assign immediately after selecting a channel, then `previewConfirmed` should be removed from `canAssign`. But as the current code and UI messaging are designed, keeping it is correct.
