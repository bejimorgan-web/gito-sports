import type { ParsedChannel } from "@gito/shared";
import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import { syncProviderChannelsBatched } from "../repositories/provider-repository.js";
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
  const batchSize = 500;
  const updateMissingInBatches = (table: string, identityColumn: string, identities: string[], where = "") => {
    const validIds = new Set(identities);
    const timestamp = new Date().toISOString();

    if (validIds.size === 0) {
      database.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active' ${where}`).run(timestamp, providerId);
      return;
    }

    let lastValue = "";
    for (;;) {
      const rows = database.prepare(`SELECT ${identityColumn} AS value FROM ${table} WHERE provider_id = ? AND status = 'active' AND ${identityColumn} > ? ${where} ORDER BY ${identityColumn} LIMIT ?`).all(providerId, lastValue, batchSize) as { value: string }[];
      if (rows.length === 0) break;

      const missingIds = rows.map((row) => row.value).filter((value) => !validIds.has(value));
      if (missingIds.length > 0) {
        const placeholders = missingIds.map(() => "?").join(",");
        database.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE provider_id = ? AND status = 'active' AND ${identityColumn} IN (${placeholders}) ${where}`).run(timestamp, providerId, ...missingIds);
      }

      const lastRow = rows[rows.length - 1];
      if (!lastRow) break;
      lastValue = lastRow.value;
    }
  };

  updateMissingInBatches("channels", "id", liveChannelIds, "AND content_type = 'live'");
  updateMissingInBatches("iptv_movies", "external_id", movieExternalIds);
  updateMissingInBatches("iptv_series", "external_id", seriesExternalIds);
  updateMissingInBatches("iptv_seasons", "provider_season_id", seasonKeys);

  const episodeSet = new Set(episodeExternalIds);
  const timestamp = new Date().toISOString();
  let lastEpisodeId = "";
  for (;;) {
    const rows = database.prepare(`SELECT e.external_id AS value FROM iptv_series_episodes e INNER JOIN iptv_series s ON s.id = e.series_id WHERE e.status = 'active' AND s.provider_id = ? AND e.external_id > ? ORDER BY e.external_id LIMIT ?`).all(providerId, lastEpisodeId, batchSize) as { value: string }[];
    if (rows.length === 0) break;

    const missingEpisodeIds = rows.map((row) => row.value).filter((value) => !episodeSet.has(value));
    if (missingEpisodeIds.length > 0) {
      const placeholders = missingEpisodeIds.map(() => "?").join(",");
      database.prepare(`UPDATE iptv_series_episodes SET status = 'archived', updated_at = ? WHERE status = 'active' AND external_id IN (${placeholders}) AND EXISTS (SELECT 1 FROM iptv_series s WHERE s.id = iptv_series_episodes.series_id AND s.provider_id = ?)`).run(timestamp, ...missingEpisodeIds, providerId);
    }

    const lastRow = rows[rows.length - 1];
    if (!lastRow) break;
    lastEpisodeId = lastRow.value;
  }
}

export async function syncParsedM3uCatalogue(providerId: string, parsedChannels: ParsedChannel[]): Promise<M3uCatalogueSyncResult> {
  if (parsedChannels.length === 0) {
    return { liveChannels: 0, movies: 0, series: 0, episodes: 0 };
  }
  if (parsedChannels.some((entry) => !entry.url.trim() || !entry.name.trim())) {
    throw new Error("m3u_catalogue_sync_invalid_entry");
  }

  const database = getDatabase();
  const persistCatalogue = async () => {
    const live = parsedChannels.filter((entry) => (entry.contentType ?? "live") === "live");
    const movies = parsedChannels.filter((entry) => entry.contentType === "movie");
    const seriesEpisodes = parsedChannels.filter((entry) => entry.contentType === "series");

    const savedLive = live.length > 0 ? await syncProviderChannelsBatched(providerId, live) : [];
    const liveCategoryIds = [...new Set(live.map((entry) => entry.categoryId ?? entry.groupName).filter((value): value is string => Boolean(value)))];

    const movieCategoryRecords = movies.flatMap((entry) => categoryRecords(entry, "movie"));
    const uniqueMovieCategories = [...new Map(movieCategoryRecords.map((record) => [record.providerCategoryId, record])).values()];
    const movieCategoryStats = uniqueMovieCategories.length > 0 ? await syncXtreamCategories(providerId, "movie", uniqueMovieCategories) : null;
    const movieStats = await syncXtreamMoviesDetailed(providerId, movies.map((entry, index) => ({
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
    const seriesCategoryStats = uniqueSeriesCategories.length > 0 ? await syncXtreamCategories(providerId, "series", uniqueSeriesCategories) : null;
    const seriesStats = await syncXtreamSeriesDetailed(providerId, seriesRecords);

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
      seasonFailures += (await syncXtreamSeasonsDetailed(providerId, seasonRecords)).failed;
      const episodeStats = await syncXtreamEpisodesDetailed(providerId, seriesExternalId, entries.map((entry, index) => ({
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
  };

  return await persistCatalogue();
}
