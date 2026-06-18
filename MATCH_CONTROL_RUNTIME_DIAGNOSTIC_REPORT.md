# MATCH CONTROL Runtime Diagnostic Report

Date: 2026-06-01
Workspace: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports`
UI URL: `http://localhost:4200`
Backend URL: `http://localhost:4100`

## Summary

The desktop UI is not allowing interaction with the broadcast control buttons because the current operator session has no selected IPTV channel and no match metadata selected. The backend is reachable and responding successfully.

## Runtime Evidence

- Backend health check: `GET http://localhost:4100/health` returned `200 OK`
- Backend status in current UI state: `Online`
- `window.__GITO_CONTROL_DIAGNOSTIC__` runtime object:
  - `selectedChannelId`: `null`
  - `previewConfirmed`: `false`
  - `backendOffline`: `false`
  - `streamFailed`: `false`
  - `canAssign`: `false`
  - `canApprove`: `false`
  - `canPublish`: `false`
  - `assignButtonDisabled`: `true`
  - `approveButtonDisabled`: `true`
  - `publishButtonDisabled`: `true`

## Blocked reasons shown in UI

- `Blocked: select an IPTV channel.`
- `Select a competition.`
- `Select a home team.`
- `Select an away team.`

## Root Cause

The blocking condition comes from the `BroadcastConsoleScreen` gating logic:

- `Assign Previewed Stream` requires a selected channel and `previewConfirmed`.
- `Approve Stream` requires an existing `assignment` with `stream.status` in `assigned` or `testing`.
- `Publish Live` requires `assignment.match.status === "approved"` and `assignment.stream.status === "approved"`.

Because no channel has been selected and no match metadata has been chosen, `canAssign` is false and the buttons remain disabled.

## Conclusion

The backend is available. The current disabled state is caused by front-end workflow gating, not by backend connectivity.

To enable `Assign Previewed Stream`, select an IPTV channel and confirm preview, then choose competition, home team, away team, and kickoff before assigning.
