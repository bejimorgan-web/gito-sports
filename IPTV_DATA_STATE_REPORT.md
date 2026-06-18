# IPTV_DATA_STATE_REPORT

## Summary

The current IPTV database state shows:

- total channels: 14,783
- active channels: 3,862
- archived channels: 10,921
- inactive channels: 0
- stale channels: 0
- deleted providers: 12
- active providers: 1

## Provider state

| Provider | Deleted | Total channels | Active | Archived | Notes |
| --- | --- | --- | --- | --- | --- |
| IPTV | 0 | 3,851 | 3,851 | 0 | Active production provider |
| API TV | 1 | 10,921 | 0 | 10,921 | Soft-deleted provider; all channels archived |
| Provider Comp 3e18d156 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Comp c208b87d | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Host d01672f0 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Host e3749818 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Sport 9e686212 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Sport bd94b7c2 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Team 61a84790 | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Team a15c82de | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Team f937707c | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Provider Team ff1f2d7d | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |
| Reliability Inline M3U | 1 | 1 | 1 | 0 | Deleted provider with 1 active channel |

## Findings

### 1. Were these channels intentionally archived?

Yes. The 10,921 archived channels are all owned by the deleted provider `API TV`.
The `softDeleteProvider()` implementation explicitly archives all channels for a provider when the provider is marked deleted.
This matches the observed state for `API TV`.

### 2. Were they archived because they were missing during sync?

No. The archived channels are not the result of `full` sync stale/inactive logic.
They are the result of provider soft deletion, not a missing provider channel in an incoming sync payload.

### 3. Were providers deleted accidentally?

The provider deletion path is clearly implemented via `softDeleteProvider()` and only this code path updates `providers.deleted` and archives channels.
The data indicates intentional soft deletion for 12 providers.

That said, there is an anomaly: 11 deleted providers still each have 1 active channel.
Under normal soft-delete semantics, a deleted provider should have all of its channels archived.
This suggests data drift or an edge-state after deletion that should be reconciled prior to migration.

## Note on provider_deleted debug counts

The IPTV debug route `GET /iptv/channels?mode=debug` attaches `provider_deleted` based on the parent provider's deleted flag.
The runtime debug output shows `provider_deleted` count of 10,932.
This matches:

- 10,921 archived channels from `API TV`
- 11 active channels from deleted providers

## Conclusion

- `API TV` channels were intentionally archived through provider deletion.
- These archives are not sync-missing stale transitions.
- Provider deletion appears intentional, but the 11 active channels under deleted providers are inconsistent and should be cleaned before Render migration.
