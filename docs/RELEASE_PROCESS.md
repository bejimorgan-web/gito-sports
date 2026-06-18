# Release Process

## Versioning

Use semantic versioning:

- MAJOR: incompatible workflow, schema, or deployment changes.
- MINOR: compatible product or operational improvements.
- PATCH: bug fixes, documentation, validation, and release hardening.

MVP starts at:

```text
0.1.0
```

## Release Numbering

Release tags should use:

```text
vMAJOR.MINOR.PATCH
```

Example:

```text
v0.1.0
```

## Release Notes Format

Each release note should include:

- Summary
- Operator impact
- Backend changes
- Desktop changes
- Mobile changes
- Validation results
- Known warnings
- Rollback instructions

## Release Steps

1. Update version numbers where applicable.
2. Run validation and stress gates.
3. Build backend, desktop, and mobile artifacts.
4. Back up SQLite database.
5. Record environment variables.
6. Deploy backend.
7. Verify desktop and mobile clients.
8. Publish release notes.

## Rollback Process

1. Stop backend.
2. Restore previous application build.
3. Restore previous SQLite backup if data changed incompatibly.
4. Restart backend.
5. Verify `/health`.
6. Verify desktop workflow.
7. Verify mobile feed.

Rollback is operationally preferred over manual database edits.
