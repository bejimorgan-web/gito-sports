import type { DurableClaim, VerificationEvidence } from "../repositories/ai-claim-repository.js";

export const CLAIM_VERIFICATION_PROMPT_VERSION = "claim-verification-v1";
export const CLAIM_VERIFICATION_RULES_VERSION = "verification-rules-v1";
export const CLAIM_VERIFICATION_INSTRUCTIONS = `Assess only the supplied claim and retrieved evidence passages. Evidence represents statements made by sources, not guaranteed truth. Do not browse, create sources, invent evidence, claim absolute certainty, or add fields. Return the exact JSON contract. Distinguish supporting, contradicting, contextual, and insufficient evidence; use insufficient_evidence or unresolved when evidence is weak or temporal applicability is unclear. Conflicting sources require materially opposing evidence from distinct content identities. Confidence describes reliability of this assessment given this evidence, never the probability that a claim is true. Cite only supplied evidence IDs and explain the assessment concisely.`;

export type VerificationStatus = "supported" | "contradicted" | "insufficient_evidence" | "conflicting_sources" | "unresolved";
export type EvidenceRelationshipType = "supporting" | "contradicting" | "contextual" | "insufficient";
export type EvidenceDirectness = "direct" | "indirect" | "unclear";
export interface ValidatedVerificationResult {
  schemaVersion: string; claimId: string; status: VerificationStatus; explanation: string; confidence: number;
  relationships: Array<{ evidenceId: string; relationshipType: EvidenceRelationshipType; directness: EvidenceDirectness; confidence: number; explanation: string }>;
  evidenceSetIds: string[]; temporalStatus: "not_time_sensitive" | "applicable" | "uncertain"; temporalWarnings: string[];
}

const statuses: readonly VerificationStatus[] = ["supported", "contradicted", "insufficient_evidence", "conflicting_sources", "unresolved"];
const relationshipTypes: readonly EvidenceRelationshipType[] = ["supporting", "contradicting", "contextual", "insufficient"];
const directnessTypes: readonly EvidenceDirectness[] = ["direct", "indirect", "unclear"];
const timeSensitiveTypes = new Set(["transfer", "injury", "availability", "appointment", "fixture", "roster", "competition"]);

