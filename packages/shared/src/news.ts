import type { EntityId, EntityStatus } from "./naming.js";
import type { Competition, Country, Match, Sport, Team } from "./sports.js";

export type NewsArticleStatus = "draft" | "review" | "published" | "archived";
export type NewsSourceType = "external" | "partner" | "wire" | "internal";
export type NewsMediaType = "image" | "video" | "embed";
export type NewsArticleBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "image"; url: string; altText?: string | null; caption?: string | null }
  | { type: "video"; url: string; platform?: string | null; caption?: string | null }
  | { type: "social"; url: string; platform: string; caption?: string | null; enabled?: boolean };
export type NewsContentAvailability = "full_feed_content" | "summary_only" | "no_content";
export type NewsContentOrigin = "summary" | "rss_full" | "fetched_page" | "manual" | "gito_ai";
export type NewsFetchStatus = "idle" | "success" | "failed";
export type NewsRightsAuditStatus = "unknown" | "full_republication_permitted" | "republication_permitted_with_conditions" | "limited_use_only" | "republication_not_permitted" | "review_required";
export type NewsRightsEvidenceType = "rss_terms" | "terms_of_use" | "copyright_policy" | "republication_policy" | "syndication" | "licensing" | "other";
export type NewsSourceRightsEvidenceOrigin = "publisher" | "feed_host" | "third_party";
export type NewsSourcePublishingPermission = "full_article_republication" | "headline" | "summary_excerpt" | "original_link_reference" | "commercial_use" | "modification" | "attribution" | "image_reuse" | "video_reuse" | "ai_assisted_original_story";
export type NewsArticleCategoryType = "sport" | "country" | "team" | "competition" | "match";
export type NewsClassificationStatus = "suggested" | "approved" | "rejected";
export type NewsClassificationSource = "deterministic" | "editorial" | "ai" | "import";

