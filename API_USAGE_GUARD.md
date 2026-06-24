# API-Football Protection Layer

## Overview

The `ApiUsageGuard` service provides rate limiting and caching for API-Football requests to protect against:
1. **Rate limit violations** - Enforcing maximum request frequencies per API endpoint
2. **Excessive API costs** - Preventing thousands of users from triggering thousands of API calls
3. **Service degradation** - Avoiding overwhelming the API-Football service

## Rate Limiting Rules

```
Live Fixtures:  max 1 request every 30 seconds
Fixtures:       max 1 request every 6 hours
Leagues:        max 1 request every 6 hours
Logos:          max 1 request every 7 days
```

## Architecture

### Components

1. **ApiUsageRepository** (`apps/backend/src/repositories/api-usage-repository.ts`)
   - Persists last request timestamps in the `api_usage_log` database table
   - Supports querying and updating timestamps for each request type

2. **ApiUsageGuard** (`apps/backend/src/services/api-usage-guard.ts`)
   - Enforces rate limits using both in-memory and persistent caching
   - Two-tier cache:
     - **In-memory cache**: Fast hits, TTL-based expiry (20s for live, 6h for fixtures, etc.)
     - **Database timestamps**: Persistent tracking across server restarts
   - Returns cached data when requests are rate-limited

3. **ScoreService Integration** (`apps/backend/src/services/score-service.ts`)
   - Wraps API-Football calls with `apiUsageGuard.checkAndExecute()`
   - Protected methods:
     - `listLiveScores()` → `getLiveFixtures()` (live_fixtures)
     - `listScheduledMatches()` → `getFixturesByRange()` (fixtures)
     - `listCompetitions()` → `getLeagues()` (leagues)

### Data Flow

```
Mobile App (1000+ users)
    ↓
GET /scores/live (or /football/live)
    ↓
ScoreService.listLiveScores()
    ↓
apiUsageGuard.checkAndExecute('live_fixtures')
    ├─ In-memory cache? → Return cached [instant]
    ├─ Rate limit OK? → Call API → Cache result
    └─ Rate limited? → Return cached or fail gracefully
    ↓
Backend Response to Mobile
```

## Logging

The guard emits structured logs for debugging and monitoring:

```
[API CACHE HIT] live_fixtures (live_fixtures_default)
  → Indicates a request was served from in-memory cache

[API REQUEST BLOCKED] fixtures (fixtures_range_2025-01-01_2025-12-31)
  → Rate limit enforced, next allowed in Xs

[API REQUEST SENT] live_fixtures (live_fixtures_default)
  → API request was made (rate limit passed)
```

## Implementation Details

### Cache TTLs

The guard maintains two separate TTL configurations:

1. **Rate limit interval**: Minimum time between API requests
   - Controls when a new API call is allowed

2. **Cache TTL**: How long to keep the result in memory
   - Live: 20s cache (30s rate limit)
   - Fixtures: 6h cache (6h rate limit)
   - Leagues: 6h cache (6h rate limit)
   - Logos: 7d cache (7d rate limit)

### Persistent Storage

The `api_usage_log` table stores the last request timestamp for each type:

```sql
CREATE TABLE api_usage_log (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL UNIQUE,  -- 'live_fixtures', 'fixtures', 'logos', 'leagues'
  last_request_timestamp INTEGER NOT NULL,  -- Unix timestamp (ms)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

This ensures rate limits are enforced across:
- Server restarts
- Multiple server instances
- Background refresh processes

## Usage

### Basic Usage

```typescript
import { apiUsageGuard } from './services/api-usage-guard.js';

const result = await apiUsageGuard.checkAndExecute(
  'live_fixtures',           // Request type
  'live_fixtures_default',   // Cache key
  () => ApiFootballService.getLiveFixtures()  // Async function to execute
);

if (result.allowed) {
  // Fresh API response
  console.log('Data from API:', result.data);
} else if (result.cached) {
  // Cached response (rate limited)
  console.log('Data from cache:', result.data);
  console.log('Next request at:', new Date(result.blockedUntil).toISOString());
} else {
  // Rate limited and no cache
  console.error('Rate limited:', result.reason);
}
```

### Custom Rate Limits

```typescript
import { apiUsageGuard } from './services/api-usage-guard.js';

// Override default 30s limit for live fixtures
apiUsageGuard.setRateLimitConfig('live_fixtures', {
  intervalMs: 60_000,      // 1 minute between requests
  cacheTtlMs: 30_000       // 30s in-memory cache
});
```

### Status and Monitoring

```typescript
// Get current rate limit status
const status = apiUsageGuard.getStatus();
// Returns: { live_fixtures: { lastRequest: 1234567890, nextAllowedAt: 1234567920 }, ... }

// Clear caches (for testing)
apiUsageGuard.clearCache(true);  // true = also clear database timestamps
```

## Testing

### Scenario: 1000 Users Opening App

Expected behavior:

1. **First user** → API call made → Result cached
   - Log: `[API REQUEST SENT] live_fixtures`
   - Response time: ~500ms (API call)

2. **Next 999 users** (within 30 seconds) → Cache hit
   - Log: `[API CACHE HIT] live_fixtures`
   - Response time: ~5ms (cache lookup)

3. **31+ seconds later** → Next API call made
   - Log: `[API REQUEST SENT] live_fixtures`
   - Remaining users still get cached data

**Result**: Instead of 1000 API calls, only 1-2 calls are made.

### Database Validation

Check the `api_usage_log` table after testing:

```sql
SELECT request_type, last_request_timestamp, updated_at
FROM api_usage_log
ORDER BY updated_at DESC;
```

Each row should have a recent timestamp that only updates once per rate limit interval.

## Failure Modes

### Scenario: Rate Limited Without Cache

If a request is rate-limited and no cached data is available:

```json
{
  "allowed": false,
  "cached": false,
  "reason": "Rate limit exceeded. No cached data available."
}
```

**Mitigation**: The ScoreService returns empty results or an error response to the client. The mobile app should handle gracefully by:
- Using stale data from local cache
- Showing an error message
- Retrying after the blocked period

### Scenario: Database Error

If the `api_usage_log` table is unavailable:

- The in-memory cache still functions
- New API calls may be made more frequently than intended
- Guardian will log the database error

**Resolution**: Fix database connectivity and restart the backend.

## Monitoring Checklist

- [ ] Check logs for `[API REQUEST SENT]` frequency (should be rare for live_fixtures)
- [ ] Verify `[API CACHE HIT]` logs appear for most requests
- [ ] Monitor API quota usage (should be significantly reduced)
- [ ] Validate `api_usage_log` table entries are being updated
- [ ] Test mobile app with 100+ concurrent users
- [ ] Verify no direct API-Football calls from mobile routes

## Future Enhancements

1. **Per-User Rate Limiting**: Track usage per IP/user to prevent abuse
2. **Adaptive Caching**: Adjust TTLs based on data freshness requirements
3. **Metrics Export**: Send rate limit metrics to Prometheus/CloudWatch
4. **Circuit Breaker**: Prevent cascading failures if API-Football is down
5. **Logo Caching**: Implement dedicated logo request batching
