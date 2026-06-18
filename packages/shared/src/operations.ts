import type { EntityId } from "./naming";
import type { Match } from "./sports";
import type { Channel, IPTVProvider, ProviderType, Stream, StreamHealthStatus } from "./streams";

export interface ProviderConnectionTest {
  ok: boolean;
  statusCode?: number;
  message: string;
}

export interface ParsedChannel {
  name: string;
  url: string;
  externalRef?: string;
  groupName?: string;
}

export interface ProviderIngestionResult {
  provider: IPTVProvider;
  channelsCreated: number;
  categories: string[];
}

export interface MatchAssignmentRequest {
  sportName: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  startsAt: string;
  channelId: EntityId;
  venueName?: string;
}

export interface MatchAssignmentResult {
  match: Match;
  stream: Stream;
  channel: Channel;
}

export interface MatchStreamAssignmentRequest {
  channelId: EntityId;
  priority?: number;
  isActive?: boolean;
}

export interface MatchStreamAssignment {
  id: EntityId;
  matchId: EntityId;
  channelId: EntityId;
  providerId: EntityId;
  streamUrl: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MatchStreamAssignmentResult {
  match: Match;
  channel: Channel;
  assignment: MatchStreamAssignment;
}

export interface PublishedLiveMatch {
  match: Match;
  stream: Stream;
  channel: Channel;
  provider: Pick<IPTVProvider, "id" | "name" | "type" | "status" | "availabilityStatus" | "healthScore">;
  playbackUrl: string;
  homeTeamName?: string;
  awayTeamName?: string;
  competitionName?: string;
  homeTeamLogoUrl?: string;
  awayTeamLogoUrl?: string;
  competitionLogoUrl?: string;
  sportLogoUrl?: string;
  countryLogoUrl?: string;
}

export interface CreateProviderRequest {
  name: string;
  baseUrl: string;
  type: ProviderType;
  authType?: "none" | "basic" | "token";
  syncMode?: "partial" | "full";
  username?: string;
  password?: string;
}

export interface UpdateProviderRequest extends Partial<CreateProviderRequest> {
  status?: "active" | "pending" | "failed" | "invalid";
}

export interface StreamHealthReport {
  status: StreamHealthStatus;
  reason?: string;
  channelId?: EntityId;
}

export interface OperationalLogEntry {
  id: EntityId;
  eventType: string;
  entityType: string;
  entityId?: EntityId;
  message: string;
  severity: "info" | "warning" | "error";
  createdAt: string;
}
