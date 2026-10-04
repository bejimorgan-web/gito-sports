import type { AiNewsTask, NewsArticle } from "@gito/shared";
import type { DatabaseSync } from "../db/sqlite.js";
import { AiClaimRepository } from "../repositories/ai-claim-repository.js";
import { AiArticleGenerationRepository, type GenerationContextReference, type GeneratedArticleVersion } from "../repositories/ai-article-generation-repository.js";
import type { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { AiNewsTaskRunner, createAiTaskProviderRegistry, type AiProviderConfiguration, type AiTaskProviderAdapter } from "./ai-news-provider.js";
import { ARTICLE_GENERATION_INSTRUCTIONS, ARTICLE_GENERATION_PROMPT_VERSION, ARTICLE_GENERATION_RULES_VERSION, ARTICLE_GENERATION_TYPES, deterministicEvidenceUnavailableOutput, validateArticleGeneration, type ArticleGenerationContext, type ArticleGenerationIntent, type ArticleGenerationOutput, type GenerationClaim, type GenerationEvidence } from "./article-generation-contract.js";

const SAFETY_PROVIDER = "deterministic-article-safety";
const SAFETY_MODEL = "no-assessed-evidence-v1";
const MAX_CONTEXT_BYTES = 180 * 1024;

class DeterministicSafetyProvider implements AiTaskProviderAdapter {
  readonly provider = SAFETY_PROVIDER;
  readonly capabilities = { "text-generation": true, "structured-output": true } as const;
  async execute(request: Parameters<AiTaskProviderAdapter["execute"]>[0]) {
    return { output: deterministicEvidenceUnavailableOutput((request.input as { intent: ArticleGenerationIntent }).intent) };
  }
}

export interface ArticleGenerationTaskResult { task: AiNewsTask; version: GeneratedArticleVersion | null; context: GenerationContextReference[] }
export interface AiArticleWorkflowState {
  articleExists: boolean;
  storyUnderstanding: { taskId: string; status: string } | null;
  research: { taskId: string; sessionId: string | null; status: string; sessionStatus: string | null } | null;
}
export interface CanonicalArticleReader { getArticleById(id: string): NewsArticle | null }

export class AiArticleGenerationService {
  private readonly claims: AiClaimRepository;
  private readonly research: AiResearchRepository;
  private readonly generationRepository: AiArticleGenerationRepository;
  private readonly canonicalArticles: CanonicalArticleReader;

  constructor(private readonly db: DatabaseSync, private readonly taskRepository: AiNewsTaskRepository, private readonly taskService: AiNewsTaskService,
    private readonly runnerFactory: (configuration: AiProviderConfiguration) => AiNewsTaskRunner, private readonly providerConfiguration: AiProviderConfiguration,
    canonicalArticles?: CanonicalArticleReader) {
    this.claims = new AiClaimRepository(db); this.research = new AiResearchRepository(db); this.generationRepository = new AiArticleGenerationRepository(db);
    this.canonicalArticles = canonicalArticles ?? new NewsRepository(db as any);
  }

  async generate(articleId: string, actorId: string, actorRole: string, intent: ArticleGenerationIntent,
    request: { correlationId?: string; idempotencyKey: string }): Promise<ArticleGenerationTaskResult> {
    const context = this.assembleContext(articleId, actorId);
    const references = contextReferences(context);
    const input = { instructions: ARTICLE_GENERATION_INSTRUCTIONS, rulesVersion: ARTICLE_GENERATION_RULES_VERSION,
      intent, editorInstructionsAreUntrusted: true, generationContext: context };
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_CONTEXT_BYTES) throw new Error("generation_context_too_large");
    const hasAssessedEvidence = context.claims.some((claim) => claim.relationships.some((relationship) => context.evidence.some((item) => item.id === relationship.evidenceId)));
    const configuration = hasAssessedEvidence ? this.providerConfiguration : { provider: SAFETY_PROVIDER, model: SAFETY_MODEL, baseUrl: "", apiKey: "" };
    const task = this.taskService.create({ taskType: "article_generation", articleId, promptVersion: ARTICLE_GENERATION_PROMPT_VERSION,
      correlationId: request.correlationId, idempotencyKey: request.idempotencyKey }, actorId, configuration, actorRole);
    this.generationRepository.createRequest(task.id, articleId, actorId, context.research.sessionId, intent, references);
    if (task.status !== "queued") return { task, version: task.status === "completed" ? this.generationRepository.getVersionForTask(task.id, actorId) : null,
      context: this.generationRepository.getContextReferences(task.id, actorId) };

    const runner = this.runnerFactory(configuration);
    const validate = (output: unknown) => task.provider === SAFETY_PROVIDER
      ? deterministicEvidenceUnavailableOutput(intent) : validateArticleGeneration(output, context, intent);
    const finishedTask = await runner.run(task, input, validate, (output) => {
      const validated = output as ArticleGenerationOutput;
      this.generationRepository.persistVersion(task.id, articleId, actorId, validated);
    });
    return { task: finishedTask, version: finishedTask.status === "completed" ? this.generationRepository.getVersionForTask(task.id, actorId) : null,
      context: this.generationRepository.getContextReferences(task.id, actorId) };
  }

  getTask(taskId: string, actorId: string): ArticleGenerationTaskResult | null {
    const task = this.taskRepository.getByActorAndId(taskId, actorId);
    if (!task || task.taskType !== "article_generation") return null;
    return { task, version: task.status === "completed" ? this.generationRepository.getVersionForTask(task.id, actorId) : null,
      context: this.generationRepository.getContextReferences(task.id, actorId) };
  }

  listVersions(articleId: string, actorId: string): GeneratedArticleVersion[] { return this.generationRepository.listVersions(articleId, actorId); }
  getVersion(articleId: string, generationId: string, actorId: string): GeneratedArticleVersion | null {
    return this.generationRepository.getVersion(articleId, generationId, actorId);
  }

  getWorkflowState(articleId: string, actorId: string): AiArticleWorkflowState {
    const articleExists = this.taskRepository.articleExists(articleId);
    if (!articleExists) return { articleExists: false, storyUnderstanding: null, research: null };
    const story = this.db.prepare(`SELECT t.id AS task_id, t.status FROM ai_tasks t JOIN ai_generations g ON g.task_id=t.id
      WHERE t.news_article_id=? AND t.actor_id=? AND t.task_type='story_understanding' AND t.status='completed'
      ORDER BY g.created_at DESC LIMIT 1`).get(articleId, actorId) as any;
    const research = this.db.prepare(`SELECT t.id AS task_id, t.status, s.id AS session_id, s.status AS session_status
      FROM ai_tasks t LEFT JOIN ai_research_sessions s ON s.task_id=t.id
      WHERE t.news_article_id=? AND t.actor_id=? AND t.task_type='research'
      ORDER BY t.created_at DESC LIMIT 1`).get(articleId, actorId) as any;
    return {
      articleExists: true,
      storyUnderstanding: story ? { taskId: story.task_id, status: story.status } : null,
      research: research ? { taskId: research.task_id, sessionId: research.session_id ?? null, status: research.status, sessionStatus: research.session_status ?? null } : null
    };
  }

  private assembleContext(articleId: string, actorId: string): ArticleGenerationContext {
    const article = this.canonicalArticles.getArticleById(articleId);
    if (!article) throw new Error("generation_article_not_found");
    const story = this.claims.latestStoryUnderstanding(articleId, actorId);
    if (!story) throw new Error("generation_story_understanding_not_found");
    const sessionRow = this.db.prepare(`SELECT s.id AS session_id, s.task_id, s.status, s.article_id FROM ai_research_sessions s
      JOIN ai_tasks t ON t.id=s.task_id WHERE s.article_id=? AND s.actor_id=? AND t.actor_id=? AND t.task_type='research' AND t.status='completed'
      AND s.status IN ('completed','completed_with_source_failures') ORDER BY COALESCE(s.completed_at,s.created_at) DESC LIMIT 1`).get(articleId, actorId, actorId) as any;
    if (!sessionRow) throw new Error("generation_research_session_not_found");
    const researchData = this.research.getForActor(sessionRow.task_id, actorId) as any;
    if (!researchData?.session || researchData.session.id !== sessionRow.session_id || researchData.session.articleId !== articleId) throw new Error("generation_research_session_not_found");

    const allEvidence = (researchData.evidence as any[]).filter((item) => typeof item.text === "string" && item.text.trim());
    const sourceById = new Map((researchData.sources as any[]).filter((source) => source.retrievalStatus === "retrieved").map((source) => [source.id, source]));
    const evidence: GenerationEvidence[] = []; let evidenceChars = 0;
    for (const item of allEvidence) {
      const source = sourceById.get(item.sourceId) as any; if (!source || evidence.length >= 120) continue;
      const text = String(item.text).slice(0, 2200); if (evidenceChars + text.length > 90_000) continue;
      evidenceChars += text.length;
      evidence.push({ id: item.id, sourceId: item.sourceId, sourceUrl: String(source.url ?? "").slice(0, 1000), canonicalUrl: String(source.canonicalUrl ?? "").slice(0, 1000),
        sourceTitle: typeof source.title === "string" ? source.title.slice(0, 300) : null, publisher: typeof source.publisher === "string" ? source.publisher.slice(0, 200) : null,
        sourceType: String(source.sourceType ?? "other"), publishedAt: source.publishedAt ?? null, retrievedAt: source.retrievedAt ?? null,
        contentHash: source.contentHash ?? null, text, location: item.location });
    }
    const durableClaims = this.claims.getClaimsForResearchTask(sessionRow.task_id, actorId) ?? [];
    const claims: GenerationClaim[] = [];
    for (const durable of durableClaims.slice(0, 100)) {
      const details = this.claims.getClaimDetails(durable.id, actorId) as any;
      const assessments = (details?.assessments ?? []).filter((assessment: any) => assessment.researchSessionId === sessionRow.session_id).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const latest = assessments[0];
      const status = latest?.status ?? "unresolved";
      const temporalStatus = latest?.temporalStatus ?? "uncertain";
      const validStatus = ["supported", "contradicted", "insufficient_evidence", "conflicting_sources", "unresolved"].includes(status) ? status : "unresolved";
      const relationships = (latest?.relationships ?? []).filter((relationship: any) => evidence.some((item) => item.id === relationship.evidenceId)).map((relationship: any) => ({
        evidenceId: relationship.evidenceId, relationshipType: relationship.relationshipType, directness: relationship.directness, explanation: String(relationship.explanation ?? "").slice(0, 500)
      }));
      claims.push({ ...durable, text: durable.text.slice(0, 3000), subjectEntities: durable.subjectEntities.slice(0, 20), temporalContext: durable.temporalContext.slice(0, 20),
        verificationStatus: validStatus as GenerationClaim["verificationStatus"], assessmentId: latest?.id ?? null, temporalStatus,
        temporalWarnings: Array.isArray(latest?.temporalWarnings) ? latest.temporalWarnings.slice(0, 20) : ["verification_assessment_unavailable"], relationships });
    }
    const storyJson = JSON.stringify(story.output);
    if (Buffer.byteLength(storyJson, "utf8") > 50_000) throw new Error("generation_story_context_too_large");
    const storyOutput = story.output;
    const canonicalArticle = { id: article.id, title: article.title.slice(0, 500), summary: article.summary?.slice(0, 1500) ?? null,
      body: article.body?.slice(0, 8000) ?? null, sourceName: article.sourceName?.slice(0, 200) ?? null, sourceUrl: article.sourceUrl?.slice(0, 1000) ?? null,
      publishedAt: article.publishedAt ?? null, status: article.status };
    return { article: canonicalArticle, storyUnderstanding: { taskId: story.taskId, generationId: story.generationId, output: storyOutput },
      research: { taskId: sessionRow.task_id, sessionId: sessionRow.session_id, status: researchData.session.status }, claims, evidence,
      sourceIds: [...new Set(evidence.map((item) => item.sourceId))] };
  }
}

