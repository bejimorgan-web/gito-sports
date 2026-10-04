import assert from "node:assert/strict";
import { DatabaseSync, allowSqliteInstantiation } from "../db/sqlite.js";
import test from "node:test";
import { readAiNewsSchema } from "../db/schema.js";
import { AiClaimRepository, type VerificationEvidence } from "../repositories/ai-claim-repository.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import { AiNewsTaskRunner, AiTaskProviderRegistry, type AiProviderConfiguration } from "./ai-news-provider.js";
import { CLAIM_VERIFICATION_PROMPT_VERSION, CLAIM_VERIFICATION_RULES_VERSION, validateVerificationResult } from "./claim-verification-contract.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { ClaimVerificationService } from "./claim-verification-service.js";

const config: AiProviderConfiguration = { provider: "mock-verifier", model: "mock-v1", baseUrl: "", apiKey: "" };
const baseClaimOutput = { claimType: "result", referencedEntities: ["Harbor FC"], sourceContext: "Harbor FC won the final 2-1.", extractionConfidence: 0.86, text: "Harbor FC won the final 2-1." };

function setup(options: { claimType?: string; temporal?: unknown[]; includeEvidence?: boolean; secondEvidence?: { text: string; hash: string; source: string; publishedAt?: string } } = {}) {
  const db = allowSqliteInstantiation(() => new DatabaseSync(":memory:")); db.exec("PRAGMA foreign_keys=ON;");
  (db as any).transaction = (callback: () => unknown) => () => { db.exec("BEGIN IMMEDIATE;"); try { const value = callback(); db.exec("COMMIT;"); return value; } catch (error) { db.exec("ROLLBACK;"); throw error; } };
  db.exec("CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT, summary TEXT, body TEXT, status TEXT, published_at TEXT); INSERT INTO news_articles VALUES ('article-1','Original title','Original summary','Original body','draft',NULL);");
  db.exec(readAiNewsSchema());
  const taskRepo = new AiNewsTaskRepository(db as any); const taskService = new AiNewsTaskService(taskRepo);
  const storyTask = taskService.create({ taskType: "story_understanding", articleId: "article-1", promptVersion: "story-understanding-v1" }, "operator-1", config);
  taskRepo.start(storyTask.id);
  const storyOutput = { schemaVersion: "story-understanding-v1", keyClaims: [{ ...baseClaimOutput, claimType: options.claimType ?? "result" }, { ...baseClaimOutput, claimType: options.claimType ?? "result" }],
    timeReferences: options.temporal ?? [], uncertainty: {} };
  taskRepo.complete(storyTask.id, storyOutput);
  const researchTask = taskService.create({ taskType: "research", articleId: "article-1", promptVersion: "research-v1" }, "operator-1", config);
  taskRepo.start(researchTask.id); taskRepo.complete(researchTask.id, { schemaVersion: "research-v1" });
  const researchRepo = new AiResearchRepository(db as any);
  const sessionId = researchRepo.createSession({ taskId: researchTask.id, articleId: "article-1", actorId: "operator-1", correlationId: researchTask.correlationId,
    promptVersion: "research-v1", querySummary: "Harbor final result", discoveryProvider: "mock", retrievalProvider: "mock" });
  researchRepo.finishSession(sessionId, "completed");
  const addSourceEvidence = (n: number, text: string, hash: string, url: string, publishedAt: string | null = "2026-09-30T10:00:00.000Z") => {
    const sourceId = researchRepo.upsertSource({ sessionId, url, canonicalUrl: url, title: `Report ${n}`, publisher: `Publisher ${n}`, author: null,
      publishedAt, discoveredAt: "2026-09-30T10:00:00.000Z", retrievedAt: "2026-09-30T10:00:00.000Z", httpStatus: 200, contentType: "text/html",
      sourceType: "news", retrievalStatus: "retrieved", contentHash: hash, snapshotText: text, discoveryProvider: "mock-search", retrievalProvider: "mock-fetch",
      retrievalMetadata: {}, errorCode: null, errorMessage: null });
    return researchRepo.addEvidence({ sessionId, sourceId, text, paragraphIndex: 0, characterStart: 0, characterEnd: text.length, evidenceType: "source_statement" });
  };
  const evidenceIds: string[] = [];
  if (options.includeEvidence !== false) evidenceIds.push(addSourceEvidence(1, "Harbor FC won the final 2-1 according to the match report.", "hash-a", "https://news.example/report"));
  if (options.secondEvidence) evidenceIds.push(addSourceEvidence(2, options.secondEvidence.text, options.secondEvidence.hash, options.secondEvidence.source, options.secondEvidence.publishedAt ?? "2026-09-29T10:00:00.000Z"));
  const claimRepo = new AiClaimRepository(db as any);
  const makeRunner = (runnerConfig: AiProviderConfiguration, getOutput: () => unknown) => {
    const registry = new AiTaskProviderRegistry();
    registry.register({ provider: runnerConfig.provider, capabilities: { "text-generation": true, "structured-output": true }, async execute(request) { assert.equal(request.taskType, "claim_verification"); return { output: getOutput() }; } });
    return new AiNewsTaskRunner(taskRepo, registry, runnerConfig);
  };
  const observedConfigurations: AiProviderConfiguration[] = [];
  const service = new ClaimVerificationService(db as any, taskRepo, taskService, (runnerConfig) => { observedConfigurations.push(runnerConfig); return makeRunner(runnerConfig, currentOutput); }, config);
  let currentOutput: () => unknown = () => ({ });
  const extracted = service.extract("article-1", researchTask.id, "operator-1");
  return { db, taskRepo, taskService, claimRepo, service, storyTask, researchTask, sessionId, evidenceIds, extracted, observedConfigurations, setOutput: (factory: () => unknown) => { currentOutput = factory; } };
}

