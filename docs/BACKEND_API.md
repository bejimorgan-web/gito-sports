# Backend API

The backend API is a lightweight Node.js and Express service. It coordinates operational data between desktop, SQLite, and mobile clients.

## Responsibilities

- Expose CRUD endpoints for sports data.
- Expose IPTV provider and stream source endpoints.
- Expose match scheduling endpoints.
- Expose stream approval endpoints.
- Expose mobile-safe approved stream metadata.

## Route Groups

- `/health`
- `/sports`
- `/competitions`
- `/teams`
- `/matches`
- `/iptv/providers`
- `/iptv/sources`
- `/streams`
- `/mobile/matches`

## API Rules

- Return JSON only.
- Use consistent response envelopes.
- Keep validation close to route handlers or service boundaries.
- Never expose provider secrets to mobile clients.
- Use explicit approval states for stream publication.

