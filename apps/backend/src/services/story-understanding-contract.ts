import type {
  AiNewsTaskType,
  StoryUnderstandingBasis,
  StoryUnderstandingClaimType,
  StoryUnderstandingEntityType,
  StoryUnderstandingInput,
  StoryUnderstandingIntent,
  StoryUnderstandingOutput,
  StoryUnderstandingStoryType,
  StoryUnderstandingTimeType
} from "@gito/shared";

export const STORY_UNDERSTANDING_TASK_TYPE: AiNewsTaskType = "story_understanding";
export const STORY_UNDERSTANDING_PROMPT_VERSION = "story-understanding-v1";
export const MAX_STORY_UNDERSTANDING_OUTPUT_BYTES = 256 * 1024;

export const STORY_UNDERSTANDING_INSTRUCTIONS = `Interpret only the supplied canonical GiTO News article. Return one JSON object matching the requested Story Understanding contract exactly. Do not use outside knowledge, browse, research, or verify. Do not claim any fact is true or externally verified. Key claims are only assertions made by the supplied article. Distinguish directly stated information, your interpretation, and unresolved information using the basis field. Preserve original temporal wording; set normalizedIso only when the article itself provides an unambiguous ISO date or timestamp. Match canonicalEntityId only to an exact supplied canonical relationship; otherwise preserve the textual name and mark it unresolved. Missing input stays missing. Report ambiguity, missing information, unresolved entities, internal conflicts, and low-confidence interpretations. Confidence from 0 to 1 describes extraction/interpretation confidence only, never truth or source reliability. Use only the contract's controlled vocabularies and fields; do not add verification fields or other properties.`;

const storyTypes = ["match", "transfer", "injury", "team_news", "player_news", "manager_news", "competition_news", "result", "fixture", "standings", "statistics", "disciplinary", "business", "other"] as const satisfies readonly StoryUnderstandingStoryType[];
const intents = ["breaking_news", "report", "preview", "reaction", "analysis", "transfer_update", "announcement", "result_report", "other"] as const satisfies readonly StoryUnderstandingIntent[];
const entityTypes = ["person", "team", "club", "competition", "country", "sport", "match", "host", "venue", "organization", "other"] as const satisfies readonly StoryUnderstandingEntityType[];
const timeTypes = ["exact_date", "relative_date", "season", "kickoff", "publication_relative", "other"] as const satisfies readonly StoryUnderstandingTimeType[];
const claimTypes = ["match_event", "result", "transfer", "injury", "selection", "quote", "statistic", "date_time", "other"] as const satisfies readonly StoryUnderstandingClaimType[];
const bases = ["directly_stated", "ai_interpretation", "unresolved"] as const satisfies readonly StoryUnderstandingBasis[];

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shape(value: unknown, keys: readonly string[], path: string): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new StoryUnderstandingValidationError(`${path}_shape_invalid`);
  }
}

function text(value: unknown, path: string, max = 4000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new StoryUnderstandingValidationError(`${path}_invalid`);
}

function nullableText(value: unknown, path: string, max = 4000): asserts value is string | null {
  if (value !== null) text(value, path, max);
}

function confidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new StoryUnderstandingValidationError(`${path}_invalid`);
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], path: string): asserts value is T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) throw new StoryUnderstandingValidationError(`${path}_invalid`);
}

function stringList(value: unknown, path: string, maxItems: number, maxText = 1000): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new StoryUnderstandingValidationError(`${path}_invalid`);
  value.forEach((item, index) => text(item, `${path}_${index}`, maxText));
}

function isoDate(value: unknown, path: string): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== "string" || value.length > 40) throw new StoryUnderstandingValidationError(`${path}_invalid`);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if ((!dateOnly && !timestamp) || !Number.isFinite(Date.parse(value))) throw new StoryUnderstandingValidationError(`${path}_invalid`);
  if (dateOnly && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new StoryUnderstandingValidationError(`${path}_invalid`);
}

export class StoryUnderstandingValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StoryUnderstandingValidationError";
  }
}

