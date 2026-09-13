export type IptvCatalogueContentType = "live" | "movie" | "series";
export type IptvCatalogueStatus = "active" | "inactive" | "archived" | "stale";

export interface IptvCataloguePage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface IptvCategory {
  id: string;
  providerId: string;
  contentType: IptvCatalogueContentType;
  providerCategoryId: string;
  name: string;
  slug?: string | null;
  parentCategoryId?: string | null;
  ordering?: number | null;
  status: IptvCatalogueStatus;
}

export interface IptvCatalogueChannel {
  id: string;
  providerId: string;
  externalRef?: string | null;
  tvgName?: string | null;
  name: string;
  categoryId?: string | null;
  category?: Pick<IptvCategory, "id" | "name" | "slug"> | null;
  playbackReference: string;
  logoUrl?: string | null;
  epgChannelId?: string | null;
  status: IptvCatalogueStatus;
  metadata?: unknown;
}

export interface IptvMovie {
  id: string;
  providerId: string;
  externalId: string;
  title: string;
  categoryId?: string | null;
  category?: Pick<IptvCategory, "id" | "name" | "slug"> | null;
  playbackReference: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  description?: string | null;
  genre?: string | null;
  year?: number | null;
  rating?: number | null;
  duration?: number | null;
  language?: string | null;
  country?: string | null;
  cast?: string | null;
  director?: string | null;
  trailerUrl?: string | null;
  status: IptvCatalogueStatus;
  metadata?: unknown;
}

export interface IptvSeries extends Omit<IptvMovie, "playbackReference"> {
  playbackReference?: never;
}

export interface IptvSeason {
  id: string;
  providerId: string;
  seriesId: string;
  providerSeasonId: string;
  seasonNumber?: number | null;
  name?: string | null;
  description?: string | null;
  posterUrl?: string | null;
  status: IptvCatalogueStatus;
  metadata?: unknown;
}

export interface IptvEpisode {
  id: string;
  providerId: string;
  seriesId: string;
  seasonId: string;
  externalId: string;
  episodeNumber?: number | null;
  seasonNumber?: number | null;
  title?: string | null;
  description?: string | null;
  playbackReference: string;
  posterUrl?: string | null;
  duration?: number | null;
  status: IptvCatalogueStatus;
  metadata?: unknown;
}

export interface IptvEpgChannel {
  id: string;
  providerId: string;
  externalEpgChannelId: string;
  channelId?: string | null;
  channelExternalRef?: string | null;
  name: string;
  iconUrl?: string | null;
  status: IptvCatalogueStatus;
}

export interface IptvEpgProgramme {
  id: string;
  providerId: string;
  epgChannelId: string;
  channelId?: string | null;
  externalProgrammeId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  iconUrl?: string | null;
  status: IptvCatalogueStatus;
  metadata?: unknown;
}
