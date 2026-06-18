# IPTV Operations Audit

Date: 2026-05-30
Author: Automated audit (assistant)

## Scope

This audit inspects the IPTV subsystem from an operator workflow perspective without modifying code. It reviews documentation and implementation across `apps/backend` and `apps/desktop` to determine completeness, gaps, and recommended remediation steps.

Files reviewed (selection):
- README.md
- docs/ARCHITECTURE.md
- docs/WORKFLOWS.md
- docs/STATE_MANAGEMENT.md
- docs/OPERATOR_GUIDE.md
- docs/INVARIANTS.md
- docs/TASKS/0013-electron-packaging-alignment.md
- docs/ARCHITECTURE_AUDIT.md
- apps/backend/src/repositories/provider-repository.ts
- apps/backend/src/routes/iptv.ts
- apps/backend/src/services/m3u-parser.ts
- apps/backend/src/services/xtream-codes.ts
- apps/backend/src/repositories/operations-repository.ts
- apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx
- apps/desktop/src/renderer/services/api-client.ts

---

## Executive summary

- The system implements an operator-driven IPTV ingestion and stream approval workflow where the backend (Node + SQLite) is the authoritative owner of providers, channels, matches and streams.
- Core ingestion and extraction features exist: M3U parsing, Xtream Codes sync, channel upsert, provider health scoring, and provider testing.
- Many operator interactions are implemented in the desktop UI, including creating/updating/deleting providers, testing connections, ingesting playlists, and selecting channels for preview/assignment.
- Key gaps are primarily UX and administrative tooling (manual activation toggles, primary/backup provider selection, channel search and category-based browsing), plus some packaging/deployment documentation clarity previously causing blank installer launches (now addressed by packaging alignment work).

---

## Checklist & findings

1) Provider validation workflow — Can credentials be validated?
- Implemented: Yes.
  - `POST /iptv/providers/test` supports both on-the-fly validation and Xtream credential tests (`testXtreamConnection`).
  - `POST /iptv/providers/:providerId/test` runs a stored-provider test and will fetch/sync channels for Xtream/M3U.

2) Are validation errors surfaced to operator?
- Partially: Backend returns explicit error JSON with `message`/`error` codes (e.g. `playlist_contains_invalid_stream_url`, `xtream_contains_invalid_stream_url`).
- The desktop UI consumes test responses and displays `status` messages (via `setStatus`) for immediate tests and shows provider `status` and `availabilityStatus` in the Provider Health panel.
- Recommendation: Ensure all API error payloads include a concise `message` key (consistent) to guarantee consistent UI messaging.

3) Are channel counts reported?
- Yes: the UI displays `channels.length` and the backend returns `channelsCreated` after ingestion/sync endpoints.

4) Are connectivity failures reported?
- Yes: provider `failedChannelLoads`, `availability_status`, and `health_score` are tracked and exposed in the UI.
- Stream health reporting exists (`POST /streams/:streamId/health`) and provider health is updated from stream health events.

5) Provider lifecycle management: Create
- Implemented: `POST /iptv/providers` creates providers starting in `pending` status.

6) Edit
- Implemented: `PUT /iptv/providers/:providerId` updates provider and resets status to `pending` (requires retest).

7) Delete
- Implemented: `DELETE /iptv/providers/:providerId` performs a soft-delete (`deleted = 1`).

8) Activate
- Partially implemented: providers move to `active` automatically after successful test/sync. There is no explicit `activate` API for manual toggling.

9) Deactivate
- Partially implemented: providers may be marked `failed` by automatic tests; there is no explicit `deactivate` API or `inactive` status other than soft-delete.

10) Channel organization — M3U `group-title` support
- Implemented: `parseM3uPlaylist` and `syncProviderChannels` map `group-title` to `group_name` stored in `channels.group_name`.

11) Xtream category support
- Implemented: `fetchXtreamChannels` retrieves categories and maps `category_id`/`category_name` to `group_name`.

12) UI category browsing
- Missing: the UI shows each channel's `groupName` but does not expose a category browser or category list for filtering.

13) Category filtering
- Missing: backend exposes `GET /iptv/categories` but the desktop UI does not include a category filter control in the channel list.

14) Provider activation model — mark providers active/inactive
- Partially implemented: providers are marked `active` after successful tests and `failed` on failure. No manual activation/deactivation endpoint exists.

15) Ability to limit stream assignment to active providers
- Implemented: `assignChannelToMatch` enforces that a channel's provider must be `p.status = 'active'` and `c.status = 'active'` — server-side guard exists and will reject assignments otherwise.

16) Ability to choose primary/backup providers
- Missing: no model or UI for primary/backup provider selection. No DB columns or logic for preference/priority selection are present.

17) Channel management — Search
- Missing in UI: no search field in `IptvManagementScreen` channel list. Backend `listChannels` supports optional `providerId` query only.

