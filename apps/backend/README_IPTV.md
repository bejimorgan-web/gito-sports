IPTV Subsystem (Phase 1)
=========================

Overview
--------
This module introduces the initial Phase 1 data model and backend scaffolding for a production-grade IPTV subsystem.

Files added
- `src/db/schema/initial-schema.sql` (tables appended)
- `src/repositories/iptv-repository.ts`
- `src/services/iptv-provider-service.ts`
- `src/services/iptv-channel-service.ts`
- `src/services/iptv-health-service.ts` (skeleton)
- `src/routes/iptv.ts`

Security
--------
- Provider credentials are encrypted using AES-256-GCM. The key must be provided via `IPTV_SECRET_KEY` environment variable.

Compatibility
-------------
This Phase 1 change is additive and preserves existing tables and workflows. No existing routes or APIs were changed.

Next steps
----------
Phase 2 will implement provider CRUD UI and expand the health checks, importers, and monitoring.
