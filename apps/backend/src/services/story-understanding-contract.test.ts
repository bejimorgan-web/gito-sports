import assert from "node:assert/strict";
import test from "node:test";
import type { StoryUnderstandingInput } from "@gito/shared";
import { formatSafeStoryUnderstandingValidationDiagnostic, MAX_STORY_UNDERSTANDING_OUTPUT_BYTES, STORY_UNDERSTANDING_PROMPT_VERSION, StoryUnderstandingValidationError, validateStoryUnderstandingOutput } from "./story-understanding-contract.js";

const input: StoryUnderstandingInput = {
  articleId: "article-1", title: "City beat United", summary: null, body: "City beat United 2-1 next weekend.", fetchedBody: null,
  author: null, source: { id: null, name: "Example", type: null, url: null }, publishedAt: null, contentAvailability: null,
  categories: [], tags: [], canonicalEntities: [{ entityType: "club", id: "club-1", name: "City" }]
};
function valid() {
  return {
    schemaVersion: STORY_UNDERSTANDING_PROMPT_VERSION,
    subject: { primaryTopic: "City's result", topicSummary: null, storyType: "result", basis: "ai_interpretation", confidence: 0.8 },
    intent: { value: "result_report", basis: "ai_interpretation", confidence: 0.8 },
    entities: [
      { name: "City", entityType: "club", canonicalEntityId: "club-1", resolutionStatus: "matched_existing_relationship", sourceText: "City", basis: "directly_stated", confidence: 1 },
      { name: "United", entityType: "club", canonicalEntityId: null, resolutionStatus: "unresolved", sourceText: "United", basis: "directly_stated", confidence: 0.9 }
    ],
    event: { eventType: "result", description: "City beat United 2-1", timeReference: "next weekend", location: null, participants: ["City", "United"], basis: "directly_stated", confidence: 0.9 },
    timeReferences: [{ text: "next weekend", type: "relative_date", normalizedIso: null, basis: "directly_stated", confidence: 1 }],
    keyClaims: [{ text: "City beat United 2-1", claimType: "result", referencedEntities: ["City", "United"], sourceContext: "City beat United 2-1 next weekend.", extractionConfidence: 0.9 }],
    uncertainty: { ambiguities: ["Timing is relative."], missingInformation: [], unresolvedEntities: ["United"], internalConflicts: [], lowConfidenceInterpretations: [] }
  };
}

test("accepts bounded structured understanding and preserves unresolved temporal ambiguity", () => {
  const result = validateStoryUnderstandingOutput(valid(), input);
  assert.equal(result.timeReferences[0]?.normalizedIso, null);
  assert.deepEqual(result.uncertainty.unresolvedEntities, ["United"]);
});

test("rejects malformed, unbounded, unverifiable, and unsupplied canonical output", () => {
  const cases: Array<(value: any) => void> = [
    (value) => { delete value.subject.primaryTopic; },
    (value) => { value.subject.storyType = "verified"; },
    (value) => { value.subject.confidence = 1.01; },
    (value) => { value.entities[0].canonicalEntityId = "guess-99"; },
    (value) => { value.keyClaims[0].referencedEntities = []; delete value.keyClaims[0].text; },
    (value) => { value.verificationStatus = "verified"; },
    (value) => { value.subject.primaryTopic = "x".repeat(MAX_STORY_UNDERSTANDING_OUTPUT_BYTES + 1); }
  ];
  for (const mutate of cases) {
    const value = valid(); mutate(value);
    assert.throws(() => validateStoryUnderstandingOutput(value, input));
  }
});

test("formats only bounded allowlisted Story Understanding validation codes", () => {
  assert.equal(
    formatSafeStoryUnderstandingValidationDiagnostic(new StoryUnderstandingValidationError("claim_99_entities_29_invalid")),
    "AI_OUTPUT_VALIDATION_FAILED validationCode=claim_99_entities_29_invalid"
  );
  assert.equal(
    formatSafeStoryUnderstandingValidationDiagnostic(new StoryUnderstandingValidationError("private_article_text")),
    undefined
  );
  assert.equal(
    formatSafeStoryUnderstandingValidationDiagnostic(new StoryUnderstandingValidationError("x".repeat(81))),
    undefined
  );
});
