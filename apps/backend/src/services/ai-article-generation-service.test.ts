import assert from "node:assert/strict";
import { DatabaseSync, allowSqliteInstantiation } from "../db/sqlite.js";
import test from "node:test";
import type { NewsArticle } from "@gito/shared";
import { readAiNewsSchema } from "../db/schema.js";
import { AiArticleGenerationRepository } from "../repositories/ai-article-generation-repository.js";
import { AiClaimRepository } from "../repositories/ai-claim-repository.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import { AiNewsTaskRunner, AiTaskProviderRegistry, type AiProviderConfiguration, type AiTaskProviderAdapter } from "./ai-news-provider.js";
import { ClaimVerificationService } from "./claim-verification-service.js";
import { CLAIM_VERIFICATION_PROMPT_VERSION } from "./claim-verification-contract.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { AiArticleGenerationService, createArticleGenerationRunner, parseArticleGenerationIntent } from "./ai-article-generation-service.js";
import { ARTICLE_GENERATION_PROMPT_VERSION, validateArticleGeneration, type ArticleGenerationContext, type ArticleGenerationIntent } from "./article-generation-contract.js";

const providerConfig: AiProviderConfiguration = { provider: "mock-article-provider", model: "mock-article-v1", baseUrl: "", apiKey: "test-only" };
const articleId = "article-generation-test";
const article = { id: articleId, title: "Harbor FC confirms venue update", slug: "harbor-venue", summary: "Canonical summary", body: "Canonical body remains unchanged.",
  bodyBlocks: [], status: "draft", sportId: null, competitionId: null, teamId: null, countryId: null, matchId: null, sourceId: null, sourceName: "Harbor FC", sourceUrl: null,
  externalId: null, author: null, categories: [], tags: [], contentAvailability: null, contentOrigin: "manual", fetchedBody: null, fetchedAt: null, fetchStatus: null, fetchError: null,
  createdBy: "operator-1", publishedAt: null, createdAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z", sport: null, competition: null, team: null, country: null,
  match: null, source: null, media: [], links: [], audit: [] } as NewsArticle;
const claimText = "Harbor FC confirmed a new training venue.";
const evidenceText = "Harbor FC confirmed a new training venue in a club statement.";

