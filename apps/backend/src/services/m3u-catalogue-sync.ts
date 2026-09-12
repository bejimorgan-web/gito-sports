import type { ParsedChannel } from "@gito/shared";
import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import { syncProviderChannels } from "../repositories/provider-repository.js";
import {
  archiveMissingXtreamCategories,
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

function categoryRecords(entries: ParsedChannel, contentType: "movie" | "series") {
  const providerCategoryId = entries.categoryId ?? entries.groupName;
  return providerCategoryId
    ? [{ providerCategoryId, name: entries.groupName ?? providerCategoryId, metadata: { source: "m3u", contentType } }]
    : [];
}

function streamExternalId(entry: ParsedChannel, fallback: string) {
  return entry.externalRef ?? fallback;
}

function episodeExternalId(seriesExternalId: string, entry: ParsedChannel, index: number) {
  const season = entry.seasonNumber ?? 1;
  if (entry.episodeNumber !== undefined) {
    return `${seriesExternalId}:s${season}:e${entry.episodeNumber}`;
  }
  const urlHash = crypto.createHash("sha256").update(entry.url).digest("hex").slice(0, 24);
  return `${seriesExternalId}:s${season}:url-${urlHash || index}`;
}

function archiveMissingM3uRecords(
  providerId: string,
  liveChannelIds: string[],
  movieExternalIds: string[],
  seriesExternalIds: string[],
  seasonKeys: string[],
  episodeExternalIds: string[]
) {
  const database = getDatabase();
  const updateMissing = (table: string, identityColumn: string, identities: string[], where = "") => {
    if (identities.length === 0) {
      database.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active' ${where}`).run(new Date().toISOString(), providerId);
      return;
    }
    const placeholders = identities.map(() => "?").join(",");
    database.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active' AND ${identityColumn} NOT IN (${placeholders}) ${where}`).run(new Date().toISOString(), providerId, ...identities);
  };

  updateMissing("channels", "id", liveChannelIds, "AND content_type = 'live'");
  updateMissing("iptv_movies", "external_id", movieExternalIds);
  updateMissing("iptv_series", "external_id", seriesExternalIds);

  if (seasonKeys.length === 0) {
    database.prepare("UPDATE iptv_seasons SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active'").run(new Date().toISOString(), providerId);
  } else {
    const seasonPlaceholders = seasonKeys.map(() => "?").join(",");
    database.prepare(`UPDATE iptv_seasons SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active' AND provider_season_id NOT IN (${seasonPlaceholders})`).run(new Date().toISOString(), providerId, ...seasonKeys);
  }

  const episodeWhere = episodeExternalIds.length === 0
    ? ""
    : `AND e.external_id NOT IN (${episodeExternalIds.map(() => "?").join(",")})`;
  database.prepare(`UPDATE iptv_series_episodes AS e SET status = 'archived', updated_at = ? WHERE e.status = 'active' AND EXISTS (SELECT 1 FROM iptv_series s WHERE s.id = e.series_id AND s.provider_id = ?) ${episodeWhere}`).run(new Date().toISOString(), providerId, ...episodeExternalIds);
}

export function syncParsedM3uCatalogue(providerId: string, parsedChannels: ParsedChannel[]): M3uCatalogueSyncResult {
  if (parsedChannels.length === 0) {
    return { liveChannels: 0, movies: 0, series: 0, episodes: 0 };
  }
  if (parsedChannels.some((entry) => !entry.url.trim() || !entry.name.trim())) {
    throw new Error("m3u_catalogue_sync_invalid_entry");
  }

  const database = getDatabase();
  const persistCatalogue = database.transaction(() => {
    const live = parsedChannels.filter((entry) => (entry.contentType ?? "live") === "live");
    const movies = parsedChannels.filter((entry) => entry.contentType === "movie");
    const seriesEpisodes = parsedChannels.filter((entry) => entry.contentType === "series");

    const savedLive = live.length > 0 ? syncProviderChannels(providerId, live) : [];
    const liveCategoryIds = [...new Set(live.map((entry) => entry.categoryId ?? entry.groupName).filter((value): value is string => Boolean(value)))];

    const movieCategoryRecords = movies.flatMap((entry) => categoryRecords(entry, "movie"));
    const uniqueMovieCategories = [...new Map(movieCategoryRecords.map((record) => [record.providerCategoryId, record])).values()];
    const movieCategoryStats = uniqueMovieCategories.length > 0 ? syncXtreamCategories(providerId, "movie", uniqueMovieCategories) : null;
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
    const seriesCategoryStats = uniqueSeriesCategories.length > 0 ? syncXtreamCategories(providerId, "series", uniqueSeriesCategories) : null;
    const seriesStats = syncXtreamSeriesDetailed(providerId, seriesRecords);

    let episodes = 0;
    const episodeExternalIds: string[] = [];
    const seasonKeys: string[] = [];
    let seasonFailures = 0;
    let episodeFailures = 0;
    for (const [seriesExternalId, entries] of seriesByExternalRef) {
      const seasonRecords = [...new Map(entries.map((entry, index) => {
        const seasonNumber = entry.seasonNumber ?? 1;
        return [`${seriesExternalId}:${seasonNumber}`, {
          seriesExternalId,
          providerSeasonId: `${seriesExternalId}:${seasonNumber}`,
          seasonNumber,
          name: `Season ${seasonNumber}`,
          metadata: { source: "m3u" }
        }];
      })).values()];
      seasonKeys.push(...seasonRecords.map((record) => record.providerSeasonId));
      seasonFailures += syncXtreamSeasonsDetailed(providerId, seasonRecords).failed;
      const episodeStats = syncXtreamEpisodesDetailed(providerId, seriesExternalId, entries.map((entry, index) => ({
        externalId: episodeExternalId(seriesExternalId, entry, index),
        seasonNumber: entry.seasonNumber ?? 1,
        episodeNumber: entry.episodeNumber ?? index + 1,
        name: entry.name,
        streamUrl: entry.url,
        metadata: { source: "m3u", contentType: "series", tvgName: entry.tvgName ?? null }
      })));
      episodeExternalIds.push(...entries.map((entry, index) => episodeExternalId(seriesExternalId, entry, index)));
      episodeFailures += episodeStats.failed;
      episodes += episodeStats.processed;
    }

    const failedWrites = [movieCategoryStats, seriesCategoryStats, movieStats, seriesStats].some((stats) => stats !== null && stats.failed > 0) || seasonFailures > 0 || episodeFailures > 0;
    if (failedWrites) {
      throw new Error("m3u_catalogue_sync_failed");
    }

    archiveMissingXtreamCategories(providerId, "movie", uniqueMovieCategories.map((record) => record.providerCategoryId));
    archiveMissingXtreamCategories(providerId, "series", uniqueSeriesCategories.map((record) => record.providerCategoryId));
    archiveMissingXtreamCategories(providerId, "live", liveCategoryIds);
    archiveMissingM3uRecords(
      providerId,
      savedLive.map((channel) => channel.id),
      movies.map((entry, index) => streamExternalId(entry, `movie-${index}`)),
      seriesRecords.map((record) => record.externalId),
      seasonKeys,
      episodeExternalIds
    );

    return {
      liveChannels: savedLive.length,
      movies: movieStats.processed,
      series: seriesStats.processed,
      episodes
    };
  });

  return persistCatalogue();
}
