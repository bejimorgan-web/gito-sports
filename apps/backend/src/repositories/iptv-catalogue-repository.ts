import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

function now() {
  return new Date().toISOString();
}

function id(prefix: string, providerId: string, externalId: string) {
  return `${prefix}_${crypto.createHash("sha256").update(`${providerId}:${externalId}`).digest("hex").slice(0, 24)}`;
}

export type XtreamMovieRecord = {
  externalId: string;
  categoryId?: string;
  name: string;
  streamUrl: string;
  posterUrl?: string;
  metadata: any;
};

export type XtreamSeriesRecord = {
  externalId: string;
  categoryId?: string;
  name: string;
  posterUrl?: string;
  metadata: any;
};

export type XtreamEpisodeRecord = {
  externalId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  name?: string;
  streamUrl: string;
  metadata: any;
};

export type CatalogueSyncStats = { fetched: number; processed: number; inserted: number; updated: number; unchanged: number; failed: number; archived: number };

function emptyStats(fetched: number): CatalogueSyncStats {
  return { fetched, processed: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, archived: 0 };
}

function value(record: any, ...keys: string[]) {
  for (const key of keys) if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== "") return record[key];
  return null;
}

function numberValue(record: any, ...keys: string[]) {
  const candidate = value(record, ...keys);
  if (candidate === null) return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(record: any, ...keys: string[]) {
  const candidate = value(record, ...keys);
  return candidate === null ? null : String(candidate);
}

function jsonValue(record: any) {
  return JSON.stringify(record ?? {});
}

export type CataloguePage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CatalogueListOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  categoryId?: string;
  status?: string;
};

function pageValues(options: CatalogueListOptions = {}) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 50)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function cataloguePage<T>(items: T[], total: number, page: number, pageSize: number): CataloguePage<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function parseMetadata(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}"));
  } catch {
    return {};
  }
}

function mapCategory(row: any) {
  return {
    id: row.id,
    providerId: row.provider_id,
    contentType: row.content_type,
    providerCategoryId: row.provider_category_id,
    name: row.name,
    slug: row.slug,
    parentCategoryId: row.parent_category_id,
    ordering: row.ordering,
    status: row.status
  };
}

function mapEpgChannel(row: any) {
  return {
    id: row.id,
    providerId: row.provider_id,
    externalEpgChannelId: row.external_epg_channel_id,
    channelId: row.channel_id,
    channelExternalRef: row.channel_external_ref,
    name: row.name,
    iconUrl: row.icon_url,
    status: row.status
  };
}

function mapEpgProgramme(row: any) {
  return {
    id: row.id,
    providerId: row.provider_id,
    epgChannelId: row.epg_channel_id,
    channelId: row.channel_id,
    externalProgrammeId: row.external_programme_id,
    title: row.title,
    description: row.description,
    category: row.category,
    startAt: row.start_at,
    endAt: row.end_at,
    iconUrl: row.icon_url,
    status: row.status ?? "active",
    metadata: parseMetadata(row.metadata_json)
  };
}

export function listIptvCategoriesPage(providerId: string, contentType?: IptvCategoryContentType, options: CatalogueListOptions = {}) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const clauses = ["provider_id = ?"];
  const params: unknown[] = [providerId];
  if (contentType) { clauses.push("content_type = ?"); params.push(contentType); }
  if (options.status) { clauses.push("status = ?"); params.push(options.status); }
  const where = clauses.join(" AND ");
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM iptv_categories WHERE ${where}`).get(...params) as { count: number }).count ?? 0);
  const rows = db.prepare(`SELECT * FROM iptv_categories WHERE ${where} ORDER BY ordering IS NULL, ordering, name LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as any[];
  return cataloguePage(rows.map(mapCategory), total, page, pageSize);
}

