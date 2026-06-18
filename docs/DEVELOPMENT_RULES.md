# Development Rules

## General

- Keep MVP implementation focused.
- Prefer clear modules over broad abstractions.
- Use TypeScript for desktop, backend, and shared contracts.
- Keep Flutter code inside `apps/mobile`.
- Document architectural decisions in `docs/DECISIONS`.

## Naming

- Packages use `@gito/{name}`.
- TypeScript files use kebab-case for feature files and PascalCase for React components.
- Database tables use plural snake_case.
- API route paths use plural lowercase nouns.
- Enum values use lowercase snake_case.

## Code Organization

- Backend routes live in `apps/backend/src/routes`.
- Backend services should live in `apps/backend/src/services`.
- Database code should live in `apps/backend/src/db`.
- Desktop React code lives in `apps/desktop/src/renderer`.
- Electron main-process code lives in `apps/desktop/electron`.
- Shared contracts live in `packages/shared/src`.

## Testing Direction

- Add unit tests for shared model helpers.
- Add route-level tests for backend workflows.
- Add UI tests for critical desktop approval flows.
- Add mobile playback tests once the Flutter app is scaffolded.

