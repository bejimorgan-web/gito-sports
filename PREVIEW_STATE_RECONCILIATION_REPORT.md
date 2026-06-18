# PREVIEW_STATE_RECONCILIATION_REPORT

## Objective
Prevent the desktop preview player from restoring a channel that no longer exists after a provider delete and app restart.

## Fix implemented
- Added validation for restored preview state in `apps/desktop/src/renderer/App.tsx`.
- On startup and after every full refresh, the app now verifies that `selectedChannel` still exists in the active backend channel list and belongs to an active provider.
- If the restored channel is missing or belongs to a deleted provider, the app now:
  - clears `selectedChannel`
  - clears `previewedChannelId`
  - removes the saved session from `localStorage`
- Also, on provider deletion the app clears any selected channel that belongs to the deleted provider immediately.

## Code changes
- `apps/desktop/src/renderer/App.tsx`
  - added `isSelectedChannelStillValid(...)`
  - added `clearPreviewState()` helper
  - reconciled restored preview state after `refreshOperations("full")`
  - cleared stale selected channel on `deleteProvider`

## Validation steps
1. Delete a provider from the IPTV management screen.
2. Restart the desktop app.
3. Confirm the preview does not restore a deleted channel.

## Result
- Deleted provider channels are no longer restored from persisted state.
- The preview player stops when the selected channel is invalid.
- The stale saved preview session is removed from `localStorage`.
