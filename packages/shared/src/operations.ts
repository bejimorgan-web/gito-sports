import type { EntityId } from "./naming.js";
import type { Match } from "./sports.js";
import type { Channel, IPTVProvider, ProviderType, Stream, StreamHealthStatus } from "./streams.js";

export interface ProviderConnectionTest {
  ok: boolean;
  statusCode?: number;
  message: string;
  detectedType?: ProviderType;
  channelsAvailable?: number;
  categories?: string[];
  stages?: Array<{ name: string; ok: boolean; message: string }>;
}

export type IptvOperationType = "xtream_validation" | "m3u_validation" | "m3u_import" | "xtream_channel_sync";
export type IptvOperationStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export interface IptvOperation {
  id: string;
  type: IptvOperationType;
  status: IptvOperationStatus;
  startedAt: string;
  completedAt?: string;
  total?: number;
  processed: number;
  succeeded: number;
  updated: number;
  skipped: number;
  failed: number;
  currentStage: string;
  currentMessage: string;
  error?: string;
  cancelled: boolean;
  createdBy?: string;
}

export interface PaginatedChannels<T = Channel> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ParsedChannel {
  name: string;
  url: string;
  externalRef?: string;
  groupName?: string;
  contentType?: "live" | "movie" | "series";
}

export interface ProviderIngestionResult {
  provider: IPTVProvider;
  channelsCreated: number;
  categories: string[];
}

export interface MatchAssignmentRequest {
  canonicalFixtureId?: EntityId;
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
