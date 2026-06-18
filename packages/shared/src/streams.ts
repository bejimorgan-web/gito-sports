import type { EntityId, EntityStatus } from "./naming.js";
import type { StreamLifecycleStatus } from "./lifecycle.js";

export type ProviderAuthType = "none" | "basic" | "token";

export type ProviderType = "manual" | "m3u" | "xtream";

export type ProviderSyncMode = "partial" | "full";

export type ChannelListMode = "active" | "includeInactive" | "debug" | "raw";

export type ProviderLifecycleStatus = "active" | "pending" | "failed" | "invalid" | "inactive";

export type StreamApprovalStatus = StreamLifecycleStatus;

export type StreamProtocol = "hls" | "dash" | "rtsp" | "other";

export type StreamHealthStatus = "active" | "degraded" | "failed" | "unknown";

export type ProviderAvailabilityStatus = "online" | "offline" | "degraded" | "unknown";

export interface IPTVProvider {
  id: EntityId;
  name: string;
  baseUrl: string;
  type: ProviderType;
  authType: ProviderAuthType;
  syncMode?: ProviderSyncMode;
  status: ProviderLifecycleStatus;
  availabilityStatus: ProviderAvailabilityStatus;
  failedChannelLoads: number;
  healthScore: number;
  lastSuccessfulStreamLoadAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type IptvProvider = IPTVProvider;

export interface Channel {
  id: EntityId;
  providerId: EntityId;
  name: string;
  externalRef?: string;
  groupName?: string;
  url: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export type ChannelExcludedReason = "provider_deleted" | "archived" | "inactive" | "stale" | null;

export interface ChannelDebug extends Channel {
  excludedReason: ChannelExcludedReason;
}

export interface ProviderChannelDiagnostics {
  providerId: EntityId;
  status: ProviderLifecycleStatus;
  availabilityStatus: ProviderAvailabilityStatus;
  healthScore: number;
  syncMode?: ProviderSyncMode;
  lastSuccessfulStreamLoadAt?: string;
  totalChannels: number;
  counts: {
    active: number;
    inactive: number;
    stale: number;
    archived: number;
  };
}

export type StreamSource = Channel;

export interface Stream {
  id: EntityId;
  matchId: EntityId;
  channelId: EntityId;
  protocol: StreamProtocol;
  status: StreamLifecycleStatus;
  approvalStatus: StreamApprovalStatus;
  healthStatus: StreamHealthStatus;
  healthReason?: string;
  failureCount: number;
  lastHealthAt?: string;
  approvedByUserId?: EntityId;
  approvedAt?: string;
  rejectionReason?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type MatchStream = Stream;
