# SELECTION_BINDING_AUDIT_REPORT

Date: 2026-06-01
Workspace: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports`
UI URL: `http://localhost:4200`

## Scope

Audit of the match control selection binding in `apps/desktop/src/renderer/features/broadcast/BroadcastConsoleScreen.tsx` and related `App.tsx` state wiring.

## Findings

### Competition selector
- Displayed value after selection: `Governance League`
- Handler: `onChange={(e) => setSelectedCompetitionId(e.target.value)}` in `BroadcastConsoleScreen.tsx`
- State before selection: `selectedCompetitionId = ""`
- State after selection: `selectedCompetitionId = "51eec79e-219a-4133-9c37-a21780b1d6cb"`

### Home Team selector
- Displayed value after selection: `Arsenal`
- Handler: `onChange={(e) => setSelectedHomeTeamId(e.target.value)}` in `BroadcastConsoleScreen.tsx`
- State before selection: `selectedHomeTeamId = ""`
- State after selection: `selectedHomeTeamId = "67428ad8-53aa-417e-ae67-df4c5d479c30"`

### Away Team selector
- Displayed value after selection: `Atlético Madrid`
- Handler: `onChange={(e) => setSelectedAwayTeamId(e.target.value)}` in `BroadcastConsoleScreen.tsx`
- State before selection: `selectedAwayTeamId = ""`
- State after selection: `selectedAwayTeamId = "46bbe704-bd08-4214-aa1d-815e03e29376"`

### IPTV Channel selector
- Displayed value after selection: `ADN TV+ (720p)`
- Handler in `BroadcastConsoleScreen.tsx`: each channel button calls `onSelectChannel(channel)`
- App state binding in `App.tsx`: `selectChannel = (channel) => { setSelectedChannel(channel); setPreviewedChannelId(undefined); }`
- State before selection: `selectedChannelId = null`
- State after selection: `selectedChannelId = "656772a7-c384-4288-97c6-38bb3c9cb544"`

## Runtime state snapshot

Captured from `window.__GITO_CONTROL_DIAGNOSTIC__` inside `BroadcastConsoleScreen`:

- `selectedCompetitionId`: `51eec79e-219a-4133-9c37-a21780b1d6cb`
- `selectedHomeTeamId`: `67428ad8-53aa-417e-ae67-df4c5d479c30`
- `selectedAwayTeamId`: `46bbe704-bd08-4214-aa1d-815e03e29376`
- `selectedChannelId`: `656772a7-c384-4288-97c6-38bb3c9cb544`
- `previewConfirmed`: `true` (after preview readiness)
- `backendOffline`: `false`
- `streamFailed`: `false`
- `canAssign`: `true` (after preview confirmed)
- `assignButtonDisabled`: `false` (after preview confirmed)

## Verification

- UI display values matched stored state for competition, home team, away team, and selected channel.
- No selector was found to update the UI independently of state.
- The selectors are bound correctly; the values are carried into component state as expected.

## Answers

A. Which selector fails to update state?
- None of the selectors fail to update state. Competition, Home Team, Away Team, and IPTV Channel all update state correctly.

B. Does UI show a value while state remains null?
- No. Displayed values correspond to actual state values in the runtime snapshot.

C. Exact component and handler responsible.
- `BroadcastConsoleScreen.tsx` handles the selectors:
  - `setSelectedCompetitionId(e.target.value)` for competition
  - `setSelectedHomeTeamId(e.target.value)` for home team
  - `setSelectedAwayTeamId(e.target.value)` for away team
  - `onSelectChannel(channel)` for IPTV channel
- `App.tsx` implements the channel selection binding in `selectChannel`, where it calls `setSelectedChannel(channel)` and resets `previewedChannelId`.

D. Exact fix required.
- The remaining disabled button state is not a selector binding failure. It is the preview gating condition.
- `BroadcastConsoleScreen.tsx` uses:
  - `const previewConfirmed = Boolean(selectedChannel) && previewedChannelId === selectedChannel?.id;
    const canAssign = Boolean(selectedChannel) && previewConfirmed && !assignment;`
- The fix depends on intended UX:
  1. If selecting a channel should immediately permit assignment, remove `previewConfirmed` from `canAssign`.
  2. If preview must be explicitly ready before assignment, keep `previewConfirmed` and improve the UI messaging to make that step explicit.

## Conclusion

This is a UX/gating issue, not a broken selector binding. The exact code path that controls the disabled assign action is `BroadcastConsoleScreen.tsx` via `previewConfirmed`, and `StreamPreviewPanel.tsx` must successfully call `onPreviewReady(channel.id)` when the preview becomes ready.
