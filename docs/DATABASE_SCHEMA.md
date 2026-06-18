# Database Schema

The MVP database uses SQLite. Schema design should stay normalized enough to support growth while remaining easy to query and operate.

## Core Tables

### sports

- id
- name
- slug
- status
- created_at
- updated_at

### regions

- id
- name
- code
- type
- parent_region_id
- status

### countries

- id
- name
- iso2_code
- iso3_code
- region_id
- status

### seasons

- id
- competition_id
- name
- starts_at
- ends_at
- status

### competitions

- id
- sport_id
- name
- slug
- scope
- region_code
- season_label
- status
- created_at
- updated_at

Competitions are not strictly country-dependent. `scope` supports domestic, continental, international, friendly, and custom competition types.

### teams

- id
- sport_id
- name
- short_name
- country_code
- status
- created_at
- updated_at

### matches

- id
- competition_id
- home_team_id
- away_team_id
- starts_at
- venue_name
- status
- created_at
- updated_at

Allowed match states: draft, scheduled, assigned, approved, published, live, ended, cancelled.

### providers

- id
- name
- base_url
- type
- auth_type
- credential_username
- credential_password
- availability_status
- last_successful_stream_load_at
- failed_channel_loads
- health_score
- status
- created_at
- updated_at

### channels

- id
- provider_id
- name
- url
- external_ref
- status
- created_at
- updated_at

### streams

- id
- match_id
- channel_id
- protocol
- status
- approval_status
- approved_by_user_id
- approved_at
- rejection_reason
- published_at
- health_status
- health_reason
- failure_count
- last_health_at
- created_at
- updated_at

Allowed stream states: idle, assigned, testing, approved, active, failed, disabled.

Allowed stream health states: active, degraded, failed, unknown.

### operational_logs

- id
- event_type
- entity_type
- entity_id
- severity
- message
- metadata
- created_at

### operator_settings

- id
- operator_user_id
- setting_key
- setting_value
- created_at
- updated_at

### auth_sessions

- id
- operator_user_id
- token_id
- expires_at
- created_at

### operator_users

- id
- name
- email
- role
- status
- last_login_at
- created_at
- updated_at

## Naming Conventions

- Table names use plural snake_case.
- Primary keys are `id`.
- Foreign keys use `{entity}_id`.
- Timestamps use UTC ISO-compatible values.
- Enum-like values use lowercase snake_case.