export function listIptvChannelsPage(providerId: string, options: CatalogueListOptions = {}) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const clauses = ["c.provider_id = ?"];
  const params: unknown[] = [providerId];
  if (options.status) { clauses.push("c.status = ?"); params.push(options.status); }
  if (options.categoryId) { clauses.push("(c.category_id = ? OR cat.id = ? OR cat.provider_category_id = ?)"); params.push(options.categoryId, options.categoryId, options.categoryId); }
  if (options.search) { clauses.push("LOWER(c.name) LIKE ?"); params.push(`%${options.search.toLowerCase()}%`); }
  const where = clauses.join(" AND ");
  const from = `FROM channels c LEFT JOIN iptv_categories cat ON cat.provider_id = c.provider_id AND cat.content_type = 'live' AND (cat.id = c.category_id OR cat.provider_category_id = c.category_id)`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...params) as { count: number }).count ?? 0);
  const rows = db.prepare(`SELECT c.*, cat.id AS category_canonical_id, cat.name AS category_name, cat.slug AS category_slug FROM channels c LEFT JOIN iptv_categories cat ON cat.provider_id = c.provider_id AND cat.content_type = 'live' AND (cat.id = c.category_id OR cat.provider_category_id = c.category_id) WHERE ${where} ORDER BY c.name, c.id LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as any[];
  return cataloguePage(rows.map((row) => ({
    id: row.id, providerId: row.provider_id, externalRef: row.external_ref, name: row.name,
    categoryId: row.category_canonical_id ?? row.category_id, category: row.category_name ? { id: row.category_canonical_id, name: row.category_name, slug: row.category_slug } : null,
    playbackReference: row.url, logoUrl: row.logo_url, epgChannelId: row.epg_channel_id,
    metadata: parseMetadata(row.metadata_json), status: row.status
  })), total, page, pageSize);
}

function movieFields(row: any) {
  return { id: row.id, providerId: row.provider_id, externalId: row.external_id, title: row.name, categoryId: row.category_id, category: row.category_name ? { id: row.category_canonical_id ?? row.category_id, name: row.category_name, slug: row.category_slug } : null, playbackReference: row.stream_url, posterUrl: row.poster_url, backdropUrl: row.backdrop_url, description: row.description, genre: row.genre, year: row.year, rating: row.rating, duration: row.duration, language: row.language, country: row.country, cast: row.cast, director: row.director, trailerUrl: row.trailer_url, status: row.status, metadata: parseMetadata(row.metadata_json) };
}

function seriesFields(row: any) {
  return { id: row.id, providerId: row.provider_id, externalId: row.external_id, title: row.name, categoryId: row.category_id, category: row.category_name ? { id: row.category_canonical_id ?? row.category_id, name: row.category_name, slug: row.category_slug } : null, posterUrl: row.poster_url, backdropUrl: row.backdrop_url, description: row.description, genre: row.genre, year: row.year, rating: row.rating, language: row.language, country: row.country, cast: row.cast, director: row.director, trailerUrl: row.trailer_url, status: row.status, metadata: parseMetadata(row.metadata_json) };
}

function catalogueItemFromOptions(table: "iptv_movies" | "iptv_series", providerId: string, options: CatalogueListOptions) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const clauses = [`x.provider_id = ?`];
  const params: unknown[] = [providerId];
  if (options.status) { clauses.push("x.status = ?"); params.push(options.status); }
  if (options.categoryId) { clauses.push("(x.category_id = ? OR cat.id = ? OR cat.provider_category_id = ?)"); params.push(options.categoryId, options.categoryId, options.categoryId); }
  if (options.search) { clauses.push("LOWER(x.name) LIKE ?"); params.push(`%${options.search.toLowerCase()}%`); }
  const contentType = table === "iptv_movies" ? "movie" : "series";
  const from = `FROM ${table} x LEFT JOIN iptv_categories cat ON cat.provider_id = x.provider_id AND cat.content_type = '${contentType}' AND cat.id = x.category_id`;
  const where = clauses.join(" AND ");
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...params) as { count: number }).count ?? 0);
  const rows = db.prepare(`SELECT x.*, cat.id AS category_canonical_id, cat.name AS category_name, cat.slug AS category_slug ${from} WHERE ${where} ORDER BY x.name, x.id LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as any[];
  const items = table === "iptv_movies" ? rows.map(movieFields) : rows.map(seriesFields);
  return cataloguePage(items, total, page, pageSize);
}

export function listIptvMoviesPage(providerId: string, options: CatalogueListOptions = {}) { return catalogueItemFromOptions("iptv_movies", providerId, options); }
export function listIptvSeriesPage(providerId: string, options: CatalogueListOptions = {}) { return catalogueItemFromOptions("iptv_series", providerId, options); }

export function getIptvMovie(providerId: string, movieId: string) {
  const row = getDatabase().prepare("SELECT x.*, cat.id AS category_canonical_id, cat.name AS category_name, cat.slug AS category_slug FROM iptv_movies x LEFT JOIN iptv_categories cat ON cat.id = x.category_id AND cat.provider_id = x.provider_id WHERE x.provider_id = ? AND x.id = ?").get(providerId, movieId) as any;
  return row ? movieFields(row) : undefined;
}

export function getIptvSeries(providerId: string, seriesId: string) {
  const row = getDatabase().prepare("SELECT x.*, cat.id AS category_canonical_id, cat.name AS category_name, cat.slug AS category_slug FROM iptv_series x LEFT JOIN iptv_categories cat ON cat.id = x.category_id AND cat.provider_id = x.provider_id WHERE x.provider_id = ? AND x.id = ?").get(providerId, seriesId) as any;
  return row ? seriesFields(row) : undefined;
}

export function listIptvSeasonsPage(providerId: string, seriesId: string) {
  const rows = getDatabase().prepare("SELECT * FROM iptv_seasons WHERE provider_id = ? AND series_id = ? ORDER BY season_number IS NULL, season_number, name, id").all(providerId, seriesId) as any[];
  return rows.map((row) => ({ id: row.id, providerId: row.provider_id, seriesId: row.series_id, providerSeasonId: row.provider_season_id, seasonNumber: row.season_number, name: row.name, description: row.description, posterUrl: row.poster_url, status: row.status, metadata: parseMetadata(row.metadata_json) }));
}

