import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import type { ArticleGenerationIntent, ArticleGenerationOutput } from "../services/article-generation-contract.js";

export interface GenerationContextReference { contextType: string; contextId: string }
export interface GeneratedArticleVersion { id: string; articleId: string; taskId: string; actorId: string; headline: string; summary: string; body: string; sections: unknown; output: ArticleGenerationOutput; validation: unknown; reviewState: string; createdAt: string }
export interface ArticleGenerationRequestRecord { articleId: string; researchSessionId: string; articleType: string; editorInstruction: string | null; requestedLength: number | null; tone: string; headlineOptions: number; createdAt: string }

export class AiArticleGenerationRepository {
  constructor(private readonly db: DatabaseSync) {}

  createRequest(taskId: string, articleId: string, actorId: string, researchSessionId: string, intent: ArticleGenerationIntent, references: GenerationContextReference[]): void {
    const canonicalIntent = JSON.stringify(intent);
    const fingerprint = createHash("sha256").update(`${researchSessionId}\n${canonicalIntent}`).digest("hex");
    const prior = this.db.prepare("SELECT request_fingerprint FROM ai_article_generation_requests WHERE task_id=?").get(taskId) as { request_fingerprint: string } | undefined;
    if (prior) {
      if (prior.request_fingerprint !== fingerprint) throw new Error("ai_idempotency_conflict");
      return;
    }
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_article_generation_requests (task_id, article_id, actor_id, research_session_id, article_type, editor_instruction,
      requested_length, tone, headline_options, request_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(taskId, articleId, actorId, researchSessionId, intent.articleType, intent.editorInstruction, intent.requestedLength, intent.tone,
        intent.headlineOptions, fingerprint, now);
    const insertReference = this.db.prepare("INSERT OR IGNORE INTO ai_article_generation_context (task_id, context_type, context_id) VALUES (?, ?, ?)");
    for (const reference of references) insertReference.run(taskId, reference.contextType, reference.contextId);
  }

  persistVersion(taskId: string, articleId: string, actorId: string, output: ArticleGenerationOutput): string {
    const versionId = randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO ai_generated_article_versions (id, article_id, task_id, actor_id, headline, summary, body, sections_json, output_json, validation_json, review_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?)`)
      .run(versionId, articleId, taskId, actorId, output.headline, output.summary, output.body, JSON.stringify(output.sections), JSON.stringify(output),
        JSON.stringify({ valid: true, rulesVersion: "article-generation-rules-v1", factCheckRequired: output.factCheckRequired, generationWarnings: output.generationWarnings }), now);
    return versionId;
  }

  getVersionForTask(taskId: string, actorId: string): GeneratedArticleVersion | null {
    const row = this.db.prepare(`SELECT v.* FROM ai_generated_article_versions v JOIN ai_tasks t ON t.id=v.task_id
      WHERE v.task_id=? AND v.actor_id=? AND t.actor_id=? AND t.task_type='article_generation'`).get(taskId, actorId, actorId) as any;
    return row ? toVersion(row) : null;
  }

  listVersions(articleId: string, actorId: string): GeneratedArticleVersion[] {
    return (this.db.prepare(`SELECT v.* FROM ai_generated_article_versions v JOIN ai_tasks t ON t.id=v.task_id
      WHERE v.article_id=? AND v.actor_id=? AND t.actor_id=? AND t.task_type='article_generation'
      ORDER BY v.created_at DESC, v.id DESC`).all(articleId, actorId, actorId) as any[]).map(toVersion);
  }

  getVersion(articleId: string, generationId: string, actorId: string): GeneratedArticleVersion | null {
    const row = this.db.prepare(`SELECT v.* FROM ai_generated_article_versions v JOIN ai_tasks t ON t.id=v.task_id
      WHERE v.article_id=? AND v.id=? AND v.actor_id=? AND t.actor_id=? AND t.task_type='article_generation'`).get(articleId, generationId, actorId, actorId) as any;
    return row ? toVersion(row) : null;
  }

  getContextReferences(taskId: string, actorId: string): GenerationContextReference[] {
    return this.db.prepare(`SELECT c.context_type AS contextType, c.context_id AS contextId FROM ai_article_generation_context c
      JOIN ai_tasks t ON t.id=c.task_id WHERE c.task_id=? AND t.actor_id=? ORDER BY c.context_type, c.context_id`).all(taskId, actorId) as GenerationContextReference[];
  }

  getRequestForTask(taskId: string, actorId: string): ArticleGenerationRequestRecord | null {
    const row = this.db.prepare(`SELECT r.* FROM ai_article_generation_requests r JOIN ai_tasks t ON t.id=r.task_id
      WHERE r.task_id=? AND r.actor_id=? AND t.actor_id=? AND t.task_type='article_generation'`).get(taskId, actorId, actorId) as any;
    return row ? { articleId: row.article_id, researchSessionId: row.research_session_id, articleType: row.article_type,
      editorInstruction: row.editor_instruction, requestedLength: row.requested_length, tone: row.tone, headlineOptions: row.headline_options, createdAt: row.created_at } : null;
  }
}

function toVersion(row: any): GeneratedArticleVersion {
  return { id: row.id, articleId: row.article_id, taskId: row.task_id, actorId: row.actor_id, headline: row.headline, summary: row.summary,
    body: row.body, sections: safeJson(row.sections_json, []), output: safeJson<ArticleGenerationOutput>(row.output_json, null as any), validation: safeJson(row.validation_json, null),
    reviewState: row.review_state, createdAt: row.created_at };
}
function safeJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
