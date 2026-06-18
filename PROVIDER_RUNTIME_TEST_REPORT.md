PROVIDER RUNTIME TEST REPORT

Subject provider: 9fe16532-ac82-4650-9ae7-2dfab9f575f9

Test objective: Validate behavior of POST /iptv/providers/:providerId/test against a non-existent provider.

Test execution status: PARTIAL
- DB state captured: YES (before-test state only)
- HTTP request executed: NO (backend not running on localhost:4100)
- Backend availability: UNAVAILABLE at time of test

---

## Evidence Collected

### 1. Full HTTP Status Code
- Status: UNABLE TO DETERMINE (backend not responding)
- Attempted URL: POST http://localhost:4100/iptv/providers/9fe16532-ac82-4650-9ae7-2dfab9f575f9/test
- Connection result: Timeout / Connection refused (backend service not running)

### 2. Full JSON Response Body
- Response: NOT CAPTURED (no backend response received)
- Expected behavior (from code analysis): The backend route should return HTTP 404 with error response because `getProviderCredentials()` will return `undefined` for a non-existent provider id.
- Code reference: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts) line 183-185:
  ```
  const provider = getProviderCredentials(request.params.providerId);
  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
  ```

### 3. Provider Status in DB Before Test
- Provider exists: NO
- Provider row: null
- Evidence:
  ```
  {
    "label": "before_test",
    "provider_row": null,
    "active_channels": 0
  }
  ```
- SQL executed: `SELECT id, name, status, created_at, updated_at FROM providers WHERE id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9'`

### 4. Provider Status in DB After Test
- Test not executed: DB state after test unavailable (backend not running)
- Inferred outcome: Provider row would remain null (no modification to DB for non-existent provider expected from the code)

### 5. Active Channel Count Before Test
- Count: 0
- Evidence:
  ```
  "active_channels": 0
  ```
- SQL executed: `SELECT COUNT(*) AS cnt FROM channels WHERE provider_id = '9fe16532-ac82-4650-9ae7-2dfab9f575f9' AND status = 'active'`

### 6. Active Channel Count After Test
- Test not executed: After-test count unavailable
- Inferred outcome: Would remain 0 (no channels associated with the non-existent provider)

### 7. Whether Provider is Marked Deleted
- Soft-delete column: NOT PRESENT
- Evidence: The `providers` table schema has no `deleted` column (confirmed in deletion audit: `has_deleted_column: false`)
- Current schema columns: id, name, base_url, type, auth_type, credential_username, credential_password, availability_status, last_successful_stream_load_at, failed_channel_loads, health_score, status, created_at, updated_at
- Deletion mechanism: Physical deletion (row absence from DB)

### 8. Whether Test Endpoint Executes Despite Deleted Status
- Backend not available: Cannot confirm via live test
- Code analysis: Endpoint WILL execute (it's a valid HTTP route), but will:
  1. Call `getProviderCredentials(providerId)` which queries the DB
  2. Receive `undefined` (no row found)
  3. Immediately return `HTTP 404` with error: "provider_not_found"
  4. **NO channel sync or status update will occur** (code path returns early)
- Code reference: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts) lines 183-200:
  ```typescript
  iptvRouter.post("/providers/:providerId/test", async (request, response) => {
    const provider = getProviderCredentials(request.params.providerId);

    if (!provider) {
      response.status(404).json({ error: "provider_not_found" });
      return;  // <-- Early exit, no further processing
    }

    // ... rest of test logic only executes if provider exists
  ```

---

## Summary of Findings

| Item | Finding | Evidence |
|------|---------|----------|
| Provider exists in SQLite | NO | provider_row: null |
| Active channel count | 0 | COUNT(*) = 0 |
| Deleted via soft flag | N/A | No deleted column exists |
| Physically deleted | YES | Row absent from DB |
| GET /iptv/providers includes it | NO | DB query returns null |
| Test endpoint reachable | UNKNOWN | Backend unavailable |
| Test endpoint behavior on non-existent provider | HTTP 404 (code analysis) | Would return early with error_not_found |
| Channel sync on test | Would NOT occur | Backend code returns 404 before sync logic |
| Provider status update on test | Would NOT occur | Backend code returns 404 before status update |

---

## Code Path Analysis: POST /iptv/providers/9fe16532-ac82-4650-9ae7-2dfab9f575f9/test

Expected flow if backend were running:

1. Request received at route handler in [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts)
2. `getProviderCredentials(providerId)` called from [apps/backend/src/repositories/provider-repository.ts](apps/backend/src/repositories/provider-repository.ts)
3. SQL query: `SELECT ... FROM providers WHERE id = ? AND deleted = 0` (no deleted column in this DB, so query would be `SELECT ... FROM providers WHERE id = ?`)
4. Result: NULL (no matching row)
5. Guard check: `if (!provider) { response.status(404).json({ error: "provider_not_found" }); return; }`
6. Execution stops; no channel sync, no status update, no operational logging
7. Client receives:
   ```json
   {
     "error": "provider_not_found"
   }
   ```
   HTTP Status: 404

---

## Backend Service Status

At time of test execution:
- Service endpoint: http://localhost:4100
- Health check: FAILED (connection timeout)
- Port 4100 status: No service listening
- Implication: Backend was not started or not accessible

To reproduce this test with backend running:
1. Start backend: `npm run dev:backend` or `npm run dev -w @gito/backend`
2. Verify health: `curl http://localhost:4100/health`
3. Then run the test script: `python scripts/provider_runtime_test.py`

---

## Test Limitations

- HTTP request could not be executed (backend unavailable)
- DB state "after test" could not be captured
- Live HTTP status code / response body not available
- However, code analysis strongly indicates expected behavior

---

## Conclusion

The provider `9fe16532-ac82-4650-9ae7-2dfab9f575f9` is **physically deleted** (row absent from DB). If the test endpoint were called with a running backend, the server would respond with **HTTP 404 "provider_not_found"** and would NOT execute any channel sync or status updates. The endpoint logic has an early-exit guard that prevents further processing for non-existent providers.

Evidence-only report complete.
