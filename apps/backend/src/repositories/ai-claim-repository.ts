import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";

export interface DurableClaim {
  id: string; articleId: string; text: string; normalizedText: string; claimType: string;
  sourceContext: string | null; subjectEntities: string[]; temporalContext: Array<Record<string, unknown>>; extractionConfidence: number | null;
}
export interface VerificationEvidence {
  id: string; text: string; evidenceType: string; sourceId: string; sourceUrl: string; canonicalUrl: string; sourceType: string;
  publisher: string | null; sourcePublishedAt: string | null; retrievedAt: string | null; contentHash: string | null; sourceContentIdentity: string; location: unknown;
}
export interface PersistedAssessment {
  id?: string; claimId: string; articleId: string; researchSessionId: string; taskId: string; status: string; explanation: string;
  confidence: number; temporalStatus: string; temporalWarnings: string[]; evidenceSetIds: string[]; relationships: Array<{
    evidenceId: string; relationshipType: string; directness: string; confidence: number; explanation: string;
  }>;
  rulesVersion: string; provider: string; model: string; promptVersion: string; correlationId: string;
}

function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }

export class AiClaimRepository {
  constructor(private readonly db: DatabaseSync) {}

  latestStoryUnderstanding(articleId: string, actorId: string): { taskId: string; generationId: string; output: Record<string, any> } | null {
    const row = this.db.prepare(`SELECT t.id AS task_id, g.id AS generation_id, g.output_json FROM ai_generations g
      JOIN ai_tasks t ON t.id=g.task_id WHERE g.news_article_id=? AND t.actor_id=? AND t.task_type='story_understanding' AND t.status='completed'
      ORDER BY g.created_at DESC LIMIT 1`).get(articleId, actorId) as any;
    if (!row) return null;
    const output = parseJson<Record<string, any> | null>(row.output_json, null);
    if (!output || typeof output !== "object" || !Array.isArray(output.keyClaims)) return null;
    return { taskId: row.task_id, generationId: row.generation_id, output };
  }

