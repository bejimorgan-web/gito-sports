# SPORTS MODAL FAILURE REPORT

Date: 2026-05-31

Summary
- Goal: open the Sports "Create Sport" modal via automated UI interactions and run a full create/edit/delete UI sweep.
- Outcome: automated attempts to open the modal (including inner-element heuristics and two retries) could not be completed reliably due to intermittent execution failures in the automation environment. The app's source shows the modal is opened by a visible button labeled "Add Sport"; however the automation runs intermittently failed to click the control and/or observe the modal DOM.

What I inspected in-code (authoritative selectors)
- Source component: `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`
  - "Add Sport" button location (exact JSX):
    - inside: `section.console-panel > div.panel-heading > button` with text "Add Sport" and `onClick={() => openSportEditor()}`
  - Modal rendering: conditional `modalContext ? <Modal ...>` renders `LogoUrlField` which contains an `input[type=file]`.

Automated selectors attempted (exact)
1. Navigation entry (main nav): clicked the nav button whose text contains "SportsManage sports, countries, competitions, and teams" (approx selector: first nav button matching that text; implementation used index-based click of nodes[4]).
2. Page-level 'Add Sport' click attempts:
  - selector attempt A: element matched by exact text `(button, a)` where `text.trim() === 'Add Sport'` (attempted via text-based lookup and `.click()`).
  - selector attempt B: inner-element heuristic — for candidate buttons found by broader matching, attempted to click child nodes (`span`, `svg`, `i`, `img`) by matching the child's outerHTML start, then falling back to clicking parent by index (e.g. `parent by index N`).
3. Fallback: attempted clicking the first visible top-left `button` when other heuristics found no candidates.

Click attempts performed (evidence)
- Attempt: click nav entry (index-based) to reach the Sports workspace. Screenshot: `reports/trace-sport-workspace.png` (existing evidence shows Sports UI rendering).
- Attempt: look for `button` with exact text "Add Sport" and invoke `.click()`. (No modal observed by automation after click.)
- Inner-element heuristics: tried clicking child `span`/`svg` if present, then parent by index. (No input[type=file] appeared in DOM after attempts.)

Screenshots captured during discovery (selected)
- `reports/create-sport-modal.png` — existing capture of the create modal/control from earlier runs (shows upload control). This is static evidence that the modal exists and contains the `LogoUrlField` input.
- `reports/trace-sport-workspace.png` — Sports workspace listing evidence.
- Several temporary discovery screenshots (before/after click attempts) were created under `reports/` (files named like `ui_sweep_sports_debug_01.png`, `ui_sweep_sports_debug_02_sports.png`, `sports_modal_*_before_click_*.png`, etc.) — inspect `reports/` for exact filenames.

Event and click detection
- I attempted to instrument the page with a global click listener to capture click events and their targets during automated clicks (pushes to `window.__clickLog`).
- Observed behavior:
  - In some runs the click listener captured events (clicks on various elements), but these did not result in the modal being rendered.
  - In other runs the automation script itself experienced execution errors before the full instrumentation could complete; the intermittent failures prevented reliable aggregation of event logs across retries.

DOM state after attempts
- No `input[type=file]` was present in the DOM after automated clicks according to the runs that completed.
- Modal `<dialog>` or `[role="dialog"]` elements were not detected by the automation after attempts.

Reasons automation did not open the modal (root-cause hypotheses)
1. Selector mismatch (likely): the primary control text is "Add Sport" (not "Create Sport"), so earlier broad heuristics missed it; corrected selector was attempted but automation execution failed intermittently.
2. Custom component behavior: the app's UI may wrap the actual click target in nested elements, and text-based matching may find a different node (or the clickable element requires an inner element click) — inner-element heuristics were attempted but did not open the modal.
3. Automation environment instability: multiple `run_playwright_code` executions returned intermittent errors while the script was performing click-and-observe sequences; these execution failures prevented completing the full 2-retry sequence reliably.

Exact items to reproduce locally (manual fallback)
1. Open app at `http://localhost:4200/` and click the main nav entry "SportsManage sports, countries, competitions, and teams" to open the Sports workspace.
2. In the Sports workspace, click the button labeled "Add Sport" (selector: `section.screen-stack.sports-workspace-screen .panel-heading > button` or `button` whose trimmed text is "Add Sport").
3. The modal should appear; verify presence of `input[type=file]` inside the modal (component `LogoUrlField`).

Next recommended steps
- Option A (preferred for automation): allow one more automated run but without heavy screenshots and with a guaranteed exact selector: I'll target `document.querySelector('section.screen-stack.sports-workspace-screen .panel-heading > button')` and click its node, then check for `input[type=file]`. This reduces selector brittleness.
- Option B (if you want immediate verification): manually click "Add Sport" in the app and reply "Modal open" — I will then enumerate modal internals and complete the UI sweep.

Files referenced
- `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx` — exact code paths used to identify selectors and modal structure.
- `reports/create-sport-modal.png`, `reports/trace-sport-workspace.png` — existing screenshots showing the create modal and workspace.

I did not open the modal manually and did not mark any UI step as PASS without explicit UI evidence.
