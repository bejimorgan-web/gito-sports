# Architecture

GiTO Live Sports uses a pragmatic MVP architecture:

- Electron + React + TypeScript desktop app.
- Flutter mobile app.
- Node.js + Express backend API.
- SQLite local operational database.
- Shared TypeScript package for contracts and naming helpers.

## High-Level Flow

1. Operators configure sports, competitions, teams, matches, IPTV providers, and stream sources in the desktop app.
2. The desktop app communicates with the backend API.
3. The backend stores operational data in SQLite.
4. Operators preview IPTV streams and submit stream assignments for approval.
5. Approved match stream metadata becomes available to the mobile app.

## Modules

- Sports module: sports, competitions, teams, seasons, fixtures.
- IPTV module: providers, stream sources, preview metadata.
- Match module: scheduling and match lifecycle.
- Approval module: stream review and publication state.
- Mobile delivery module: approved match stream access.

## Architecture Rules

- Keep modules separated by business capability.
- Do not introduce distributed services during the MVP.
- Prefer explicit API routes over generic catch-all endpoints.
- Keep shared contracts small and stable.
- Keep provider-specific IPTV code behind adapters.

## Stream Delivery

- Non-negotiable: GiTO Live Sports does NOT proxy, relay, retransmit, or transcode media streams.
- The backend is strictly a management and orchestration platform: it stores provider/channel metadata, validates feeds, monitors health, and manages lifecycle and publication state.
- Clients (desktop, mobile) MUST connect directly to the approved stream source URL for playback. The backend MUST NOT act as a media proxy, relay, or transcoder.
- Any future requirement to proxy, relay, or transcode media streams requires an explicit architectural change, design review, and accompanying operational controls.

