# Desktop App

The desktop app is the operational control center for GiTO Live Sports.

## Technology

- Electron shell.
- React renderer.
- TypeScript across Electron and React.
- Vite for frontend development.
- Uses relative `./assets/...` paths in production so the Electron `file://` renderer can load built assets correctly.

## Core Workflows

- Manage sports taxonomy.
- Manage competitions, seasons, teams, and matches.
- Configure IPTV providers and stream sources.
- Preview IPTV streams.
- Assign streams to matches.
- Approve, reject, or suspend match streams.

## UX Priorities

- Dense but readable operational screens.
- Clear statuses and filters.
- Preview-first stream review.
- Fast navigation between match schedule, stream source, and approval state.
- Avoid decorative layouts that slow down operators.