function providerOutput(claimId: string, evidenceIds: string[], status = "supported") {
  return { schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId, status, explanation: "The linked source passage states the same match result as the claim.", confidence: 0.83,
    relationships: evidenceIds.map((evidenceId) => ({ evidenceId, relationshipType: "supporting", directness: "direct", confidence: 0.9, explanation: "The passage states the reported result." })) };
}

test("extracts stable durable claims with Story Understanding, task, generation, and research provenance", () => {
  const { db, claimRepo, extracted, researchTask, sessionId } = setup();
  assert.equal(extracted.claims.length, 1);
  const claim = extracted.claims[0]!;
  assert.equal(claim.articleId, "article-1"); assert.equal(claim.claimType, "result"); assert.equal(claim.text, baseClaimOutput.text);
  const details = claimRepo.getClaimDetails(claim.id, "operator-1") as any;
  assert.equal(details.provenance.length, 1); assert.equal(details.provenance[0].originType, "story_understanding");
  assert.equal(details.provenance[0].taskId !== null, true); assert.equal(details.provenance[0].generationId !== null, true);
  assert.equal(details.provenance[0].researchSessionId, sessionId); assert.equal(researchTask.taskType, "research");
  db.close();
});

test("persists supported assessment, evidence links, provenance, idempotency, and immutable assessment history", async () => {
  const { db, service, extracted, evidenceIds, researchTask, setOutput, taskRepo } = setup();
  const claim = extracted.claims[0]!; setOutput(() => providerOutput(claim.id, evidenceIds));
  const request = { correlationId: "verify-corr", idempotencyKey: "verify-once" };
  const first = await service.verify(claim.id, researchTask.id, "operator-1", "editor", request);
  assert.equal(first.task.taskType, "claim_verification"); assert.equal(first.task.articleId, "article-1"); assert.equal(first.task.correlationId, "verify-corr");
  assert.equal((first.assessment as any).status, "supported"); assert.equal((first.assessment as any).evidenceSetSize, 1);
  assert.equal((first.assessment as any).rulesVersion, CLAIM_VERIFICATION_RULES_VERSION); assert.equal((first.assessment as any).provider, config.provider);
  assert.equal((first.assessment as any).confidenceSemantics, "assessment_reliability_not_truth_probability");
  assert.equal((first.assessment as any).relationships[0].evidenceId, evidenceIds[0]);
  const replay = await service.verify(claim.id, researchTask.id, "operator-1", "editor", request);
  assert.equal(replay.task.id, first.task.id);
  const second = await service.verify(claim.id, researchTask.id, "operator-1", "editor", { idempotencyKey: "verify-new-evidence-set" });
  assert.notEqual(second.task.id, first.task.id);
  const details = service.getClaim(claim.id, "operator-1") as any;
  assert.equal(details.assessments.length, 2);
  assert.deepEqual({ ...db.prepare("SELECT title, summary, body, status, published_at FROM news_articles WHERE id='article-1'").get() },
    { title: "Original title", summary: "Original summary", body: "Original body", status: "draft", published_at: null });
  assert.equal(taskRepo.getGeneration(first.task.id)?.taskType, "claim_verification");
  db.close();
});