export function parseArticleGenerationIntent(value: unknown): { articleId: string; intent: ArticleGenerationIntent; correlationId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("generation_request_invalid");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["articleId", "articleType", "editorInstruction", "requestedLength", "tone", "headlineOptions", "promptVersion", "correlationId"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || typeof body.articleId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.articleId)) throw new Error("generation_request_invalid");
  const articleType = body.articleType ?? "news_report";
  if (typeof articleType !== "string" || !(ARTICLE_GENERATION_TYPES as readonly string[]).includes(articleType)) throw new Error("generation_article_type_invalid");
  if (body.promptVersion != null && body.promptVersion !== ARTICLE_GENERATION_PROMPT_VERSION) throw new Error("generation_prompt_version_invalid");
  if (body.editorInstruction != null && (typeof body.editorInstruction !== "string" || body.editorInstruction.trim().length > 2000)) throw new Error("generation_instruction_invalid");
  if (body.requestedLength != null && (!Number.isInteger(body.requestedLength) || Number(body.requestedLength) < 50 || Number(body.requestedLength) > 2000)) throw new Error("generation_length_invalid");
  const tone = body.tone ?? "neutral";
  if (typeof tone !== "string" || !["neutral", "conversational", "formal", "analytical"].includes(tone)) throw new Error("generation_tone_invalid");
  const headlineOptions = body.headlineOptions ?? 0;
  if (!Number.isInteger(headlineOptions) || Number(headlineOptions) < 0 || Number(headlineOptions) > 5) throw new Error("generation_headline_options_invalid");
  if (body.correlationId != null && (typeof body.correlationId !== "string" || body.correlationId.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(body.correlationId))) throw new Error("generation_correlation_invalid");
  return { articleId: body.articleId, intent: { articleType: articleType as ArticleGenerationIntent["articleType"],
    editorInstruction: typeof body.editorInstruction === "string" ? body.editorInstruction.trim() || null : null,
    requestedLength: body.requestedLength as number | null ?? null, tone, headlineOptions: headlineOptions as number }, correlationId: body.correlationId as string | undefined };
}

export function createArticleGenerationRunner(repository: AiNewsTaskRepository, configuration: AiProviderConfiguration, injectedProvider?: AiTaskProviderAdapter): AiNewsTaskRunner {
  const registry = createAiTaskProviderRegistry([new DeterministicSafetyProvider(), ...(injectedProvider ? [injectedProvider] : [])]);
  return new AiNewsTaskRunner(repository, registry, configuration);
}

function contextReferences(context: ArticleGenerationContext): GenerationContextReference[] {
  const result: GenerationContextReference[] = [{ contextType: "story_generation", contextId: context.storyUnderstanding.generationId },
    { contextType: "research_task", contextId: context.research.taskId }, { contextType: "research_session", contextId: context.research.sessionId }];
  for (const id of context.sourceIds) result.push({ contextType: "source", contextId: id });
  for (const item of context.evidence) result.push({ contextType: "evidence", contextId: item.id });
  for (const claim of context.claims) { result.push({ contextType: "claim", contextId: claim.id }); if (claim.assessmentId) result.push({ contextType: "verification_assessment", contextId: claim.assessmentId }); }
  return result;
}
