import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { NewsArticleCategory } from "@gito/shared";
import { NewsClassificationPanel } from "./NewsClassificationPanel";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const win = dom.window as any;
  for (const [key, value] of [["window", win], ["document", win.document], ["navigator", win.navigator]] as const) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  return dom;
}

const category = (id: string, type: NewsArticleCategory["categoryType"], entityId: string, status: NewsArticleCategory["classificationStatus"], confidence = 95): NewsArticleCategory => ({
  id, articleId: "article-1", categoryType: type, entityId, confidence, reason: "Exact normalized catalog name found in article text", classificationSource: "deterministic", classificationStatus: status, createdAt: "2026-08-19", updatedAt: "2026-08-19"
});

test("classification panel separates approved relationships and suggestion actions", async () => {
  const dom = setupDom();
  const { render, fireEvent, within } = await import("@testing-library/react");
  const approved: NewsArticleCategory[] = [category("approved-bayern", "team", "Bayern Munich", "approved")];
  const suggestions: NewsArticleCategory[] = [category("suggested-dortmund", "team", "Borussia Dortmund", "suggested", 94), category("suggested-ucl", "competition", "Champions League", "suggested", 61)];
  const approvedIds: string[] = [];
  const rejectedIds: string[] = [];
  let rerunCount = 0;
  const view = render(<NewsClassificationPanel classification={{ approved, suggestions }} labelFor={(item) => item.entityId} selectedIds={["suggested-dortmund"]} onToggle={() => undefined} onApprove={(id) => approvedIds.push(id)} onReject={(id) => rejectedIds.push(id)} onApproveSelected={() => approvedIds.push("bulk")} onRerun={() => { rerunCount += 1; }} />);
  assert.ok(view.getByText("Approved"));
  assert.ok(view.getByText("Bayern Munich"));
  assert.ok(view.getByText("94%"));
  const suggestionElements = view.getAllByText((content) => content.includes("Exact normalized catalog name found in article text"));
  assert.equal(suggestionElements.length, 2);
  const suggestionCard = suggestionElements[0]!.closest(".news-classification-suggestion") as HTMLElement;
  fireEvent.click(within(suggestionCard).getByRole("button", { name: "Approve" }));
  fireEvent.click(within(suggestionCard).getByRole("button", { name: "Reject" }));
  fireEvent.click(view.getByRole("button", { name: "Approve selected" }));
  fireEvent.click(view.getByRole("button", { name: "Rerun classification" }));
  assert.deepEqual(approvedIds, ["suggested-dortmund", "bulk"]);
  assert.deepEqual(rejectedIds, ["suggested-dortmund"]);
  assert.equal(rerunCount, 1);
  dom.window.close();
});
