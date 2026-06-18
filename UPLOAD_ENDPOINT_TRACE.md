# Upload Endpoint Trace

Date: 2026-05-31

Summary
- Endpoint: POST /upload/images
- Route file: `apps/backend/src/routes/uploads.ts`
- Upload library: `multer` (diskStorage)

Middleware stack (order in `apps/backend/src/app.ts`)
- `helmet()`
- `cors()`
- `express.json({ limit: '1mb' })`
- `app.use('/uploads', express.static(...))`
- `app.use('/upload', uploadsRouter)` -> where `POST /images` is mounted

Route implementation (high level)
1. The uploads router uses `multer.diskStorage({...})` with `storage` and `limits`.
2. The route calls `upload.single('file')` to parse the multipart body and write to disk.
3. On success the handler returns 201 with `{ data: { url } }`.

Observed behaviour
- `curl -F file=@test.png http://127.0.0.1:4100/upload/images` connected and the request body was sent.
- The client observed no response and timed out (connection stayed open).
- Server-side debug (added) logged `multer middleware start` but did not log `multer middleware finished` until after the fix.

Execution trace (before fix)
- Express matched the route and invoked our wrapper middleware that logs `multer middleware start`.
- `upload.single('file')` calls into `multer` which calls the configured `storage.destination` function.
- `multer` expects `destination` to call the callback `cb(null, destinationPath)`.
- The configured `destination` was implemented as `destination: () => uploadDirectory` (a function that returns a string), not a function that calls the provided callback.
- Because the callback was never called, `multer`'s internal flow waited indefinitely for `destination` to complete and did not emit completion or error — hence no response.

Where execution stalled
- Inside `multer.diskStorage` where `storage.destination(req, file, cb)` is invoked. The provided `destination` did not invoke `cb`, so the parser (busboy) did not proceed.

Root cause
- `storage.destination` had the wrong signature and did not call the callback. Specifically:
  - Wrong: `destination: () => uploadDirectory`
  - Expected: `destination: (req, file, cb) => cb(null, uploadDirectory)`

Additional interference discovered (investigation steps)
- While debugging I briefly attached `req.on('data')` listeners which can consume the request stream and interfere with `multer` parsing. Those listeners were later removed — they were not the root cause here but would have caused further issues.

Files involved
- Route: [apps/backend/src/routes/uploads.ts](apps/backend/src/routes/uploads.ts)
- App wiring: [apps/backend/src/app.ts](apps/backend/src/app.ts)

Relevant code locations
- `multer.diskStorage({...})` declaration in `apps/backend/src/routes/uploads.ts` (destination function)
- `uploadsRouter.post('/images', ...)` handler in `apps/backend/src/routes/uploads.ts`

Validation notes
- After fixing the `destination` function to call the callback, `multer` completed, the file was written, and the handler returned a `201` response.

Logs (excerpt from `apps/backend/data/uploads/upload-debug.log` after reproducing):
```
[2026-05-31T18:18:43.982Z] multer middleware start
[2026-05-31T18:18:44.037Z] request headers {"host":"127.0.0.1:4100","user-agent":"curl/8.19.0","accept":"*/*","content-length":"221","content-type":"multipart/form-data; boundary=------------------------bZzDxbIIFZgZTRZlQi5q5x"}
[2026-05-31T18:18:44.038Z] request content-length 221
[2026-05-31T18:18:44.045Z] multer middleware finished no-err
[2026-05-31T18:18:44.046Z] route handler start
[2026-05-31T18:18:44.046Z] file saved {"filename":"1780251524042-h2xxhs.png","size":8,"path":"data\\uploads\\1780251524042-h2xxhs.png"}
[2026-05-31T18:18:44.047Z] responding with file url http://127.0.0.1:4100/uploads/1780251524042-h2xxhs.png
```

Conclusion
- The upload endpoint hung because `multer`'s storage `destination` did not invoke the required callback. Fixing that to call `cb(null, uploadDirectory)` resolves the hang and allows uploads to complete.
