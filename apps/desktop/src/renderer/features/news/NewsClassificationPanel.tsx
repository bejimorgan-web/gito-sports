import React from "react";
import type { NewsArticleCategory } from "@gito/shared";

type ClassificationState = { approved: NewsArticleCategory[]; suggestions: NewsArticleCategory[] };
type AiStatus = "idle" | "running" | "success" | "unavailable" | "failed";

interface Props {
  classification: ClassificationState | null;
  labelFor: (category: NewsArticleCategory) => string;
  selectedIds: string[];
  onToggle: (categoryId: string) => void;
  onApprove: (categoryId: string) => void;
  onReject: (categoryId: string) => void;
  onApproveSelected: () => void;
  onRerun: () => void;
  aiStatus?: AiStatus;
  onAiClassify?: () => void;
  entities?: Record<NewsArticleCategory["categoryType"], Array<{ id: string; name: string }>>;
  onRemoveApproved?: (categoryId: string) => void;
  onAddManual?: (categoryType: NewsArticleCategory["categoryType"], entityId: string) => void;
}

function CategoryGroup({ title, categories, labelFor, onRemove }: { title: string; categories: NewsArticleCategory[]; labelFor: Props["labelFor"]; onRemove?: Props["onRemoveApproved"] }) {
  return <div className="news-classification-group"><strong>{title}</strong>{categories.length ? categories.map((category) => <span key={category.id}>{labelFor(category)}{onRemove ? <button type="button" className="secondary" onClick={() => onRemove(category.id)}>Remove</button> : null}</span>) : <small>None</small>}</div>;
}

export function NewsClassificationPanel({ classification, labelFor, selectedIds, onToggle, onApprove, onReject, onApproveSelected, onRerun, aiStatus = "idle", onAiClassify, entities, onRemoveApproved, onAddManual }: Props) {
  const approved = classification?.approved ?? [];
  const rejected = (classification?.suggestions ?? []).filter((category) => category.classificationStatus === "rejected");
  const suggestions = (classification?.suggestions ?? []).filter((category) => category.classificationStatus === "suggested");
  const group = (categories: NewsArticleCategory[], categoryType: NewsArticleCategory["categoryType"]) => categories.filter((category) => category.categoryType === categoryType);

  return <section className="console-panel news-classification-panel">
    <div className="panel-heading"><h3>Classification</h3><div className="button-row"><span className="status-pill">Suggestions require approval</span><button type="button" onClick={onAiClassify} disabled={!onAiClassify || aiStatus === "running"}>{aiStatus === "running" ? "AI classification…" : "Run AI classification"}</button></div></div>
    {aiStatus === "unavailable" || aiStatus === "failed" ? <p className="field-note">AI classification is temporarily unavailable. Existing deterministic classification remains available.</p> : null}
    <div className="news-classification-approved"><h4>Approved</h4>
      {(["team", "competition", "country", "sport", "match"] as const).map((type) => <CategoryGroup key={type} title={({ team: "Teams", competition: "Competitions", country: "Countries", sport: "Sports", match: "Matches" })[type]} categories={group(approved, type)} labelFor={labelFor} onRemove={onRemoveApproved} />)}
    </div>
    <div className="news-classification-suggestions"><div className="news-panel-header"><h4>Suggestions</h4><div className="button-row"><button type="button" onClick={onRerun}>Rerun classification</button><button type="button" onClick={onApproveSelected} disabled={!selectedIds.length}>Approve selected</button></div></div>
      {suggestions.length ? suggestions.map((category) => <div className="news-classification-suggestion" key={category.id}>
        <label><input type="checkbox" checked={selectedIds.includes(category.id)} onChange={() => onToggle(category.id)} /><strong>{labelFor(category)}</strong> <span>{category.confidence}%</span></label>
        <small>{category.classificationSource.toUpperCase()} · {category.reason}</small>
        <div className="button-row"><button type="button" onClick={() => onApprove(category.id)}>Approve</button><button type="button" className="secondary" onClick={() => onReject(category.id)}>Reject</button></div>
      </div>) : <p className="field-note">No pending suggestions.</p>}
      {rejected.length ? <div className="news-classification-rejected"><h4>Rejected</h4>{rejected.map((category) => <div className="news-classification-suggestion" key={category.id}><strong>{labelFor(category)}</strong><small>REJECTED · {category.classificationSource.toUpperCase()} · {category.reason}</small></div>)}</div> : null}
    </div>
    {entities && onAddManual ? <div className="news-classification-manual"><h4>Manual relationships</h4>{(["team", "competition", "country", "sport", "match"] as const).map((type) => <div className="button-row" key={type}><select defaultValue="" onChange={(event) => { if (event.target.value) onAddManual(type, event.target.value); event.target.value = ""; }}><option value="">+ Add {type}</option>{entities[type].map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></div>)}<h4>This article will appear in</h4><div className="news-classification-destinations">{approved.map((category) => <span key={category.id}>✓ {labelFor(category)}</span>)}</div></div> : null}
  </section>;
}