export interface NewsArticleCategory {
  id: string;
  articleId: string;
  categoryType: NewsArticleCategoryType;
  entityId: string;
  confidence: number;
  reason?: string | null;
  classificationSource: NewsClassificationSource;
  classificationStatus: NewsClassificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewsArticleCategoryInput {
  categoryType: NewsArticleCategoryType;
  entityId: string;
}

export interface NewsClassificationSuggestion {
  id?: string;
  articleId: EntityId;
  categoryType: NewsArticleCategoryType;
  entityId: EntityId;
  confidence: number;
  reason: string;
  classificationSource: NewsClassificationSource;
  classificationStatus: NewsClassificationStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface NewsSourceRightsEvidence {
  id: EntityId;
  auditId: EntityId;
  evidenceUrl: string;
  pageTitle?: string | null;
  evidenceType: NewsRightsEvidenceType;
  evidenceDomain?: string | null;
  evidenceOrigin?: NewsSourceRightsEvidenceOrigin | null;
  matchedRule?: string | null;
  snippet?: string | null;
  checkedAt: string;
  createdAt: string;
}

export interface NewsSourceRightsPermission {
  id: EntityId;
  auditId: EntityId;
  permission: NewsSourcePublishingPermission;
  allowed: boolean;
  notes?: string | null;
  evidenceUrl?: string | null;
  createdAt: string;
}

export interface NewsSourceRightsAudit {
  id: EntityId;
  sourceId: EntityId;
  status: NewsRightsAuditStatus;
  summary?: string | null;
  reviewNotes?: string | null;
  administratorDecision?: string | null;
  checkedAt: string;
  createdAt: string;
  updatedAt: string;
  evidence: NewsSourceRightsEvidence[];
  permissions: NewsSourceRightsPermission[];
}

export interface NewsSource {
  id: EntityId;
  name: string;
  sourceType: NewsSourceType;
  baseUrl?: string | null;
  feedUrl?: string | null;
  enabled: boolean;
  collectionIntervalMinutes?: number | null;
  lastCollectedAt?: string | null;
  lastCollectionStatus?: string | null;
  lastCollectionMessage?: string | null;
  lastCollectionAttemptAt?: string | null;
  lastCollectionSucceededAt?: string | null;
  lastCollectionError?: string | null;
  lastCollectionDiscoveredCount?: number | null;
  lastCollectionNewCount?: number | null;
  lastCollectionDuplicateCount?: number | null;
  rightsStatus?: NewsRightsAuditStatus | null;
  rightsLastCheckedAt?: string | null;
  rightsReviewNotes?: string | null;
  rightsAdministratorDecision?: string | null;
  rightsDecisionAt?: string | null;
  rightsAuditSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewsArticleMedia {
  id: EntityId;
  articleId: EntityId;
  mediaType: NewsMediaType;
  url: string;
  altText?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface NewsArticleLink {
  id: EntityId;
  articleId: EntityId;
  url: string;
  label?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface NewsArticleAuditEntry {
  id: EntityId;
  articleId: EntityId;
  actorId?: string | null;
  action: string;
  note?: string | null;
  createdAt: string;
}

export interface NewsArticle {
  id: EntityId;
  title: string;
  slug: string;
  summary?: string | null;
  body?: string | null;
  bodyBlocks?: NewsArticleBodyBlock[];
  status: NewsArticleStatus;
  sportId?: string | null;
  competitionId?: string | null;
  teamId?: string | null;
  countryId?: string | null;
  matchId?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  externalId?: string | null;
  author?: string | null;
  categories?: NewsArticleCategory[];
  tags?: string[];
  contentAvailability?: NewsContentAvailability | null;
  contentOrigin?: NewsContentOrigin | null;
  fetchedBody?: string | null;
  fetchedAt?: string | null;
  fetchStatus?: NewsFetchStatus | null;
  fetchError?: string | null;
  createdBy?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sport?: Pick<Sport, "id" | "name"> | null;
  competition?: Pick<Competition, "id" | "name"> | null;
  team?: Pick<Team, "id" | "name"> | null;
  country?: Pick<Country, "id" | "name"> | null;
  match?: Pick<Match, "id"> | null;
  source?: Pick<NewsSource, "id" | "name" | "sourceType"> | null;
  media?: NewsArticleMedia[];
  links?: NewsArticleLink[];
  audit?: NewsArticleAuditEntry[];
}

export interface CreateNewsArticleRequest {
  title: string;
  slug?: string;
  summary?: string | null;
  body?: string | null;
  bodyBlocks?: NewsArticleBodyBlock[];
  status?: NewsArticleStatus;
  sportId?: string | null;
  competitionId?: string | null;
  teamId?: string | null;
  countryId?: string | null;
  matchId?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  externalId?: string | null;
  author?: string | null;
  categories?: Array<NewsArticleCategoryInput | string>;
  tags?: string[];
  contentAvailability?: NewsContentAvailability | null;
  contentOrigin?: NewsContentOrigin | null;
  fetchedBody?: string | null;
  fetchedAt?: string | null;
  fetchStatus?: NewsFetchStatus | null;
  fetchError?: string | null;
  createdBy?: string | null;
  publishedAt?: string | null;
  classificationMode?: "editorial" | "suggestion";
}

export interface UpdateNewsArticleRequest {
  title?: string;
  slug?: string;
  summary?: string | null;
  body?: string | null;
  bodyBlocks?: NewsArticleBodyBlock[];
  status?: NewsArticleStatus;
  sportId?: string | null;
  competitionId?: string | null;
  teamId?: string | null;
  countryId?: string | null;
  matchId?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  externalId?: string | null;
  author?: string | null;
  categories?: Array<NewsArticleCategoryInput | string>;
  tags?: string[];
  contentAvailability?: NewsContentAvailability | null;
  contentOrigin?: NewsContentOrigin | null;
  fetchedBody?: string | null;
  fetchedAt?: string | null;
  fetchStatus?: NewsFetchStatus | null;
  fetchError?: string | null;
  publishedAt?: string | null;
}

export interface CreateNewsSourceRequest {
  name: string;
  sourceType?: NewsSourceType;
  baseUrl?: string | null;
  feedUrl?: string | null;
  enabled?: boolean;
  collectionIntervalMinutes?: number | null;
  rightsStatus?: NewsRightsAuditStatus | null;
  rightsLastCheckedAt?: string | null;
  rightsReviewNotes?: string | null;
  rightsAdministratorDecision?: string | null;
  rightsDecisionAt?: string | null;
  rightsAuditSummary?: string | null;
}

export interface UpdateNewsSourceRequest {
  name?: string;
  sourceType?: NewsSourceType;
  baseUrl?: string | null;
  feedUrl?: string | null;
  enabled?: boolean;
  collectionIntervalMinutes?: number | null;
  rightsStatus?: NewsRightsAuditStatus | null;
  rightsLastCheckedAt?: string | null;
  rightsReviewNotes?: string | null;
  rightsAdministratorDecision?: string | null;
  rightsDecisionAt?: string | null;
  rightsAuditSummary?: string | null;
}

export type NewsResearchSourceType = "original_publisher" | "official_organization" | "reputable_news" | "specialist_publication" | "secondary_source" | "search_lead";
export type NewsResearchFactStatus = "verified" | "strongly_supported" | "conflicting" | "insufficient_evidence" | "unsupported";
export type NewsResearchConfidence = "high" | "medium" | "low";
export type NewsResearchStatus = "completed" | "failed" | "insufficient_evidence";

export interface NewsResearchSource {
  id: string;
  url: string;
  domain: string;
  title?: string | null;
  publisher?: string | null;
  sourceType: NewsResearchSourceType;
  retrievedAt: string;
  relevance: number;
  authorityLevel: number;
  extractedFacts: string[];
  evidenceSnippets: string[];
  isPrimarySource: boolean;
}

export interface NewsResearchFact {
  id: string;
  statement: string;
  importance: "high" | "medium" | "low";
  sources: string[];
  agreement: number;
  confidence: NewsResearchConfidence;
  status: NewsResearchFactStatus;
}

export interface NewsResearchConflict {
  id: string;
  topic: string;
  details: string;
  sources: string[];
  recommendedAction: string;
}

export interface NewsResearchResult {
  query: string;
  researchedAt: string;
  sources: NewsResearchSource[];
  verifiedFacts: NewsResearchFact[];
  disputedFacts: NewsResearchFact[];
  unsupportedClaims: string[];
  keyEvents: string[];
  people: string[];
  organizations: string[];
  statistics: string[];
  timeline: Array<{ label: string; detail: string }>;
  confidence: NewsResearchConfidence;
  researchStatus: NewsResearchStatus;
  summary: string;
  conflicts: NewsResearchConflict[];
}

export interface CollectNewsSourceRequest {
  sourceId: string;
}

export interface NewsQueryOptions {
  status?: NewsArticleStatus;
  sportId?: string;
  competitionId?: string;
  teamId?: string;
  countryId?: string;
  matchId?: string;
  sourceId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}
