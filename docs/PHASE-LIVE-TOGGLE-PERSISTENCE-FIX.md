# Live Toggle Persistence Fix

## Symptom

The Desktop Mobile App Configuration screen allowed the operator to select the `Live` checkbox and displayed `Saved`, but after the save-triggered reload the checkbox returned to unselected.

## Root Cause

`MobileFeatureService.ensureNavigationTables()` ran whenever the Live navigation flags were read or updated. After inserting missing default rows, it unconditionally executed:

```sql
UPDATE mobile_feature_flags
SET enabled = 0
WHERE feature_key = 'navigation.live';
```

The actual flow was:

```text
Desktop checkbox: true
  -> PUT /api/admin/mobile/features { featureKey: "navigation.live", enabled: true }
  -> mobile_feature_flags.enabled = 1
  -> Desktop GET /mobile/features
  -> ensureNavigationTables()
  -> mobile_feature_flags.enabled = 0
  -> GET returns live.enabled = false
  -> Desktop checkbox becomes unchecked
```

The Save response was successful, but the subsequent read path reset the persisted value before returning it.

## State Flow Before Fix

### Desktop state

[MobileFeatureControlScreen.tsx](../apps/desktop/src/renderer/features/mobile/MobileFeatureControlScreen.tsx) stores each feature in `features[].enabled` and binds the checkbox to:

```tsx
checked={feature.enabled}
onChange={(event) => updateFeature(feature.key, event.target.checked)}
```

### Save request

[api-client.ts](../apps/desktop/src/renderer/services/api-client.ts) sends one request per changed feature:

```text
PUT /api/admin/mobile/features
Authorization: Bearer [REDACTED]
{
  featureKey: "navigation.live",
  enabled: true,
  message: null
}
```

### Backend write

[admin.ts](../apps/backend/src/routes/admin.ts) validates the boolean and calls:

```text
MobileFeatureService.updateNavigationFeature("navigation.live", true, null)
```

That method writes:

```sql
UPDATE mobile_feature_flags
SET enabled = 1, updated_at = ?
WHERE feature_key = 'navigation.live'
```

### Backend read

The Desktop reloads through:

```text
GET /mobile/features
```

The route calls `MobileFeatureService.getNavigationFeatures()`, which calls `ensureNavigationTables()`. Before the fix, that initializer changed the saved value back to `0` before the response was normalized.

## Fix

Changed:

- `apps/backend/src/services/mobile-feature-service.ts`
  - removed the unconditional `UPDATE mobile_features ... navigation.live = 0`;
  - removed the unconditional `UPDATE mobile_feature_flags ... navigation.live = 0`.

Kept unchanged:

- default insertion for missing rows, so a first-time database still starts with Live disabled;
- the Desktop UI and checkbox behavior;
- the admin PUT endpoint;
- the mobile GET endpoint;
- the database schema and settings architecture.

The initializer now creates missing defaults only. Existing operator values are preserved across writes, reads, reloads, and backend initialization.

## Database Verification

The focused isolated regression used the in-memory test database and the actual `MobileFeatureService` write/read methods.

```text
BEFORE:
navigation.live enabled = 0

SAVE REQUEST EFFECT:
updateNavigationFeature("navigation.live", true, null)

AFTER UPDATE:
mobile_feature_flags.enabled = 1

GET/READ RESPONSE:
getNavigationFeatures().navigation.live.enabled = true

SAVE REQUEST EFFECT:
updateNavigationFeature("navigation.live", false, null)

AFTER UPDATE:
mobile_feature_flags.enabled = 0

GET/READ RESPONSE:
getNavigationFeatures().navigation.live.enabled = false
```

No credentials, tokens, or production database were accessed.

## Tests

Passed:

- `npx tsx --test apps/backend/src/services/mobile-feature-service.test.ts`
  - 3 tests passed, including the new persistence regression.
- `npx tsx --test apps/desktop/src/renderer/features/mobile/MobileFeatureControlScreen.test.tsx`
  - 2 tests passed.
- `npm run typecheck -w apps/backend`
  - passed.
- `npm run typecheck -w apps/desktop`
  - passed.

The existing dirty worktree was preserved. No production service, migration, deployment, UI redesign, or unrelated IPTV change was performed.

## Regression Coverage

The new backend test proves both directions:

```text
false -> save true -> SQLite 1 -> service GET true
true  -> save false -> SQLite 0 -> service GET false
```

It specifically exercises the initialization/read path that caused the original regression, so a future unconditional reset will fail the test.

## Final Gate

`PASS`

The persistence/state-sync bug is fixed at its root cause. The Desktop UI now retains the selected Live state after saving and reloading through the backend read path. Real production deployment validation was not performed and remains outside this task.
