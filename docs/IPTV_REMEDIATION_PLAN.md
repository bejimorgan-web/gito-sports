# IPTV Remediation Plan

Date: 2026-05-30
Author: Automated plan (assistant)

Purpose

Convert the findings in `docs/IPTV_OPERATIONS_AUDIT.md` into a prioritized implementation plan. Items are categorized P0 (broken), P1 (operator-critical), P2 (UX improvements), P3 (future enhancements).

Priority ordering follows the principle: fix correctness/safety first (P0/P1), then UX (P2), then enhancements (P3).

---

Summary of approach

- Source documents reviewed: `docs/IPTV_OPERATIONS_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/INVARIANTS.md`, `docs/OPERATOR_GUIDE.md`, `docs/WORKFLOWS.md`, `docs/STATE_MANAGEMENT.md`, `docs/TASKS/0014-stream-delivery-invariant.md`.
- Deliverable: this prioritized remediation plan (no code changes). Each item includes: Problem, Impact, Root cause, Recommended fix, Estimated scope, Dependencies.

---

Legend

- Problem: what fails or is missing.
- Impact: operator/customer impact.
- Root cause: technical or process reason.
- Recommended fix: high-level implementation approach.
- Estimated scope: tiny/small/medium/large (approx engineering effort).
- Dependencies: other tasks, infra, or policy.

---

Plan (ordered)

P0 — Broken / High-Risk

1) Blank packaged Electron application (packaging drift)
- Problem: Installer may produce a blank or non-starting app when build outputs are not in expected `dist/electron` paths or Electron version is not pinned.
- Impact: Operators cannot use desktop app; blocks all IPTV operations in packaged releases.
- Root cause: packaging build steps (Vite/TS build) and `electron-builder` entry path expectations diverged; electron version not pinned in packaging context.
- Recommended fix: Ensure deterministic build pipeline: (a) pin `electron` devDependency to supported version; (b) make `apps/desktop` build produce `dist/electron/main.js` and `dist/electron/preload.js` (or copy step); (c) add CI packaging job to run `npm run electron:build` and smoke-launch the app headlessly or on test runner; (d) add package-time validation of `VITE_GITO_API_BASE_URL` (fail build if unset for prod artifacts).
- Estimated scope: small (scripts, package.json, CI job). Packaging alignment work already partially completed; verify CI and docs.
- Dependencies: build infra/CI, `electron` version pin, `apps/desktop` build scripts.
- Classification: P0 (deliverable-impacting historically; must remain validated in CI).

P1 — Operator-critical (must implement soon)

2) Provider active/inactive toggle (manual activation/deactivation)
- Problem: No explicit operator control to mark a provider `active` or `inactive`; only automatic activation after tests or soft-delete exists.
- Impact: Operators cannot temporarily remove a provider from selection without deleting it; assignments may fail or operators lose control during failures.
- Root cause: design relied on automatic lifecycle transitions; missing API and UI control.
- Recommended fix: Add authenticated API `POST /iptv/providers/:id/status` with allowed values (`active`,`inactive`,`failed`,`pending`) protected by operator role; add UI toggle and confirm dialog in `IptvManagementScreen`; ensure toggling updates provider `status` without deleting row and triggers a health re-evaluation if needed.
- Estimated scope: medium (backend route + validation + DB migration if schema needs status values + desktop UI change + tests).
- Dependencies: auth/roles, provider repository; update docs and operator guides.
- Classification: P1

3) Provider credential validation feedback (consistent error payloads and UI mapping)
- Problem: Validation errors are returned but payloads are inconsistent and UI sometimes shows raw messages or codes.
- Impact: Operators get confusing messages; debugging failing provider tests is harder and slower.
- Root cause: API error shaping is ad-hoc across routes; front-end mapping incomplete.
- Recommended fix: Standardize API error payloads to `{ error: string, message?: string, details?: any }`; map common errors (e.g., invalid URL, auth failure, network) to friendly messages in UI; add unit tests for endpoint error cases; add operator troubleshooting hints in `OPERATOR_GUIDE.md`.
- Estimated scope: small (API error helpers + UI mapping + docs updates).
- Dependencies: API middleware, front-end error handling components.
- Classification: P1

4) Persistence verification after edits/deletes (durability & soft-delete semantics)
- Problem: Uncertainty whether edits/deletes persist correctly across backend restarts and desktop operations; soft-delete used but no explicit operator UI to restore or archive.
- Impact: Risk of data loss or operator confusion if deleted providers vanish without a recovery path.
- Root cause: UI uses soft-delete but no restore or audit action; operator docs sparse on recovery.
- Recommended fix: Add explicit `restore` endpoint `POST /iptv/providers/:id/restore` and UI action; add operator-facing audit log view showing delete/restore events; add tests verifying soft-delete semantics survive restarts and are visible in `data/gito.sqlite`.
- Estimated scope: small (backend route + UI action + docs + tests).
- Dependencies: operational logs, `operational-log-repository`.
- Classification: P1

P2 — UX Improvements (medium priority)

