import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { NewsArticleCategory } from "@gito/shared";
import { NewsClassificationPanel } from "./NewsClassificationPanel";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  Object.defineProperty(globalThis, "window", { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, "document", { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, writable: true, configurable: true });
  return dom;
}

test("AI classification action is explicit and suggestions remain visibly non-authoritative", async () => {
  const dom = setupDom();
  const { render, fireEvent } = await import("@testing-library/react");
  let aiCalls = 0;
  const suggestion: NewsArticleCategory = {
    id: "ai-1", articleId: "article-1", categoryType: "team", entityId: "team-bayern", confidence: 94,
    reason: "Article explicitly names Bayern Munich.", classificationSource: "ai", classificationStatus: "suggested",
    createdAt: "2026-08-19", updatedAt: "2026-08-19"
  };
  const view = render(<NewsClassificationPanel classification={{ approved: [], suggestions: [suggestion] }} labelFor={() => "Bayern Munich"} selectedIds={[]} onToggle={() => undefined} onApprove={() => undefined} onReject={() => undefined} onApproveSelected={() => undefined} onRerun={() => undefined} onAiClassify={() => { aiCalls += 1; }} />);
  fireEvent.click(view.getByRole("button", { name: "Run AI classification" }));
  assert.equal(aiCalls, 1);
  assert.ok(view.getByText("AI · Article explicitly names Bayern Munich."));
  assert.ok(view.getByText("Suggestions require approval"));
  dom.window.close();
});
