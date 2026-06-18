# Logo Rendering Audit

## Summary

This audit covers the logo upload and avatar rendering path for desktop and mobile, including:
- backend upload URL handling
- desktop logo preview and persisted avatar rendering
- mobile live feed logo support
- root cause and fix details

## Root Cause

1. `apps/desktop/src/renderer/services/api-client.ts`
   - `uploadImage()` always prefixed returned upload URLs with `API_BASE_URL`.
   - Backend upload endpoint already returned an absolute URL, so the client could duplicate or corrupt the final image URL.

2. `apps/desktop/src/renderer/components/LogoUrlField.tsx`
   - file selection did not generate an immediate in-place preview inside the avatar.
   - users were told the logo would appear after saving, which delayed feedback and hid the image until later.

3. Backend mobile feed endpoint `apps/backend/src/routes/mobile.ts`
   - `listPublishedLiveMatches()` was returning optional team/competition logo metadata but not normalizing relative `/uploads/...` paths.
   - mobile UI expected absolute image URLs for `NetworkImage`.

4. Backend asset normalization helper `apps/backend/src/routes/asset-url.ts`
   - object spread of optional asset fields caused TypeScript `exactOptionalPropertyTypes` mismatches.

## Fixes Implemented

### Backend

- `apps/backend/src/routes/uploads.ts`
  - upload endpoint returns a fully qualified absolute image URL.

- `apps/backend/src/routes/asset-url.ts`
  - added explicit typed normalized objects for `Sport`, `Country`, `Competition`, and `Team`.
  - prevents TypeScript optional-property mismatches while preserving `/uploads/...` normalization.

- `apps/backend/src/routes/mobile.ts`
  - normalizes `homeTeamLogoUrl`, `awayTeamLogoUrl`, and `competitionLogoUrl` from `/uploads/...` to absolute backend URLs.

- `apps/backend/src/repositories/operations-repository.ts`
  - extended `listPublishedLiveMatches()` to include team and competition logo metadata.
  - joins teams and competitions in the query and maps new optional fields onto each published match.

### Desktop

- `apps/desktop/src/renderer/services/api-client.ts`
  - `uploadImage()` now preserves absolute URLs returned by backend and prefixes only relative upload paths.

- `apps/desktop/src/renderer/components/LogoUrlField.tsx`
  - adds an immediate file preview using `FileReader`.
  - displays the preview in the existing avatar area at the same dimensions used by initials.
  - supports previewing existing absolute URLs, relative `/uploads/...` URLs, and data URIs.

- `apps/desktop/src/renderer/styles.css`
  - introduced `.logo-url-field` and `.logo-url-preview-row` to keep the preview aligned with form controls.

### Mobile

- `apps/mobile/lib/main.dart`
  - extended `LiveMatch` model with optional `homeTeamLogoUrl`, `awayTeamLogoUrl`, and `competitionLogoUrl`.
  - updated `LiveMatch.fromJson()` to populate those fields when present.
  - updated match cards to display team and competition logos using `NetworkImage` when available.

## Validation

- `npm run typecheck --workspace @gito/backend` ✅
- `npm run typecheck --workspace @gito/desktop` ✅
- `dart analyze lib/main.dart` in `apps/mobile` ✅

## Notes

- Desktop upload preview now appears immediately inside the same 48x48 avatar area used for initials.
- Backend and mobile changes are aligned so that uploaded assets stored under `/uploads/...` are exposed as absolute URLs when returned to clients.
- The audit preserves existing list and entity normalization behavior while making the upload flow more reliable.