const safeValidationCodePatterns = [
  /^(?:output_not_serializable|output_too_large|schema_version_invalid|entities_invalid|event_participant_not_extracted|time_references_invalid|key_claims_invalid|uncertainty_unresolved_entity_not_unresolved)$/,
  /^(?:result|subject|intent|event|uncertainty)_shape_invalid$/,
  /^subject_(?:primary_topic|topic_summary|story_type|basis|confidence)_invalid$/,
  /^intent_(?:value|basis|confidence)_invalid$/,
  /^entity_(?:0|[1-9][0-9])_(?:shape_invalid|name_invalid|type_invalid|canonical_id_invalid|resolution_status_invalid|source_text_invalid|basis_invalid|confidence_invalid|resolution_mismatch|canonical_id_not_supplied)$/,
  /^event_(?:type|description|time_reference|location|basis|confidence|participants)_invalid$/,
  /^event_participants_(?:[0-9]|1[0-9]|2[0-9])_invalid$/,
  /^time_reference_(?:[0-9]|[1-4][0-9])_(?:shape_invalid|text_invalid|type_invalid|normalized_iso_invalid|basis_invalid|confidence_invalid)$/,
  /^claim_(?:0|[1-9][0-9])_(?:shape_invalid|text_invalid|type_invalid|entities_invalid|source_context_invalid|confidence_invalid|entity_not_extracted)$/,
  /^claim_(?:0|[1-9][0-9])_entities_(?:[0-9]|1[0-9]|2[0-9])_invalid$/,
  /^uncertainty_(?:ambiguities|missing_information|internal_conflicts|low_confidence)(?:_(?:[0-9]|[1-4][0-9]))?_invalid$/,
  /^uncertainty_unresolved_entities(?:_(?:[0-9]|[1-9][0-9]))?_invalid$/
] as const;

export function formatSafeStoryUnderstandingValidationDiagnostic(error: StoryUnderstandingValidationError): string | undefined {
  if (error.code.length > 80 || !safeValidationCodePatterns.some((pattern) => pattern.test(error.code))) return undefined;
  return `AI_OUTPUT_VALIDATION_FAILED validationCode=${error.code}`;
}

