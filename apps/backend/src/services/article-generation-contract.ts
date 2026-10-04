import type { DurableClaim } from "../repositories/ai-claim-repository.js";

export const ARTICLE_GENERATION_PROMPT_VERSION = "article-generation-v1";
export const ARTICLE_GENERATION_RULES_VERSION = "article-generation-rules-v1";
export const ARTICLE_GENERATION_TYPES = ["news_report", "match_preview", "match_recap", "transfer_update", "injury_update", "team_update", "competition_update", "explainer"] as const;
export type ArticleGenerationType = typeof ARTICLE_GENERATION_TYPES[number];
export type ClaimVerificationState = "supported" | "contradicted" | "insufficient_evidence" | "conflicting_sources" | "unresolved";
export type GenerationFraming = "asserted" | "attributed" | "uncertain";

export const ARTICLE_GENERATION_INSTRUCTIONS = `Write a reviewable article draft using only the supplied canonical article, Story Understanding, claims, verification assessments, and evidence passages. The article is not the canonical article and must not be published. Do not invent facts, statistics, scores, players, dates, transfers, injuries, quotes, events, sources, evidence, or verification. Never state contradicted, conflicting, insufficient, or unresolved claims as established facts. Supported claims may be stated with care. Conflicting claims must be attributed to both sides, described as uncertain, or omitted; never silently pick a version. Unverified details must be omitted or explicitly identified as uncertain. Reproduce a direct quote only when its exact words appear in cited evidence; otherwise paraphrase without quotation marks. Every headline, summary, and paragraph must cite supplied claim and evidence identifiers and choose asserted, attributed, or uncertain framing. Follow editor instructions only when they do not conflict with evidence or these rules. Use the required exact JSON contract; do not add fields.`;

export interface GenerationRelationship { evidenceId: string; relationshipType: string; directness: string; explanation: string }
export interface GenerationClaim extends DurableClaim {
  verificationStatus: ClaimVerificationState;
  assessmentId: string | null;
  temporalStatus: string;
  temporalWarnings: string[];
  relationships: GenerationRelationship[];
}
export interface GenerationEvidence {
  id: string; sourceId: string; sourceUrl: string; canonicalUrl: string; sourceTitle: string | null; publisher: string | null;
  sourceType: string; publishedAt: string | null; retrievedAt: string | null; contentHash: string | null; text: string; location: unknown;
}
export interface ArticleGenerationContext {
  article: { id: string; title: string; summary: string | null; body: string | null; sourceName: string | null; sourceUrl: string | null; publishedAt: string | null; status: string };
  storyUnderstanding: { taskId: string; generationId: string; output: unknown };
  research: { taskId: string; sessionId: string; status: string };
  claims: GenerationClaim[];
  evidence: GenerationEvidence[];
  sourceIds: string[];
}
export interface ArticleGenerationIntent {
  articleType: ArticleGenerationType; editorInstruction: string | null; requestedLength: number | null; tone: string; headlineOptions: number;
}
export interface TextUnit { text: string; claimIds: string[]; evidenceIds: string[]; framing: GenerationFraming }
export interface ArticleGenerationOutput {
  schemaVersion: string; articleType: ArticleGenerationType; headline: string; summary: string; body: string;
  headlineBasis: TextUnit; summaryBasis: TextUnit;
  headlineAlternatives: TextUnit[];
  sections: Array<{ heading: string; headingBasis: TextUnit; paragraphs: TextUnit[] }>;
  usedClaims: string[]; usedEvidence: string[];
  uncertainties: Array<{ claimId: string; reason: string }>;
  editorialNotes: string[]; factCheckRequired: boolean; generationWarnings: string[];
  tone: string; requestedLength: number | null; wordCount: number;
}

