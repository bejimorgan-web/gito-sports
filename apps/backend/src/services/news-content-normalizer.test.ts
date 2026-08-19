import test from "node:test";
import assert from "node:assert/strict";
import { buildSummaryFromText, normalizeNewsText } from "./news-content-normalizer.js";

test("normalizeNewsText removes div and img markup and preserves text", () => {
  const input = `<div><img src="IMAGE_URL"><div>In an exclusive interview with Sky Sports, Conor Gallagher discusses his resurgence at Tottenham...</div></div>`;
  const normalized = normalizeNewsText(input);
  assert.equal(normalized, "In an exclusive interview with Sky Sports, Conor Gallagher discusses his resurgence at Tottenham...");
});

test("normalizeNewsText removes script and style content", () => {
  const input = `<div>Top story</div><script>window.alert('hi')</script><style>.hidden{display:none;}</style><p>More details</p>`;
  const normalized = normalizeNewsText(input);
  assert.equal(normalized, "Top story\n\nMore details");
});

test("normalizeNewsText decodes HTML entities", () => {
  const input = `<p>AT&amp;T said &quot;yes&quot; to the deal&#39;s terms.&nbsp;Finalized.</p>`;
  const normalized = normalizeNewsText(input);
  assert.equal(normalized, `AT&T said "yes" to the deal's terms. Finalized.`);
});

test("normalizeNewsText preserves readable paragraphs and collapses whitespace", () => {
  const input = `<article><p>Line one.</p><div>Line two<br>Line three</div></article>`;
  const normalized = normalizeNewsText(input);
  assert.equal(normalized, "Line one.\n\nLine two\nLine three");
});

test("normalizeNewsText falls back to normalized summary when body is empty", () => {
  const summary = `<div>Summary only &amp; nothing else.</div>`;
  const normalizedBody = normalizeNewsText("");
  assert.equal(normalizedBody, "");
  const normalizedSummary = normalizeNewsText(summary);
  assert.equal(normalizedSummary, "Summary only & nothing else.");
});

test("normalizeNewsText does not modify original input string", () => {
  const input = `<div>Original <img src=\"test\"></div>`;
  const clone = String(input);
  normalizeNewsText(input);
  assert.equal(input, clone);
});
test("buildSummaryFromText extracts a clean title, summary, and keywords", () => {
  const result = buildSummaryFromText(
    "A new release is available for the product team. The update improves the workflow and speeds up review. The company plans to expand access next quarter.",
    20
  );

  assert.equal(result.title, "A new release is available for the product team");
  assert.equal(result.summary, "A new release is available for the product team. The update improves the workflow and speeds up review. The company...");
  assert.deepEqual(result.keywords, ["release", "product", "team", "workflow", "review", "company"]);
});
