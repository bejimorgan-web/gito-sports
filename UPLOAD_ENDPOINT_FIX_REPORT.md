# Upload Endpoint Fix Report

Date: 2026-05-31

Summary of fix
- Problem: POST `/upload/images` never completed; `multer` waited indefinitely.
- Root cause: `multer.diskStorage` `destination` implementation did not call the provided Node-style callback, blocking `multer`'s flow.

Change implemented
- File modified: `apps/backend/src/routes/uploads.ts`
- Fixes applied:
  - Corrected storage destination to call the callback:

    - Before: `destination: () => uploadDirectory`
    - After: `destination: (_req, _file, cb) => cb(null, uploadDirectory)`

  - Removed manual `req.on('data')` / `req.on('end')` listeners used during debugging which can interfere with `multer`'s stream parsing.
  - Added conservative debug logs (appended to `apps/backend/data/uploads/upload-debug.log`) so future hangs are visible without relying on attached terminal stdout.

Why this fixes the hang
- `multer.diskStorage` expects the `destination` function to call `cb(null, destinationPath)` (or call `cb(err)` on error). If the callback is not called, `multer` never receives the destination and cannot proceed to write the file, so the request processing stalls.
- Calling the callback unblocks `multer` so it continues parsing and writing the uploaded file.

Live test results
- Command run:

```bash
curl -v --max-time 30 -F file=@apps/backend/data/uploads/1780244145873-f1vx63.png http://127.0.0.1:4100/upload/images
```

- HTTP status: 201 Created
- Response body:

```json
{"data":{"url":"http://127.0.0.1:4100/uploads/1780251524042-h2xxhs.png"}}
```

- Saved file path on disk (relative to repo root):
  - `apps/backend/data/uploads/1780251524042-h2xxhs.png` (file size: 8 bytes in this test)

Debug log (file):
- `apps/backend/data/uploads/upload-debug.log` contains timestamps and the steps `multer middleware start`, `multer middleware finished`, `route handler start`, `file saved`, and `responding with file url`.

Recommended follow-ups
- Remove or reduce debug log verbosity in production. Keep a short audit log if desired.
- Add a small integration test that performs a multipart upload against `/upload/images` to prevent regressions.
- Add server-side monitoring for slow requests and error rates on `/upload`.

Notes
- While debugging I temporarily added `req.on('data')` listeners; those were removed because attaching `data` listeners can consume the request stream and interfere with `multer`/`busboy` parsing.
- No other code unrelated to the upload flow was changed.

Files changed
- `apps/backend/src/routes/uploads.ts` (fixed `destination`, removed debug listeners, added conservative logging)

If you want, I can:
- revert the debug logging after you confirm the fix
- add an automated test that uploads a small file to `/upload/images`
- implement a small size/format check and friendly JSON error responses for `413` (file too large)
