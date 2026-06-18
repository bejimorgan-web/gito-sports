PROVIDER DELETION AUDIT

Subject provider: 9fe16532-ac82-4650-9ae7-2dfab9f575f9

Actions performed
- Queried local SQLite DB `data/gito.sqlite` for the provider row and channel references.
- Inspected frontend codepaths that trigger `POST /iptv/providers/:providerId/test`.

1) Does the provider exist in SQLite?
- Answer: NO
- Evidence (JSON output from DB query):

```
{
  "provider_schema": [
    { "cid": 0, "name": "id", "type": "TEXT" },
    { "cid": 1, "name": "name", "type": "TEXT" },
    { "cid": 2, "name": "base_url", "type": "TEXT" },
    { "cid": 3, "name": "type", "type": "TEXT" },
    { "cid": 4, "name": "auth_type", "type": "TEXT" },
    { "cid": 5, "name": "credential_username", "type": "TEXT" },
    { "cid": 6, "name": "credential_password", "type": "TEXT" },
    { "cid": 7, "name": "availability_status", "type": "TEXT" },
    { "cid": 8, "name": "last_successful_stream_load_at", "type": "TEXT" },
    { "cid": 9, "name": "failed_channel_loads", "type": "INTEGER" },
    { "cid": 10, "name": "health_score", "type": "INTEGER" },
    { "cid": 11, "name": "status", "type": "TEXT" },
    { "cid": 12, "name": "created_at", "type": "TEXT" },
    { "cid": 13, "name": "updated_at", "type": "TEXT" }
  ],
  "provider_row": null,
  "channels_count": 0,
  "visible_in_get_providers": false,
  "has_deleted_column": false
}
```

- Notes: `provider_row: null` means the providers table contains no row with the specified id.

2) If it exists: id
- Not applicable (provider not found).

3) name
- Not applicable.

4) status
- Not applicable.

5) deleted flag
- The current DB schema in this database does NOT include a `deleted` column on `providers` (see `has_deleted_column: false`). Therefore there is no soft-delete flag present in this DB instance.

6) created_at
- Not applicable.

7) updated_at
- Not applicable.

8) How many channels reference this provider?
- 0 (SQL evidence: `channels_count": 0`)
- SQL executed: `SELECT COUNT(*) AS cnt FROM channels WHERE provider_id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9'` returned 0.

9) Does GET /iptv/providers return this provider?
- No. Evidence: the provider does not exist in the `providers` table; the backend `listProviders()` reads providers from the DB and (in current code) filters out rows where `deleted = 1` — but this DB does not have a `deleted` column and the provider row is absent, so the GET response will not include this id.
- Relevant backend code: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts) and [apps/backend/src/repositories/provider-repository.ts](apps/backend/src/repositories/provider-repository.ts) (see `listProviders()` implementation).

10) Does the desktop UI state contain this provider after page reload?
- Evidence and reasoning:
  - On app startup the desktop UI calls `apiClient.listProviders()` and replaces the provider list from the backend (see `apps/desktop/src/renderer/App.tsx` — `refreshOperations()` called on init). If the backend does not return the provider (it doesn't), the UI will not contain it after a reload.
  - I did not find any persisted client-side storage in the repository that would retain this provider across reloads (the UI uses `window.localStorage` at runtime; that data is not present in the repo). Therefore there is no file evidence of a cached provider in source. Conclusion: after a page reload the desktop UI will NOT contain this provider (unless a local running instance had it in memory / session storage, but that's not persisted here).
  - Relevant code: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) — `refreshOperations()` and localStorage usage; [apps/desktop/src/renderer/services/api-client.ts](apps/desktop/src/renderer/services/api-client.ts).

11) Trace the exact source of POST /iptv/providers/9fe16532-ac82-4650-9ae7-2dfab9f575f9/test
- Component: `IptvManagementScreen` — [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx)
- Event handler (component): `handleTestProvider()` in `IptvManagementScreen` (this is invoked by the "Test Connection" button in the Provider Setup UI).
- User action: clicking the button labeled "Test Connection" (rendered in that component).
- API call chain:
  - `handleTestProvider()` calls the `onTestProviderById` prop when a `selectedProviderId` exists; the prop is provided by `App`.
  - `App` defines `testProviderById` (component callback) which calls `apiClient.testProviderById(providerId)` and then `refreshOperations()`.
  - `apiClient.testProviderById` sends POST to `/iptv/providers/${providerId}/test`.
- Code references (call chain):
  - UI button: [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx) (button and `handleTestProvider`)
  - Prop wiring and testProviderById implementation: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) (function `testProviderById` and actions mapping)
  - API implementation: [apps/desktop/src/renderer/services/api-client.ts](apps/desktop/src/renderer/services/api-client.ts) (`testProviderById(providerId)` → `request('/iptv/providers/${providerId}/test', { method: 'POST' })`)
  - Backend route handling the request: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts) — `iptvRouter.post('/providers/:providerId/test', ...)` which performs validation, parsing, channel sync, and returns `channelsCreated`, `channelsParsed`, `channelsRejected` when applicable.

Determinations (evidence-only):
- Physically deleted? YES — the provider row is absent from the `providers` table in `data/gito.sqlite` (evidence: `provider_row: null`). This is consistent with the provider having been removed from the DB rather than marked with a `deleted` flag.
- Soft deleted? NO — there is no `deleted` column in the `providers` table of this DB (`has_deleted_column: false`), so soft-deletes via `deleted=1` are not applicable in this DB snapshot.
- Hidden by filter? NO — GET `/iptv/providers` returns rows from the DB; because the provider row is absent it cannot be hidden by a `deleted` filter.
- Cached in frontend state? NO EVIDENCE — the repository contains no persisted frontend session that would restore this provider on reload; the app refreshes providers from the backend on startup, so an absent backend row means the UI will not show it after reload. (If a running desktop instance had an in-memory state prior to reload, that is runtime-only and not captured here.)

Raw DB commands executed (for reproducibility):
- PRAGMA table_info(providers);
- SELECT id,name,status,created_at,updated_at FROM providers WHERE id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9';
- SELECT COUNT(*) AS cnt FROM channels WHERE provider_id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9';
- If `deleted` column existed: SELECT COUNT(*) FROM providers WHERE id = '...' AND deleted = 0

Files referenced (evidence):
- Backend routes and logic: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts)
- Provider repository: [apps/backend/src/repositories/provider-repository.ts](apps/backend/src/repositories/provider-repository.ts)
- Desktop client API client: [apps/desktop/src/renderer/services/api-client.ts](apps/desktop/src/renderer/services/api-client.ts)
- Desktop UI: [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx)
- Desktop app wiring: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx)

---

If you want, I can:
- Run the exact HTTP call (`curl`) against a running backend and paste the response for an existing provider id (if you want live evidence), or
- Search Git history to find when this provider row was removed (requires examining commits/backups), or
- Export additional DB state (nearby rows) for context.

Evidence-only audit complete and saved to this file.