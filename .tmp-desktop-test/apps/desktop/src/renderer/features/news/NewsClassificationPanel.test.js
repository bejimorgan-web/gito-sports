import { jsx as _jsx } from "react/jsx-runtime";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { NewsClassificationPanel } from "./NewsClassificationPanel";
function setupDom() {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
    const win = dom.window;
    for (const [key, value] of [["window", win], ["document", win.document], ["navigator", win.navigator]]) {
        Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    }
    return dom;
}
const category = (id, type, entityId, status, confidence = 95) => ({
    id, articleId: "article-1", categoryType: type, entityId, confidence, reason: "Exact normalized catalog name found in article text", classificationSource: "deterministic", classificationStatus: status, createdAt: "2026-08-19", updatedAt: "2026-08-19"
});
test("classification panel separates approved relationships and suggestion actions", async () => {
    const dom = setupDom();
    const { render, fireEvent, within } = await import("@testing-library/react");
    const approved = [category("approved-bayern", "team", "Bayern Munich", "approved")];
    const suggestions = [category("suggested-dortmund", "team", "Borussia Dortmund", "suggested", 94), category("suggested-ucl", "competition", "Champions League", "suggested", 61)];
    const approvedIds = [];
    const rejectedIds = [];
    let rerunCount = 0;
    const view = render(_jsx(NewsClassificationPanel, { classification: { approved, suggestions }, labelFor: (item) => item.entityId, selectedIds: ["suggested-dortmund"], onToggle: () => undefined, onApprove: (id) => approvedIds.push(id), onReject: (id) => rejectedIds.push(id), onApproveSelected: () => approvedIds.push("bulk"), onRerun: () => { rerunCount += 1; }, approvingCategoryId: null, entities: { team: [], competition: [], country: [], host: [{ id: "host-fifa", name: "FIFA" }], sport: [], match: [] }, onAddManual: () => undefined }));
    assert.ok(view.getByText("Approved"));
    assert.ok(view.getByText("Bayern Munich"));
    assert.ok(view.getByText("+ Add host"));
    assert.ok(view.getByText("94%"));
    const suggestionElements = view.getAllByText((content) => content.includes("Exact normalized catalog name found in article text"));
    assert.equal(suggestionElements.length, 2);
    const suggestionCard = suggestionElements[0].closest(".news-classification-suggestion");
    fireEvent.click(within(suggestionCard).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(suggestionCard).getByRole("button", { name: "Reject" }));
    fireEvent.click(view.getByRole("button", { name: "Approve selected" }));
    fireEvent.click(view.getByRole("button", { name: "Rerun classification" }));
    assert.deepEqual(approvedIds, ["suggested-dortmund", "bulk"]);
    assert.deepEqual(rejectedIds, ["suggested-dortmund"]);
    assert.equal(rerunCount, 1);
    dom.window.close();
});