function exactObject(value: unknown, keys: readonly string[], path: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${path}_shape_invalid`);
  }
}
function boundedText(value: unknown, max: number, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${path}_invalid`);
}
function boundedConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path}_invalid`);
}
function absoluteCertainty(value: string): boolean {
  return /\b(definitely|certainly|undeniably|unquestionably|guaranteed true|proven beyond doubt|without any doubt|absolute truth|verified fact|claim is verified)\b|\b100\s*%\s*true\b/i.test(value);
}

function temporalAssessment(claim: DurableClaim, linkedEvidence: VerificationEvidence[], now = Date.now()): { status: ValidatedVerificationResult["temporalStatus"]; warnings: string[] } {
  if (!timeSensitiveTypes.has(claim.claimType)) return { status: "not_time_sensitive", warnings: [] };
  const temporal = claim.temporalContext;
  const explicitDates = temporal.map((item) => typeof item.normalizedIso === "string" && Number.isFinite(Date.parse(item.normalizedIso)) ? Date.parse(item.normalizedIso) : null).filter((date): date is number => date !== null);
  const ambiguousRelative = temporal.some((item) => ["relative_date", "publication_relative", "kickoff"].includes(String(item.type)) && item.normalizedIso == null);
  const publicationDates = linkedEvidence.map((item) => item.sourcePublishedAt && Number.isFinite(Date.parse(item.sourcePublishedAt)) ? Date.parse(item.sourcePublishedAt) : null).filter((date): date is number => date !== null);
  const warnings: string[] = [];
  if (ambiguousRelative) warnings.push("ambiguous_claim_time");
  if (!publicationDates.length) warnings.push("source_publication_time_unknown");
  if (explicitDates.length && publicationDates.length && publicationDates.every((date) => date < Math.min(...explicitDates))) warnings.push("evidence_predates_claim_time");
  if (!explicitDates.length && publicationDates.length && publicationDates.every((date) => now - date > 30 * 24 * 60 * 60 * 1000)) warnings.push("stale_source_for_current_claim");
  return { status: warnings.length ? "uncertain" : "applicable", warnings };
}

export function validateVerificationResult(value: unknown, claim: DurableClaim, evidence: VerificationEvidence[]): ValidatedVerificationResult {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new Error("verification_result_not_serializable"); }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 128 * 1024) throw new Error("verification_result_too_large");
  exactObject(value, ["schemaVersion", "claimId", "status", "explanation", "confidence", "relationships"], "verification");
  if (value.schemaVersion !== CLAIM_VERIFICATION_PROMPT_VERSION || value.claimId !== claim.id) throw new Error("verification_identity_invalid");
  if (!statuses.includes(value.status)) throw new Error("verification_status_invalid");
  boundedText(value.explanation, 2000, "verification_explanation");
  if (absoluteCertainty(value.explanation)) throw new Error("verification_absolute_certainty_not_allowed");
  boundedConfidence(value.confidence, "verification_confidence");
  if (!Array.isArray(value.relationships) || value.relationships.length > 100) throw new Error("verification_relationships_invalid");

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const used = new Set<string>();
  const relationships = value.relationships.map((item: unknown, index: number) => {
    exactObject(item, ["evidenceId", "relationshipType", "directness", "confidence", "explanation"], `relationship_${index}`);
    if (typeof item.evidenceId !== "string" || !evidenceById.has(item.evidenceId)) throw new Error("verification_evidence_id_invalid");
    if (used.has(item.evidenceId)) throw new Error("verification_evidence_duplicate"); used.add(item.evidenceId);
    if (!relationshipTypes.includes(item.relationshipType)) throw new Error("verification_relationship_type_invalid");
    if (!directnessTypes.includes(item.directness)) throw new Error("verification_directness_invalid");
    boundedConfidence(item.confidence, `relationship_${index}_confidence`);
    boundedText(item.explanation, 500, `relationship_${index}_explanation`, true);
    if (absoluteCertainty(item.explanation)) throw new Error("verification_absolute_certainty_not_allowed");
    return { evidenceId: item.evidenceId, relationshipType: item.relationshipType as EvidenceRelationshipType, directness: item.directness as EvidenceDirectness, confidence: item.confidence, explanation: item.explanation };
  });

  const supporting = relationships.filter((item) => item.relationshipType === "supporting");
  const contradicting = relationships.filter((item) => item.relationshipType === "contradicting");
  if (!evidence.length && (supporting.length || contradicting.length || (value.status !== "insufficient_evidence" && value.status !== "unresolved"))) throw new Error("verification_without_evidence_invalid");
  if (value.status === "supported" && (!supporting.length || contradicting.length)) throw new Error("verification_support_basis_invalid");
  if (value.status === "contradicted" && (!contradicting.length || supporting.length)) throw new Error("verification_contradiction_basis_invalid");
  if (supporting.length && contradicting.length && value.status !== "conflicting_sources" && value.status !== "unresolved") throw new Error("verification_conflict_not_exposed");
  if (value.status === "conflicting_sources") {
    if (!supporting.length || !contradicting.length) throw new Error("verification_conflict_basis_invalid");
    const supportHashes = new Set(supporting.map((item) => evidenceById.get(item.evidenceId)?.sourceContentIdentity ?? evidenceById.get(item.evidenceId)?.contentHash).filter((hash): hash is string => Boolean(hash)));
    const independentConflict = contradicting.some((item) => { const evidenceItem = evidenceById.get(item.evidenceId); const hash = evidenceItem?.sourceContentIdentity ?? evidenceItem?.contentHash; return Boolean(hash && [...supportHashes].some((supportHash) => supportHash !== hash)); });
    if (!independentConflict) throw new Error("verification_conflict_sources_not_independent");
  }

  const temporal = temporalAssessment(claim, relationships.map((item) => evidenceById.get(item.evidenceId)!));
  let status = value.status as VerificationStatus;
  let explanation = value.explanation as string;
  if (temporal.status === "uncertain" && ["supported", "contradicted", "conflicting_sources"].includes(status)) {
    status = "unresolved";
    explanation = `${explanation} Temporal applicability is uncertain: ${temporal.warnings.join(", ")}.`;
  }
  return { schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId: claim.id, status, explanation, confidence: value.confidence,
    relationships, evidenceSetIds: evidence.map((item) => item.id), temporalStatus: temporal.status, temporalWarnings: temporal.warnings };
}

export function deterministicNoEvidenceResult(claimId: string): unknown {
  return { schemaVersion: CLAIM_VERIFICATION_PROMPT_VERSION, claimId, status: "insufficient_evidence", explanation: "No retrieved evidence was available in the selected research session.", confidence: 1, relationships: [] };
}
