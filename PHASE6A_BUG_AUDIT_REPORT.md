PHASE 6A POST-IMPLEMENTATION BUG AUDIT

Scope
- Entities: Sports, Countries, Competitions, Clubs (Teams), National Teams
- Focus: logo rendering after save and delete-workflow reliability
- Environment: Desktop Electron renderer + backend Express + SQLite

Summary
- Reproduced and traced save, read and delete flows at code and repository level.
- Verified backend repository CRUD operations succeed when used directly against SQLite.
- Two classes of failures observed in the codebase and operator reports:
  1) Logos not displaying after save when the persisted value is a relative path ("/uploads/...").
  2) Delete actions failing silently for operators because backend returns HTTP 409 when business rules block deletion (foreign-dependency), and UI feedback can be ambiguous.

Logo Rendering Audit (Sports, Countries, Competitions, Teams)
For each entity the chain is:
- UI value source: `LogoUrlField` (uploads file via `apiClient.uploadImage` OR operator pasted URL)
- API payload: JSON body of create/update requests (field names: `logoUrl` or `flagUrl`)
- DB persistence: `sports.logo_url`, `countries.flag_url`, `competitions.logo_url`, `teams.logo_url`
- API response: repository `map*` functions include `logoUrl` when column not null
- React consumption: `apiClient.request()` returns data → components receive entity objects
- Rendering: components pass `entity.logoUrl` (or `flagUrl`) to `<img src={...}>` or `EntityAvatar` which renders `<img src={src}>`.

Failure mode and exact break point
- If the stored value is a relative path beginning with `/uploads/` the renderer treats that as a same-origin path.
  - In the desktop context (Electron renderer or Vite dev served app) same-origin requests for `/uploads/...` will be resolved against the renderer origin (file:// or vite://) instead of the backend host, yielding 404 and broken images.
  - This is the concrete breakpoint: the value persisted as `/uploads/...` (DB) ⇒ API returns `/uploads/...` (GET/list) ⇒ React receives `/uploads/...` ⇒ `<img src="/uploads/..">` resolves to wrong origin and does not load the image.
- Where relative paths exist: older rows or operator-copy/paste of the `/uploads/*` path, and any route that returns the raw DB column without converting to an absolute backend URL.

Database row example (observed / possible)
- Sports row example (SQL representation):
  {
    id: "audit-123",
    name: "Audit Sport",
    logo_url: "/uploads/audit-sport.png"
  }

API response example (what React currently may receive)
- GET /sports
  {
    "data": [
      {
        "id": "audit-123",
        "name": "Audit Sport",
        "logoUrl": "/uploads/audit-sport.png"
      }
    ]
  }

React prop example (component receives this prop)
- In component: `<EntityAvatar src={sport.logoUrl} fallback={sport.name} />`
- `sport.logoUrl === '/uploads/audit-sport.png'`
- Renderer resolves `<img src="/uploads/audit-sport.png">` against renderer origin → 404

Delete Workflow Audit (Sports, Countries, Competitions, Teams)
Trace (UI → Backend): UI Button → Confirmation Dialog → `apiClient.deleteX(id)` → fetch DELETE → backend route `DELETE /<entity>/:id` → repository `deleteX(id)` uses counts or FK constraints → SQL DELETE or returns `false` when in-use.

Observed behavior & failure points
- Repository-level intentional protection: deletion returns `false` when dependent rows exist (e.g., sport with competitions, country with teams/competitions, team used in matches). This is expected business logic.
- API route maps `false` to `409` + JSON `{ error: '<code>' }`.
- Frontend `request()` helper reads response JSON then throws Error using `errorBody.message ?? errorBody.error` so UI receives the short error token (e.g., `sport_in_use_or_not_found`).
- UI handlers catch the thrown Error and set `status` or push a toast, but operator reports show the deletion 'did not work' because:
  - The error message is terse and technical (`sport_in_use_or_not_found`) and not clearly shown in some modals/screens.
  - Operators may expect the Delete modal to close and the list to refresh on success; on failure the modal remains and the operator may not notice the status change.

Per-entity answers (based on code examination and repository tests):
- Sports: click handler executes; API request fires; backend route exists; repository delete returns `false` when competitions exist; UI should refresh on success but will only do so after `loadData()`; failure point is repository business rule when dependents exist and ambiguous operator error presentation.
- Countries: same pattern; delete prevented when competitions or teams reference the country.
- Competitions: delete prevented when matches exist; otherwise delete passes.
- Teams (Clubs & National Teams): delete prevented when used by matches; otherwise delete passes.

Validation: test record CRUD
- Repository-level tests (ad-hoc scripts) confirm create/read/update/delete operations work when no dependent constraints exist. When dependent rows exist, delete returns false and API responds 409.

Conclusions - Primary Root Causes
1) Logo rendering: relative `/uploads/...` paths are valid in DB but are not guaranteed to load in the renderer origin — API must return absolute URLs (or frontend must convert them) so renderer requests the backend-hosted static file.
2) Delete reliability: backend intentionally blocks deletion when referential dependencies exist; UI feedback is too terse and can be missed by operators. Not a bug in enforcement but in operator UX and error messaging.

Files & locations inspected
- Frontend: `apps/desktop/src/renderer/components/LogoUrlField.tsx`, `apps/desktop/src/renderer/features/**/*` (SportsWorkspaceScreen, CountriesManagementScreen, CompetitionCatalogScreen, TeamsManagementScreen)
- API client: `apps/desktop/src/renderer/services/api-client.ts` (uploadImage returns absolute URL)
- Backend routes: `apps/backend/src/routes/*` (sports.ts, countries.ts, competitions.ts, teams.ts, uploads.ts)
- Repositories: `apps/backend/src/repositories/*-repository.ts`
- DB schema & migration: `apps/backend/src/db/schema/*` and `apps/backend/src/db/connection.ts`

Next recommended actions (short)
- Normalize/convert relative `/uploads/*` DB values into absolute URLs when returning API responses.
- Add friendly `message` text to API error responses for deletion failures and ensure frontend shows friendly toasts/modal messages.

End of audit.
