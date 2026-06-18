# ASSIGN_ACTION_EXECUTION_REPORT

## Summary

Completed end-to-end verification of the "Assign Previewed Stream" workflow in the desktop app.

- `canAssign` was `true`
- `assignButtonDisabled` was `false`
- The frontend clicked `Assign Previewed Stream`
- The backend received `POST /matches/assign-stream`
- A new `match` and corresponding `stream` were persisted in SQLite
- No console errors occurred during the request execution

## Execution details

### UI state before assignment

Selected values used for the assign action:

- Sport: `Soccer`
- Competition: `Premier League`
- Home Team: `Manchester United`
- Away Team: `Manchester City`
- Preview confirmed: `true`
- Channel ID: `656772a7-c384-4288-97c6-38bb3c9cb544`
- `canAssign`: `true`
- `assignButtonDisabled`: `false`

### Captured frontend request

Request endpoint:

- `http://localhost:4100/matches/assign-stream`

Request payload:

```json
{
  "sportName": "Soccer",
  "competitionName": "Premier League",
  "homeTeamName": "Manchester United",
  "awayTeamName": "Manchester City",
  "startsAt": "2026-05-31T23:48:00.000Z",
  "channelId": "656772a7-c384-4288-97c6-38bb3c9cb544"
}
```

Response:

- HTTP status: `201`
- Response body included:
  - `match.id`: `6e947b11-4186-480f-be3b-2f451a1485af`
  - `stream.id`: `904b2c1f-6a01-469e-b68c-d92e356178c1`
  - `stream.status`: `assigned`
  - `stream.approvalStatus`: `assigned`
  - `stream.healthStatus`: `unknown`

## Database verification

Verified persisted data in `apps/backend/data/gito.sqlite`:

- `matches` row found for `id = 6e947b11-4186-480f-be3b-2f451a1485af`
  - `status = assigned`
  - `home_team_id = a0a5ebb7-7332-49a1-99dc-415e031f9fea`
  - `away_team_id = 8a499a2a-ed10-4658-bc5a-47895648ef99`
  - `competition_id = 472b0739-6961-44db-aba5-74b79ded631f`

- `streams` row found for `id = 904b2c1f-6a01-469e-b68c-d92e356178c1`
  - `match_id = 6e947b11-4186-480f-be3b-2f451a1485af`
  - `channel_id = 656772a7-c384-4288-97c6-38bb3c9cb544`
  - `protocol = hls`
  - `status = assigned`
  - `approval_status = assigned`
  - `health_status = unknown`

## Notes

- The assign workflow requires valid competition-specific team values; after selecting `Premier League`, the available home/away teams were limited to `Manchester City` and `Manchester United`.
- Because the app filters teams after competition selection, selecting an invalid home team value caused the assignment data to remain incomplete.

## Conclusion

The `Assign Previewed Stream` action is functioning end-to-end: the frontend submits the correct payload, the backend returns `201`, and the expected `matches`/`streams` rows are inserted successfully into SQLite.
