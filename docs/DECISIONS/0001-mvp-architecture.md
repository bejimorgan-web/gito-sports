# Decision 0001: MVP Architecture

## Status

Accepted

## Context

GiTO Live Sports needs a professional but lightweight MVP architecture for desktop operations, mobile streaming, and backend coordination.

## Decision

Use:

- Electron + React + TypeScript for the desktop app.
- Flutter for the mobile app.
- Node.js + Express for the backend API.
- SQLite for local operational persistence.
- TypeScript shared package for contracts and naming helpers.

## Consequences

- The platform can be developed quickly without distributed infrastructure.
- Operational data remains easy to inspect during MVP development.
- Future scalability should be handled through modular boundaries before infrastructure expansion.

