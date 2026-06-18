# Release Checklist

## Pre-Deployment

- Confirm `npm run validate:operations` passes.
- Confirm `npm run stress:operations` is PASS or PASS WITH WARNINGS.
- Confirm desktop build succeeds.
- Confirm mobile build succeeds.
- Set `NODE_ENV=production`.
- Set deployment-specific `JWT_SECRET`.
- Confirm `DATABASE_PATH`.
- Back up SQLite database.
- Confirm backend URL for desktop and mobile builds.
- Review provider credentials and access controls.

## Deployment

- Build shared, backend, desktop, and mobile artifacts.
- Start backend with production environment.
- Verify `/health`.
- Verify `/mobile/matches/live`.
- Install or launch desktop.
- Confirm desktop backend status is online.
- Confirm operator login works.
- Install or distribute mobile build.
- Confirm mobile feed loads.

## Post-Deployment

- Ingest or verify IPTV providers.
- Preview a known channel.
- Assign and approve a test match in a safe environment.
- Publish only when intended.
- Verify mobile live feed.
- Enter LIVE MODE and confirm alerts/status.
- Record release version, date, and operator sign-off.

## Rollback Readiness

- Keep previous application build.
- Keep latest known-good SQLite backup.
- Document environment values used by the release.
- Verify restore procedure before match day.