18) Category filter
- Missing in UI (see items 12 and 13).

19) Provider filter
- Implemented in the UI: provider selector filters channels by provider via `listChannels(providerId)`.

20) Electron production build — Investigate blank installed application
- Resolved: packaging path drift initially caused electron-builder to fail or produce an app without the expected entry. The repository was updated to pin Electron and align build outputs; `npm run electron:build` now produces installer artifacts. See `docs/TASKS/0013-electron-packaging-alignment.md` for details.

21) Verify renderer path
- Verified: `apps/desktop/package.json` `main` points to `dist/electron/main.js` and `apps/desktop/scripts/align-electron-output.js` ensures compiled `main.js` and `preload.js` are placed under `dist/electron/` prior to packaging.

22) Verify production API configuration
- Partial: the packaged renderer uses `import.meta.env.VITE_GITO_API_BASE_URL` baked at build time. If not explicitly provided during build, it defaults to `http://localhost:4100`.
- Operator-installers must be documented to configure backend URL either by building with `VITE_GITO_API_BASE_URL` or by providing a runtime configuration overlay (not currently implemented).

23) Verify packaged build launches correctly
- Verified in current workspace: `electron-builder` produced `GiTO Live Sports Setup 0.1.0.exe` and `GiTO Live Sports-0.1.0-win.zip` after packaging alignment work. The packaged app launches and uses the configured API base URL baked at build time.

---

## Missing features (explicit)

- Manual provider activation/deactivation endpoint and UI control (toggle).
- Primary/backup provider model (DB fields, UI selection, and enforcement in assignment/publish flows).
- Channel search in the UI (text search by channel name, externalRef, or url).
- Category browser and filtering UI (desktop) even though `GET /iptv/categories` exists server-side.
- Runtime desktop configuration for backend API URL (a lightweight config file or installer-time option to set backend URL would improve operator setup).

## Partially implemented features

- Validation feedback: present but could be made more consistent (standardize error payloads, map codes to user-friendly messages).
- Provider activation: automatic activation on successful tests exists; manual control is missing.
- Deactivation: soft-delete exists; explicit `deactivate` (preserve but mark inactive) does not.

## Broken features or risks

- Packaging drift previously caused failed or blank installers (addressed). Ensure CI reproduces packaging and signs installers if required.
- If the packaged desktop is built with default API base URL (localhost) but the backend is remote, operators may see an app that appears non-functional. This is a deployment risk (not a code bug).

## Recommended fixes (with priorities)

Priority 1 — Operational correctness / safety
- Add server-side endpoint to manually set provider `status` (e.g. `POST /iptv/providers/:providerId/status` with `active|failed|invalid`) and require protected/admin access. This allows operators to mark providers active/inactive without re-running tests.
- Add server-side and UI support for `deactivate` that does not delete provider (preserve config/history).
- Ensure packaged desktop installer includes a simple runtime configuration step to set the backend URL, or provide a small settings file the installer writes.

Priority 2 — Operator UX improvements
- Add a channel search box to `IptvManagementScreen` that filters `channels` client-side by name/externalRef or server-side via a `q` query parameter if needed.
- Add a category panel and a category filter control; reuse existing `GET /iptv/categories` endpoint.
- Expose a simple provider preference model: allow marking a provider as `primary` for a given region/sport, and allow selecting a backup provider when publishing.

Priority 3 — Hardening and polish
- Standardize API error responses to always include `{ error: string, message?: string }` and ensure the front-end maps these to operator-friendly text.
- Add unit/integration tests for `assignChannelToMatch` guards to prevent regression.
- Add end-to-end packaging CI job that runs `npm run electron:build` and validates that the produced installer launches and can be configured to point to a test backend.

---

## Quick remediation plan (small iterations)

1. Add manual provider status API and UI toggle (backend + desktop changes). Validate that `assignChannelToMatch` continues to enforce active provider requirement.
2. Add channel search and category filter in `IptvManagementScreen` using existing `listChannels` and `listChannelCategories` endpoints (UI only).
3. Add installer-time or runtime setting for `VITE_GITO_API_BASE_URL` (packaging docs + small runtime config reader in the Electron main process) so packaged installers won't default to `localhost` unexpectedly.
4. Add primary/backup provider metadata if operators need automated failover selection; otherwise treat it as lower priority.

---

## Closing notes

- The backend enforces the most important invariants (active provider requirement, stream URL validation, lifecycle guards) so operator actions are constrained correctly.
- Most work required is UI/administration polish and deployment configuration; the core ingestion and publication workflows are present and correctly guarded.

If you want, I can next:
- Produce a prioritized implementation plan and open PR patches for the top-priority items.
- Add UI mockups and API changes for the provider status toggle and channel search.

