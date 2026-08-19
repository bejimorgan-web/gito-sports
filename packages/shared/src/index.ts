// CORE TYPES
export type { EntityId, EntityStatus } from "./naming.js";
export { createSlug } from "./naming.js";

// SPORTS
export type {
  Sport,
  Country,
  Season,
  CreateSeasonRequest,
  UpdateSeasonRequest,
  CompetitionSeasonTeam,
  ClubDetail,
  Competition,
  Team,
  Match,
  CompetitionParticipantType,
  CompetitionScope,
  CompetitionType,
  TeamType,
  CreateSportRequest,
  UpdateSportRequest,
  CreateCountryRequest,
  UpdateCountryRequest,
  CreateCompetitionRequest,
  UpdateCompetitionRequest,
  CreateTeamRequest,
  UpdateTeamRequest,
  CreateMatchRequest,
  UpdateMatchRequest
  ,FixtureLinkStatus
  ,FixtureConfidence
  ,FixtureReconciliationCandidate
  ,FixtureReconciliationDecision
  ,FixtureReconciliationPreview
} from "./sports.js";

export type {
  MatchLifecycleStatus,
  StreamLifecycleStatus
} from "./lifecycle.js";

export { canTransitionMatch, canTransitionStream } from "./lifecycle.js";

// NEWS
export type {
  NewsArticle,
  NewsArticleAuditEntry,
  NewsArticleCategory,
  NewsArticleCategoryInput,
  NewsClassificationSuggestion,
  NewsClassificationStatus,
  NewsClassificationSource,
  NewsArticleCategoryType,
  NewsArticleLink,
  NewsArticleMedia,
  NewsArticleStatus,
  NewsContentAvailability,
  NewsContentOrigin,
  NewsFetchStatus,
  NewsMediaType,
  NewsQueryOptions,
  NewsSource,
  NewsSourceType,
  CreateNewsArticleRequest,
  UpdateNewsArticleRequest,
  CreateNewsSourceRequest,
  UpdateNewsSourceRequest,
  CollectNewsSourceRequest,
  NewsRightsAuditStatus,
  NewsRightsEvidenceType,
  NewsSourceRightsEvidenceOrigin,
  NewsSourceRightsAudit,
  NewsSourceRightsEvidence,
  NewsSourceRightsPermission,
  NewsResearchSourceType,
  NewsResearchFactStatus,
  NewsResearchConfidence,
  NewsResearchStatus,
  NewsResearchSource,
  NewsResearchFact,
  NewsResearchConflict,
  NewsResearchResult
} from "./news.js";

// STREAMS
export type {
  IPTVProvider,
  IptvProvider,
  Channel,
  ChannelDebug,
  ChannelListMode,
  ProviderChannelDiagnostics,
  Stream,
  MatchStream
} from "./streams.js";

export type {
  ProviderConnectionTest,
  ParsedChannel,
  ProviderIngestionResult,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  MatchStreamAssignmentRequest,
  MatchStreamAssignment,
  MatchStreamAssignmentResult,
  PublishedLiveMatch,
  CreateProviderRequest,
  UpdateProviderRequest,
  StreamHealthReport,
  OperationalLogEntry
} from "./operations.js";

export type {
  MobileClub,
  MobileSeason,
  MobileStream,
  MobileFixture,
  MobileClubDetail
} from "./mobile.js";