export function listIptvEpisodesPage(providerId: string, seasonId: string, options: CatalogueListOptions = {}) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const season = db.prepare("SELECT id, series_id, season_number FROM iptv_seasons WHERE provider_id = ? AND id = ?").get(providerId, seasonId) as { id: string; series_id: string; season_number: number | null } | undefined;
  if (!season) return undefined;
  const clauses = ["s.provider_id = ?", "e.series_id = ?", "e.season_number IS ?"];
  const params: unknown[] = [providerId, season.series_id, season.season_number];
  if (options.status) { clauses.push("e.status = ?"); params.push(options.status); }
  if (options.search) { clauses.push("LOWER(COALESCE(e.name, '')) LIKE ?"); params.push(`%${options.search.toLowerCase()}%`); }
  const where = clauses.join(" AND ");
  const from = "FROM iptv_series_episodes e JOIN iptv_series s ON s.id = e.series_id";
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(...params) as { count: number }).count ?? 0);
  const rows = db.prepare(`SELECT e.*, s.provider_id, e.series_id, ? AS season_id ${from} WHERE ${where} ORDER BY e.episode_number IS NULL, e.episode_number, e.name, e.id LIMIT ? OFFSET ?`).all(seasonId, ...params, pageSize, offset) as any[];
  return cataloguePage(rows.map((row) => ({ id: row.id, providerId: row.provider_id, seriesId: row.series_id, seasonId: row.season_id, externalId: row.external_id, episodeNumber: row.episode_number, seasonNumber: row.season_number, title: row.name, description: row.description, playbackReference: row.stream_url, posterUrl: row.poster_url, duration: row.duration, status: row.status, metadata: parseMetadata(row.metadata_json) })), total, page, pageSize);
}

export function listIptvEpgChannelsPage(providerId: string, options: CatalogueListOptions = {}) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const total = Number((db.prepare("SELECT COUNT(*) AS count FROM iptv_epg_channels WHERE provider_id = ?").get(providerId) as { count: number }).count ?? 0);
  const rows = db.prepare("SELECT * FROM iptv_epg_channels WHERE provider_id = ? ORDER BY name, id LIMIT ? OFFSET ?").all(providerId, pageSize, offset) as any[];
  return cataloguePage(rows.map(mapEpgChannel), total, page, pageSize);
}

export function listIptvEpgProgrammesPage(providerId: string, options: CatalogueListOptions & { epgChannelId?: string; from?: string; to?: string; current?: boolean; upcoming?: boolean } = {}) {
  const db = getDatabase();
  const { page, pageSize, offset } = pageValues(options);
  const nowAt = new Date().toISOString();
  const clauses = ["provider_id = ?"];
  const params: unknown[] = [providerId];
  if (options.epgChannelId) { clauses.push("epg_channel_id = ?"); params.push(options.epgChannelId); }
  if (options.from) { clauses.push("(end_at IS NULL OR end_at >= ?)"); params.push(options.from); }
  if (options.to) { clauses.push("(start_at IS NULL OR start_at <= ?)"); params.push(options.to); }
  if (options.current) { clauses.push("start_at <= ? AND end_at > ?"); params.push(nowAt, nowAt); }
  if (options.upcoming) { clauses.push("start_at > ?"); params.push(nowAt); }
  const where = clauses.join(" AND ");
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM iptv_epg_programmes WHERE ${where}`).get(...params) as { count: number }).count ?? 0);
  const rows = db.prepare(`SELECT * FROM iptv_epg_programmes WHERE ${where} ORDER BY start_at, title, id LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as any[];
  return cataloguePage(rows.map(mapEpgProgramme), total, page, pageSize);
}

function resolveCategoryId(providerId: string, contentType: "live" | "movie" | "series", providerCategoryId?: string) {
  if (!providerCategoryId) return null;
  const row = getDatabase().prepare("SELECT id FROM iptv_categories WHERE provider_id = ? AND content_type = ? AND provider_category_id = ?").get(providerId, contentType, providerCategoryId) as { id: string } | undefined;
  return row?.id ?? providerCategoryId;
}

function syncRowsInBatches<T>(records: T[], save: (record: T) => "inserted" | "updated" | "unchanged") {
  const stats = emptyStats(records.length);
  for (let index = 0; index < records.length; index += 500) {
    for (const record of records.slice(index, index + 500)) {
      try {
        stats[save(record)] += 1;
      } catch {
        stats.failed += 1;
      }
      stats.processed += 1;
    }
  }
  return stats;
}

export function syncXtreamCategories(providerId: string, contentType: "live" | "movie" | "series", records: Array<{ providerCategoryId: string; name: string; parentCategoryId?: string; metadata?: unknown }>) {
  return syncRowsInBatches(records, (record) => {
    const db = getDatabase();
    const existing = db.prepare("SELECT name, slug, parent_category_id, metadata_json, status FROM iptv_categories WHERE provider_id = ? AND content_type = ? AND provider_category_id = ?").get(providerId, contentType, record.providerCategoryId) as any;
    const slug = record.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
    const metadataJson = jsonValue(record.metadata);
    const changed = !existing || existing.name !== record.name || existing.slug !== slug || existing.parent_category_id !== (record.parentCategoryId ?? null) || existing.metadata_json !== metadataJson || existing.status !== "active";
    upsertIptvCategory(providerId, { ...record, contentType, slug, status: "active" });
    return existing ? changed ? "updated" : "unchanged" : "inserted";
  });
}