async function setup(options: { evidence?: boolean; verificationStatus?: string } = {}) {
  const db = allowSqliteInstantiation(() => new DatabaseSync(":memory:")); db.exec("PRAGMA foreign_keys=ON;");
  (db as any).transaction = (callback: () => unknown) => () => { db.exec("BEGIN IMMEDIATE;"); try { const result = callback(); db.exec("COMMIT;"); return result; } catch (error) { db.exec("ROLLBACK;"); throw error; } };
  db.exec("CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT, summary TEXT, body TEXT, status TEXT, published_at TEXT); INSERT INTO news_articles VALUES ('article-generation-test','Harbor FC confirms venue update','Canonical summary','Canonical body remains unchanged.','draft',NULL);");
  db.exec(readAiNewsSchema());
  const tasks = new AiNewsTaskRepository(db as any); const taskService = new AiNewsTaskService(tasks);
  const storyTask = taskService.create({ taskType: "story_understanding", articleId, promptVersion: "story-understanding-v1" }, "operator-1", providerConfig);
  tasks.start(storyTask.id); tasks.complete(storyTask.id, { schemaVersion: "story-understanding-v1", keyClaims: [{ text: claimText, claimType: "event", sourceContext: claimText, referencedEntities: ["Harbor FC"], extractionConfidence: 0.9 }], timeReferences: [], uncertainty: {} });
  const researchTask = taskService.create({ taskType: "research", articleId, promptVersion: "research-v1" }, "operator-1", providerConfig);
  tasks.start(researchTask.id); tasks.complete(researchTask.id, { schemaVersion: "research-v1" });
  const research = new AiResearchRepository(db as any);
  const sessionId = research.createSession({ taskId: researchTask.id, articleId, actorId: "operator-1", correlationId: researchTask.correlationId,
    promptVersion: "research-v1", querySummary: "venue", discoveryProvider: "mock-search", retrievalProvider: "mock-http" });
  research.finishSession(sessionId, "completed");
  let evidenceId: string | null = null;
  if (options.evidence !== false) {
    const sourceId = research.upsertSource({ sessionId, url: "https://club.example/news", canonicalUrl: "https://club.example/news", title: "Club venue statement", publisher: "Harbor FC", author: null,
      publishedAt: "2026-09-30T10:00:00.000Z", discoveredAt: "2026-09-30T10:00:00.000Z", retrievedAt: "2026-09-30T10:00:00.000Z", httpStatus: 200, contentType: "text/html",
      sourceType: "official", retrievalStatus: "retrieved", contentHash: "venue-hash", snapshotText: evidenceText, discoveryProvider: "mock-search", retrievalProvider: "mock-http", retrievalMetadata: {}, errorCode: null, errorMessage: null });
    evidenceId = research.addEvidence({ sessionId, sourceId, text: evidenceText, paragraphIndex: 0, characterStart: 0, characterEnd: evidenceText.length, evidenceType: "source_statement" });
  }
  const claims = new AiClaimRepository(db as any);
  const durableClaim = claims.extractFromStory(articleId, sessionId, storyTask.id, String((db.prepare("SELECT id FROM ai_generations WHERE task_id=?").get(storyTask.id) as any).id), { keyClaims: [{ text: claimText, claimType: "event", sourceContext: claimText, referencedEntities: ["Harbor FC"], extractionConfidence: 0.9 }], timeReferences: [] })[0]!;
  if (options.verificationStatus && evidenceId) {
    const verifyProvider: AiTaskProviderAdapter = { provider: "mock-verifier", capabilities: { "text-generation": true, "structured-output": true }, async execute() { return { output: { schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: durableClaim.id,
      status: options.verificationStatus, explanation: "The stored passage supplies this assessment.", confidence: 0.8,
      relationships: [{ evidenceId, relationshipType: options.verificationStatus === "contradicted" ? "contradicting" : "supporting", directness: "direct", confidence: 0.8, explanation: "Stored evidence relationship." }] } }; } };
    const verifyService = new ClaimVerificationService(db as any, tasks, taskService, (config) => { const registry = new AiTaskProviderRegistry(); registry.register(verifyProvider); return new AiNewsTaskRunner(tasks, registry, config); }, { ...providerConfig, provider: "mock-verifier" });
    await verifyService.verify(durableClaim.id, researchTask.id, "operator-1", "editor", { idempotencyKey: "verify-phase5" });
  }
  const generationRepo = new AiArticleGenerationRepository(db as any);
  const canonicalReader = { getArticleById: (id: string) => id === articleId ? article : null };
  return { db, tasks, taskService, researchTask, durableClaim, evidenceId, generationRepo, canonicalReader };
}

function draftFromInput(input: any) {
  const context = input.generationContext as ArticleGenerationContext;
  const intent = input.intent as ArticleGenerationIntent;
  const claim = context.claims[0]!; const evidence = context.evidence[0]!;
  const paragraph = "Harbor FC confirmed a new training venue, according to the retrieved club statement.";
  const unit = (text: string) => ({ text, claimIds: [claim.id], evidenceIds: [evidence.id], framing: "asserted" });
  const body = paragraph;
  return { schemaVersion: ARTICLE_GENERATION_PROMPT_VERSION, articleType: intent.articleType, headline: "Harbor FC confirms new training venue",
    summary: "Harbor FC confirmed a new training venue, according to a club statement.", body,
    headlineBasis: unit("Harbor FC confirms new training venue"), summaryBasis: unit("Harbor FC confirmed a new training venue, according to a club statement."), headlineAlternatives: [],
    sections: [{ heading: "", headingBasis: { text: "", claimIds: [], evidenceIds: [], framing: "uncertain" }, paragraphs: [unit(paragraph)] }], usedClaims: [claim.id], usedEvidence: [evidence.id], uncertainties: [], editorialNotes: [], tone: intent.tone,
    requestedLength: intent.requestedLength, wordCount: body.split(/\s+/).length };
}

