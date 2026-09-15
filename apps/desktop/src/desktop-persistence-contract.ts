import type { IptvOperation, IptvOperationType, ProviderConnectionTest } from "@gito/shared";

export type DesktopProviderType = "manual" | "m3u" | "xtream";
export type DesktopProviderStatus = "active" | "pending" | "failed" | "invalid" | "inactive";
export type DesktopAvailability = "online" | "offline" | "degraded" | "unknown";
export type DesktopContentType = "live" | "movie" | "series";
export type DesktopRecordStatus = "active" | "inactive" | "archived" | "stale";

export interface DesktopProviderAccount {
  id: string;
  name: string;
  type: DesktopProviderType;
  baseUrl: string;
  credentialStoreRef: string;
  expiresAt: string | null;
  status: DesktopProviderStatus;
  availability: DesktopAvailability;
  lastValidatedAt: string | null;
  healthReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopProviderAccountInput {
  name: string;
  type: DesktopProviderType;
  baseUrl: string;
  credentialStoreRef: string;
  expiresAt?: string | null;
  status?: DesktopProviderStatus;
  availability?: DesktopAvailability;
  lastValidatedAt?: string | null;
  healthReason?: string | null;
}

export interface DesktopChannel {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  name: string;
  groupName: string | null;
  logoUrl: string | null;
  playbackUrl: string;
  contentType: DesktopContentType;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopChannelInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  name: string;
  groupName?: string | null;
  logoUrl?: string | null;
  playbackUrl: string;
  contentType?: DesktopContentType;
  status?: DesktopRecordStatus;
}

export interface DesktopCatalogueCategory {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  name: string;
  contentType: DesktopContentType;
  sortOrder: number | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopCatalogueCategoryInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  name: string;
  contentType?: DesktopContentType;
  sortOrder?: number | null;
  status?: DesktopRecordStatus;
}

export interface DesktopEpgChannel {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  channelId: string | null;
  name: string;
  logoUrl: string | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopEpgChannelInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  channelId?: string | null;
  name: string;
  logoUrl?: string | null;
  status?: DesktopRecordStatus;
}

export interface DesktopEpgProgramme {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  epgChannelId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  metadataJson: string | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopEpgProgrammeInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  epgChannelId: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  metadataJson?: string | null;
  status?: DesktopRecordStatus;
}

export interface DesktopMovie {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  categoryId: string | null;
  name: string;
  description: string | null;
  logoUrl: string | null;
  posterUrl: string | null;
  contentType: DesktopContentType;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopMovieInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  categoryId?: string | null;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  posterUrl?: string | null;
  contentType?: DesktopContentType;
  status?: DesktopRecordStatus;
}

export interface DesktopSeries {
  id: string;
  providerAccountId: string;
  externalReference: string | null;
  categoryId: string | null;
  name: string;
  description: string | null;
  logoUrl: string | null;
  posterUrl: string | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopSeriesInput {
  id?: string;
  providerAccountId: string;
  externalReference?: string | null;
  categoryId?: string | null;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  posterUrl?: string | null;
  status?: DesktopRecordStatus;
}

export interface DesktopSeason {
  id: string;
  providerAccountId: string;
  seriesId: string;
  externalReference: string | null;
  seasonNumber: number | null;
  name: string | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopSeasonInput {
  id?: string;
  providerAccountId: string;
  seriesId: string;
  externalReference?: string | null;
  seasonNumber?: number | null;
  name?: string | null;
  status?: DesktopRecordStatus;
}

export interface DesktopEpisode {
  id: string;
  providerAccountId: string;
  seriesId: string;
  seasonId: string | null;
  externalReference: string | null;
  episodeNumber: number | null;
  name: string | null;
  description: string | null;
  logoUrl: string | null;
  status: DesktopRecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopEpisodeInput {
  id?: string;
  providerAccountId: string;
  seriesId: string;
  seasonId?: string | null;
  externalReference?: string | null;
  episodeNumber?: number | null;
  name?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  status?: DesktopRecordStatus;
}

export interface DesktopPublicationSource {
  publicationId: string;
  sourceReference: string;
  providerAccountId: string | null;
  channelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopPublicationSourceInput {
  publicationId: string;
  sourceReference: string;
  providerAccountId?: string | null;
  channelId?: string | null;
}

export interface DesktopIptvOperation {
  id: string;
  providerAccountId: string | null;
  operationType: string;
  status: string;
  processed: number;
  succeeded: number;
  failed: number;
  checkpoint: string | null;
  cancellationRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopIptvOperationInput {
  id?: string;
  providerAccountId?: string | null;
  operationType: string;
  status?: string;
  processed?: number;
  succeeded?: number;
  failed?: number;
  checkpoint?: string | null;
  cancellationRequested?: boolean;
  error?: string | null;
}

export interface DesktopStorageApi {
  providerAccounts: {
    list(): Promise<DesktopProviderAccount[]>;
    get(id: string): Promise<DesktopProviderAccount | null>;
    create(input: DesktopProviderAccountInput): Promise<DesktopProviderAccount>;
    update(id: string, input: Partial<DesktopProviderAccountInput>): Promise<DesktopProviderAccount | null>;
    delete(id: string): Promise<boolean>;
  };
  channels: {
    list(providerAccountId?: string): Promise<DesktopChannel[]>;
    get(id: string): Promise<DesktopChannel | null>;
    upsert(input: DesktopChannelInput): Promise<DesktopChannel>;
  };
  categories: {
    list(providerAccountId?: string, contentType?: DesktopContentType): Promise<DesktopCatalogueCategory[]>;
    get(id: string): Promise<DesktopCatalogueCategory | null>;
    upsert(input: DesktopCatalogueCategoryInput): Promise<DesktopCatalogueCategory>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopCatalogueCategory | null>;
  };
  epgChannels: {
    list(providerAccountId?: string): Promise<DesktopEpgChannel[]>;
    get(id: string): Promise<DesktopEpgChannel | null>;
    upsert(input: DesktopEpgChannelInput): Promise<DesktopEpgChannel>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopEpgChannel | null>;
  };
  epgProgrammes: {
    list(providerAccountId?: string, epgChannelId?: string): Promise<DesktopEpgProgramme[]>;
    get(id: string): Promise<DesktopEpgProgramme | null>;
    upsert(input: DesktopEpgProgrammeInput): Promise<DesktopEpgProgramme>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopEpgProgramme | null>;
  };
  movies: {
    list(providerAccountId?: string): Promise<DesktopMovie[]>;
    get(id: string): Promise<DesktopMovie | null>;
    upsert(input: DesktopMovieInput): Promise<DesktopMovie>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopMovie | null>;
  };
  series: {
    list(providerAccountId?: string): Promise<DesktopSeries[]>;
    get(id: string): Promise<DesktopSeries | null>;
    upsert(input: DesktopSeriesInput): Promise<DesktopSeries>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopSeries | null>;
  };
  seasons: {
    list(providerAccountId?: string, seriesId?: string): Promise<DesktopSeason[]>;
    get(id: string): Promise<DesktopSeason | null>;
    upsert(input: DesktopSeasonInput): Promise<DesktopSeason>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopSeason | null>;
  };
  episodes: {
    list(providerAccountId?: string, seriesId?: string, seasonId?: string): Promise<DesktopEpisode[]>;
    get(id: string): Promise<DesktopEpisode | null>;
    upsert(input: DesktopEpisodeInput): Promise<DesktopEpisode>;
    delete(id: string): Promise<boolean>;
    archive(id: string): Promise<DesktopEpisode | null>;
  };
  publicationSources: {
    list(): Promise<DesktopPublicationSource[]>;
    get(publicationId: string): Promise<DesktopPublicationSource | null>;
    upsert(input: DesktopPublicationSourceInput): Promise<DesktopPublicationSource>;
    delete(publicationId: string): Promise<boolean>;
  };
  operations: {
    list(providerAccountId?: string): Promise<DesktopIptvOperation[]>;
    get(id: string): Promise<DesktopIptvOperation | null>;
    upsert(input: DesktopIptvOperationInput): Promise<DesktopIptvOperation>;
  };
}

export interface DesktopCredentialApi {
  set(ref: string, username: string, password: string): Promise<void>;
  delete(ref: string): Promise<void>;
}

export type DesktopPlaybackEntityType = "movie" | "episode";
export type DesktopPlaybackResourceType = "manifest" | "playlist" | "segment" | "init" | "key" | "subtitle" | "media";
export interface DesktopPlaybackSessionView {
  sessionId: string;
  entityType: DesktopPlaybackEntityType;
  entityId: string;
  expiresAt: string;
  resourceId?: string;
  contentType?: string;
  supportsRange?: boolean;
}
export interface DesktopPlaybackStartInput {
  entityType: DesktopPlaybackEntityType;
  entityId: string;
}
export interface DesktopPlaybackReadInput {
  sessionId: string;
  requestId: string;
  resourceId: string;
  resourceType: DesktopPlaybackResourceType;
  byteRange?: { start: number; end?: number };
}
export interface DesktopPlaybackResourceResponse {
  sessionId: string;
  requestId: string;
  resourceType: DesktopPlaybackResourceType;
  contentType: string;
  data: ArrayBuffer;
  done: boolean;
  status?: 200 | 206;
  contentLength?: number;
  totalLength?: number;
  range?: { start: number; end: number; total: number };
}
export interface DesktopPlaybackApi {
  start(input: DesktopPlaybackStartInput): Promise<DesktopPlaybackSessionView>;
  read(input: DesktopPlaybackReadInput): Promise<DesktopPlaybackResourceResponse>;
  cancel(sessionId: string): Promise<void>;
}

export interface DesktopIptvRuntimeApi {
  validateProvider(input: {
    providerId?: string;
    baseUrl?: string;
    type?: DesktopProviderType | "manual";
    playlist?: string;
  }): Promise<ProviderConnectionTest>;
  validateProviderById(providerId: string): Promise<ProviderConnectionTest>;
  startEpgSync(providerId: string): Promise<IptvOperation>;
  startXtreamCatalogueSync(providerId: string): Promise<IptvOperation>;
  startM3uCatalogueSync(providerId: string): Promise<IptvOperation>;
  startOperation(type: IptvOperationType, input?: {
    providerId?: string;
    playlist?: string;
    baseUrl?: string;
  }): Promise<IptvOperation>;
  getOperation(operationId: string): Promise<IptvOperation | null>;
  cancelOperation(operationId: string): Promise<IptvOperation | null>;
}

declare global {
  interface Window {
    gito?: {
      platform: "desktop";
      onNavigateToScreen: (callback: (screen: string) => void) => () => void;
      sendRendererError: (error: unknown) => void;
      sendRendererConsoleError: (args: unknown) => void;
      desktopStorage?: DesktopStorageApi;
      desktopCredentials?: DesktopCredentialApi;
      desktopIptv?: DesktopIptvRuntimeApi;
      desktopPlayback?: DesktopPlaybackApi;
    };
  }
}
