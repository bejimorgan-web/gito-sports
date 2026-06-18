// CORE TYPES
export type { EntityId, EntityStatus } from "./naming";
export { createSlug } from "./naming";

// SPORTS
export type {
  Sport,
  Country,
  Season,
  Competition,
  Team,
  Match,
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
} from "./sports";

export type {
  MatchLifecycleStatus,
  StreamLifecycleStatus
} from "./lifecycle";

export { canTransitionMatch, canTransitionStream } from "./lifecycle";

// STREAMS
export type {
  IPTVProvider,
  IptvProvider,
  Channel,
  ChannelDebug,
  Stream,
  MatchStream
} from "./streams";

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
} from "./operations";