  extractFromStory(articleId: string, researchSessionId: string, storyTaskId: string, generationId: string, output: Record<string, any>): DurableClaim[] {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      const result: DurableClaim[] = [];
      for (const item of output.keyClaims as any[]) {
        if (!item || typeof item.text !== "string" || !item.text.trim()) continue;
        const claimType = claimTypeMap[String(item.claimType)] ?? "other";
        const text = item.text.trim().slice(0, 3000);
        const normalizedText = text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
        if (!normalizedText) continue;
        const sourceContext = typeof item.sourceContext === "string" ? item.sourceContext.trim().slice(0, 1000) : null;
        const identityKey = createHash("sha256").update(`${normalizedText}\n${(sourceContext ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim()}`).digest("hex");
        const old = this.db.prepare("SELECT id FROM ai_claims WHERE article_id=? AND identity_key=? AND claim_type=?").get(articleId, identityKey, claimType) as { id: string } | undefined;
        const id = old?.id ?? randomUUID();
        const temporalReferences = Array.isArray(output.timeReferences) ? output.timeReferences.filter((reference: any) => {
          if (!reference || typeof reference.text !== "string") return false;
          const source = `${text} ${sourceContext ?? ""}`.toLocaleLowerCase("en-US");
          return source.includes(reference.text.toLocaleLowerCase("en-US")) || output.timeReferences.length === 1;
        }) : [];
        if (!old) this.db.prepare(`INSERT INTO ai_claims (id, article_id, claim_text, normalized_text, identity_key, claim_type, source_context, subject_entities_json,
          temporal_context_json, extraction_confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, articleId, text, normalizedText, identityKey, claimType, sourceContext, JSON.stringify(uniqueStrings(item.referencedEntities)), JSON.stringify(temporalReferences),
            boundedConfidence(item.extractionConfidence), now, now);
        this.db.prepare(`INSERT OR IGNORE INTO ai_claim_provenance (id, claim_id, origin_type, task_id, generation_id, research_session_id, created_at)
          VALUES (?, ?, 'story_understanding', ?, ?, ?, ?)`)
          .run(randomUUID(), id, storyTaskId, generationId, researchSessionId, now);
        const claim = this.getClaimRow(id)!;
        if (!result.some((existingClaim) => existingClaim.id === claim.id)) result.push(claim);
      }
      return result;
    });
    return transaction();
  }

  bindVerificationTask(taskId: string, claimId: string, articleId: string, researchSessionId: string, actorId: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO ai_verification_requests (task_id, claim_id, article_id, research_session_id, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(taskId, claimId, articleId, researchSessionId, actorId, new Date().toISOString());
    const row = this.db.prepare("SELECT claim_id, article_id, research_session_id, actor_id FROM ai_verification_requests WHERE task_id=?").get(taskId) as any;
    if (!row || row.claim_id !== claimId || row.article_id !== articleId || row.research_session_id !== researchSessionId || row.actor_id !== actorId) {
      throw new Error("ai_idempotency_conflict");
    }
  }

  getRequestForTask(taskId: string, actorId: string): any | null {
    return (this.db.prepare(`SELECT r.*, c.claim_text AS claimText, c.claim_type AS claimType, c.normalized_text AS normalizedText,
      c.subject_entities_json AS subjectEntitiesJson, c.temporal_context_json AS temporalContextJson, c.extraction_confidence AS extractionConfidence
      FROM ai_verification_requests r JOIN ai_claims c ON c.id=r.claim_id
      JOIN ai_research_sessions s ON s.id=r.research_session_id JOIN ai_tasks t ON t.id=r.task_id
      WHERE r.task_id=? AND r.actor_id=? AND s.actor_id=? AND t.actor_id=?`).get(taskId, actorId, actorId, actorId) as any) ?? null;
  }

  getEvidenceForSession(sessionId: string, actorId: string): VerificationEvidence[] {
    return (this.db.prepare(`SELECT e.id, e.evidence_text AS text, e.evidence_type AS evidenceType, e.location_json AS location,
      s.id AS sourceId, s.url AS sourceUrl, s.canonical_url AS canonicalUrl, s.source_type AS sourceType, s.publisher,
      s.published_at AS sourcePublishedAt, s.retrieved_at AS retrievedAt, s.content_hash AS contentHash
      , (SELECT GROUP_CONCAT(ordered_passages.evidence_text, char(10)) FROM
        (SELECT e2.evidence_text FROM ai_research_evidence e2 WHERE e2.source_id=s.id ORDER BY e2.extracted_at, e2.id) ordered_passages) AS sourcePassages
      FROM ai_research_evidence e JOIN ai_research_sources s ON s.id=e.source_id JOIN ai_research_sessions rs ON rs.id=e.session_id
      WHERE e.session_id=? AND rs.actor_id=? AND rs.status IN ('completed','completed_with_source_failures') AND s.retrieval_status='retrieved'
      ORDER BY e.extracted_at, e.id LIMIT 500`).all(sessionId, actorId) as any[]).map((row) => ({ ...row,
        sourceContentIdentity: createHash("sha256").update(String(row.sourcePassages ?? "").normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim()).digest("hex"),
        location: parseJson(row.location, null) }));
  }

  getClaimForActor(claimId: string, actorId: string): DurableClaim | null {
    const row = this.db.prepare(`SELECT c.* FROM ai_claims c WHERE c.id=? AND (
      EXISTS (SELECT 1 FROM ai_claim_provenance p JOIN ai_research_sessions s ON s.id=p.research_session_id WHERE p.claim_id=c.id AND s.actor_id=?) OR
      EXISTS (SELECT 1 FROM ai_verification_assessments a JOIN ai_tasks t ON t.id=a.task_id WHERE a.claim_id=c.id AND t.actor_id=?))`).get(claimId, actorId, actorId) as any;
    return row ? toClaim(row) : null;
  }

  claimBelongsToResearchSession(claimId: string, researchSessionId: string, actorId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM ai_claim_provenance p JOIN ai_research_sessions s ON s.id=p.research_session_id
      WHERE p.claim_id=? AND p.research_session_id=? AND s.actor_id=? LIMIT 1`).get(claimId, researchSessionId, actorId));
  }

  getClaimsForResearchTask(taskId: string, actorId: string): DurableClaim[] | null {
    const session = this.db.prepare(`SELECT s.id FROM ai_research_sessions s JOIN ai_tasks t ON t.id=s.task_id
      WHERE s.task_id=? AND s.actor_id=? AND t.actor_id=? AND s.status IN ('completed','completed_with_source_failures')`).get(taskId, actorId, actorId) as { id: string } | undefined;
    if (!session) return null;
    const rows = this.db.prepare(`SELECT DISTINCT c.* FROM ai_claims c JOIN ai_claim_provenance p ON p.claim_id=c.id
      WHERE p.research_session_id=? ORDER BY c.created_at, c.id`).all(session.id) as any[];
    return rows.map(toClaim);
  }

  getAssessmentForTask(taskId: string, actorId: string): unknown | null {
    const row = this.db.prepare(`SELECT a.* FROM ai_verification_assessments a JOIN ai_tasks t ON t.id=a.task_id
      WHERE a.task_id=? AND t.actor_id=?`).get(taskId, actorId) as any;
    return row ? this.assessmentDetails(row) : null;
  }