test("generation assembles server-owned context, persists a review version, preserves history and canonical article", async () => {
  const fixture = await setup({ verificationStatus: "supported" });
  const provider: AiTaskProviderAdapter = { provider: providerConfig.provider, capabilities: { "text-generation": true, "structured-output": true }, async execute(request) { assert.equal(request.taskType, "article_generation"); return { output: draftFromInput(request.input) }; } };
  const service = new AiArticleGenerationService(fixture.db as any, fixture.tasks, fixture.taskService,
    (config) => createArticleGenerationRunner(fixture.tasks, config, provider), providerConfig, fixture.canonicalReader);
  const workflowState = service.getWorkflowState(articleId, "operator-1");
  assert.equal(workflowState.articleExists, true);
  assert.equal(workflowState.storyUnderstanding?.status, "completed");
  assert.equal(workflowState.research?.taskId, fixture.researchTask.id);
  const otherOperatorState = service.getWorkflowState(articleId, "operator-2");
  assert.equal(otherOperatorState.research, null);
  assert.equal(otherOperatorState.storyUnderstanding, null);
  const intent = parseArticleGenerationIntent({ articleId, articleType: "news_report", editorInstruction: "Keep the tone measured.", tone: "formal", headlineOptions: 0 }).intent;
  const first = await service.generate(articleId, "operator-1", "editor", intent, { idempotencyKey: "generation-one" });
  assert.equal(first.task.taskType, "article_generation"); assert.equal(first.version?.reviewState, "needs_review"); assert.equal(first.version?.output.factCheckRequired, false);
  assert.equal(fixture.generationRepo.getRequestForTask(first.task.id, "operator-1")?.editorInstruction, "Keep the tone measured.");
  assert.ok(first.context.some((ref) => ref.contextType === "claim" && ref.contextId === fixture.durableClaim.id));
  assert.ok(first.context.some((ref) => ref.contextType === "evidence" && ref.contextId === fixture.evidenceId));
  assert.ok(first.context.some((ref) => ref.contextType === "verification_assessment"));
  const replay = await service.generate(articleId, "operator-1", "editor", intent, { idempotencyKey: "generation-one" });
  assert.equal(replay.task.id, first.task.id); assert.equal(replay.version?.id, first.version?.id);
  const second = await service.generate(articleId, "operator-1", "editor", intent, { idempotencyKey: "generation-two" });
  assert.notEqual(second.version?.id, first.version?.id); assert.equal(service.listVersions(articleId, "operator-1").length, 2);
  assert.equal(service.getTask(first.task.id, "operator-2"), null); assert.equal(service.listVersions(articleId, "operator-2").length, 0);
  assert.deepEqual({ ...fixture.db.prepare("SELECT title,summary,body,status,published_at FROM news_articles WHERE id=?").get(articleId) as object },
    { title: "Harbor FC confirms venue update", summary: "Canonical summary", body: "Canonical body remains unchanged.", status: "draft", published_at: null });
  fixture.db.close();
});

test("workflow state and generation use only the authenticated operator's Story Understanding", async () => {
  const fixture = await setup();
  const service = new AiArticleGenerationService(fixture.db as any, fixture.tasks, fixture.taskService,
    (config) => createArticleGenerationRunner(fixture.tasks, config), providerConfig, fixture.canonicalReader);

  assert.equal(service.getWorkflowState(articleId, "operator-2").storyUnderstanding, null);
  const intent = parseArticleGenerationIntent({ articleId }).intent;
  await assert.rejects(
    () => service.generate(articleId, "operator-2", "editor", intent, { idempotencyKey: "operator-two-without-story" }),
    /generation_story_understanding_not_found/
  );

  const ownStory = fixture.taskService.create({ taskType: "story_understanding", articleId, promptVersion: "story-understanding-v1" }, "operator-2", providerConfig);
  fixture.tasks.start(ownStory.id);
  fixture.tasks.complete(ownStory.id, { schemaVersion: "story-understanding-v1", keyClaims: [], timeReferences: [], uncertainty: {} });
  const ownResearch = fixture.taskService.create({ taskType: "research", articleId, promptVersion: "research-v1" }, "operator-2", providerConfig);
  fixture.tasks.start(ownResearch.id);
  fixture.tasks.complete(ownResearch.id, { schemaVersion: "research-v1" });
  const researchRepository = new AiResearchRepository(fixture.db as any);
  const ownSession = researchRepository.createSession({ taskId: ownResearch.id, articleId, actorId: "operator-2", correlationId: ownResearch.correlationId,
    promptVersion: "research-v1", querySummary: "operator two context", discoveryProvider: "mock", retrievalProvider: "mock" });
  researchRepository.finishSession(ownSession, "completed");

  const result = await service.generate(articleId, "operator-2", "editor", intent, { idempotencyKey: "operator-two-own-context" });
  assert.equal(result.task.status, "completed");
  assert.ok(result.context.some((reference) => reference.contextType === "story_generation" && reference.contextId === fixture.tasks.getGeneration(ownStory.id)?.id));
  assert.ok(result.context.some((reference) => reference.contextType === "research_session" && reference.contextId === ownSession));
  assert.equal(service.getWorkflowState(articleId, "operator-2").storyUnderstanding?.taskId, ownStory.id);
  assert.equal(service.getWorkflowState(articleId, "operator-1").storyUnderstanding?.taskId !== ownStory.id, true);
  fixture.db.close();
});

