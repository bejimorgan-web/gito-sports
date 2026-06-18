-- IPTV_RECOVERY_SCRIPTS.sql
-- Safe recovery actions for IPTV provider/channel cleanup.
-- Do not execute until the state is reviewed and a backup is available.

-- A. Restore soft-deleted provider API TV and its archived channels.
BEGIN TRANSACTION;
UPDATE providers
SET deleted = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = '78dc0da9-7a89-44ee-aee1-38431531f0c9'
  AND deleted = 1;

UPDATE channels
SET status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id = '78dc0da9-7a89-44ee-aee1-38431531f0c9'
  AND status = 'archived';
COMMIT;

-- Revert A.
BEGIN TRANSACTION;
UPDATE channels
SET status = 'archived',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id = '78dc0da9-7a89-44ee-aee1-38431531f0c9'
  AND status = 'active';

UPDATE providers
SET deleted = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = '78dc0da9-7a89-44ee-aee1-38431531f0c9';
COMMIT;

-- B. Archive any active channels that still belong to deleted providers.
BEGIN TRANSACTION;
UPDATE channels
SET status = 'archived',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id IN (
  '367342ac-d4cb-4ecb-9842-8ba971463ce6',
  '50304964-4f57-4fe1-a45b-1c821c1e5950',
  '608a0a42-0328-456b-a2b4-a2cc8118355d',
  '69f25a85-7105-4ee4-aa5a-da03c97ffbdf',
  '7312213f-c5ed-4199-9ce5-9e1c93d31470',
  '7851ecfc-3cbe-4b7f-9163-4a82d9936fbf',
  '78dc0da9-7a89-44ee-aee1-38431531f0c9',
  '7a3b8106-3d01-4cc1-a2a6-1edd5b390f16',
  '86a9ef09-3f6d-4b9a-b479-d559c71ff739',
  '8f810078-1e70-47c1-91b8-f468ff6f28a7',
  '9f96d506-7db2-4c1c-915f-62405d8d486d',
  'dbc1b707-f5ca-4798-afe7-755e057ccbfb'
)
  AND status = 'active';
COMMIT;

-- Revert B.
BEGIN TRANSACTION;
UPDATE channels
SET status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id IN (
  '367342ac-d4cb-4ecb-9842-8ba971463ce6',
  '50304964-4f57-4fe1-a45b-1c821c1e5950',
  '608a0a42-0328-456b-a2b4-a2cc8118355d',
  '69f25a85-7105-4ee4-aa5a-da03c97ffbdf',
  '7312213f-c5ed-4199-9ce5-9e1c93d31470',
  '7851ecfc-3cbe-4b7f-9163-4a82d9936fbf',
  '78dc0da9-7a89-44ee-aee1-38431531f0c9',
  '7a3b8106-3d01-4cc1-a2a6-1edd5b390f16',
  '86a9ef09-3f6d-4b9a-b479-d559c71ff739',
  '8f810078-1e70-47c1-91b8-f468ff6f28a7',
  '9f96d506-7db2-4c1c-915f-62405d8d486d',
  'dbc1b707-f5ca-4798-afe7-755e057ccbfb'
)
  AND status = 'archived';
COMMIT;

-- C. Convert archived channels to stale for an active provider if that provider should remain in partial sync mode.
BEGIN TRANSACTION;
UPDATE channels
SET status = 'stale',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id = 'ca27cba8-0e74-47fb-84a2-e497d6cc9f93'
  AND status = 'archived';
COMMIT;

-- Revert C.
BEGIN TRANSACTION;
UPDATE channels
SET status = 'archived',
    updated_at = CURRENT_TIMESTAMP
WHERE provider_id = 'ca27cba8-0e74-47fb-84a2-e497d6cc9f93'
  AND status = 'stale';
COMMIT;
