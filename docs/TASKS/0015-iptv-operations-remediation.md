# 0015 — IPTV Operations Remediation (P0 + P1)

Date: 2026-05-30
Author: Implementation (assistant)

## Summary

This task implements the P0 and P1 items from the IPTV remediation plan. Changes are limited to backend and desktop UI, preserve existing SQLite data, and do not change streaming/proxying behavior.

## Changes made

Backend
- Added search and category filtering to `GET /iptv/channels` (`providerId`, `q`, `category`).
- Added operator endpoint `POST /iptv/providers/:providerId/status` to set provider lifecycle status (`active|inactive|failed|pending|invalid`).
- Allowed `inactive` provider lifecycle state across backend code.

Desktop (Electron renderer)
- Added channel search box and category filter in `IptvManagementScreen`.
- Provider selector now shows provider status in its labels.
- Provider health panel includes `Activate` / `Deactivate` toggle that calls new status endpoint.
- Client-side channel filtering honors provider selection, category filter, and search term.
- API client extended with `listChannels` q/category params, `listCategories`, and `setProviderStatus`.

Shared types
- Added `inactive` to `ProviderLifecycleStatus` in `packages/shared/src/streams.ts` for compatibility.

Docs
- Created this task file and previously added the stream delivery invariant (TASK 0014).

## Migration notes

- No database schema changes were required; all provider `status` values are stored in a free-form `TEXT` column.
- The runtime already maps legacy `inactive` values to `failed` in `migrateExistingOperationalState`. Existing data will be preserved.
- Adding `inactive` as a recognized status will not modify existing rows unless operators explicitly set the status.

## Validation checklist

- Typecheck: update local build to ensure `packages/shared` is recompiled and referenced types updated.
- Build: run `npm run build` in root and `apps/desktop` to ensure TypeScript compiles.
- Packaging: run `npm run electron:build` in `apps/desktop` CI to verify packaged app launches and renderer loads.
- Provider CRUD: create/update/delete provider flows unchanged; test toggling provider `active`/`inactive`.
- Category filtering: use the category dropdown to filter channels.
- Search: search by channel name, `externalRef`, or URL to filter channel list.
- Assignment protection: server-side `assignChannelToMatch` already enforces provider to be `active`; inactive providers will be rejected by assignment endpoint.

## Rollout

1. Merge changes to `main` and run CI typecheck/build.
2. Publish a test packaging build and verify Electron installer on Windows (as in previous packaging task).
3. Notify operators about new `Activate/Deactivate` toggle and show updated operator guide screenshots.

## Notes

- This change intentionally does not add any proxying, relay, or transcoding capabilities.
- For large channel datasets, consider adding server-side pagination and server-side search acceleration later (P2/P3 items).

