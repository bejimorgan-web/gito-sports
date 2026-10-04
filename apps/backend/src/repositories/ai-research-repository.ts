import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";

export type ResearchStatus = "running" | "completed" | "completed_with_source_failures" | "failed" | "cancelled";
export interface ResearchSourceRecord {
  id: string; sessionId: string; url: string; canonicalUrl: string; title: string | null; publisher: string | null; author: string | null;
  publishedAt: string | null; discoveredAt: string; retrievedAt: string | null; httpStatus: number | null; contentType: string | null;
  sourceType: string; retrievalStatus: "discovered" | "retrieved" | "failed"; contentHash: string | null; errorCode: string | null;
}

export class AiResearchRepository {
  constructor(private readonly db: DatabaseSync) {}

  createSession(value: { taskId: string; articleId: string; actorId: string; correlationId: string; promptVersion: string; querySummary: string; discoveryProvider: string; retrievalProvider: string }): string {
    const id = randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_research_sessions (id, task_id, article_id, actor_id, correlation_id, status, prompt_version,
      query_summary, discovery_provider, retrieval_provider, created_at, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`)
      .run(id, value.taskId, value.articleId, value.actorId, value.correlationId, value.promptVersion, value.querySummary.slice(0, 2000), value.discoveryProvider, value.retrievalProvider, now, now);
    return id;
  }

  finishSession(id: string, status: ResearchStatus, failureCode: string | null = null): void {
    this.db.prepare("UPDATE ai_research_sessions SET status = ?, completed_at = ?, failure_code = ?, failure_message = ? WHERE id = ?")
      .run(status, new Date().toISOString(), failureCode, failureCode ? "Research completed with a source or discovery failure" : null, id);
  }

  upsertSource(value: Omit<ResearchSourceRecord, "id"> & { snapshotText: string | null; discoveryProvider: string; retrievalProvider: string; retrievalMetadata: Record<string, unknown>; errorMessage: string | null }): string {
    const old = this.db.prepare("SELECT id FROM ai_research_sources WHERE session_id = ? AND canonical_url = ?").get(value.sessionId, value.canonicalUrl) as { id: string } | undefined;
    const id = old?.id ?? randomUUID();
    this.db.prepare(`INSERT INTO ai_research_sources (id, session_id, url, canonical_url, source_title, publisher, author, published_at,
      discovered_at, retrieved_at, http_status, content_type, source_type, retrieval_status, content_hash, snapshot_text,
      retrieval_provider, discovery_provider, retrieval_metadata_json, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, canonical_url) DO UPDATE SET url=excluded.url, source_title=excluded.source_title, publisher=excluded.publisher,
      author=excluded.author, published_at=excluded.published_at, retrieved_at=excluded.retrieved_at, http_status=excluded.http_status,
      content_type=excluded.content_type, retrieval_status=excluded.retrieval_status, content_hash=excluded.content_hash,
      snapshot_text=excluded.snapshot_text, retrieval_metadata_json=excluded.retrieval_metadata_json,
      error_code=excluded.error_code, error_message=excluded.error_message`)
      .run(id, value.sessionId, value.url, value.canonicalUrl, value.title, value.publisher, value.author, value.publishedAt, value.discoveredAt,
        value.retrievedAt, value.httpStatus, value.contentType, value.sourceType, value.retrievalStatus, value.contentHash,
        value.snapshotText, value.retrievalProvider, value.discoveryProvider, JSON.stringify(value.retrievalMetadata), value.errorCode, value.errorMessage);
    return id;
  }

  updateSource(id: string, value: Omit<ResearchSourceRecord, "id"> & { snapshotText: string | null; discoveryProvider: string; retrievalProvider: string; retrievalMetadata: Record<string, unknown>; errorMessage: string | null }): boolean {
    try {
      const result = this.db.prepare(`UPDATE ai_research_sources SET url=?, canonical_url=?, source_title=?, publisher=?, author=?, published_at=?,
        discovered_at=?, retrieved_at=?, http_status=?, content_type=?, source_type=?, retrieval_status=?, content_hash=?, snapshot_text=?,
        retrieval_provider=?, discovery_provider=?, retrieval_metadata_json=?, error_code=?, error_message=? WHERE id=?`)
        .run(value.url, value.canonicalUrl, value.title, value.publisher, value.author, value.publishedAt, value.discoveredAt, value.retrievedAt,
          value.httpStatus, value.contentType, value.sourceType, value.retrievalStatus, value.contentHash, value.snapshotText, value.retrievalProvider,
          value.discoveryProvider, JSON.stringify(value.retrievalMetadata), value.errorCode, value.errorMessage, id);
      return Number(result.changes) === 1;
    } catch { return false; }
  }

  getSourceByCanonicalUrl(sessionId: string, canonicalUrl: string): { id: string; retrievalStatus: string } | null {
    const row = this.db.prepare("SELECT id, retrieval_status AS retrievalStatus FROM ai_research_sources WHERE session_id=? AND canonical_url=?").get(sessionId, canonicalUrl) as { id: string; retrievalStatus: string } | undefined;
    return row ?? null;
  }

  deleteSource(sourceId: string): void { this.db.prepare("DELETE FROM ai_research_sources WHERE id=?").run(sourceId); }

  addEvidence(value: { sessionId: string; sourceId: string; text: string; paragraphIndex: number; characterStart: number; characterEnd: number; evidenceType: "source_statement" | "context" | "other" }): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ai_research_evidence (id, session_id, source_id, evidence_text, evidence_type, location_json,
      extraction_confidence, extracted_at, provenance_json) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(id, value.sessionId, value.sourceId, value.text, value.evidenceType, JSON.stringify({ paragraphIndex: value.paragraphIndex, characterStart: value.characterStart, characterEnd: value.characterEnd }), new Date().toISOString(), JSON.stringify({ method: "normalized_paragraph_extraction-v1" }));
    return id;
  }

  markEvidenceExtractionFailure(sourceId: string): void {
    const row = this.db.prepare("SELECT retrieval_metadata_json FROM ai_research_sources WHERE id = ?").get(sourceId) as { retrieval_metadata_json: string } | undefined;
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(row?.retrieval_metadata_json ?? "{}"); } catch { /* keep safe empty metadata */ }
    metadata.evidenceExtractionStatus = "failed";
    this.db.prepare("UPDATE ai_research_sources SET retrieval_metadata_json = ? WHERE id = ?").run(JSON.stringify(metadata), sourceId);
  }

  latestStoryUnderstanding(articleId: string, actorId: string): unknown | null {
    const row = this.db.prepare(`SELECT g.output_json FROM ai_generations g JOIN ai_tasks t ON t.id = g.task_id
      WHERE g.news_article_id = ? AND t.actor_id = ? AND t.task_type = 'story_understanding' AND t.status = 'completed'
      ORDER BY g.created_at DESC LIMIT 1`).get(articleId, actorId) as { output_json: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.output_json); } catch { return null; }
  }

  getForActor(taskId: string, actorId: string): Record<string, unknown> | null {
    const session = this.db.prepare(`SELECT s.* FROM ai_research_sessions s JOIN ai_tasks t ON t.id=s.task_id
      WHERE s.task_id = ? AND s.actor_id = ? AND t.actor_id = ?`).get(taskId, actorId, actorId) as any;
    if (!session) return null;
    const sources = this.db.prepare(`SELECT id, session_id AS sessionId, url, canonical_url AS canonicalUrl, source_title AS title,
      publisher, author, published_at AS publishedAt, discovered_at AS discoveredAt, retrieved_at AS retrievedAt, http_status AS httpStatus,
      content_type AS contentType, source_type AS sourceType, retrieval_status AS retrievalStatus, content_hash AS contentHash,
      error_code AS errorCode, error_message AS errorMessage, retrieval_metadata_json AS retrievalMetadata
      FROM ai_research_sources WHERE session_id = ? ORDER BY discovered_at`).all(session.id) as any[];
    const evidence = this.db.prepare(`SELECT e.id, e.session_id AS sessionId, e.source_id AS sourceId, e.evidence_text AS text, e.evidence_type AS evidenceType,
      e.location_json AS location, e.extracted_at AS extractedAt, e.provenance_json AS provenance
      FROM ai_research_evidence e JOIN ai_research_sessions s ON s.id=e.session_id
      WHERE e.session_id = ? ORDER BY e.extracted_at`).all(session.id) as any[];
    return { session: { id: session.id, taskId: session.task_id, articleId: session.article_id, correlationId: session.correlation_id, status: session.status,
      promptVersion: session.prompt_version, querySummary: session.query_summary, discoveryProvider: session.discovery_provider,
      retrievalProvider: session.retrieval_provider, createdAt: session.created_at, startedAt: session.started_at, completedAt: session.completed_at,
      failureCode: session.failure_code, failureMessage: session.failure_message },
      sources: sources.map((source) => ({ ...source, retrievalMetadata: safeJson(source.retrievalMetadata) })),
      evidence: evidence.map((item) => ({ ...item, location: safeJson(item.location), provenance: safeJson(item.provenance) })) };
  }
}

function safeJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
