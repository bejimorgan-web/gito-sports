# SPORT_LOGO_UPLOAD_AUDIT

## Issue

Creating a sport with a logo produced a backend rejection:

`PayloadTooLargeError: request entity too large`

The backend log showed the request was rejected before the `/sports` route executed.

## Investigation

### 1. Payload sent by SportsWorkspaceScreen when saving a sport

The frontend component is `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`.

When a sport is saved, `saveSport()` builds a JSON payload:

```ts
const payload: CreateSportRequest = {
  name: sportName,
  ...(sportLogoUrl ? { logoUrl: sportLogoUrl } : {}),
  countryIds: sportCountryIds
};
```

This payload is sent through `apiClient.createSport(payload)`.

### 2. How the logo is transmitted

The current `LogoUrlField` component previously converted selected files into a Data URL and returned that string as `logoUrl`.

That means the field was sent as:
- Data URL
- Base64-encoded image
- inside the JSON request body

### 3. Sample payload

A failed request looked like:

```json
{
  "name": "World Football",
  "logoUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgA...",
  "countryIds": []
}
```

### 4. Request size

A Base64 image payload expands the binary by roughly 33%, so a 75 KB PNG becomes ~100 KB in the JSON body, plus extra JSON wrapper overhead.

Since the selected logo file can easily exceed 100 KB, the request body grows past the backend parser limit.

### 5. Express JSON body limit

`apps/backend/src/app.ts` used `express.json()` with no explicit limit before the fix.

That means the default Express JSON parser limit was in effect, which is approximately 100 KB.

After the fix, the backend now uses:

```ts
app.use(express.json({ limit: "1mb" }));
```

### 6. Why the UI did not surface the backend error

The backend rejected the request before reaching the `/sports` route, because the JSON parser failed first.

The custom error handler `workflowErrorHandler` only handled `WorkflowStateError` previously and forwarded other errors to Express default error handling.

That meant the frontend could receive a non-JSON error response or a generic HTML error page to parse, preventing a clean operator-facing error notification.

## Root cause

The root cause was that the app attempted to upload image files by embedding them into a JSON payload as a Data URL.

That created oversized JSON bodies which exceeded Express's default JSON parser limit, causing `PayloadTooLargeError` before the sport route executed.

## Fix implemented

### Backend

- Added a new upload endpoint: `POST /upload/images`
- Added local file storage under `data/uploads`
- Added static serving for uploaded files under `/uploads`
- Added `multer` to accept multipart/form-data uploads
- Added explicit JSON body size limit: `express.json({ limit: "1mb" })`
- Extended `workflowErrorHandler` to return JSON for generic Express errors, including large payload rejection

### Frontend

- Updated `LogoUrlField` to upload selected image files immediately via `apiClient.uploadImage(file)`
- No longer converts files to Base64 Data URLs
- `uploadImage()` sends a multipart/form-data upload to `/upload/images`
- On upload success, the returned image URL is stored in `logoUrl`
- The sport save payload now sends only a normal URL string, not a bulky Base64 payload

### UI feedback

- Existing save loading state and toast notifications are already implemented in `SportsWorkspaceScreen`
- Backend upload failures will now surface as upload errors in `LogoUrlField`
- Save failures will show error toast notifications via the existing error-handling flow

## Recommended long-term approach

1. Upload images through a dedicated endpoint, not inside entity JSON payloads.
2. Store only an image URL or path in the `logoUrl` field.
3. Keep uploaded files in a local media storage directory for the desktop backend.
4. Serve uploaded files through a static route so they can be previewed by the UI.
5. Avoid storing large Base64 payloads in entity records.

## Files changed

- `apps/backend/src/app.ts`
- `apps/backend/src/routes/uploads.ts`
- `apps/backend/src/middleware/workflow-error.ts`
- `apps/backend/package.json`
- `apps/desktop/src/renderer/services/api-client.ts`
- `apps/desktop/src/renderer/components/LogoUrlField.tsx`

## Result

The logo upload flow now uses a file upload endpoint and backend storage layer. Sport creation no longer sends large embedded Base64 data in the `/sports` JSON payload.
