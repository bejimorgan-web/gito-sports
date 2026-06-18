# SPORT LOGO TRACE REPORT

Date: 2026-05-31

Objective: trace one sport logo end-to-end (upload -> create sport -> DB -> API -> UI) and identify where the URL is stored, returned, and consumed.

1) Upload response

Command run:

curl -F file=@apps/backend/data/uploads/1780244145873-f1vx63.png http://127.0.0.1:4100/upload/images

Response (raw):

{"data":{"url":"http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png"}}

Evidence file: server debug log appended to `apps/backend/data/uploads/upload-debug.log` (excerpt later).

2) Sport create request

Command run (via Python tmp-create-sport.py): POST http://127.0.0.1:4100/sports

Request payload sent:

{"name":"Trace Sport E2E","logoUrl":"http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png","countryIds":[]}

API response (raw):

201
{"data":{"id":"8e7b5fe8-6a25-4ceb-92f6-7ecddb13a84b","name":"Trace Sport E2E","slug":"trace-sport-e2e","status":"active","createdAt":"2026-05-31T18:25:44.162Z","updatedAt":"2026-05-31T18:25:44.162Z","logoUrl":"http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png","countryIds":[]}}

3) SQLite row

Database file: `apps/backend/data/gito.sqlite`

Query run (tmp-query-sqlite.py):

PRAGMA table_info(sports):
(0, 'id', 'TEXT', 0, None, 1)
(1, 'name', 'TEXT', 1, None, 0)
(2, 'slug', 'TEXT', 1, None, 0)
(3, 'status', 'TEXT', 1, "'active'", 0)
(4, 'created_at', 'TEXT', 1, None, 0)
(5, 'updated_at', 'TEXT', 1, None, 0)
(6, 'logo_url', 'TEXT', 0, None, 0)

Last sports row (raw):

('8e7b5fe8-6a25-4ceb-92f6-7ecddb13a84b', 'Trace Sport E2E', 'trace-sport-e2e', 'active', '2026-05-31T18:25:44.162Z', '2026-05-31T18:25:44.162Z', 'http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png')

4) GET /sports response

Command run:

curl http://127.0.0.1:4100/sports

Response (excerpt includes our sport):

{"data":[
  ...,
  {"id":"8e7b5fe8-6a25-4ceb-92f6-7ecddb13a84b","name":"Trace Sport E2E","slug":"trace-sport-e2e","status":"active","createdAt":"2026-05-31T18:25:44.162Z","updatedAt":"2026-05-31T18:25:44.162Z","logoUrl":"http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png","countryIds":[]}
]}

5) React component props & avatar logic

Component: `EntityAvatar` inside `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`

Code excerpt:

function EntityAvatar({ src, fallback }: { src?: string | undefined; fallback: string }) {
  const resolvedSrc = resolveAssetUrl(src);

  return (
    <div className="entity-avatar">
      {resolvedSrc ? <img src={resolvedSrc} alt={fallback} /> : <span>{fallback.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

Invocation site (where sport cards are rendered):

<EntityAvatar src={sport.logoUrl} fallback={sport.name} />

resolveAssetUrl implementation (apps/desktop/src/renderer/components/asset-url.ts):

- If `value` is falsy -> return "".
- If value starts with `data:image/` -> return value.
- If value matches `^https?://` -> return value.
- If value starts with `/uploads/` -> return `${API_BASE_URL}${trimmed}` where `API_BASE_URL` defaults to `http://localhost:4100`.
- Otherwise return trimmed.

Given the stored and API-returned value is `http://127.0.0.1:4100/uploads/...` which matches `^https?://`, `resolveAssetUrl` returns the same absolute URL unchanged.

6) Avatar render decision

Decision logic: `resolvedSrc ? <img src={resolvedSrc} .../> : <span>{fallback initials}</span>`

- `resolvedSrc` computed from `sport.logoUrl` is `http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png` (non-empty string)
- Consequently, the avatar renders an `<img>` tag with `src` set to that URL.

---------------------------------------------------------

Final Answers (A-D)

A. What exact value is stored in `logo_url`?
- Stored value (SQLite `logo_url` column):
  - http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png

B. What exact value is returned by GET /sports?
- In the `logoUrl` field for the created sport:
  - http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png

C. What exact value reaches the avatar component?
- Passed prop `src` to `EntityAvatar`: `sport.logoUrl` = http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png
- `resolvedSrc` computed by `resolveAssetUrl(src)` = http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png

D. Why does the avatar display an image (not initials)?
- Because `resolvedSrc` is a non-empty absolute URL, so the conditional `resolvedSrc ? <img .../> : <span>...</span>` chooses the `<img>` branch; therefore an image is displayed.

Evidence collected (saved as text outputs in this repo):
- Upload response: see above (raw JSON)
- DB row: obtained via `tmp-query-sqlite.py` output
- API response: GET /sports raw output above
- UI logic: code excerpts from `SportsWorkspaceScreen.tsx` and `asset-url.ts` included above

First point where the logo URL could be lost or modified
- In this trace there was no loss or modification. The first possible points where the URL could change in general are:
  1. Backend upload endpoint: it returns either an absolute URL or a relative `/uploads/...`. The frontend `apiClient.uploadImage` prefixes `API_BASE_URL` for relative paths. If backend returned a relative path but the frontend expected absolute, a mismatch or double-prefix could occur. (Not observed here.)
  2. `createSport` handler: if backend code normalized or rejected the `logoUrl` field before inserting into DB. (Not observed; DB contains same value.)
  3. Frontend `resolveAssetUrl`: if a returned URL was `/uploads/...` it would be prefixed with `API_BASE_URL` which may differ from runtime host, causing `localhost` vs `127.0.0.1` differences. (Not observed here because API returned absolute `http://127.0.0.1:4100/...`.)

Notes & Recommendations
- For robust behavior across environments prefer backend to return absolute URLs consistently (done here), or have a documented client normalization rule that always prefixes relative `/uploads/` with configured base URL.
- Consider normalizing host (localhost vs 127.0.0.1) if clients compare origins.
- Optionally remove the temporary server debug log created during investigation: `apps/backend/data/uploads/upload-debug.log`.

Attachments (text evidence included inline). If you want I can:
- Add an automated E2E test that uploads an image, creates a sport, and asserts DB + API + UI values.
- Remove debug logging now that the issue is resolved.

--- End of report
