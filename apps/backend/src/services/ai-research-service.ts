import { createHash } from "node:crypto";
import type { AiNewsTask, NewsArticle } from "@gito/shared";
import type { DatabaseSync } from "../db/sqlite.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import type { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { normalizeNewsText } from "./news-content-normalizer.js";
import { fetchPublicTextDocumentDetailed, validateRssUrl } from "./news-rss-service.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { AiNewsTaskRunner, AiTaskProviderRegistry, type AiProviderConfiguration, type AiProviderTaskRequest, type AiTaskProviderAdapter } from "./ai-news-provider.js";

export const RESEARCH_PROMPT_VERSION = "research-v1";
export const RESEARCH_RETRIEVAL_PROVIDER = "safe-http-text-v1";
export const RESEARCH_DISCOVERY_PROVIDER = "canonical-context-v1";
const SNAPSHOT_MAX_CHARS = 200_000;
const MAX_EVIDENCE_ITEMS = 20;

export interface ResearchCandidate { url: string; sourceType?: "official" | "primary" | "news" | "interview" | "database" | "social" | "reference" | "unknown" }
export interface ResearchDiscoveryRequest { query: string; article: NewsArticle; storyUnderstanding: Record<string, any> }
export interface ResearchDiscoveryProvider { readonly name: string; discover(request: ResearchDiscoveryRequest): Promise<ResearchCandidate[]> }
export interface RetrievedResearchSource {
  url: string; canonicalUrl: string; title: string | null; publisher: string | null; author: string | null; publishedAt: string | null;
  httpStatus: number | null; contentType: string | null; retrievedAt: string; snapshotText: string; contentHash: string;
  metadata: Record<string, unknown>;
}
export interface ResearchSourceRetriever { readonly name: string; retrieve(url: string): Promise<RetrievedResearchSource> }

/** No search vendor is configured in Phase 3. The default discovery provider uses
 * only the known source URL on this canonical article; deployments may inject a
 * search provider implementing this same boundary. */
export class CanonicalContextDiscoveryProvider implements ResearchDiscoveryProvider {
  readonly name = RESEARCH_DISCOVERY_PROVIDER;
  async discover(request: ResearchDiscoveryRequest): Promise<ResearchCandidate[]> {
    const url = request.article.sourceUrl;
    return url ? [{ url, sourceType: "unknown" }] : [];
  }
}

function safeCanonicalUrl(value: string): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("research_url_invalid");
  const url = validateRssUrl(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|.*(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|signature|session)).*$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

function boundedMetadata(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength) || null;
}

function extractMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*content=["']([^"']*)["'][^>]*>|<meta\\b(?=[^>]*content=["']([^"']*)["'])[^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i");
  const match = html.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseDate(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export class SafeWebpageResearchRetriever implements ResearchSourceRetriever {
  readonly name = RESEARCH_RETRIEVAL_PROVIDER;
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async retrieve(inputUrl: string): Promise<RetrievedResearchSource> {
    const safeUrl = safeCanonicalUrl(inputUrl);
    const page = await fetchPublicTextDocumentDetailed(safeUrl, undefined, this.fetcher);
    const title = boundedMetadata(normalizeNewsText(page.text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? extractMeta(page.text, "og:title")), 500);
    const publisher = boundedMetadata(normalizeNewsText(extractMeta(page.text, "og:site_name") ?? extractMeta(page.text, "publisher")), 300);
    const author = boundedMetadata(normalizeNewsText(extractMeta(page.text, "author") ?? extractMeta(page.text, "article:author")), 300);
    const publishedAt = parseDate(extractMeta(page.text, "article:published_time") ?? extractMeta(page.text, "datePublished"));
    const plainText = normalizeNewsText(page.text).slice(0, SNAPSHOT_MAX_CHARS);
    const canonicalLink = page.text.match(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const finalUrl = safeCanonicalUrl(page.finalUrl);
    let canonicalUrl = finalUrl;
    if (canonicalLink) {
      try { canonicalUrl = safeCanonicalUrl(new URL(canonicalLink, page.finalUrl).toString()); } catch { /* retain the safe final URL */ }
    }
    return { url: safeUrl, canonicalUrl, title, publisher, author, publishedAt, httpStatus: page.status, contentType: page.contentType.slice(0, 250) || null,
      retrievedAt: new Date().toISOString(), snapshotText: plainText, contentHash: createHash("sha256").update(plainText).digest("hex"),
      metadata: { finalUrl, snapshotTruncated: normalizeNewsText(page.text).length > SNAPSHOT_MAX_CHARS } };
  }
}

export interface ResearchServiceResult { task: unknown; result: unknown; session: Record<string, unknown> | null }

class PersistedResearchOutputProvider implements AiTaskProviderAdapter {
  readonly provider = "deterministic-research";
  readonly capabilities = { "text-generation": true, "structured-output": true } as const;
  async execute(request: AiProviderTaskRequest): Promise<{ output: unknown }> {
    return { output: (request.input as { output: unknown }).output };
  }
}

export function createResearchTaskRunner(taskRepository: AiNewsTaskRepository, config?: AiProviderConfiguration): { runner: AiNewsTaskRunner; configuration: AiProviderConfiguration } {
  const configuration = config ?? { provider: "deterministic-research", model: "research-pipeline-v1", baseUrl: "", apiKey: "" };
  const registry = new AiTaskProviderRegistry(); registry.register(new PersistedResearchOutputProvider());
  return { runner: new AiNewsTaskRunner(taskRepository, registry, configuration), configuration };
}

function buildResearchQuery(article: NewsArticle, understanding: Record<string, any>): string {
  const fields = [understanding.subject?.primaryTopic, understanding.event?.description,
    ...(understanding.entities ?? []).map((entity: any) => entity.name), ...(understanding.timeReferences ?? []).map((entry: any) => entry.text),
    ...(understanding.uncertainty?.unresolvedEntities ?? []), ...(understanding.keyClaims ?? []).map((claim: any) => claim.text)];
  const unique = [...new Set(fields.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))];
  return unique.join(" · ").slice(0, 2000) || article.summary || article.title;
}

function extractEvidence(snapshot: string): Array<{ text: string; paragraphIndex: number; characterStart: number; characterEnd: number }> {
  const evidence: Array<{ text: string; paragraphIndex: number; characterStart: number; characterEnd: number }> = [];
  let cursor = 0;
  for (const [paragraphIndex, paragraph] of snapshot.split(/\n{2,}/).entries()) {
    const paragraphStart = snapshot.indexOf(paragraph, cursor); cursor = paragraphStart + paragraph.length;
    const leadingWhitespace = paragraph.length - paragraph.trimStart().length;
    const text = paragraph.trim(); if (text.length < 40) continue;
    const start = paragraphStart + leadingWhitespace;
    evidence.push({ text: text.slice(0, 2000), paragraphIndex, characterStart: start, characterEnd: start + Math.min(text.length, 2000) });
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
  }
  return evidence;
}

function validateResearchOutput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("research_output_invalid");
  const output = value as Record<string, unknown>;
  const keys = ["schemaVersion", "sessionId", "articleId", "status", "sourceIds", "retrievedSourceIds", "failedSourceIds", "evidenceIds", "discoveryErrors", "evidenceErrors"];
  if (Object.keys(output).length !== keys.length || Object.keys(output).some((key) => !keys.includes(key))) throw new Error("research_output_invalid");
  if (output.schemaVersion !== RESEARCH_PROMPT_VERSION || typeof output.sessionId !== "string" || typeof output.articleId !== "string" || !["completed", "completed_with_source_failures"].includes(String(output.status))) throw new Error("research_output_invalid");
  for (const key of ["sourceIds", "retrievedSourceIds", "failedSourceIds", "evidenceIds", "discoveryErrors", "evidenceErrors"]) {
    if (!Array.isArray(output[key]) || (output[key] as unknown[]).length > 500 || (output[key] as unknown[]).some((item) => typeof item !== "string" || item.length > 200)) throw new Error("research_output_invalid");
  }
  if (JSON.stringify(output).toLowerCase().includes("verificationstatus") || JSON.stringify(output).toLowerCase().includes("verified")) throw new Error("research_output_invalid");
  return output;
}

export class AiResearchService {
  constructor(private readonly articles: { getArticleById(id: string): NewsArticle | null }, private readonly db: DatabaseSync,
    private readonly taskRepository: AiNewsTaskRepository, private readonly taskService: AiNewsTaskService, private readonly runner: AiNewsTaskRunner,
    private readonly configuration: AiProviderConfiguration, private readonly discovery: ResearchDiscoveryProvider = new CanonicalContextDiscoveryProvider(),
    private readonly retriever: ResearchSourceRetriever = new SafeWebpageResearchRetriever()) {}

  async research(articleId: string, actorId: string, actorRole: string, request: { promptVersion: string; correlationId?: string; idempotencyKey?: string }): Promise<ResearchServiceResult> {
    if (request.promptVersion !== RESEARCH_PROMPT_VERSION) throw new Error("research_prompt_version_unsupported");
    const article = this.articles.getArticleById(articleId); if (!article) throw new Error("article_not_found");
    const repository = new AiResearchRepository(this.db);
    const understanding = repository.latestStoryUnderstanding(articleId, actorId);
    if (!understanding || typeof understanding !== "object") throw new Error("story_understanding_required");
    const story = understanding as Record<string, any>;
    const query = buildResearchQuery(article, story);
    const task = this.taskService.create({ taskType: "research", articleId, promptVersion: RESEARCH_PROMPT_VERSION,
      correlationId: request.correlationId, idempotencyKey: request.idempotencyKey }, actorId, this.configuration, actorRole);
    if (task.status !== "queued") return { task, result: task.status === "completed" ? this.taskRepository.getGeneration(task.id)?.output ?? null : null,
      session: repository.getForActor(task.id, actorId) };

    const sessionId = repository.createSession({ taskId: task.id, articleId, actorId, correlationId: task.correlationId,
      promptVersion: RESEARCH_PROMPT_VERSION, querySummary: query, discoveryProvider: this.discovery.name, retrievalProvider: this.retriever.name });
    const sourceIds: string[] = []; const retrievedSourceIds: string[] = []; const failedSourceIds: string[] = []; const evidenceIds: string[] = []; const discoveryErrors: string[] = []; const evidenceErrors: string[] = [];
    let candidates: ResearchCandidate[] = [];
    try { candidates = await this.discovery.discover({ query, article, storyUnderstanding: story }); }
    catch { discoveryErrors.push("discovery_failed"); }
    const seen = new Set<string>();
    for (const candidate of candidates.slice(0, 20)) {
      if (this.taskRepository.getById(task.id)?.status === "cancelled") break;
      let canonical: string;
      try { canonical = safeCanonicalUrl(candidate.url); }
      catch {
        let rejectedUrl = "https://invalid.example/";
        try { const parsed = new URL(String(candidate.url)); if (parsed.protocol === "http:" || parsed.protocol === "https:") { parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = ""; rejectedUrl = parsed.toString().slice(0, 2000); } } catch { /* never persist an unparseable candidate verbatim */ }
        const invalidHash = createHash("sha256").update(String(candidate.url).slice(0, 4096)).digest("hex");
        const invalidId = repository.upsertSource({ sessionId, url: rejectedUrl, canonicalUrl: `blocked:${invalidHash}`, title: null, publisher: null, author: null, publishedAt: null,
          discoveredAt: new Date().toISOString(), retrievedAt: null, httpStatus: null, contentType: null, sourceType: candidate.sourceType ?? "unknown", retrievalStatus: "failed", contentHash: null,
          snapshotText: null, discoveryProvider: this.discovery.name, retrievalProvider: this.retriever.name, retrievalMetadata: {}, errorCode: "url_not_allowed", errorMessage: "Source URL is not permitted" });
        sourceIds.push(invalidId); failedSourceIds.push(invalidId); continue;
      }
      if (seen.has(canonical)) continue; seen.add(canonical);
      const discoveredAt = new Date().toISOString();
      const sourceType = ["official", "primary", "news", "interview", "database", "social", "reference", "unknown"].includes(String(candidate.sourceType)) ? candidate.sourceType ?? "unknown" : "unknown";
      const candidateSourceId = repository.upsertSource({ sessionId, url: canonical, canonicalUrl: canonical, title: null, publisher: null, author: null, publishedAt: null,
        discoveredAt, retrievedAt: null, httpStatus: null, contentType: null, sourceType, retrievalStatus: "discovered", contentHash: null,
        snapshotText: null, discoveryProvider: this.discovery.name, retrievalProvider: this.retriever.name, retrievalMetadata: {}, errorCode: null, errorMessage: null });
      sourceIds.push(candidateSourceId);
      try {
        const retrieved = await this.retriever.retrieve(canonical);
        if (this.taskRepository.getById(task.id)?.status === "cancelled") break;
        const finalCanonical = safeCanonicalUrl(retrieved.canonicalUrl);
        const retrievedRecord = { sessionId, url: canonical, canonicalUrl: finalCanonical, title: retrieved.title, publisher: retrieved.publisher,
          author: retrieved.author, publishedAt: retrieved.publishedAt, discoveredAt, retrievedAt: retrieved.retrievedAt, httpStatus: retrieved.httpStatus,
          contentType: retrieved.contentType, sourceType, retrievalStatus: "retrieved" as const, contentHash: retrieved.contentHash,
          snapshotText: retrieved.snapshotText, discoveryProvider: this.discovery.name, retrievalProvider: this.retriever.name, retrievalMetadata: retrieved.metadata, errorCode: null, errorMessage: null };
        let sourceId = candidateSourceId;
        if (!repository.updateSource(candidateSourceId, retrievedRecord)) {
          const duplicate = repository.getSourceByCanonicalUrl(sessionId, finalCanonical);
          if (!duplicate) throw new Error("research_source_identity_conflict");
          if (duplicate.id === candidateSourceId) throw new Error("research_source_identity_conflict");
          repository.deleteSource(candidateSourceId); sourceIds[sourceIds.indexOf(candidateSourceId)] = duplicate.id; sourceId = duplicate.id;
          if (duplicate.retrievalStatus === "retrieved") continue;
          if (!repository.updateSource(sourceId, retrievedRecord)) throw new Error("research_source_identity_conflict");
        }
        if (!retrievedSourceIds.includes(sourceId)) retrievedSourceIds.push(sourceId);
        try {
          for (const passage of extractEvidence(retrieved.snapshotText)) evidenceIds.push(repository.addEvidence({ sessionId, sourceId, text: passage.text,
            paragraphIndex: passage.paragraphIndex, characterStart: passage.characterStart, characterEnd: passage.characterEnd, evidenceType: "source_statement" }));
        } catch {
          evidenceErrors.push(sourceId);
          repository.markEvidenceExtractionFailure(sourceId);
        }
      } catch (error) {
        const code = error instanceof Error && /^rss_(url|redirect|fetch|content|response)/.test(error.message) ? error.message.slice(0, 80) : "source_retrieval_failed";
        const httpStatus = /^rss_fetch_failed_(\d{3})$/.exec(code)?.[1];
        repository.updateSource(candidateSourceId, { sessionId, url: canonical, canonicalUrl: canonical, title: null, publisher: null, author: null, publishedAt: null,
          discoveredAt, retrievedAt: new Date().toISOString(), httpStatus: httpStatus ? Number(httpStatus) : null, contentType: null, sourceType, retrievalStatus: "failed", contentHash: null,
          snapshotText: null, discoveryProvider: this.discovery.name, retrievalProvider: this.retriever.name, retrievalMetadata: {}, errorCode: code, errorMessage: "Source retrieval failed" });
        failedSourceIds.push(candidateSourceId);
      }
    }
    const latestTask = this.taskRepository.getById(task.id) ?? task;
    if (latestTask.status === "cancelled") return { task: latestTask, result: null, session: repository.getForActor(task.id, actorId) };
    const partial = failedSourceIds.length > 0 || discoveryErrors.length > 0 || evidenceErrors.length > 0;
    const status = partial ? "completed_with_source_failures" : "completed";
    repository.finishSession(sessionId, status, partial ? discoveryErrors[0] ?? "source_retrieval_failed" : null);
    const output = { schemaVersion: RESEARCH_PROMPT_VERSION, sessionId, articleId, status, sourceIds, retrievedSourceIds, failedSourceIds, evidenceIds, discoveryErrors, evidenceErrors };
    let completed: AiNewsTask;
    try { completed = await this.runner.run(latestTask, { output }, validateResearchOutput); }
    catch {
      const current = this.taskRepository.getById(task.id) ?? latestTask;
      if (current.status === "cancelled") return { task: current, result: null, session: repository.getForActor(task.id, actorId) };
      repository.finishSession(sessionId, "failed", "research_task_failed");
      return { task: current, result: null, session: repository.getForActor(task.id, actorId) };
    }
    if (completed.status !== "completed") repository.finishSession(sessionId, "failed", completed.failureCode ?? "research_task_failed");
    const generation = completed.status === "completed" ? this.taskRepository.getGeneration(task.id)?.output ?? null : null;
    return { task: completed, result: generation, session: repository.getForActor(task.id, actorId) };
  }

  getForActor(taskId: string, actorId: string): ResearchServiceResult | null {
    const task = this.taskRepository.getByActorAndId(taskId, actorId);
    if (!task || task.taskType !== "research") return null;
    const details = new AiResearchRepository(this.db).getForActor(taskId, actorId);
    return { task, result: task.status === "completed" ? this.taskRepository.getGeneration(taskId)?.output ?? null : null, session: details };
  }
}
