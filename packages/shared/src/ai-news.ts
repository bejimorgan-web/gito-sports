export const aiNewsTaskTypes = [
  "story_understanding",
  "story_clustering",
  "research",
  "claim_extraction",
  "claim_verification",
  "article_generation",
  "article_validation",
  "editor_assistance"
] as const;

export type AiNewsTaskType = typeof aiNewsTaskTypes[number];

export const aiNewsTaskStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type AiNewsTaskStatus = typeof aiNewsTaskStatuses[number];

export interface AiNewsUsageMetadata {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  currency?: string | null;
  providerReported?: Record<string, unknown> | null;
}

export interface CreateAiNewsTaskRequest {
  taskType: AiNewsTaskType;
  articleId?: string | null;
  promptVersion: string;
  correlationId?: string;
  idempotencyKey?: string | null;
}

export interface AiNewsTask {
  id: string;
  taskType: AiNewsTaskType;
  status: AiNewsTaskStatus;
  articleId?: string | null;
  actorId: string;
  actorRole: string;
  provider: string;
  model: string;
  promptVersion: string;
  correlationId: string;
  idempotencyKey?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  usage?: AiNewsUsageMetadata | null;
}

export interface AiNewsGeneration {
  id: string;
  taskId: string;
  taskType: AiNewsTaskType;
  articleId?: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  correlationId: string;
  output: unknown;
  createdAt: string;
}

export type StoryUnderstandingBasis = "directly_stated" | "ai_interpretation" | "unresolved";
export type StoryUnderstandingStoryType = "match" | "transfer" | "injury" | "team_news" | "player_news" | "manager_news" | "competition_news" | "result" | "fixture" | "standings" | "statistics" | "disciplinary" | "business" | "other";
export type StoryUnderstandingIntent = "breaking_news" | "report" | "preview" | "reaction" | "analysis" | "transfer_update" | "announcement" | "result_report" | "other";
export type StoryUnderstandingEntityType = "person" | "team" | "club" | "competition" | "country" | "sport" | "match" | "host" | "venue" | "organization" | "other";
export type StoryUnderstandingTimeType = "exact_date" | "relative_date" | "season" | "kickoff" | "publication_relative" | "other";
export type StoryUnderstandingClaimType = "match_event" | "result" | "transfer" | "injury" | "selection" | "quote" | "statistic" | "date_time" | "other";

export interface StoryUnderstandingCanonicalEntity {
  entityType: StoryUnderstandingEntityType;
  id: string;
  name: string | null;
}

export interface StoryUnderstandingInput {
  articleId: string;
  title: string;
  summary: string | null;
  body: string | null;
  fetchedBody: string | null;
  author: string | null;
  source: {
    id: string | null;
    name: string | null;
    type: string | null;
    url: string | null;
  };
  publishedAt: string | null;
  contentAvailability: string | null;
  categories: Array<{ entityType: StoryUnderstandingEntityType; entityId: string; status: "approved" | "suggested" | "rejected" }>;
  tags: string[];
  canonicalEntities: StoryUnderstandingCanonicalEntity[];
}

export interface StoryUnderstandingEntity {
  name: string;
  entityType: StoryUnderstandingEntityType;
  canonicalEntityId: string | null;
  resolutionStatus: "matched_existing_relationship" | "unresolved";
  sourceText: string | null;
  basis: StoryUnderstandingBasis;
  confidence: number;
}

export interface StoryUnderstandingOutput {
  schemaVersion: "story-understanding-v1";
  subject: {
    primaryTopic: string;
    topicSummary: string | null;
    storyType: StoryUnderstandingStoryType;
    basis: StoryUnderstandingBasis;
    confidence: number;
  };
  intent: {
    value: StoryUnderstandingIntent;
    basis: StoryUnderstandingBasis;
    confidence: number;
  };
  entities: StoryUnderstandingEntity[];
  event: {
    eventType: StoryUnderstandingStoryType | null;
    description: string | null;
    timeReference: string | null;
    location: string | null;
    participants: string[];
    basis: StoryUnderstandingBasis;
    confidence: number;
  };
  timeReferences: Array<{
    text: string;
    type: StoryUnderstandingTimeType;
    normalizedIso: string | null;
    basis: StoryUnderstandingBasis;
    confidence: number;
  }>;
  keyClaims: Array<{
    text: string;
    claimType: StoryUnderstandingClaimType;
    referencedEntities: string[];
    sourceContext: string | null;
    extractionConfidence: number;
  }>;
  uncertainty: {
    ambiguities: string[];
    missingInformation: string[];
    unresolvedEntities: string[];
    internalConflicts: string[];
    lowConfidenceInterpretations: string[];
  };
}
