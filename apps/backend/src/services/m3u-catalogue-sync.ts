import type { ParsedChannel } from "@gito/shared";
import { syncProviderChannels } from "../repositories/provider-repository.js";
import {
  syncXtreamCategories,
  syncXtreamEpisodesDetailed,
  syncXtreamMoviesDetailed,
  syncXtreamSeasonsDetailed,
  syncXtreamSeriesDetailed
} from "../repositories/iptv-catalogue-repository.js";

export type M3uCatalogueSyncResult = {
  liveChannels: number;
  movies: number;
  series: number;
  episodes: number;
};

function categoryRecords(entry: ParsedChannel, contentType: "movie" | "series") {
  const providerCategoryId = entry.categoryId ?? entry.groupName;
  return providerCategoryId
    ? [{ providerCategoryId, name: entry.groupName ?? providerCategoryId, metadata: { source: "m3u", contentType } }]
    : [];
}

function streamExternalId(entry: ParsedChannel, fallback: string) {
  return entry.externalRef ?? fallback;
}

export function syncParsedM3uCatalogue(providerId: string, parsedChannels: ParsedChannel[]): M3uCatalogueSyncResult {
  const live = parsedChannels.filter((entry) => (entry.contentType ?? "live") === "live");
  const movies = parsedChannels.filter((entry) => entry.contentType === "movie");
  const seriesEpisodes = parsedChannels.filter((entry) => entry.contentType === "series");
  const savedLive = live.length > 0 ? syncProviderChannels(providerId, live) : [];

  const movieCategoryRecords = movies.flatMap((entry) => categoryRecords(entry, "movie"));
  const uniqueMovieCategories = [...new Map(movieCategoryRecords.map((record) => [record.providerCategoryId, record])).values()];
  if (uniqueMovieCategories.length > 0) syncXtreamCategories(providerId, "movie", uniqueMovieCategories);
  const movieStats = syncXtreamMoviesDetailed(providerId, movies.map((entry, index) => ({
    externalId: streamExternalId(entry, `movie-${index}`),
    categoryId: entry.categoryId ?? entry.groupName,
    name: entry.name,
    streamUrl: entry.url,
    posterUrl: entry.logoUrl,
    metadata: { source: "m3u", contentType: "movie", tvgName: entry.tvgName ?? null }
  })));

  const seriesByExternalRef = new Map<string, ParsedChannel[]>();
  for (const entry of seriesEpisodes) {
    const externalRef = entry.seriesExternalRef ?? entry.seriesName ?? entry.groupName ?? "series";
    const existing = seriesByExternalRef.get(externalRef) ?? [];
    existing.push(entry);
    seriesByExternalRef.set(externalRef, existing);
  }
  const seriesRecords = [...seriesByExternalRef.entries()].map(([externalId, entries]) => {
    const first = entries[0];
    return {
      externalId,
      categoryId: first?.categoryId ?? first?.groupName,
      name: first?.seriesName ?? first?.groupName ?? first?.name ?? externalId,
      posterUrl: first?.logoUrl,
      metadata: { source: "m3u", contentType: "series" }
    };
  });
  const seriesCategoryRecords = seriesRecords.flatMap((entry) => entry.categoryId
    ? [{ providerCategoryId: entry.categoryId, name: entry.categoryId, metadata: { source: "m3u", contentType: "series" } }]
    : []);
  const uniqueSeriesCategories = [...new Map(seriesCategoryRecords.map((record) => [record.providerCategoryId, record])).values()];
  if (uniqueSeriesCategories.length > 0) syncXtreamCategories(providerId, "series", uniqueSeriesCategories);
  const seriesStats = syncXtreamSeriesDetailed(providerId, seriesRecords);

  let episodes = 0;
  for (const [seriesExternalId, entries] of seriesByExternalRef) {
    const seasonRecords = [...new Map(entries.map((entry) => {
      const seasonNumber = entry.seasonNumber ?? 1;
      return [`${seriesExternalId}:${seasonNumber}`, {
        seriesExternalId,
        providerSeasonId: `${seriesExternalId}:${seasonNumber}`,
        seasonNumber,
        name: `Season ${seasonNumber}`,
        metadata: { source: "m3u" }
      }];
    })).values()];
    syncXtreamSeasonsDetailed(providerId, seasonRecords);
    const episodeStats = syncXtreamEpisodesDetailed(providerId, seriesExternalId, entries.map((entry, index) => ({
      externalId: streamExternalId(entry, `episode-${index}`),
      seasonNumber: entry.seasonNumber ?? 1,
      episodeNumber: entry.episodeNumber ?? index + 1,
      name: entry.name,
      streamUrl: entry.url,
      metadata: { source: "m3u", contentType: "series", tvgName: entry.tvgName ?? null }
    })));
    episodes += episodeStats.processed;
  }

  return { liveChannels: savedLive.length, movies: movieStats.processed, series: seriesStats.processed, episodes };
}
