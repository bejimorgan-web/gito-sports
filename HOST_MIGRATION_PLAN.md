# Host Catalog Migration Plan

The runtime schema migration is additive only: it creates `hosts` and adds nullable `competitions.host_id`. Existing `countries`, competition IDs, team `country_id` values, fixtures, streams, and news references remain unchanged.

Legacy competition migration is intentionally not invoked during backend startup. The temporary helper at `apps/backend/src/db/host-migration.ts` creates one country Host per sport/country pair and fills only null `host_id` values. It preserves competition IDs and the legacy `country_id` projection. Run it only against an exported or temporary database after row-count and reference parity checks.

New organization, federation, association, regional, international, and other Hosts are stored only in `hosts`; they are never inserted into `countries` or ISO fields.