5) Channel search in UI
- Problem: No text search in `IptvManagementScreen` to find channels by name/externalRef/url.
- Impact: Operators must manually scan long lists, slowing assignment and verification.
- Root cause: UI only supports provider filtering; no search field or server-side `q` param.
- Recommended fix: Add a client-side search box that filters displayed channels; optionally extend `GET /iptv/channels?q=` for server-side search when result sets grow. Include debounce and highlight matches.
- Estimated scope: small (UI change) or medium (server-side search + index) if later required.
- Dependencies: `listChannels` API extension if needed, dataset size considerations.
- Classification: P2

6) Channel category navigation and filtering
- Problem: Categories are stored (`group_name`) and backend exposes `GET /iptv/categories` but the UI lacks a category browser or filter.
- Impact: Operators cannot browse by category; finding groups of channels is tedious.
- Root cause: Missing UI controls to consume categories endpoint.
- Recommended fix: Add a categories panel listing `GET /iptv/categories` results and filter channels by selected category; add counts and collapsible groups in channel list.
- Estimated scope: small (UI only); medium if client needs server-side pagination.
- Dependencies: existing `GET /iptv/categories` endpoint.
- Classification: P2

7) Provider filtering improvements (improve selector UX)
- Problem: Provider selector exists but can be improved (searchable dropdown, status badges).
- Impact: Operators with many providers have slower workflows.
- Root cause: Basic selector implementation.
- Recommended fix: Replace provider selector with searchable dropdown, add status and health badges, and allow multi-select for bulk actions.
- Estimated scope: small.
- Dependencies: UI component library and `listProviders` endpoint.
- Classification: P2

P3 — Future enhancements / optional features

8) Primary/backup provider selection and routing
- Problem: No model to mark primary/backup providers or to route assignments automatically between them.
- Impact: No automated failover or operator-preferred provider selection; manual failover required.
- Root cause: MVP avoided failover complexity; DB and UI lack preference fields.
- Recommended fix: Add optional `priority` or `role` metadata to providers (e.g., `primary`, `backup`) with UI controls; extend `assignChannelToMatch` or publishing flow with a small routing layer that picks primary first then backup when health fails. Include audit and dry-run mode.
- Estimated scope: large (DB migration, repo updates, API, UI, tests, policy for failover rules).
- Dependencies: business policy, monitoring, provider health metrics.
- Classification: P3

9) Proxy/relay/CDN support (enterprise)
- Problem: The system currently forbids proxying/retransmission by invariant.
- Impact: Enterprise customers that require centralized proxying or DRM cannot use current architecture without redesign.
- Root cause: deliberate architectural decision to avoid media transit responsibilities in MVP.
- Recommended fix: Treat as a separate architectural project: design proxying service (separate infra), add auth/token exchange, logging, scaling (CDN), and legal/compliance checklist. Do not implement as a quick change in core backend.
- Estimated scope: very large (new service + infra + ops + legal).
- Dependencies: infra budget, design sign-off, security review, new service repo.
- Classification: P3

---

Cross-cutting items and tests

- Add standard API error format and ensure front-end mapping (see P1.3).
- Add tests for lifecycle guards (`assignChannelToMatch`, `publishStream`, health-based exclusion) — small test suite expansion.
- Add end-to-end packaging/installer CI job (see P0.1) that runs packaging, then launches packaged app in headless mode or smoke-tests `VITE_GITO_API_BASE_URL` connectivity.

---

Estimated implementation order (release-driven)

1. P0.1 — Packaging CI + build fixes (ensure installers are deterministic). (Blocker for any packaged release.)
2. P1.2 — Provider active/inactive toggle + role-based protection. (Operator control.)
3. P1.3 — Standardize validation errors + UI mapping. (Operator clarity.)
4. P1.4 — Persistence restore/restore endpoint and audit log exposure. (Data safety.)
5. P2.5 — Channel search UI (quick win). (Improve operator speed.)
6. P2.6 — Category panel and filter (improve discovery). (UX improvement.)
7. P2.7 — Provider selector improvements (small UX polish).
8. P3.8 — Primary/backup provider model (if requested after operator feedback). (Enhancement.)
9. P3.9 — Proxy/CDN design (enterprise project). (Enterprise feature.)

---

Estimated timelines (rough)

- Small tasks: 1–3 days each (single engineer).
- Medium tasks: 1–2 weeks (backend + frontend changes + tests + docs).
- Large tasks: multiple sprints (design, DB migration, infra changes).

---

Dependencies and ownership

- Backend owners: implement API routes, state transitions, tests.
- Desktop UI owners: implement UI toggles, search, category browser, mapping of error payloads.
- Release/CI owners: add packaging CI job, ensure environment variables for `VITE_GITO_API_BASE_URL` are enforced.
- Product/PM: decide on primary/backup semantics and enterprise proxy policy.

---

Next steps (suggested)

1. Review and approve this remediation plan.
2. Create scoped issues/PRs for top two items (P0 packaging CI; P1 provider manual status + UI toggle).
3. Implement P0 in CI and run packaging verification for current release.

---

Appendix: references

- docs/IPTV_OPERATIONS_AUDIT.md
- docs/ARCHITECTURE.md
- docs/INVARIANTS.md
- docs/TASKS/0014-stream-delivery-invariant.md
- apps/backend/src/repositories/operations-repository.ts
- apps/backend/src/routes/iptv.ts