test("without assessed evidence generation uses a local safe draft and makes no provider call", async () => {
  const fixture = await setup({ evidence: false }); let providerCalls = 0;
  const provider: AiTaskProviderAdapter = { provider: providerConfig.provider, capabilities: { "text-generation": true, "structured-output": true }, async execute() { providerCalls++; return { output: {} }; } };
  const service = new AiArticleGenerationService(fixture.db as any, fixture.tasks, fixture.taskService,
    (config) => createArticleGenerationRunner(fixture.tasks, config, provider), providerConfig, fixture.canonicalReader);
  const intent = parseArticleGenerationIntent({ articleId }).intent;
  const result = await service.generate(articleId, "operator-1", "editor", intent, { idempotencyKey: "empty-context" });
  assert.equal(result.task.provider, "deterministic-article-safety"); assert.equal(providerCalls, 0);
  assert.equal(result.version?.output.factCheckRequired, true); assert.equal(result.version?.body, "");
  fixture.db.close();
});

test("retrieved evidence without a Phase 4 assessment cannot trigger article generation", async () => {
  const fixture = await setup(); let providerCalls = 0;
  const provider: AiTaskProviderAdapter = { provider: providerConfig.provider, capabilities: { "text-generation": true, "structured-output": true }, async execute() { providerCalls++; return { output: {} }; } };
  const service = new AiArticleGenerationService(fixture.db as any, fixture.tasks, fixture.taskService,
    (config) => createArticleGenerationRunner(fixture.tasks, config, provider), providerConfig, fixture.canonicalReader);
  const intent = parseArticleGenerationIntent({ articleId }).intent;
  const result = await service.generate(articleId, "operator-1", "editor", intent, { idempotencyKey: "unassessed-evidence" });
  assert.equal(result.task.provider, "deterministic-article-safety"); assert.equal(providerCalls, 0);
  assert.equal(result.version?.output.generationWarnings.includes("no_assessed_evidence_available"), true);
  fixture.db.close();
});

test("idempotency key reuse with different editor intent is rejected", async () => {
  const fixture = await setup({ verificationStatus: "supported" }); const provider: AiTaskProviderAdapter = { provider: providerConfig.provider, capabilities: { "text-generation": true, "structured-output": true }, async execute(request) { return { output: draftFromInput(request.input) }; } };
  const service = new AiArticleGenerationService(fixture.db as any, fixture.tasks, fixture.taskService,
    (config) => createArticleGenerationRunner(fixture.tasks, config, provider), providerConfig, fixture.canonicalReader);
  const base = parseArticleGenerationIntent({ articleId }).intent;
  await service.generate(articleId, "operator-1", "editor", base, { idempotencyKey: "intent-key" });
  const altered = parseArticleGenerationIntent({ articleId, editorInstruction: "Use a transfer angle." }).intent;
  await assert.rejects(() => service.generate(articleId, "operator-1", "editor", altered, { idempotencyKey: "intent-key" }), /ai_idempotency_conflict/);
  fixture.db.close();
});

test("output validator rejects invalid IDs, unsupported claims, fabricated quotes and unsupported numbers", async () => {
  const fixture = await setup({ verificationStatus: "supported" });
  const claim = { ...fixture.durableClaim, verificationStatus: "supported", assessmentId: "assessment-1", temporalStatus: "applicable", temporalWarnings: [],
    relationships: [{ evidenceId: fixture.evidenceId, relationshipType: "supporting", directness: "direct", explanation: "supported" }] } as any;
  const context = { article: { id: articleId, title: "", summary: null, body: null, sourceName: null, sourceUrl: null, publishedAt: null, status: "draft" },
    storyUnderstanding: { taskId: "story", generationId: "story-generation", output: {} }, research: { taskId: "research", sessionId: "session", status: "completed" }, claims: [claim],
    evidence: [{ id: fixture.evidenceId, sourceId: "source", sourceUrl: "https://club.example/news", canonicalUrl: "https://club.example/news", sourceTitle: "Club", publisher: "Club", sourceType: "official", publishedAt: null, retrievedAt: null, contentHash: "hash", text: evidenceText, location: null }], sourceIds: ["source"] } as ArticleGenerationContext;
  const intent = parseArticleGenerationIntent({ articleId }).intent; const valid = draftFromInput({ generationContext: context, intent });
  const badId = structuredClone(valid); badId.usedEvidence = ["invented"]; assert.throws(() => validateArticleGeneration(badId, context, intent));
  const badQuote = structuredClone(valid); badQuote.sections[0]!.paragraphs[0]!.text = 'The club said "a different fabricated quote".'; badQuote.body = badQuote.sections[0]!.paragraphs[0]!.text; assert.throws(() => validateArticleGeneration(badQuote, context, intent), /generation_quote_unsupported/);
  const badNumber = structuredClone(valid); badNumber.sections[0]!.paragraphs[0]!.text = "The venue is 99 miles away."; badNumber.body = badNumber.sections[0]!.paragraphs[0]!.text; assert.throws(() => validateArticleGeneration(badNumber, context, intent), /number_unsupported/);
  const unresolved = structuredClone(context); unresolved.claims[0]!.verificationStatus = "unresolved";
  assert.throws(() => validateArticleGeneration(valid, unresolved, intent), /generation_headline_basis_unsupported_claim_asserted/);
  const temporal = structuredClone(context); temporal.claims[0]!.temporalStatus = "uncertain";
  assert.throws(() => validateArticleGeneration(valid, temporal, intent), /generation_headline_basis_unsupported_claim_asserted/);
  fixture.db.close();
});