  persistAssessment(value: PersistedAssessment, evidence: VerificationEvidence[]): void {
    const assessmentId = value.id ?? randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_verification_assessments (id, claim_id, article_id, research_session_id, task_id, status, explanation,
      confidence, confidence_semantics, temporal_status, temporal_warnings_json, evidence_set_size, rules_version, provider, model, prompt_version, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assessment_reliability_not_truth_probability', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(assessmentId, value.claimId, value.articleId, value.researchSessionId, value.taskId, value.status, value.explanation, value.confidence,
        value.temporalStatus, JSON.stringify(value.temporalWarnings), value.evidenceSetIds.length, value.rulesVersion, value.provider, value.model, value.promptVersion, value.correlationId, now);
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    for (const evidenceId of value.evidenceSetIds) {
      const item = evidenceById.get(evidenceId); if (!item) throw new Error("verification_evidence_not_found");
      this.db.prepare(`INSERT INTO ai_verification_evidence_set (assessment_id, evidence_id, source_id, content_hash, content_identity, source_published_at, retrieved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(assessmentId, evidenceId, item.sourceId, item.contentHash, item.sourceContentIdentity, item.sourcePublishedAt, item.retrievedAt);
    }
    for (const relationship of value.relationships) {
      if (!evidenceById.has(relationship.evidenceId)) throw new Error("verification_evidence_not_found");
      this.db.prepare(`INSERT INTO ai_claim_evidence (id, assessment_id, claim_id, evidence_id, relationship_type, directness, assessment_confidence, explanation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), assessmentId, value.claimId, relationship.evidenceId, relationship.relationshipType, relationship.directness,
          relationship.confidence, relationship.explanation, now);
    }
  }

  getClaimDetails(claimId: string, actorId: string): unknown | null {
    const claim = this.getClaimForActor(claimId, actorId); if (!claim) return null;
    const provenance = this.db.prepare(`SELECT p.origin_type AS originType, p.task_id AS taskId, p.generation_id AS generationId,
      p.research_session_id AS researchSessionId, p.created_at AS createdAt FROM ai_claim_provenance p
      JOIN ai_research_sessions s ON s.id=p.research_session_id WHERE p.claim_id=? AND s.actor_id=? ORDER BY p.created_at`).all(claimId, actorId);
    const assessments = this.db.prepare(`SELECT a.* FROM ai_verification_assessments a JOIN ai_tasks t ON t.id=a.task_id
      WHERE a.claim_id=? AND t.actor_id=? ORDER BY a.created_at DESC`).all(claimId, actorId) as any[];
    return { claim, provenance, assessments: assessments.map((row) => this.assessmentDetails(row)) };
  }

  private assessmentDetails(row: any): unknown {
    const relationships = this.db.prepare(`SELECT ce.evidence_id AS evidenceId, ce.relationship_type AS relationshipType, ce.directness,
      ce.assessment_confidence AS confidence, ce.explanation, e.evidence_text AS evidenceText, s.id AS sourceId,
      s.url AS sourceUrl, s.canonical_url AS canonicalUrl, s.source_type AS sourceType, s.content_hash AS contentHash,
      s.published_at AS sourcePublishedAt, s.retrieved_at AS retrievedAt, ves.content_identity AS sourceContentIdentity
      FROM ai_claim_evidence ce JOIN ai_research_evidence e ON e.id=ce.evidence_id JOIN ai_research_sources s ON s.id=e.source_id
      JOIN ai_verification_evidence_set ves ON ves.assessment_id=ce.assessment_id AND ves.evidence_id=ce.evidence_id
      WHERE ce.assessment_id=? ORDER BY ce.created_at`).all(row.id);
    const evidenceSet = this.db.prepare(`SELECT evidence_id AS evidenceId, source_id AS sourceId, content_hash AS contentHash, content_identity AS contentIdentity,
      source_published_at AS sourcePublishedAt, retrieved_at AS retrievedAt FROM ai_verification_evidence_set WHERE assessment_id=?`).all(row.id);
    return { id: row.id, claimId: row.claim_id, articleId: row.article_id, researchSessionId: row.research_session_id, taskId: row.task_id,
      status: row.status, explanation: row.explanation, confidence: row.confidence, confidenceSemantics: row.confidence_semantics,
      temporalStatus: row.temporal_status, temporalWarnings: parseJson(row.temporal_warnings_json, []), evidenceSetSize: row.evidence_set_size,
      rulesVersion: row.rules_version, provider: row.provider, model: row.model, promptVersion: row.prompt_version,
      correlationId: row.correlation_id, createdAt: row.created_at, evidenceSet, relationships };
  }

  private getClaimRow(id: string): DurableClaim | null {
    const row = this.db.prepare("SELECT * FROM ai_claims WHERE id=?").get(id) as any;
    return row ? toClaim(row) : null;
  }
}

const claimTypeMap: Record<string, string> = { match_event: "event", result: "result", transfer: "transfer", injury: "injury", selection: "availability", quote: "statement", statistic: "statistic", date_time: "date", other: "other" };
function uniqueStrings(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 30) : []; }
function boundedConfidence(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }
function toClaim(row: any): DurableClaim { return { id: row.id, articleId: row.article_id, text: row.claim_text, normalizedText: row.normalized_text, claimType: row.claim_type,
  sourceContext: row.source_context ?? null, subjectEntities: parseJson(row.subject_entities_json, []), temporalContext: parseJson(row.temporal_context_json, []), extractionConfidence: row.extraction_confidence }; }