export function archiveMissingXtreamCategories(providerId: string, contentType: "live" | "movie" | "series", providerCategoryIds: string[]) {
  if (providerCategoryIds.length === 0) return 0;
  const placeholders = providerCategoryIds.map(() => "?").join(",");
  return getDatabase().prepare(`UPDATE iptv_categories SET status = 'inactive', updated_at = ? WHERE provider_id = ? AND content_type = ? AND status = 'active' AND provider_category_id NOT IN (${placeholders})`).run(now(), providerId, contentType, ...providerCategoryIds).changes;
}

export function syncXtreamMoviesDetailed(providerId: string, records: XtreamMovieRecord[]) {
  const db = getDatabase();
  return syncRowsInBatches(records, (record) => {
    const timestamp = now();
    const metadata = record.metadata ?? {};
    const fields = [resolveCategoryId(providerId, "movie", record.categoryId), record.name, record.streamUrl, record.posterUrl ?? textValue(metadata, "stream_icon", "poster"), textValue(metadata, "backdrop", "backdrop_path"), textValue(metadata, "plot", "description"), textValue(metadata, "genre"), numberValue(metadata, "year"), numberValue(metadata, "rating"), numberValue(metadata, "duration"), textValue(metadata, "language"), textValue(metadata, "country"), textValue(metadata, "cast"), textValue(metadata, "director"), textValue(metadata, "youtube_trailer", "trailer"), jsonValue(metadata)];
    const existing = db.prepare("SELECT category_id, name, stream_url, poster_url, backdrop_url, description, genre, year, rating, duration, language, country, \"cast\", director, trailer_url, metadata_json, status FROM iptv_movies WHERE provider_id = ? AND external_id = ?").get(providerId, record.externalId) as any;
    const changed = !existing || fields.some((field, index) => field !== [existing.category_id, existing.name, existing.stream_url, existing.poster_url, existing.backdrop_url, existing.description, existing.genre, existing.year, existing.rating, existing.duration, existing.language, existing.country, existing.cast, existing.director, existing.trailer_url, existing.metadata_json, existing.status][index]);
    db.prepare(`
      INSERT INTO iptv_movies (id, provider_id, external_id, category_id, name, stream_url, poster_url, backdrop_url, description, genre, year, rating, duration, language, country, "cast", director, trailer_url, metadata_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(provider_id, external_id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name, stream_url=excluded.stream_url, poster_url=excluded.poster_url, backdrop_url=excluded.backdrop_url, description=excluded.description, genre=excluded.genre, year=excluded.year, rating=excluded.rating, duration=excluded.duration, language=excluded.language, country=excluded.country, "cast"=excluded."cast", director=excluded.director, trailer_url=excluded.trailer_url, metadata_json=excluded.metadata_json, status='active', updated_at=excluded.updated_at
    `).run(id("movie", providerId, record.externalId), providerId, record.externalId, ...fields, timestamp, timestamp);
    return existing ? changed ? "updated" : "unchanged" : "inserted";
  });
}

export function syncXtreamMovies(providerId: string, records: XtreamMovieRecord[]) {
  return syncXtreamMoviesDetailed(providerId, records).processed;
}

export function syncXtreamSeriesDetailed(providerId: string, records: XtreamSeriesRecord[]) {
  const db = getDatabase();
  return syncRowsInBatches(records, (record) => {
    const timestamp = now();
    const metadata = record.metadata ?? {};
    const fields = [resolveCategoryId(providerId, "series", record.categoryId), record.name, record.posterUrl ?? textValue(metadata, "cover", "cover_big"), textValue(metadata, "backdrop_path", "backdrop"), textValue(metadata, "plot", "description"), textValue(metadata, "genre"), numberValue(metadata, "year"), numberValue(metadata, "rating"), textValue(metadata, "language"), textValue(metadata, "country"), textValue(metadata, "cast"), textValue(metadata, "director"), textValue(metadata, "youtube_trailer", "trailer"), jsonValue(metadata)];
    const existing = db.prepare("SELECT category_id, name, poster_url, backdrop_url, description, genre, year, rating, language, country, \"cast\", director, trailer_url, metadata_json, status FROM iptv_series WHERE provider_id = ? AND external_id = ?").get(providerId, record.externalId) as any;
    const oldFields = existing ? [existing.category_id, existing.name, existing.poster_url, existing.backdrop_url, existing.description, existing.genre, existing.year, existing.rating, existing.language, existing.country, existing.cast, existing.director, existing.trailer_url, existing.metadata_json, existing.status] : [];
    const changed = !existing || fields.some((field, index) => field !== oldFields[index]);
    db.prepare(`
      INSERT INTO iptv_series (id, provider_id, external_id, category_id, name, poster_url, backdrop_url, description, genre, year, rating, language, country, "cast", director, trailer_url, metadata_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(provider_id, external_id) DO UPDATE SET category_id=excluded.category_id, name=excluded.name, poster_url=excluded.poster_url, backdrop_url=excluded.backdrop_url, description=excluded.description, genre=excluded.genre, year=excluded.year, rating=excluded.rating, language=excluded.language, country=excluded.country, "cast"=excluded."cast", director=excluded.director, trailer_url=excluded.trailer_url, metadata_json=excluded.metadata_json, status='active', updated_at=excluded.updated_at
    `).run(id("series", providerId, record.externalId), providerId, record.externalId, ...fields, timestamp, timestamp);
    return existing ? changed ? "updated" : "unchanged" : "inserted";
  });
}