const framings = new Set<GenerationFraming>(["asserted", "attributed", "uncertain"]);
const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
function exactObject(value: unknown, keys: string[], field: string): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`${field}_shape_invalid`);
}
function boundedString(value: unknown, max: number, field: string, empty = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new Error(`${field}_invalid`);
}
function uniqueIds(value: unknown, allowed: Set<string>, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || !allowed.has(id)) || new Set(value).size !== value.length) throw new Error(`${field}_invalid`);
  return value as string[];
}
function numericTokens(text: string): string[] { return text.match(/\b\d+(?:[,.]\d+)*(?:%|st|nd|rd|th)?\b/gi) ?? []; }
function assertQuotesGrounded(text: string, evidence: GenerationEvidence[]) {
  const doubleQuoted = [...text.matchAll(/"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
  for (const quote of doubleQuoted) if (!evidence.some((item) => item.text.includes(quote))) throw new Error("generation_quote_unsupported");
}
function validateUnit(value: unknown, field: string, context: ArticleGenerationContext, claimsById: Map<string, GenerationClaim>, evidenceById: Map<string, GenerationEvidence>): TextUnit {
  exactObject(value, ["text", "claimIds", "evidenceIds", "framing"], field);
  boundedString(value.text, 4000, `${field}_text`, true);
  const claimIds = uniqueIds(value.claimIds, new Set(claimsById.keys()), `${field}_claim_ids`);
  const evidenceIds = uniqueIds(value.evidenceIds, new Set(evidenceById.keys()), `${field}_evidence_ids`);
  if (!framings.has(value.framing)) throw new Error(`${field}_framing_invalid`);
  if (value.text.trim() && (!claimIds.length || !evidenceIds.length)) throw new Error(`${field}_provenance_required`);
  const unitEvidence = evidenceIds.map((id) => evidenceById.get(id)!);
  const unitEvidenceText = unitEvidence.map((item) => item.text).join("\n");
  for (const token of numericTokens(value.text)) {
    if (!numericTokens(unitEvidenceText).some((available) => available.toLocaleLowerCase("en-US") === token.toLocaleLowerCase("en-US"))) throw new Error(`${field}_number_unsupported`);
  }
  assertQuotesGrounded(value.text, unitEvidence);
  for (const claimId of claimIds) {
    const claim = claimsById.get(claimId)!;
    const refs = claim.relationships.filter((relationship) => evidenceIds.includes(relationship.evidenceId));
    if (!refs.length) throw new Error(`${field}_claim_evidence_mismatch`);
    if (value.framing === "asserted" && (claim.verificationStatus !== "supported" || claim.temporalStatus === "uncertain" || !refs.some((relationship) => relationship.relationshipType === "supporting"))) throw new Error(`${field}_unsupported_claim_asserted`);
    if (claim.verificationStatus === "contradicted" && value.framing === "attributed" && !refs.some((relationship) => relationship.relationshipType === "contradicting")) throw new Error(`${field}_contradiction_not_attributed`);
    if (claim.verificationStatus === "contradicted" && value.framing === "attributed" && !/\b(according to|reported by|the source (?:says|states|reports)|the club (?:says|states|reports)|the report (?:says|states|reports))\b/i.test(value.text)) throw new Error(`${field}_attribution_language_missing`);
    if (claim.verificationStatus === "conflicting_sources") {
      const hasSupport = refs.some((relationship) => relationship.relationshipType === "supporting");
      const hasContradiction = refs.some((relationship) => relationship.relationshipType === "contradicting");
      if (value.framing === "asserted" || (value.framing === "attributed" && !(hasSupport && hasContradiction))) throw new Error(`${field}_conflict_silently_resolved`);
    }
    if (["insufficient_evidence", "unresolved"].includes(claim.verificationStatus) && value.framing === "asserted") throw new Error(`${field}_unresolved_claim_asserted`);
  }
  return { text: value.text, claimIds, evidenceIds, framing: value.framing };
}

export function validateArticleGeneration(value: unknown, context: ArticleGenerationContext, intent: ArticleGenerationIntent): ArticleGenerationOutput {
  let raw: string;
  try { raw = JSON.stringify(value); } catch { throw new Error("generation_output_unserializable"); }
  if (!raw || Buffer.byteLength(raw, "utf8") > 256 * 1024) throw new Error("generation_output_too_large");
  exactObject(value, ["schemaVersion", "articleType", "headline", "summary", "body", "headlineBasis", "summaryBasis", "headlineAlternatives", "sections", "usedClaims", "usedEvidence", "uncertainties", "editorialNotes", "tone", "requestedLength", "wordCount"], "generation");
  if (value.schemaVersion !== "article-generation-v1" || value.articleType !== intent.articleType || value.tone !== intent.tone || value.requestedLength !== intent.requestedLength) throw new Error("generation_identity_invalid");
  boundedString(value.headline, 180, "generation_headline"); boundedString(value.summary, 600, "generation_summary", true); boundedString(value.body, 30_000, "generation_body", true);
  const claimsById = new Map(context.claims.map((claim) => [claim.id, claim])); const evidenceById = new Map(context.evidence.map((evidence) => [evidence.id, evidence]));
  const headlineBasis = validateUnit(value.headlineBasis, "generation_headline_basis", context, claimsById, evidenceById);
  const summaryBasis = validateUnit(value.summaryBasis, "generation_summary_basis", context, claimsById, evidenceById);
  if (headlineBasis.text !== value.headline || summaryBasis.text !== value.summary) throw new Error("generation_headline_or_summary_basis_mismatch");
  if (!Array.isArray(value.headlineAlternatives) || value.headlineAlternatives.length > intent.headlineOptions) throw new Error("generation_headline_alternatives_invalid");
  const headlineAlternatives = value.headlineAlternatives.map((unit: unknown, index: number) => validateUnit(unit, `generation_headline_alternative_${index}`, context, claimsById, evidenceById));
  if (!Array.isArray(value.sections) || value.sections.length > 12) throw new Error("generation_sections_invalid");
  const sections = value.sections.map((section: unknown, index: number) => {
    exactObject(section, ["heading", "headingBasis", "paragraphs"], `generation_section_${index}`); boundedString(section.heading, 120, `generation_section_${index}_heading`, true);
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length > 40) throw new Error("generation_paragraphs_invalid");
    const headingBasis = validateUnit(section.headingBasis, `generation_section_${index}_heading_basis`, context, claimsById, evidenceById);
    if (headingBasis.text !== section.heading) throw new Error(`generation_section_${index}_heading_basis_mismatch`);
    return { heading: section.heading, headingBasis, paragraphs: section.paragraphs.map((unit: unknown, paragraphIndex: number) => validateUnit(unit, `generation_section_${index}_paragraph_${paragraphIndex}`, context, claimsById, evidenceById)) };
  });
  const flattenedBody = sections.flatMap((section) => section.paragraphs.map((paragraph) => paragraph.text)).filter(Boolean).join("\n\n");
  if (value.body !== flattenedBody) throw new Error("generation_body_section_mismatch");
  const units = [headlineBasis, summaryBasis, ...headlineAlternatives, ...sections.flatMap((section) => [section.headingBasis, ...section.paragraphs])];
  const usedClaims = [...new Set(units.flatMap((unit) => unit.claimIds))].sort();
  const usedEvidence = [...new Set(units.flatMap((unit) => unit.evidenceIds))].sort();
  if (!Array.isArray(value.usedClaims) || JSON.stringify([...value.usedClaims].sort()) !== JSON.stringify(usedClaims) || new Set(value.usedClaims).size !== value.usedClaims.length) throw new Error("generation_used_claims_invalid");
  if (!Array.isArray(value.usedEvidence) || JSON.stringify([...value.usedEvidence].sort()) !== JSON.stringify(usedEvidence) || new Set(value.usedEvidence).size !== value.usedEvidence.length) throw new Error("generation_used_evidence_invalid");
  if (!Array.isArray(value.uncertainties) || value.uncertainties.length > context.claims.length) throw new Error("generation_uncertainties_invalid");
  const uncertaintyClaimIds = new Set<string>();
  const uncertainties = value.uncertainties.map((item: unknown, index: number) => {
    exactObject(item, ["claimId", "reason"], `generation_uncertainty_${index}`);
    if (typeof item.claimId !== "string" || !claimsById.has(item.claimId) || uncertaintyClaimIds.has(item.claimId) || claimsById.get(item.claimId)!.verificationStatus === "supported") throw new Error("generation_uncertainty_reference_invalid");
    boundedString(item.reason, 500, `generation_uncertainty_${index}_reason`); uncertaintyClaimIds.add(item.claimId);
    return { claimId: item.claimId, reason: item.reason };
  });
  for (const claimId of usedClaims) {
    const claim = claimsById.get(claimId)!;
    if (claim.verificationStatus !== "supported" && !uncertaintyClaimIds.has(claimId)) throw new Error("generation_uncertainty_missing_for_claim");
  }
  const editorialNotes = boundedStringArray(value.editorialNotes, 20, 500, "generation_editorial_notes");
  const wordTotal = wordCount(value.body);
  if (!Number.isInteger(value.wordCount) || value.wordCount !== wordTotal) throw new Error("generation_word_count_invalid");
  const generationWarnings = [...new Set(context.claims.flatMap((claim) => claim.temporalWarnings))];
  if (context.claims.some((claim) => claim.verificationStatus !== "supported" || claim.temporalStatus === "uncertain")) generationWarnings.push("non_supported_or_temporally_uncertain_claims_require_editorial_review");
  if (intent.editorInstruction && /\b(fact.?check|verify|confirm)\b/i.test(intent.editorInstruction)) generationWarnings.push("editor_requested_fact_check");
  const factCheckRequired = generationWarnings.length > 0 || uncertainties.length > 0 || editorialNotes.length > 0 || usedClaims.some((id) => claimsById.get(id)!.verificationStatus !== "supported");
  return { schemaVersion: value.schemaVersion, articleType: value.articleType, headline: value.headline, summary: value.summary, body: value.body,
    headlineBasis, summaryBasis, headlineAlternatives, sections, usedClaims, usedEvidence, uncertainties, editorialNotes,
    factCheckRequired, generationWarnings: [...new Set(generationWarnings)], tone: value.tone, requestedLength: value.requestedLength, wordCount: wordTotal };
}

export function deterministicEvidenceUnavailableOutput(intent: ArticleGenerationIntent): ArticleGenerationOutput {
  return { schemaVersion: ARTICLE_GENERATION_PROMPT_VERSION, articleType: intent.articleType, headline: "Draft requires editorial review",
    summary: "There is not enough assessed evidence to produce a fact grounded article draft.", body: "", headlineBasis: emptyUnit(), summaryBasis: emptyUnit(), headlineAlternatives: [], sections: [],
    usedClaims: [], usedEvidence: [], uncertainties: [], editorialNotes: ["Add or assess research evidence before generating article copy."],
    factCheckRequired: true, generationWarnings: ["no_assessed_evidence_available"], tone: intent.tone, requestedLength: intent.requestedLength, wordCount: 0 };
}
function emptyUnit(): TextUnit { return { text: "", claimIds: [], evidenceIds: [], framing: "uncertain" }; }
function boundedStringArray(value: unknown, maxItems: number, maxText: number, field: string): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field}_invalid`);
  value.forEach((item, index) => boundedString(item, maxText, `${field}_${index}`)); return value as string[];
}
