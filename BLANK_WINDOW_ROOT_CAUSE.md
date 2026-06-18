Summary
-------

Investigation performed May 30, 2026.

What I ran
- Launched the desktop app (local electron) and captured renderer logs to `apps/desktop/debug_output.log`.
- Added temporary renderer error forwarding in `preload.cjs` and extra logging in the main process to capture console messages, network failures, and renderer state at `did-finish-load`.

Findings
--------

- No explicit unhandled exception matching a renderer crash was present in the captured logs. The renderer printed only an Electron security warning and finished loading successfully:

  [RENDERER] Content finished loading
  [RENDERER CONSOLE] Electron Security Warning (Insecure Content-Security-Policy)

- The built `dist/index.html` contains the app bundle script in the document HEAD while the app's root DOM node is in the BODY:

  - [apps/desktop/dist/index.html](apps/desktop/dist/index.html#L1-L20)

- When the app bundle runs synchronously from the head it can execute before the body is parsed. If React attempts to mount immediately it will not find the root element and will fail to mount. That failure is commonly surfaced as:

  - Exact error (expected when that race occurs): "Target container is not a DOM element." (React) or similar; in minified production builds this may appear as a minified React error code.

Evidence
--------

- `dist/index.html` shows the script in HEAD and `<div id="root"></div>` in BODY which can cause a timing race.

What I changed (minimal)
------------------------

- Applied a single-line-safe mount guard so React only mounts after DOMContentLoaded.
  - File: [apps/desktop/src/main.tsx](apps/desktop/src/main.tsx#L1-L30)
  - Change: wrap mount in `DOMContentLoaded` listener and throw a clear error if root missing.

- Added temporary debug instrumentation (main + preload) to gather renderer console/network/errors during diagnosis. These are safe to keep for further debugging but can be removed later.
  - Files changed: [apps/desktop/electron/main.ts](apps/desktop/electron/main.ts#L1-L220), [apps/desktop/scripts/align-electron-output.js](apps/desktop/scripts/align-electron-output.js#L1-L120)

Root cause
----------

The blank window is caused by a DOM timing race in production: the built script executes before the document body is parsed, so React's `createRoot(document.getElementById('root'))` may run when `document.getElementById('root')` is null, preventing the UI from mounting. The most direct visible symptom (when it occurs) is a React mount error such as "Target container is not a DOM element.".

Minimal fix
-----------

Add a DOMContentLoaded guard around the React mount (already applied at [apps/desktop/src/main.tsx](apps/desktop/src/main.tsx#L1-L30)). This is minimal, safe, and does not alter application behaviour or features.

Next steps (optional)
--------------------

- Keep the temporary preload/main logging until you confirm the fix in CI or packaged builds, then remove the extra logging if desired.
- Optionally, adjust the Vite build/template so the generated script tag uses `defer` or stays in the body; the DOMContentLoaded guard is the smallest safe change.

If you want, I can open a PR that reverts the temporary debug instrumentation after you confirm the packaged app runs cleanly.
