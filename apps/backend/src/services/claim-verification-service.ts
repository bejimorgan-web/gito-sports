import type { AiNewsTask } from "@gito/shared";
import type { DatabaseSync } from "../db/sqlite.js";
import { AiClaimRepository, type DurableClaim, type VerificationEvidence } from "../repositories/ai-claim-repository.js";
import { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import { AiResearchRepository } from "../repositories/ai-research-repository.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { AiNewsTaskRunner, createAiTaskProviderRegistry, type AiProviderConfiguration, type AiTaskProviderAdapter } from "./ai-news-provider.js";
import { CLAIM_VERIFICATION_INSTRUCTIONS, CLAIM_VERIFICATION_PROMPT_VERSION, CLAIM_VERIFICATION_RULES_VERSION, deterministicNoEvidenceResult, validateVerificationResult } from "./claim-verification-contract.js";

const NO_EVIDENCE_PROVIDER = "deterministic-no-evidence";
const NO_EVIDENCE_MODEL = "verification-rules-v1";

class DeterministicNoEvidenceProvider implements AiTaskProviderAdapter {
  readonly provider = NO_EVIDENCE_PROVIDER;
  readonly capabilities = { "text-generation": true, "structured-output": true } as const;
  async execute(request: Parameters<AiTaskProviderAdapter["execute"]>[0]) {
    return { output: deterministicNoEvidenceResult(String((request.input as { claim?: DurableClaim }).claim?.id ?? "")) };
  }
}

export interface ClaimVerificationResult { task: AiNewsTask; result: unknown | null; assessment: unknown | null }

export class ClaimVerificationService {
  private readonly claims: AiClaimRepository;
  private readonly research: AiResearchRepository;

  constructor(private readonly db: DatabaseSync, private readonly taskRepository: AiNewsTaskRepository, private readonly taskService: AiNewsTaskService,
    private readonly runnerFactory: (configuration: AiProviderConfiguration) => AiNewsTaskRunner,
    private readonly providerConfiguration: AiProviderConfiguration) {
    this.claims = new AiClaimRepository(db); this.research = new AiResearchRepository(db);
  }

  extract(articleId: string, researchTaskId: string, actorId: string): { claims: DurableClaim[]; researchSessionId: string } {
    const researchTask = this.taskRepository.getByActorAndId(researchTaskId, actorId);
    const researchData = this.research.getForActor(researchTaskId, actorId);
    const session = (researchData as any)?.session;
    if (!researchTask || researchTask.taskType !== "research" || researchTask.status !== "completed" || !session || session.articleId !== articleId || !["completed", "completed_with_source_failures"].includes(session.status)) {
      throw new Error("research_session_not_found");
    }
    const story = this.claims.latestStoryUnderstanding(articleId, actorId);
    if (!story) throw new Error("story_understanding_not_found");
    const extracted = this.claims.extractFromStory(articleId, session.id, story.taskId, story.generationId, story.output);
    return { claims: extracted, researchSessionId: session.id };
  }

  async verify(claimId: string, researchTaskId: string, actorId: string, actorRole: string,
    request: { correlationId?: string; idempotencyKey?: string }): Promise<ClaimVerificationResult> {
    const researchTask = this.taskRepository.getByActorAndId(researchTaskId, actorId);
    const researchData = this.research.getForActor(researchTaskId, actorId);
    const session = (researchData as any)?.session;
    if (!researchTask || researchTask.taskType !== "research" || researchTask.status !== "completed" || !session || !["completed", "completed_with_source_failures"].includes(session.status)) {
      throw new Error("research_session_not_found");
    }
    const claim = this.claims.getClaimForActor(claimId, actorId);
    if (!claim || claim.articleId !== session.articleId || !this.claims.claimBelongsToResearchSession(claimId, session.id, actorId)) throw new Error("claim_not_found");
    const evidence = this.claims.getEvidenceForSession(session.id, actorId);
    const evidenceSet = trimEvidenceSet(evidence);
    const configuration = evidenceSet.length ? this.providerConfiguration : { provider: NO_EVIDENCE_PROVIDER, model: NO_EVIDENCE_MODEL, baseUrl: "", apiKey: "" };
    const task = this.taskService.create({ taskType: "claim_verification", articleId: claim.articleId, promptVersion: CLAIM_VERIFICATION_PROMPT_VERSION,
      correlationId: request.correlationId, idempotencyKey: request.idempotencyKey }, actorId, configuration, actorRole);
    this.claims.bindVerificationTask(task.id, claim.id, claim.articleId, session.id, actorId);
    if (task.status !== "queued") return { task, result: task.status === "completed" ? this.taskRepository.getGeneration(task.id)?.output ?? null : null,
      assessment: this.claims.getAssessmentForTask(task.id, actorId) };

    const runner = this.runnerFactory(configuration);
    const input = { instructions: CLAIM_VERIFICATION_INSTRUCTIONS, rulesVersion: CLAIM_VERIFICATION_RULES_VERSION,
      claim, evidence: evidenceSet.map(toProviderEvidence), temporalContext: claim.temporalContext };
    const validated = (output: unknown) => validateVerificationResult(output, claim, evidenceSet);
    const resultTask = await runner.run(task, input, validated, (output, providerMetadata) => {
      const assessment = output as ReturnType<typeof validateVerificationResult>;
      this.claims.persistAssessment({ claimId: claim.id, articleId: claim.articleId, researchSessionId: session.id, taskId: task.id,
        status: assessment.status, explanation: assessment.explanation, confidence: assessment.confidence, temporalStatus: assessment.temporalStatus,
        temporalWarnings: assessment.temporalWarnings, evidenceSetIds: assessment.evidenceSetIds, relationships: assessment.relationships,
        rulesVersion: CLAIM_VERIFICATION_RULES_VERSION, provider: providerMetadata.provider, model: providerMetadata.model, promptVersion: task.promptVersion, correlationId: task.correlationId }, evidenceSet);
    });
    const assessment = resultTask.status === "completed" ? this.claims.getAssessmentForTask(task.id, actorId) : null;
    return { task: resultTask, result: resultTask.status === "completed" ? this.taskRepository.getGeneration(task.id)?.output ?? null : null, assessment };
  }

  getClaim(claimId: string, actorId: string): unknown | null { return this.claims.getClaimDetails(claimId, actorId); }
  getClaimsForResearchTask(taskId: string, actorId: string): unknown[] | null {
    const claims = this.claims.getClaimsForResearchTask(taskId, actorId);
    if (!claims) return null;
    return claims.map((claim) => this.claims.getClaimDetails(claim.id, actorId));
  }
}

export function createClaimVerificationRunner(repository: AiNewsTaskRepository, configuration: AiProviderConfiguration, injectedProvider?: AiTaskProviderAdapter): AiNewsTaskRunner {
  const registry = createAiTaskProviderRegistry([new DeterministicNoEvidenceProvider(), ...(injectedProvider ? [injectedProvider] : [])]);
  return new AiNewsTaskRunner(repository, registry, configuration);
}

function trimEvidenceSet(evidence: VerificationEvidence[]): VerificationEvidence[] {
  const grouped = new Map<string, VerificationEvidence[]>();
  for (const item of evidence) { const group = grouped.get(item.sourceId) ?? []; group.push(item); grouped.set(item.sourceId, group); }
  const selected: VerificationEvidence[] = []; let chars = 0; let round = 0;
  while (selected.length < 100) {
    let added = false;
    for (const group of grouped.values()) {
      const item = group[round]; if (!item) continue;
      added = true;
      if (chars + item.text.length <= 160_000) { selected.push(item); chars += item.text.length; }
      if (selected.length >= 100) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function toProviderEvidence(item: VerificationEvidence) {
  return { id: item.id, text: item.text, evidenceType: item.evidenceType, location: item.location,
    source: { sourceId: item.sourceId, url: item.sourceUrl, canonicalUrl: item.canonicalUrl, sourceType: item.sourceType,
      publisher: item.publisher, publishedAt: item.sourcePublishedAt, retrievedAt: item.retrievedAt, contentHash: item.contentHash } };
}
