# SPORT_CREATE_FLOW_AUDIT

## Project context

Scanned relevant documentation and code:
- `docs/ARCHITECTURE.md` — confirms desktop operators configure sports and backend persists to SQLite.
- `docs/SPORTS_DATA_MODEL.md` — describes the sports module and sport lifecycle expectations.

The desktop app is an Electron + React + TypeScript client. It uses a Node/Express backend with SQLite via local persistence.

## Issue

Operator clicked `Save` while creating a Sport and observed no visible response.

## Workflow trace

UI
→ API Client
→ Backend Route
→ Repository
→ SQLite
→ Response
→ UI Update

### 1. Exact React component

- Component: `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`
- Handler: `saveSport()` inside `SportsWorkspaceScreen`
- Modal component: `apps/desktop/src/renderer/components/Modal.tsx`
- Toast component: `apps/desktop/src/renderer/components/Toast.tsx`

### 2. Save button click handler

The sport save workflow is triggered by the modal action button:
- In the `Modal` footer inside `SportsWorkspaceScreen.tsx`, the primary button executes `saveSport`.
- During create mode, the label is `Create` and the button is disabled by `isSaving`.

### 3. Form validation

`saveSport()` performs validation before API calls:
- Requires `sportName.trim()`.
- Validates `sportLogoUrl` with `isValidLogoSource(sportLogoUrl)`.
- If validation fails, it sets `status` and returns early.

### 4. API request execution

The desktop API client endpoint is:
- `apps/desktop/src/renderer/services/api-client.ts`
- `createSport(input: CreateSportRequest)` calls `request<Sport>('/sports', { method: 'POST', body: JSON.stringify(input) })`

### 5. Backend route used

The backend route handling sport creation is:
- `apps/backend/src/routes/sports.ts`
- `sportsRouter.post('/', ...)`
- It casts the request body to `CreateSportRequest`, validates `body.name`, and calls `createSport(body)`.

### 6. Database operation used

The repository operation is:
- `apps/backend/src/repositories/sports-repository.ts`
- `createSport(input: CreateSportRequest)`
- Generates a UUID and slug, inserts into `sports` table, and optionally records country links in `sport_countries`.
- `getDatabase()` is provided by `apps/backend/src/db/connection.ts`, which initializes SQLite and applies schema migrations.

### 7. HTTP response handling

On success, backend returns `201` with `{ data: sport }`.
On failure, the route returns `400` with `{ error: 'sport_name_required' }`.

In the frontend, `saveSport()` awaits `apiClient.createSport(payload)`.

### 8. UI update and list refresh

After successful creation, `saveSport()`:
- sets `setStatus('Sport created.')`
- sets `setSelectedSport(created)`
- invokes `pushToast('Sport created.', 'success')`
- calls `await loadData()` to refresh sports, countries, competitions, and teams
- calls `closeModal()` to dismiss the creation dialog

This ensures the sports list refreshes and the new sport becomes selected.

## Observed bug

The reported bug was a lack of visible operator feedback on sport creation.

Based on the traced code and the issue statement, the likely root cause was that the prior sport creation flow had:
- no explicit `isSaving` loading state for the modal action button,
- no visible `Toast` or success message,
- no explicit error toast on failure,
- and potentially no immediate visual acknowledgment when the modal remained open.

## Fix applied

I verified and applied the following enhancements in `SportsWorkspaceScreen.tsx` and `Toast.tsx`:

- Added `isSaving` state around `saveSport()`.
- Disabled the primary save button while saving and changed its label to `Saving...`.
- Added a toast queue with success and error variants.
- Added explicit `pushToast()` success/error notifications.
- Kept `closeModal()` on successful creation.
- Kept `loadData()` after creation for automatic list refresh.
- Set the newly created sport as `selectedSport`.
- Added a close button on toasts and accessible `role` / `aria-live` handling.
- Added entry/exit toast animations.

## Root cause

The root cause was insufficient user-facing state for the sport creation flow. The handler may have executed, but without a loading indicator, success toast/message, or explicit modal close, the operator saw no clear response.

## Current visual feedback on successful sport creation

If sport creation succeeds, the operator now receives:

1. The sport modal action button shows `Saving...` while the request is in progress.
2. A success toast appears with the message `Sport created.`
3. The create modal closes automatically.
4. The sports list is refreshed via `loadData()`.
5. The newly created sport becomes selected in the workspace.

## Verification summary

- Save button click handler: verified in `SportsWorkspaceScreen.tsx`.
- Form validation: verified before API call.
- API request execution: verified via `apiClient.createSport()`.
- HTTP response handling: successful backend `201` response is mapped into the UI flow.
- Success notification: implemented via toast and `status` updates.
- Error notification: implemented via toast and `status` on exceptions.
- Modal close behavior: confirmed `closeModal()` occurs on success.
- Sports list refresh: confirmed via `await loadData()` after creation.
- Database persistence: confirmed through backend SQL insert in `sports-repository.ts`.

## Files changed or relevant to the fix

- `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`
- `apps/desktop/src/renderer/components/Toast.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/backend/src/routes/sports.ts`
- `apps/backend/src/repositories/sports-repository.ts`
- `apps/backend/src/db/connection.ts`

## Conclusion

The sport creation workflow is now explicitly visible to the operator, with loading state, success and error toasts, modal closure on success, and automatic list refresh. The backend route and SQLite persistence are functioning through the Express route and repository insert behavior.
