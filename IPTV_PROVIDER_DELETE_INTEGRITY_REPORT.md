# IPTV_PROVIDER_DELETE_INTEGRITY_REPORT

## Deleted provider state
- The backend uses a soft delete for IPTV providers via `providers.deleted = 1`.
- Current database state in `data/gito.sqlite` shows:
  - `SELECT COUNT(*) FROM providers` → `12`
  - `SELECT COUNT(*) FROM providers WHERE deleted = 1` → `12`
- Every provider in the active DB is currently marked deleted.
- Example deleted provider ID: `78dc0da9-7a89-44ee-aee1-38431531f0c9` (name: `API TV`).

## Query results
- `SELECT COUNT(*) FROM channels` → `2411`
- `SELECT COUNT(*) FROM channels WHERE provider_id IN (SELECT id FROM providers WHERE deleted = 1)` → `2411`
- `SELECT COUNT(*) FROM channels WHERE provider_id NOT IN (SELECT id FROM providers)` → `0`

## Channels linked to deleted providers
- Deleted-provider channels remain in the `channels` table.
- They are not orphaned at the FK level; every channel still references an existing provider ID.
- Example rows for provider `78dc0da9-7a89-44ee-aee1-38431531f0c9` include:
  - `1-2-3 TV (270p)`
  - `1Almere TV (720p)`
  - `1KZN TV (576p)`
  - `1S News (576p)`
  - `1TV (720p)`

## Backend behavior after provider deletion
- Backend route `GET /iptv/channels` uses `listChannels(opts)` from `apps/backend/src/repositories/provider-repository.ts`.
- `listChannels()` constructs SQL with `p.deleted = 0` in the JOIN condition:
  - `SELECT c.* FROM channels c JOIN providers p ON p.id = c.provider_id WHERE p.deleted = 0 ...`
- This means channels belonging to deleted providers are excluded from active backend channel results.

## Front-end refresh and preview state
- `App.tsx` refreshes state with `refreshOperations("full")`, which calls:
  - `apiClient.listProviders()`
  - `apiClient.listChannels()`
  - `apiClient.listLiveMatches()`
- After deletion, `refreshOperations("full")` resets `providers` and `channels` state from backend results.
- Critically, `refreshOperations` does not clear `selectedChannel` or `previewedChannelId`.
- App startup also restores persisted state from `window.localStorage`:
  - `selectedChannel` is restored from saved session state.
  - `previewedChannelId` is restored from saved session state.
- Therefore the preview panel can still receive a channel object even if the active backend no longer returns it.

## Preview source analysis
- The preview UI is fed by the `selectedChannel` React state in `App.tsx`.
- `StreamPreviewPanel` receives `channel={selectedChannel}` and uses `channel.url` directly.
- The preview player does not re-fetch the channel from backend state at render time.

## Conclusion
- Was provider deleted? Yes. All providers in the DB are soft-deleted (`deleted = 1`).
- Were channels deleted? No. All `2411` channel rows remain in `channels`.
- Does preview survive after app restart? Yes, it can survive because `selectedChannel` and `previewedChannelId` are restored from localStorage and are not cleared during refresh.
- What exact object is feeding the preview player?
  - The cached `Channel` object stored in React state / localStorage (`selectedChannel`), not fresh backend channel data.

## Answer summary
- Provider deletion uses soft delete only; channels are left intact.
- Deleted provider channels are excluded from active backend results because `listChannels()` filters on `providers.deleted = 0`.
- Preview survives from cached state, not from active backend channel data.
- The preview player is fed by the `selectedChannel` React state object in `App.tsx`.