test("no evidence deterministically remains insufficient and cannot be supported", async () => {
  const { db, service, extracted, researchTask, setOutput, observedConfigurations } = setup({ includeEvidence: false });
  const claim = extracted.claims[0]!; setOutput(() => ({ schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: claim.id, status: "insufficient_evidence",
    explanation: "No retrieved evidence was available in the selected research session.", confidence: 1, relationships: [] }));
  const result = await service.verify(claim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "no-evidence" });
  assert.equal((result.assessment as any).status, "insufficient_evidence"); assert.equal((result.assessment as any).evidenceSetSize, 0);
  assert.equal(observedConfigurations[0]?.provider, "deterministic-no-evidence");
  assert.equal(observedConfigurations[0]?.model, "verification-rules-v1");
  db.close();
});

test("opposing evidence from distinct content identities is recorded as a conflict", async () => {
  const { db, service, extracted, evidenceIds, researchTask, setOutput } = setup({ secondEvidence: { text: "Harbor FC did not win the final; the opponent won 2-1.", hash: "hash-b", source: "https://other.example/report" } });
  const claim = extracted.claims[0]!;
  setOutput(() => ({ schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: claim.id, status: "conflicting_sources", explanation: "The retrieved reports state opposing match results.", confidence: 0.6,
    relationships: [
      { evidenceId: evidenceIds[0], relationshipType: "supporting", directness: "direct", confidence: 0.8, explanation: "The source reports a Harbor FC win." },
      { evidenceId: evidenceIds[1], relationshipType: "contradicting", directness: "direct", confidence: 0.8, explanation: "This source reports an opponent win." }
    ] }));
  const result = await service.verify(claim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "conflict" });
  assert.equal((result.assessment as any).status, "conflicting_sources"); assert.equal((result.assessment as any).relationships.length, 2);
  db.close();
});

test("contradicting evidence can produce contradicted with a durable relationship", async () => {
  const { db, service, extracted, evidenceIds, researchTask, setOutput } = setup();
  const claim = extracted.claims[0]!;
  setOutput(() => ({ schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: claim.id, status: "contradicted", explanation: "The retrieved match report states the opposing result.", confidence: 0.78,
    relationships: [{ evidenceId: evidenceIds[0], relationshipType: "contradicting", directness: "direct", confidence: 0.88, explanation: "The passage reports a different winner." }] }));
  const result = await service.verify(claim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "contradicted" });
  assert.equal((result.assessment as any).status, "contradicted");
  assert.equal((result.assessment as any).relationships[0].relationshipType, "contradicting");
  db.close();
});

