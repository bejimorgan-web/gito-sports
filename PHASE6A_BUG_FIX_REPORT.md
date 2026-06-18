PHASE 6A BUG FIX REPORT

Context
- This document recommends minimal, low-risk fixes to address the two main issues found in the PHASE6A audit: logo rendering failures (relative upload paths) and delete-workflow operator feedback.
- No new features are proposed — only normalization and clearer error messaging.

Summary of recommended fixes

1) Normalize logo URLs on API responses
- Problem: DB may contain relative paths (`/uploads/...`). Returning these directly lets the renderer resolve them against the renderer origin (file:// or vite://) which fails to reach backend static files.
- Fix: In the express route handlers (or in a small response helper), convert relative `/uploads/*` values to absolute URLs using the incoming request host and protocol before returning JSON.

  Example helper (pseudo-code):

  function absoluteUploadsUrl(request, value) {
    if (!value) return value;
    if (value.startsWith('/uploads/')) {
      return `${request.protocol}://${request.get('host')}${value}`;
    }
    return value;
  }

  Apply in routes before `response.json({ data: ... })` for both list and single-item endpoints for `sports`, `countries`, `competitions`, `teams`.

- Rationale: This is backward-compatible and only affects how data is presented to the UI; stored DB values remain unchanged.

2) Ensure upload endpoint returns canonical absolute URL (already present)
- Observation: `uploads.ts` returns `{ data: { url: '/uploads/filename' } }` and frontend `apiClient.uploadImage` currently returns `API_BASE_URL + body.data.url` which creates absolute URL. Keep this behavior; the normalization in (1) will make older rows consistent.

3) Improve deletion error messages and operator UX
- Problem: backend returns terse `error` tokens and UI surfaces them inconsistently; operators interpret failure as ‘delete not working’.
- Fixes:
  - Update routes when returning conflict responses to include a `message` field with a user-friendly string. Example:
    response.status(409).json({ error: 'sport_in_use_or_not_found', message: 'Cannot delete sport: competitions exist for this sport.' });
  - Update `workflow-error` middleware to preserve `message` when present.
  - In front-end delete handlers, show a toast with the error `message` (or fallback to a friendly string) and keep the modal open so the operator can read details.

4) Defensive frontend fallback (optional, small):
- In `EntityAvatar` or image rendering locations, add a last-resort normalization: if `src` startsWith('/uploads/') then prefix with `import.meta.env.VITE_GITO_API_BASE_URL`.
- This prevents visual regressions if API responses are slow to be normalized.

Implementation steps (suggested, minimal patches)
- Backend change (apply to `apps/backend/src/routes/*`):
  - Add `function normalizeRowUrls(req, row)` helper that substitutes `logo_url` / `flag_url` fields to absolute values using `req.protocol` and `req.get('host')`.
  - Apply this helper in `GET /` and `GET /:id` handlers before `response.json({ data: ... })`.
- Backend error messages:
  - Update delete routes to return `{ error: '<code>', message: '<friendly message>' }` for 409 cases.
- Frontend change (optional):
  - In `EntityAvatar` change `src ? <img src={src} /> : ...` to use `const resolvedSrc = src.startsWith('/uploads/') ? `${API_BASE_URL}${src}` : src;` and pass `resolvedSrc` to `<img>`.
  - In delete handlers, when catching error thrown by `apiClient`, check for `error.message` and show that in `pushToast(..., 'error')` and set modal `status` text.

Testing plan
- Create a new sport via UI using file upload; verify DB `logo_url` contains either absolute URL or relative; open `GET /sports` and confirm API response `logoUrl` is absolute `http://host/uploads/...`.
- Check a legacy DB entry that contains `/uploads/...` and confirm `GET` returns absolute URL after normalization.
- Attempt to delete a sport that has competitions; verify API returns 409 with friendly `message` and UI displays that message in a toast and in modal status text.

Estimated effort
- Backend normalization: ~1–2 hours to implement and add automated tests for the route output.
- Delete error message improvements: ~30–60 minutes.
- Frontend defensive fallback: ~30 minutes.

Notes & rationale
- Converting responses to absolute URLs keeps the DB stable and avoids mass migrations.
- Prefer server-side normalization because the server knows its own host/protocol and can respond with canonical URLs regardless of client origin.
- The friendly message improves operator confidence and saves support time.

If you want, I can implement the backend normalization patch and the improved delete error messages now and run the typechecks and a quick E2E validation.