export function validateStoryUnderstandingOutput(value: unknown, input: StoryUnderstandingInput): StoryUnderstandingOutput {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StoryUnderstandingValidationError("output_not_serializable");
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_STORY_UNDERSTANDING_OUTPUT_BYTES) {
    throw new StoryUnderstandingValidationError("output_too_large");
  }

  shape(value, ["schemaVersion", "subject", "intent", "entities", "event", "timeReferences", "keyClaims", "uncertainty"], "result");
  if (value.schemaVersion !== STORY_UNDERSTANDING_PROMPT_VERSION) throw new StoryUnderstandingValidationError("schema_version_invalid");

  shape(value.subject, ["primaryTopic", "topicSummary", "storyType", "basis", "confidence"], "subject");
  text(value.subject.primaryTopic, "subject_primary_topic", 200);
  nullableText(value.subject.topicSummary, "subject_topic_summary", 2000);
  enumValue(value.subject.storyType, storyTypes, "subject_story_type");
  enumValue(value.subject.basis, bases, "subject_basis");
  confidence(value.subject.confidence, "subject_confidence");

  shape(value.intent, ["value", "basis", "confidence"], "intent");
  enumValue(value.intent.value, intents, "intent_value");
  enumValue(value.intent.basis, bases, "intent_basis");
  confidence(value.intent.confidence, "intent_confidence");

  if (!Array.isArray(value.entities) || value.entities.length > 100) throw new StoryUnderstandingValidationError("entities_invalid");
  const inputRelationships = new Map(input.canonicalEntities.map((entity) => [`${entity.entityType}:${entity.id}`, entity]));
  const entityNames = new Set<string>();
  const unresolvedEntityNames = new Set<string>();
  value.entities.forEach((entity, index) => {
    const path = `entity_${index}`;
    shape(entity, ["name", "entityType", "canonicalEntityId", "resolutionStatus", "sourceText", "basis", "confidence"], path);
    text(entity.name, `${path}_name`, 200);
    enumValue(entity.entityType, entityTypes, `${path}_type`);
    if (entity.canonicalEntityId !== null && (typeof entity.canonicalEntityId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(entity.canonicalEntityId))) throw new StoryUnderstandingValidationError(`${path}_canonical_id_invalid`);
    if (entity.resolutionStatus !== "matched_existing_relationship" && entity.resolutionStatus !== "unresolved") throw new StoryUnderstandingValidationError(`${path}_resolution_status_invalid`);
    nullableText(entity.sourceText, `${path}_source_text`, 1000);
    enumValue(entity.basis, bases, `${path}_basis`);
    confidence(entity.confidence, `${path}_confidence`);
    if (entity.canonicalEntityId === null) {
      if (entity.resolutionStatus !== "unresolved") throw new StoryUnderstandingValidationError(`${path}_resolution_mismatch`);
      unresolvedEntityNames.add(entity.name);
    } else {
      const relationship = inputRelationships.get(`${entity.entityType}:${entity.canonicalEntityId}`);
      if (!relationship || entity.resolutionStatus !== "matched_existing_relationship") throw new StoryUnderstandingValidationError(`${path}_canonical_id_not_supplied`);
    }
    entityNames.add(entity.name);
  });

  shape(value.event, ["eventType", "description", "timeReference", "location", "participants", "basis", "confidence"], "event");
  if (value.event.eventType !== null) enumValue(value.event.eventType, storyTypes, "event_type");
  nullableText(value.event.description, "event_description", 2000);
  nullableText(value.event.timeReference, "event_time_reference", 500);
  nullableText(value.event.location, "event_location", 300);
  stringList(value.event.participants, "event_participants", 30, 200);
  if (value.event.participants.some((name) => !entityNames.has(name))) throw new StoryUnderstandingValidationError("event_participant_not_extracted");
  enumValue(value.event.basis, bases, "event_basis");
  confidence(value.event.confidence, "event_confidence");

  if (!Array.isArray(value.timeReferences) || value.timeReferences.length > 50) throw new StoryUnderstandingValidationError("time_references_invalid");
  value.timeReferences.forEach((entry, index) => {
    const path = `time_reference_${index}`;
    shape(entry, ["text", "type", "normalizedIso", "basis", "confidence"], path);
    text(entry.text, `${path}_text`, 300);
    enumValue(entry.type, timeTypes, `${path}_type`);
    isoDate(entry.normalizedIso, `${path}_normalized_iso`);
    enumValue(entry.basis, bases, `${path}_basis`);
    confidence(entry.confidence, `${path}_confidence`);
  });

  if (!Array.isArray(value.keyClaims) || value.keyClaims.length > 100) throw new StoryUnderstandingValidationError("key_claims_invalid");
  value.keyClaims.forEach((claim, index) => {
    const path = `claim_${index}`;
    shape(claim, ["text", "claimType", "referencedEntities", "sourceContext", "extractionConfidence"], path);
    text(claim.text, `${path}_text`, 3000);
    enumValue(claim.claimType, claimTypes, `${path}_type`);
    stringList(claim.referencedEntities, `${path}_entities`, 30, 200);
    if (claim.referencedEntities.some((name) => !entityNames.has(name))) throw new StoryUnderstandingValidationError(`${path}_entity_not_extracted`);
    nullableText(claim.sourceContext, `${path}_source_context`, 1000);
    confidence(claim.extractionConfidence, `${path}_confidence`);
  });

  shape(value.uncertainty, ["ambiguities", "missingInformation", "unresolvedEntities", "internalConflicts", "lowConfidenceInterpretations"], "uncertainty");
  stringList(value.uncertainty.ambiguities, "uncertainty_ambiguities", 50);
  stringList(value.uncertainty.missingInformation, "uncertainty_missing_information", 50);
  stringList(value.uncertainty.unresolvedEntities, "uncertainty_unresolved_entities", 100, 200);
  stringList(value.uncertainty.internalConflicts, "uncertainty_internal_conflicts", 50);
  stringList(value.uncertainty.lowConfidenceInterpretations, "uncertainty_low_confidence", 50);
  if (value.uncertainty.unresolvedEntities.some((name) => !unresolvedEntityNames.has(name))) throw new StoryUnderstandingValidationError("uncertainty_unresolved_entity_not_unresolved");

  return value as unknown as StoryUnderstandingOutput;
}
