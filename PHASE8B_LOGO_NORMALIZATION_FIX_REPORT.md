# PHASE8B_LOGO_NORMALIZATION_FIX_REPORT

## Issue
Mobile logo rendering failed because the backend mobile feed forwarded upload URLs containing `localhost` or `127.0.0.1` hostnames unchanged.

These values are not reachable from mobile devices or emulator environments where the backend host is accessed via a different address such as `10.0.2.2:4100`.

## Fix implemented
Updated `apps/backend/src/routes/mobile.ts` so `normalizeUploadsUrl()` now rewrites upload URLs in all supported forms:

- `/uploads/...`
- `http://localhost:4100/uploads/...`
- `http://127.0.0.1:4100/uploads/...`

The rewrite now uses the actual request host from `request.get("host")`, preserving the current protocol.

## Before values
Example logo values stored in the published live match feed before normalization:

- `http://localhost:4100/uploads/1780309911702-whd3vg.png`
- `http://localhost:4100/uploads/1780310011135-lzcjyl.png`
- `http://localhost:4100/uploads/1780309056132-id51ph.png`
- `http://localhost:4100/uploads/1780256925486-v1iypx.png`
- `http://localhost:4100/uploads/1780309038197-1gn9d4.png`

## After values
When the mobile client requests `/mobile/matches/live` through a host such as `10.0.2.2:4100`, the same URLs will now normalize to:

- `http://10.0.2.2:4100/uploads/1780309911702-whd3vg.png`
- `http://10.0.2.2:4100/uploads/1780310011135-lzcjyl.png`
- `http://10.0.2.2:4100/uploads/1780309056132-id51ph.png`
- `http://10.0.2.2:4100/uploads/1780256925486-v1iypx.png`
- `http://10.0.2.2:4100/uploads/1780309038197-1gn9d4.png`

## Feed JSON examples

### Before normalization
```json
{
  "data": [
    {
      "homeTeamLogoUrl": "http://localhost:4100/uploads/1780309911702-whd3vg.png",
      "awayTeamLogoUrl": "http://localhost:4100/uploads/1780310011135-lzcjyl.png",
      "competitionLogoUrl": "http://localhost:4100/uploads/1780309056132-id51ph.png",
      "sportLogoUrl": "http://localhost:4100/uploads/1780256925486-v1iypx.png",
      "countryLogoUrl": "http://localhost:4100/uploads/1780309038197-1gn9d4.png"
    }
  ]
}
```

### After normalization
```json
{
  "data": [
    {
      "homeTeamLogoUrl": "http://10.0.2.2:4100/uploads/1780309911702-whd3vg.png",
      "awayTeamLogoUrl": "http://10.0.2.2:4100/uploads/1780310011135-lzcjyl.png",
      "competitionLogoUrl": "http://10.0.2.2:4100/uploads/1780309056132-id51ph.png",
      "sportLogoUrl": "http://10.0.2.2:4100/uploads/1780256925486-v1iypx.png",
      "countryLogoUrl": "http://10.0.2.2:4100/uploads/1780309038197-1gn9d4.png"
    }
  ]
}
```

## Mobile verification results
- `apps/mobile/lib/main.dart` already maps the JSON fields correctly into `LiveMatch`.
- The failure was not in Flutter UI rendering but in backend URL normalization.
- With the fix, mobile clients on emulator/device will receive upload URLs using the actual backend request host instead of `localhost`.

## Notes
- `apps/backend/src/routes/mobile.ts` now logs normalization transformations via `console.debug` when a URL is rewritten.
- `packages/shared/src/operations.ts` was updated so `PublishedLiveMatch` includes optional `sportLogoUrl` and `countryLogoUrl` fields used by the mobile feed.
- This change only affects mobile feed normalization; Flutter UI remains unchanged.
