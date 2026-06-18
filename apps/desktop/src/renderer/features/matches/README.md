Stream Status Panel

This folder contains the `StreamStatusPanel` component used by the `MatchSchedulerScreen` to display the Active Stream resolution, the failover chain, and invalid stream assignments.

Files

- `StreamStatusPanel.tsx` — React component that calls the backend `GET /matches/:matchId/stream-status` via `apiClient.getStreamStatus` and presents results in a compact, readable panel. It exposes a `Recompute Active Stream` button.

Integration

- The `MatchSchedulerScreen` imports and uses `StreamStatusPanel` passing the selected match id as `matchId`.

Design Notes

- The panel is intentionally read-only and uses only the Phase 5 APIs.
- It avoids any playback or streaming behavior — only displays metadata and decision results.

Developer commands

- To run and test manually:

```powershell
# start backend
cd "c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend"
npm run dev

# start desktop
cd "c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\desktop"
npm run dev
```

Testing

- Create a match in the scheduler.
- Assign streams via the backend endpoints.
- Open the scheduler UI, select a match and click `Recompute Active Stream` to view results.
