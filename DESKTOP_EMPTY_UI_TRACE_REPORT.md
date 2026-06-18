# DESKTOP_EMPTY_UI_TRACE_REPORT

## 1. Desktop API base URL

The desktop frontend resolves the API base URL from `apps/desktop/src/renderer/services/api-client.ts`:

- `const API_BASE_URL = (import.meta.env.VITE_GITO_API_BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");`

So the desktop app is wired to:

- `http://localhost:4100` (by default)

There is no alternate API host hard-coded in the renderer source.

## 2. Actual backend process being called

The desktop app calls backend routes served by `apps/backend/src/app.ts`.
The relevant registered routers are:

- `/iptv` → `apps/backend/src/routes/iptv.ts`
- `/matches` → `apps/backend/src/routes/matches.ts`
- `/live-matches` → `apps/backend/src/routes/live-matches.ts`
- `/sports` → `apps/backend/src/routes/sports.ts`
- `/operations` → only `/operations/logs` is implemented in `apps/backend/src/routes/operations.ts`

Note: `/operations/published` is not an implemented backend route. `live-approvals` is a desktop screen name, not an HTTP endpoint.

## 3. Requests issued on application startup

At startup, `apps/desktop/src/renderer/App.tsx` does the following:

1. `POST http://localhost:4100/auth/login`
   - body: `{ "email": "operator@gito.local" }`
   - on success stores `accessToken` and continues
2. `GET http://localhost:4100/iptv/providers`
3. `GET http://localhost:4100/iptv/channels`
4. `GET http://localhost:4100/live-matches/current`

These three backend fetches are launched together in `refreshOperations("full")`.

If the app is in live mode, it later refreshes only `/live-matches/current`.

## 4. Response status codes

The frontend will treat any non-2xx response as failure and set `backendStatus` to `offline`.

- `/auth/login` should return `200` on the default operator login flow.
- `/iptv/providers` returns `200` with provider list JSON.
- `/iptv/channels` returns `200` with channel list JSON.
- `/live-matches/current` returns `200` with published live-match list JSON.

Failure on any of these during startup will mark the backend offline and stop data propagation.

## 5. Response payload counts from current backend DB (`data/gito.sqlite`)

From the current `data/gito.sqlite` file:

- `sports`: `0`
- `providers`: `13`
- `channels`: `4507`
- `matches`: `6`
- `streams`: `6`
- `published live matches` (the result of `/live-matches/current`): `0`

The backend startup log you referenced is consistent with a healthy backend in the sense that there are providers/channels/matches/streams, but the published-feed query returns zero rows for the current dataset.

## 6. React state after each response

Startup state updates in `App.tsx`:

- `setProviders(providerData)` from `/iptv/providers`
- `setChannels(channelData)` from `/iptv/channels`
- `setLiveMatches(liveData)` from `/live-matches/current`

So after startup:

- `providers` should contain provider rows if backend returned them
- `channels` should contain channel rows if backend returned them
- `liveMatches` will be empty if `/live-matches/current` returned `[]`

Separately, the sports screen and approvals screen request additional data when mounted:

- `SportsWorkspaceScreen` calls `apiClient.listSports()` → `/sports`
- `LiveMatchApprovalScreen` calls `apiClient.listCompetitions()`, `apiClient.listTeams()`, and `apiClient.listSports()`

## 7. UI render conditions

### Sports UI

- Renders empty when `sports.length === 0`
- `apiClient.listSports()` hits `GET http://localhost:4100/sports`
- Current DB has `0` sports rows, so the sports workspace will display empty UI for sports

### IPTV UI

- Renders providers and channels from `providers` and `channels` state
- Since backend likely returns providers/channels, this UI should show data if the desktop is connected correctly

### Matches and live approvals

- The live approvals feed is driven by `liveMatches` state from `/live-matches/current`
- `LiveMatchApprovalScreen` also fetches competitions/teams/sports for labels, but the primary empty state is `liveMatches.length === 0`
- The backend query for `/live-matches/current` only returns rows where:
  - `streams.status = 'active'`
  - `streams.published_at IS NOT NULL`
  - `matches.status = 'published'`
  - `streams.health_status != 'failed'`
  - channel and provider are active and provider is not offline

That filter is stricter than simply having `streams` in the database, which explains why `streams = 6` does not guarantee any live feed rows.

## Specific trace answers

A. Does the backend return data?
- `/sports`: yes, the backend route exists, but it returns an empty list because `sports` is empty.
- `/iptv/providers`: yes, the backend route exists and returns provider data. Current DB count is `13` providers.
- `/iptv/channels`: yes, the backend route exists and returns channel data. Current DB count is `4507` channels.
- `/matches`: yes, the backend route exists and returns match data. Current DB count is `6` matches.
- `/operations/published`: no, this route does not exist in the backend.
- `/live-approvals`: not an HTTP endpoint; it is a desktop UI screen name.

B. Does the frontend receive data?
- For providers/channels: yes, if the backend is reachable and returns `200`, the frontend will receive arrays and populate React state.
- For sports: yes, but it will receive `[]`.
- For published live matches: yes, but it will receive `[]` if no rows satisfy the published-feed filters.

C. Does React state contain data?
- `providers` and `channels`: yes, if startup fetches succeed.
- `liveMatches`: likely no, because `/live-matches/current` returns an empty array.
- `sports`: no, because `/sports` returns an empty array.

D. Is the UI filtering data away?
- The desktop UI is not primarily hiding providers/channels.
- The biggest filter effect is on the published feed: backend-side filters in `/live-matches/current` mean stored streams are not shown unless they are published + active + approved + healthy.
- For sports, the data is missing at the source rather than hidden by a UI filter.

E. Is the desktop connected to the wrong backend?
- No evidence of a wrong backend URL in the desktop source.
- The app is configured to use `http://localhost:4100` by default, and the backend implements the expected `/iptv`, `/sports`, `/matches`, and `/live-matches` routes.
- The absence of `/operations/published` or `/live-approvals` means those URLs are not part of the current desktop/backend contract.

## Conclusion

The empty desktop UI is caused by backend domain state, not by a wrong API target:

- `sports` is empty in the backend DB.
- `/live-matches/current` is empty because no published/active live-match feed rows exist under the current filter rules.

The backend does have providers/channels/matches/streams, but those counts do not guarantee visible live approvals or sports catalog rows.
