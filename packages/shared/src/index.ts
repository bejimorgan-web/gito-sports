// CORE TYPES
export type { EntityId, EntityStatus } from "./naming.js";
export { createSlug } from "./naming.js";

// SPORTS
export type {
  Sport,
  Country,
  Season,
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
} from "./sports.js";

export type {
  MatchLifecycleStatus,
  StreamLifecycleStatus
} from "./lifecycle.js";

export { canTransitionMatch, canTransitionStream } from "./lifecycle.js";

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