export function syncXtreamSeries(providerId: string, records: XtreamSeriesRecord[]) {
  return syncXtreamSeriesDetailed(providerId, records).processed;
}

export function syncXtreamSeasonsDetailed(providerId: string, records: Array<{ seriesExternalId: string; providerSeasonId: string; seasonNumber?: number; name?: string; posterUrl?: string; metadata?: unknown }>) {
  return syncRowsInBatches(records, (record) => {
    const series = getDatabase().prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND external_id = ?").get(providerId, record.seriesExternalId) as { id: string } | undefined;
    if (!series) throw new Error("series_not_found");
    const existing = getDatabase().prepare("SELECT name, season_number, poster_url, metadata_json, status FROM iptv_seasons WHERE provider_id = ? AND series_id = ? AND provider_season_id = ?").get(providerId, series.id, record.providerSeasonId) as any;
    const metadataJson = jsonValue(record.metadata);
    const changed = !existing || existing.name !== (record.name ?? null) || existing.season_number !== (record.seasonNumber ?? null) || existing.poster_url !== (record.posterUrl ?? null) || existing.metadata_json !== metadataJson || existing.status !== "active";
    upsertIptvSeason(providerId, { seriesId: series.id, providerSeasonId: record.providerSeasonId, seasonNumber: record.seasonNumber, name: record.name, posterUrl: record.posterUrl, metadata: record.metadata, status: "active" });
    return existing ? changed ? "updated" : "unchanged" : "inserted";
  });
}

export function syncXtreamEpisodesDetailed(providerId: string, seriesExternalId: string, records: XtreamEpisodeRecord[]) {
  const db = getDatabase();
  const series = db.prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND external_id = ?").get(providerId, seriesExternalId) as { id: string } | undefined;
  if (!series) return { fetched: records.length, processed: 0, inserted: 0, updated: 0, unchanged: 0, failed: records.length, archived: 0 };
  return syncRowsInBatches(records, (record) => {
    const timestamp = now();
    const metadata = record.metadata ?? {};
    const fields = [record.seasonNumber ?? null, record.episodeNumber ?? null, record.name ?? null, record.streamUrl, textValue(metadata, "plot", "description"), numberValue(metadata, "duration"), textValue(metadata, "movie_image", "cover_big", "image") , jsonValue(metadata)];
    const existing = db.prepare("SELECT season_number, episode_number, name, stream_url, description, duration, poster_url, metadata_json, status FROM iptv_series_episodes WHERE series_id = ? AND external_id = ?").get(series.id, record.externalId) as any;
    const oldFields = existing ? [existing.season_number, existing.episode_number, existing.name, existing.stream_url, existing.description, existing.duration, existing.poster_url, existing.metadata_json, existing.status] : [];
    const changed = !existing || fields.some((field, index) => field !== oldFields[index]);
    db.prepare(`
      INSERT INTO iptv_series_episodes (id, series_id, external_id, season_number, episode_number, name, stream_url, description, duration, poster_url, metadata_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(series_id, external_id) DO UPDATE SET season_number=excluded.season_number, episode_number=excluded.episode_number, name=excluded.name, stream_url=excluded.stream_url, description=excluded.description, duration=excluded.duration, poster_url=excluded.poster_url, metadata_json=excluded.metadata_json, status='active', updated_at=excluded.updated_at
    `).run(id("episode", series.id, record.externalId), series.id, record.externalId, ...fields, timestamp, timestamp);
    return existing ? changed ? "updated" : "unchanged" : "inserted";
  });
}

export function syncXtreamEpisodes(providerId: string, seriesExternalId: string, records: XtreamEpisodeRecord[]) {
  return syncXtreamEpisodesDetailed(providerId, seriesExternalId, records).processed;
}