test("contradicted claims require evidence attribution and conflicting claims cannot use one-sided attributed copy", async () => {
  const fixture = await setup();
  const evidenceId = fixture.evidenceId!;
  const evidence = { id: evidenceId, sourceId: "source", sourceUrl: "https://club.example/news", canonicalUrl: "https://club.example/news", sourceTitle: "Club", publisher: "Club", sourceType: "official", publishedAt: null, retrievedAt: null, contentHash: "hash", text: evidenceText, location: null };
  const base = { article: { id: articleId, title: "", summary: null, body: null, sourceName: null, sourceUrl: null, publishedAt: null, status: "draft" },
    storyUnderstanding: { taskId: "story", generationId: "story-generation", output: {} }, research: { taskId: "research", sessionId: "session", status: "completed" }, evidence: [evidence], sourceIds: ["source"] };
  const intent = parseArticleGenerationIntent({ articleId }).intent;
  const contradicted = { ...fixture.durableClaim, verificationStatus: "contradicted", assessmentId: "assessment", temporalStatus: "applicable", temporalWarnings: [],
    relationships: [{ evidenceId, relationshipType: "contradicting", directness: "direct", explanation: "Opposes the claim." }] } as any;
  const contradictedContext = { ...base, claims: [contradicted] } as ArticleGenerationContext;
  const oneSided = draftFromInput({ generationContext: contradictedContext, intent });
  oneSided.headlineBasis.framing = "attributed"; oneSided.summaryBasis.framing = "attributed"; oneSided.sections[0]!.paragraphs[0]!.framing = "attributed";
  oneSided.uncertainties = [{ claimId: contradicted.id, reason: "The evidence contradicts this claim." }];
  assert.throws(() => validateArticleGeneration(oneSided, contradictedContext, intent), /generation_headline_basis_attribution_language_missing/);

  const conflicting = { ...fixture.durableClaim, verificationStatus: "conflicting_sources", assessmentId: "assessment-conflict", temporalStatus: "applicable", temporalWarnings: [],
    relationships: [{ evidenceId, relationshipType: "supporting", directness: "direct", explanation: "Supports." }] } as any;
  const conflictContext = { ...base, claims: [conflicting] } as ArticleGenerationContext;
  const attributed = draftFromInput({ generationContext: conflictContext, intent });
  attributed.headlineBasis.framing = "attributed"; attributed.summaryBasis.framing = "attributed"; attributed.sections[0]!.paragraphs[0]!.framing = "attributed";
  attributed.uncertainties = [{ claimId: conflicting.id, reason: "The assessment reports conflicting evidence." }];
  assert.throws(() => validateArticleGeneration(attributed, conflictContext, intent), /generation_headline_basis_conflict_silently_resolved/);
  fixture.db.close();
});

test("request parser rejects client supplied evidence and unsupported generation intent", () => {
  assert.throws(() => parseArticleGenerationIntent({ articleId, evidence: [{ id: "fake" }] }), /generation_request_invalid/);
  assert.throws(() => parseArticleGenerationIntent({ articleId, articleType: "automatic_publish" }), /generation_article_type_invalid/);
  assert.throws(() => parseArticleGenerationIntent({ articleId, requestedLength: 99999 }), /generation_length_invalid/);
  assert.throws(() => parseArticleGenerationIntent({ articleId, promptVersion: "untrusted-prompt" }), /generation_prompt_version_invalid/);
});
