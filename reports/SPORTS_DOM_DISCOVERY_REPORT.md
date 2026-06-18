# SPORTS DOM DISCOVERY REPORT

Date: 2026-05-31

Scope: lightweight DOM discovery of the Desktop app's Sports workspace to find stable selectors for Create / Edit / Delete / Upload / Save / Cancel controls.

Actions performed
- Navigated to `http://localhost:4200/` and attempted to open the Sports workspace via the navigation entry.
- Directly navigated to `http://localhost:4200/sports` to inspect the rendered DOM.
- Ran small, targeted DOM probes (counts and heading samples) to avoid large serializations.

Key findings (rendered UI evidence only)
- Page headings found at `/sports`: "Live Sports", "Live Operations Console", "Stream Status", "Match Control" (see accessibility snapshot captured during discovery).
- Counts observed on the Sports listing page:
  - Buttons/links (`button, a`): 239
  - Visible `input[type=file]`: 0 (no file inputs present on the listing view)
  - Elements with `data-testid` / `data-test` / `data-cy`: 0
  - `form` elements: 0

What this means
- The Create / Edit modals (which contain `input[type=file]`) are not present in the DOM on the sports listing page until the modal is opened. Therefore discovery of the file input and modal-specific controls requires the modal to be open.
- There are no `data-testid` attributes in the rendered DOM to use as stable selectors — we must rely on structural selectors or on the modal being opened so we can inspect its elements directly.

Selectors and attempts (automated)
- Clicked navigation entry using text match: `Array.from(document.querySelectorAll('button,a')).find(e => /\bSports\b/i.test(e.textContent))` — this locates the nav item but did not expose a visible Create modal in the listing view.
- Direct navigation to `/sports` succeeded (URL reachable) but the listing view does not contain modal/form controls by default.

Observed limitations / failures
- Automation could not locate modal file inputs because the Create modal was not open at time of discovery.
- No `data-testid` attributes available, so text-based queries are fragile; many buttons contain long concatenated labels which makes reliable substring matches brittle.

Recommended next steps (to continue the sweep)
1. Open the Sports workspace and open the Create modal manually, then tell the agent the UI is in that state; or
2. Allow the agent to open the Create modal if you prefer (the agent can try again using click heuristics), accepting that it may require 1–2 retries to find the correct control; or
3. If you can provide the exact selector (or point out the Create button in the UI), the agent will use it and run the full automated Sports sweep.

Planned automated actions once modal is open
- Enumerate modal DOM: locate `input[type=file]`, name input, Save / Cancel buttons, and any `.field-success` / `.field-error` nodes.
- Use stable selectors found inside the modal to:
  - upload test PNG and capture preview-before-save screenshot
  - click Save and capture after-save screenshot
  - find the created row and capture logo rendering
  - perform Edit (change name/logo) and capture evidence
  - perform Delete and capture confirmation + post-delete state
  - restart backend and Electron, re-capture persistence screenshots

If you want me to continue automatically now, please either:
- open the Sports Create modal and reply "Modal open"; or
- reply "Agent may open modal" and I will attempt targeted clicks (may take up to 2 retries).

If automation cannot reach a control I will record the exact selector attempted, the DOM element actually present, and the reason it failed.

---

Automated click attempts (status)

I attempted up to two targeted automated clicks to open the Create modal. Summary:

- Selector candidates attempted (by visible text match):
  1. Buttons containing text matching `/create sport|new sport|add sport|create|new|add/i` (text-based search of all `button`, `a`, `[role="button"]`).
  2. Button found as the first `button` inside the heading parent for the `Live Sports` heading.

- Click attempts performed:
  - Attempt 1: clicked the first candidate button whose text contains one of the create/add/new keywords (text used: captured from page). Screenshot: [reports/ui_sweep_sports_debug_01.png](reports/ui_sweep_sports_debug_01.png)
  - Attempt 2: clicked the button found near the `Live Sports` heading (header parent button). Screenshot: [reports/ui_sweep_sports_debug_02_sports.png](reports/ui_sweep_sports_debug_02_sports.png)

- Resulting DOM state after attempts:
  - No `input[type=file]` was present in the DOM after clicks.
  - No dialog elements (`[role="dialog"]` or `<dialog>`) were detected.
  - Headings present: `Live Sports`, `Live Operations Console`, `Stream Status`, `Match Control`.

- Reason automation did not open the modal (observed):
  - The app does not render the Create modal in the DOM until a specific control is activated; the text-based heuristics did not match the exact trigger element (many buttons on the page have long concatenated labels making substring matches brittle).
  - There are no `data-testid` attributes to use as robust hooks.
  - Some navigation/UI controls appear to be custom components that may require clicking an inner element (icon or a specific child) rather than the outer `button` node the heuristic targeted.
  - During attempts the Playwright evaluation experienced execution errors intermittently (script run aborted). I retried but the modal did not appear.

Screenshots captured during discovery and attempts:
- Before attempts: [reports/ui_sports_dom_before_click_*.png] (if present) and [reports/ui_sweep_sports_debug_01.png](reports/ui_sweep_sports_debug_01.png)
- After attempts: [reports/ui_sweep_sports_debug_02_sports.png](reports/ui_sweep_sports_debug_02_sports.png)

Next actions (recommended):
1. Manual: please open the Sports Create modal and reply "Modal open"; I will then enumerate modal internals and run the full UI sweep immediately.
2. Automated (retry): allow me to run up to two more targeted clicks but I will first attempt to click inner elements (icon children) and elements with specific class patterns. This may succeed but could take up to two retries.

I will not proceed to create/edit/delete until the Create modal is confirmed open.