export function getXtreamCatalogueTotals(providerId: string) {
  const db = getDatabase();
  const movies = db.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const series = db.prepare("SELECT COUNT(*) AS count FROM iptv_series WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const episodes = db.prepare(`SELECT COUNT(*) AS count FROM iptv_series_episodes e JOIN iptv_series s ON s.id = e.series_id WHERE s.provider_id = ? AND e.status = 'active'`).get(providerId) as { count: number };
  return { movies: Number(movies.count ?? 0), series: Number(series.count ?? 0), episodes: Number(episodes.count ?? 0) };
}

export type IptvCategoryContentType = "live" | "movie" | "series";

export type IptvCategoryRecord = {
  providerCategoryId: string;
  contentType: IptvCategoryContentType;
  name: string;
  slug?: string | null;
  parentCategoryId?: string | null;
  ordering?: number | null;
  status?: "active" | "inactive" | "archived";
  metadata?: unknown;
};

export function upsertIptvCategory(providerId: string, record: IptvCategoryRecord) {
  const db = getDatabase();
  const timestamp = now();
  const categoryId = `${record.contentType}_${crypto.createHash("sha256").update(`${providerId}:${record.providerCategoryId}`).digest("hex").slice(0, 24)}`;
  const metadataJson = JSON.stringify(record.metadata ?? {});
  const generatedSlug = record.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
  const slug = record.slug ?? generatedSlug;
  const status = record.status ?? "active";

  db.prepare(`
    INSERT INTO iptv_categories (
      id, provider_id, content_type, provider_category_id, name, slug, parent_category_id, ordering, status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, content_type, provider_category_id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      parent_category_id = excluded.parent_category_id,
      ordering = excluded.ordering,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    categoryId,
    providerId,
    record.contentType,
    record.providerCategoryId,
    record.name,
    slug,
    record.parentCategoryId ?? null,
    record.ordering ?? null,
    status,
    metadataJson,
    timestamp,
    timestamp
  );

  return {
    id: categoryId,
    providerId,
    contentType: record.contentType,
    providerCategoryId: record.providerCategoryId,
    name: record.name,
    slug,
    parentCategoryId: record.parentCategoryId ?? null,
    ordering: record.ordering ?? null,
    status,
    metadata: record.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function listIptvCategories(providerId: string, contentType?: IptvCategoryContentType) {
  const db = getDatabase();
  const rows = contentType
    ? db.prepare("SELECT * FROM iptv_categories WHERE provider_id = ? AND content_type = ? ORDER BY ordering, name").all(providerId, contentType)
    : db.prepare("SELECT * FROM iptv_categories WHERE provider_id = ? ORDER BY content_type, ordering, name").all(providerId);

  return (rows as any[]).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    contentType: row.content_type,
    providerCategoryId: row.provider_category_id,
    name: row.name,
    slug: row.slug,
    parentCategoryId: row.parent_category_id,
    ordering: row.ordering,
    status: row.status,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getIptvCategoryByProviderId(providerId: string, contentType: IptvCategoryContentType, providerCategoryId: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM iptv_categories WHERE provider_id = ? AND content_type = ? AND provider_category_id = ?")
    .get(providerId, contentType, providerCategoryId) as any;

  if (!row) return undefined;

  return {
    id: row.id,
    providerId: row.provider_id,
    contentType: row.content_type,
    providerCategoryId: row.provider_category_id,
    name: row.name,
    slug: row.slug,
    parentCategoryId: row.parent_category_id,
    ordering: row.ordering,
    status: row.status,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type IptvSeasonRecord = {
  seriesId: string;
  providerSeasonId: string;
  seasonNumber?: number | null;
  name?: string | null;
  description?: string | null;
  posterUrl?: string | null;
  status?: "active" | "inactive" | "archived";
  metadata?: unknown;
};

export function upsertIptvSeason(providerId: string, record: IptvSeasonRecord) {
  const db = getDatabase();
  const timestamp = now();
  const seriesMatch = db.prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND (id = ? OR external_id = ?)").get(providerId, record.seriesId, record.seriesId) as { id: string } | undefined;
  const resolvedSeriesId = seriesMatch?.id ?? record.seriesId;
  const seasonId = `season_${crypto.createHash("sha256").update(`${providerId}:${resolvedSeriesId}:${record.providerSeasonId}`).digest("hex").slice(0, 24)}`;
  const metadataJson = JSON.stringify(record.metadata ?? {});
  const status = record.status ?? "active";

  db.prepare(`
    INSERT INTO iptv_seasons (
      id, provider_id, series_id, provider_season_id, season_number, name, description, poster_url, metadata_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, series_id, provider_season_id) DO UPDATE SET
      season_number = excluded.season_number,
      name = excluded.name,
      description = excluded.description,
      poster_url = excluded.poster_url,
      metadata_json = excluded.metadata_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    seasonId,
    providerId,
    resolvedSeriesId,
    record.providerSeasonId,
    record.seasonNumber ?? null,
    record.name ?? null,
    record.description ?? null,
    record.posterUrl ?? null,
    metadataJson,
    status,
    timestamp,
    timestamp
  );

  return {
    id: seasonId,
    providerId,
    seriesId: resolvedSeriesId,
    providerSeasonId: record.providerSeasonId,
    seasonNumber: record.seasonNumber ?? null,
    name: record.name ?? null,
    description: record.description ?? null,
    posterUrl: record.posterUrl ?? null,
    status,
    metadata: record.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function listIptvSeasons(providerId: string, seriesId?: string) {
  const db = getDatabase();
  const resolvedSeriesId = seriesId
    ? (db.prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND (id = ? OR external_id = ?)").get(providerId, seriesId, seriesId) as { id: string } | undefined)?.id ?? seriesId
    : undefined;
  const rows = seriesId
    ? db.prepare("SELECT * FROM iptv_seasons WHERE provider_id = ? AND series_id = ? ORDER BY season_number, name").all(providerId, resolvedSeriesId)
    : db.prepare("SELECT * FROM iptv_seasons WHERE provider_id = ? ORDER BY series_id, season_number, name").all(providerId);

  return (rows as any[]).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    seriesId: row.series_id,
    providerSeasonId: row.provider_season_id,
    seasonNumber: row.season_number,
    name: row.name,
    description: row.description,
    posterUrl: row.poster_url,
    status: row.status,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getIptvSeasonBySeriesId(providerId: string, seriesId: string, providerSeasonId: string) {
  const resolvedSeriesId = (getDatabase().prepare("SELECT id FROM iptv_series WHERE provider_id = ? AND (id = ? OR external_id = ?)").get(providerId, seriesId, seriesId) as { id: string } | undefined)?.id ?? seriesId;
  const row = getDatabase()
    .prepare("SELECT * FROM iptv_seasons WHERE provider_id = ? AND series_id = ? AND provider_season_id = ?")
    .get(providerId, resolvedSeriesId, providerSeasonId) as any;

  if (!row) return undefined;

  return {
    id: row.id,
    providerId: row.provider_id,
    seriesId: row.series_id,
    providerSeasonId: row.provider_season_id,
    seasonNumber: row.season_number,
    name: row.name,
    description: row.description,
    posterUrl: row.poster_url,
    status: row.status,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type IptvEpgChannelRecord = {
  externalEpgChannelId: string;
  channelId?: string | null;
  channelExternalRef?: string | null;
  name: string;
  iconUrl?: string | null;
  status?: "active" | "inactive" | "archived";
  metadata?: unknown;
};

export function upsertIptvEpgChannel(providerId: string, record: IptvEpgChannelRecord) {
  const db = getDatabase();
  const timestamp = now();
  const epgChannelId = `epg_channel_${crypto.createHash("sha256").update(`${providerId}:${record.externalEpgChannelId}`).digest("hex").slice(0, 24)}`;
  const metadataJson = JSON.stringify(record.metadata ?? {});
  const status = record.status ?? "active";

  db.prepare(`
    INSERT INTO iptv_epg_channels (
      id, provider_id, external_epg_channel_id, channel_id, channel_external_ref, name, icon_url, status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, external_epg_channel_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      channel_external_ref = excluded.channel_external_ref,
      name = excluded.name,
      icon_url = excluded.icon_url,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    epgChannelId,
    providerId,
    record.externalEpgChannelId,
    record.channelId ?? null,
    record.channelExternalRef ?? null,
    record.name,
    record.iconUrl ?? null,
    status,
    metadataJson,
    timestamp,
    timestamp
  );

  return {
    id: epgChannelId,
    providerId,
    externalEpgChannelId: record.externalEpgChannelId,
    channelId: record.channelId ?? null,
    channelExternalRef: record.channelExternalRef ?? null,
    name: record.name,
    iconUrl: record.iconUrl ?? null,
    status,
    metadata: record.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function listIptvEpgChannels(providerId: string) {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM iptv_epg_channels WHERE provider_id = ? ORDER BY name").all(providerId) as any[];

  return rows.map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    externalEpgChannelId: row.external_epg_channel_id,
    channelId: row.channel_id,
    channelExternalRef: row.channel_external_ref,
    name: row.name,
    iconUrl: row.icon_url,
    status: row.status,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export type IptvEpgProgrammeRecord = {
  epgChannelId: string;
  channelId?: string | null;
  externalProgrammeId: string;
  title: string;
  description?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  category?: string | null;
  iconUrl?: string | null;
  metadata?: unknown;
};

export function upsertIptvEpgProgramme(providerId: string, record: IptvEpgProgrammeRecord) {
  const db = getDatabase();
  const timestamp = now();
  const programmeId = `epg_prog_${crypto.createHash("sha256").update(`${providerId}:${record.epgChannelId}:${record.externalProgrammeId}`).digest("hex").slice(0, 24)}`;
  const metadataJson = JSON.stringify(record.metadata ?? {});

  db.prepare(`
    INSERT INTO iptv_epg_programmes (
      id, provider_id, epg_channel_id, channel_id, external_programme_id, title, description, start_at, end_at, category, icon_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id, epg_channel_id, external_programme_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      title = excluded.title,
      description = excluded.description,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      category = excluded.category,
      icon_url = excluded.icon_url,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    programmeId,
    providerId,
    record.epgChannelId,
    record.channelId ?? null,
    record.externalProgrammeId,
    record.title,
    record.description ?? null,
    record.startAt ?? null,
    record.endAt ?? null,
    record.category ?? null,
    record.iconUrl ?? null,
    metadataJson,
    timestamp,
    timestamp
  );

  return {
    id: programmeId,
    providerId,
    epgChannelId: record.epgChannelId,
    channelId: record.channelId ?? null,
    externalProgrammeId: record.externalProgrammeId,
    title: record.title,
    description: record.description ?? null,
    startAt: record.startAt ?? null,
    endAt: record.endAt ?? null,
    category: record.category ?? null,
    iconUrl: record.iconUrl ?? null,
    metadata: record.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function listIptvEpgProgrammes(providerId: string, epgChannelId?: string) {
  const db = getDatabase();
  const rows = epgChannelId
    ? db.prepare("SELECT * FROM iptv_epg_programmes WHERE provider_id = ? AND epg_channel_id = ? ORDER BY start_at, title").all(providerId, epgChannelId)
    : db.prepare("SELECT * FROM iptv_epg_programmes WHERE provider_id = ? ORDER BY start_at, title").all(providerId);

  return (rows as any[]).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    epgChannelId: row.epg_channel_id,
    channelId: row.channel_id,
    externalProgrammeId: row.external_programme_id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    category: row.category,
    iconUrl: row.icon_url,
    metadata: JSON.parse(row.metadata_json ?? "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getCurrentIptvEpgProgramme(providerId: string, epgChannelId: string, at = new Date().toISOString()) {
  const row = getDatabase().prepare("SELECT * FROM iptv_epg_programmes WHERE provider_id = ? AND epg_channel_id = ? AND start_at <= ? AND end_at > ? ORDER BY start_at DESC LIMIT 1").get(providerId, epgChannelId, at, at) as any;
  return row ? mapEpgProgramme(row) : undefined;
}

export function getNextIptvEpgProgramme(providerId: string, epgChannelId: string, at = new Date().toISOString()) {
  const row = getDatabase().prepare("SELECT * FROM iptv_epg_programmes WHERE provider_id = ? AND epg_channel_id = ? AND start_at > ? ORDER BY start_at LIMIT 1").get(providerId, epgChannelId, at) as any;
  return row ? mapEpgProgramme(row) : undefined;
}

export function listUpcomingIptvEpgProgrammes(providerId: string, epgChannelId: string, from = new Date().toISOString(), limit = 20) {
  const rows = getDatabase().prepare("SELECT * FROM iptv_epg_programmes WHERE provider_id = ? AND epg_channel_id = ? AND start_at >= ? ORDER BY start_at LIMIT ?").all(providerId, epgChannelId, from, Math.min(100, Math.max(1, limit))) as any[];
  return rows.map(mapEpgProgramme);
}

export function getProviderCatalogueTotals(providerId: string) {
  const db = getDatabase();
  const liveCategories = db.prepare("SELECT COUNT(*) AS count FROM iptv_categories WHERE provider_id = ? AND content_type = 'live' AND status = 'active'").get(providerId) as { count: number };
  const movieCategories = db.prepare("SELECT COUNT(*) AS count FROM iptv_categories WHERE provider_id = ? AND content_type = 'movie' AND status = 'active'").get(providerId) as { count: number };
  const seriesCategories = db.prepare("SELECT COUNT(*) AS count FROM iptv_categories WHERE provider_id = ? AND content_type = 'series' AND status = 'active'").get(providerId) as { count: number };
  const liveChannels = db.prepare("SELECT COUNT(*) AS count FROM channels WHERE provider_id = ? AND status = 'active' AND content_type = 'live'").get(providerId) as { count: number };
  const movies = db.prepare("SELECT COUNT(*) AS count FROM iptv_movies WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const series = db.prepare("SELECT COUNT(*) AS count FROM iptv_series WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const seasons = db.prepare("SELECT COUNT(*) AS count FROM iptv_seasons WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const episodes = db.prepare(`SELECT COUNT(*) AS count FROM iptv_series_episodes e JOIN iptv_series s ON s.id = e.series_id WHERE s.provider_id = ? AND e.status = 'active'`).get(providerId) as { count: number };
  const epgChannels = db.prepare("SELECT COUNT(*) AS count FROM iptv_epg_channels WHERE provider_id = ? AND status = 'active'").get(providerId) as { count: number };
  const epgProgrammes = db.prepare("SELECT COUNT(*) AS count FROM iptv_epg_programmes WHERE provider_id = ?").get(providerId) as { count: number };

  return {
    liveCategories: Number(liveCategories.count ?? 0),
    movieCategories: Number(movieCategories.count ?? 0),
    seriesCategories: Number(seriesCategories.count ?? 0),
    liveChannels: Number(liveChannels.count ?? 0),
    movies: Number(movies.count ?? 0),
    series: Number(series.count ?? 0),
    seasons: Number(seasons.count ?? 0),
    episodes: Number(episodes.count ?? 0),
    epgChannels: Number(epgChannels.count ?? 0),
    epgProgrammes: Number(epgProgrammes.count ?? 0)
  };
}