test("idempotency key cannot be reused for another claim", async () => {
  const { db, service, claimRepo, extracted, evidenceIds, researchTask, setOutput, sessionId, storyTask } = setup();
  const firstClaim = extracted.claims[0]!;
  setOutput(() => providerOutput(firstClaim.id, evidenceIds));
  await service.verify(firstClaim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "claim-key" });
  const generationId = String((db.prepare("SELECT id FROM ai_generations WHERE task_id = ?").get(storyTask.id) as any).id);
  const secondClaim = claimRepo.extractFromStory("article-1", sessionId, storyTask.id, generationId, {
    keyClaims: [{ ...baseClaimOutput, text: "A different team won the final.", sourceContext: "A different team won the final." }], timeReferences: []
  })[0]!;
  await assert.rejects(() => service.verify(secondClaim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "claim-key" }), /ai_idempotency_conflict/);
  db.close();
});

test("temporal uncertainty downgrades an unsupported current injury assessment", async () => {
  const { db, service, extracted, evidenceIds, researchTask, setOutput } = setup({ claimType: "injury", temporal: [{ text: "next weekend", type: "relative_date", normalizedIso: null }] });
  const claim = extracted.claims[0]!; setOutput(() => providerOutput(claim.id, evidenceIds));
  const result = await service.verify(claim.id, researchTask.id, "operator-1", "operator", { idempotencyKey: "temporal" });
  assert.equal((result.assessment as any).status, "unresolved"); assert.equal((result.assessment as any).temporalStatus, "uncertain");
  assert.ok((result.assessment as any).temporalWarnings.includes("ambiguous_claim_time"));
  db.close();
});

test("invalid provider output cannot invent evidence, status, certainty, or unsupported verification fields", () => {
  const claim = { id: "claim-1", articleId: "article-1", text: "Claim", normalizedText: "claim", claimType: "result", sourceContext: null, subjectEntities: [], temporalContext: [], extractionConfidence: 0.7 };
  const evidence: VerificationEvidence[] = [{ id: "e-1", text: "Source passage states result.", evidenceType: "source_statement", sourceId: "s-1", sourceUrl: "https://news.example/a", canonicalUrl: "https://news.example/a", sourceType: "news", publisher: "News", sourcePublishedAt: "2026-09-30T00:00:00Z", retrievedAt: "2026-09-30T01:00:00Z", contentHash: "hash", sourceContentIdentity: "identity", location: { paragraphIndex: 0 } }];
  const invalid: Array<(result: any) => void> = [
    (result) => { result.status = "confirmed"; },
    (result) => { result.relationships[0].evidenceId = "invented"; },
    (result) => { result.confidence = 1.1; },
    (result) => { delete result.explanation; },
    (result) => { result.verified = true; },
    (result) => { result.explanation = "This is definitely true."; }
  ];
  for (const mutate of invalid) { const value: any = providerOutput(claim.id, ["e-1"]); mutate(value); assert.throws(() => validateVerificationResult(value, claim, evidence)); }
  const noEvidence = providerOutput(claim.id, ["e-1"]); assert.throws(() => validateVerificationResult(noEvidence, claim, []));
});

test("conflict status requires independent source content identities", () => {
  const claim = { id: "claim-1", articleId: "article-1", text: "Claim", normalizedText: "claim", claimType: "result", sourceContext: null, subjectEntities: [], temporalContext: [], extractionConfidence: 0.7 };
  const evidence: VerificationEvidence[] = ["e-1", "e-2"].map((id) => ({ id, text: "same syndicated report", evidenceType: "source_statement", sourceId: id, sourceUrl: `https://${id}.example/story`, canonicalUrl: `https://${id}.example/story`, sourceType: "news", publisher: null, sourcePublishedAt: "2026-09-30T00:00:00Z", retrievedAt: "2026-09-30T01:00:00Z", contentHash: id, sourceContentIdentity: "same-syndicated-content", location: null }));
  const value = { schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: claim.id, status: "conflicting_sources", explanation: "Reports disagree.", confidence: 0.5,
    relationships: [{ evidenceId: "e-1", relationshipType: "supporting", directness: "direct", confidence: 0.8, explanation: "Support" }, { evidenceId: "e-2", relationshipType: "contradicting", directness: "direct", confidence: 0.8, explanation: "Conflict" }] };
  assert.throws(() => validateVerificationResult(value, claim, evidence), /verification_conflict_sources_not_independent/);
});
