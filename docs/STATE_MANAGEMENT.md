# State Management

State is intentionally simple for the MVP. SQLite is the durable operational source of truth, the backend owns mutations, and the desktop app owns operator intent.

## Local SQLite State

SQLite stores:

- providers
- channels
- sports
- competitions
- teams
- matches
- streams
- operator users
- auth sessions
- operator settings
- stream health metadata
- provider health metadata
- operational logs

Provider credentials remain local to the backend database and are not serialized to mobile clients.

## Backend State

The backend owns:

- provider persistence
- channel extraction results
- match creation
- stream approval state
- live publication state
- mobile-safe live feed serialization
- stream and provider health persistence
- operational log persistence

The backend should stay stateless beyond SQLite-backed operational data and short request handling.

## Authentication Persistence

The MVP uses local JWT access tokens for operator actions. Tokens are held by the desktop runtime and sent to protected endpoints. `auth_sessions` exists for future revocation and auditing, but the first implementation keeps session behavior lightweight.

## Cache Strategy

The MVP does not require a distributed cache. Desktop screens refresh provider, channel, and live match data from the backend after mutations. Any in-memory UI state is treated as temporary operator context and can be rebuilt from SQLite.

## Operational Data Ownership

- Desktop owns operator choices and workflow progression.
- Backend owns validation, persistence, approval changes, and publication changes.
- Backend owns reliability metadata and feed exclusion for failed/offline sources.
- SQLite owns durable local operational state.
- Mobile owns read-only consumption of approved published streams.
