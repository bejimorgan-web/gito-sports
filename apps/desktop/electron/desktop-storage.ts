import crypto from "node:crypto";
import Database from "better-sqlite3";
import type {
  DesktopAvailability,
  DesktopCatalogueCategory,
  DesktopCatalogueCategoryInput,
  DesktopChannel,
  DesktopChannelInput,
  DesktopContentType,
  DesktopEpisode,
  DesktopEpisodeInput,
  DesktopEpgChannel,
  DesktopEpgChannelInput,
  DesktopEpgProgramme,
  DesktopEpgProgrammeInput,
  DesktopIptvOperation,
  DesktopIptvOperationInput,
  DesktopMovie,
  DesktopMovieInput,
  DesktopPublicationSource,
  DesktopPublicationSourceInput,
  DesktopProviderAccount,
  DesktopProviderAccountInput,
  DesktopProviderStatus,
  DesktopProviderType,
  DesktopRecordStatus,
  DesktopSeason,
  DesktopSeasonInput,
  DesktopSeries,
  DesktopSeriesInput
} from "../src/desktop-persistence-contract.js";

type DatabaseConnection = InstanceType<typeof Database>;

function now() {
  return new Date().toISOString();
}

function assertString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_required`);
  return value.trim();
}

function assertSafeRef(value: unknown, name: string) {
  const reference = assertString(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)) throw new Error(`${name}_invalid`);
  return reference;
}

function assertAllowedKeys(input: object, allowed: readonly string[]) {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`desktop_storage_field_not_allowed:${unexpected}`);
}

function validateProviderAccountValues(input: { name: string; type: DesktopProviderType; baseUrl: string; credentialStoreRef: string }) {
  assertString(input.name, "provider_name");
  assertString(input.baseUrl, "provider_base_url");
  assertSafeRef(input.credentialStoreRef, "credential_store_ref");
  if (!( ["manual", "m3u", "xtream"] as const).includes(input.type as DesktopProviderType)) throw new Error("provider_type_invalid");
}

export function validateProviderAccountInput(input: DesktopProviderAccountInput) {
  assertAllowedKeys(input, ["name", "type", "baseUrl", "credentialStoreRef", "expiresAt", "status", "availability", "lastValidatedAt", "healthReason"]);
  validateProviderAccountValues(input);
  return input;
}

export function validateProviderAccountPatch(input: Partial<DesktopProviderAccountInput>) {
  assertAllowedKeys(input, ["name", "type", "baseUrl", "credentialStoreRef", "expiresAt", "status", "availability", "lastValidatedAt", "healthReason"]);
}

export function validateChannelInput(input: DesktopChannelInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "name", "groupName", "logoUrl", "playbackUrl", "contentType", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.name, "channel_name");
  assertString(input.playbackUrl, "channel_playback_url");
}

export function validateCatalogueCategoryInput(input: DesktopCatalogueCategoryInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "name", "contentType", "sortOrder", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.name, "category_name");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.contentType !== undefined && !( ["live", "movie", "series"] as const).includes(input.contentType as DesktopContentType)) throw new Error("catalogue_content_type_invalid");
  if (input.sortOrder !== undefined && input.sortOrder !== null && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) throw new Error("catalogue_sort_order_invalid");
}

export function validateEpgChannelInput(input: DesktopEpgChannelInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "channelId", "name", "logoUrl", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.name, "epg_channel_name");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.channelId !== undefined && input.channelId !== null) assertSafeRef(input.channelId, "channel_id");
}

export function validateEpgProgrammeInput(input: DesktopEpgProgrammeInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "epgChannelId", "title", "description", "startAt", "endAt", "metadataJson", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.epgChannelId, "epg_channel_id");
  assertString(input.title, "programme_title");
  assertString(input.startAt, "programme_start_at");
  assertString(input.endAt, "programme_end_at");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
}

export function validateMovieInput(input: DesktopMovieInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "categoryId", "name", "description", "logoUrl", "posterUrl", "contentType", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.name, "movie_name");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.categoryId !== undefined && input.categoryId !== null) assertSafeRef(input.categoryId, "category_id");
  if (input.contentType !== undefined && !( ["live", "movie", "series"] as const).includes(input.contentType as DesktopContentType)) throw new Error("catalogue_content_type_invalid");
}

export function validateSeriesInput(input: DesktopSeriesInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "externalReference", "categoryId", "name", "description", "logoUrl", "posterUrl", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.name, "series_name");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.categoryId !== undefined && input.categoryId !== null) assertSafeRef(input.categoryId, "category_id");
}

export function validateSeasonInput(input: DesktopSeasonInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "seriesId", "externalReference", "seasonNumber", "name", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.seriesId, "series_id");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.seasonNumber !== undefined && input.seasonNumber !== null && (!Number.isInteger(input.seasonNumber) || input.seasonNumber < 0)) throw new Error("season_number_invalid");
}

export function validateEpisodeInput(input: DesktopEpisodeInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "seriesId", "seasonId", "externalReference", "episodeNumber", "name", "description", "logoUrl", "status"]);
  assertString(input.providerAccountId, "provider_account_id");
  assertString(input.seriesId, "series_id");
  if (input.seasonId !== undefined && input.seasonId !== null) assertSafeRef(input.seasonId, "season_id");
  if (input.externalReference !== undefined && input.externalReference !== null) assertSafeRef(input.externalReference, "external_reference");
  if (input.episodeNumber !== undefined && input.episodeNumber !== null && (!Number.isInteger(input.episodeNumber) || input.episodeNumber < 0)) throw new Error("episode_number_invalid");
}

export function validateOperationInput(input: DesktopIptvOperationInput) {
  assertAllowedKeys(input, ["id", "providerAccountId", "operationType", "status", "processed", "succeeded", "failed", "checkpoint", "cancellationRequested", "error"]);
  assertString(input.operationType, "operation_type");
}

export function validatePublicationSourceInput(input: DesktopPublicationSourceInput) {
  assertAllowedKeys(input, ["publicationId", "sourceReference", "providerAccountId", "channelId"]);
  assertSafeRef(input.publicationId, "publication_id");
  validatePublicationSourceReference(input.sourceReference);
  if (input.providerAccountId !== undefined && input.providerAccountId !== null) {
    assertSafeRef(input.providerAccountId, "provider_account_id");
  }
  if (input.channelId !== undefined && input.channelId !== null) {
    assertSafeRef(input.channelId, "channel_id");
  }
  return input;
}

export function validateCredentialWrite(input: { ref: string; username: string; password: string }) {
  assertSafeRef(input.ref, "credential_store_ref");
  assertString(input.username, "credential_username");
  assertString(input.password, "credential_password");
  return input;
}

function mapProvider(row: Record<string, unknown>): DesktopProviderAccount {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as DesktopProviderType,
    baseUrl: String(row.base_url),
    credentialStoreRef: String(row.credential_store_ref),
    expiresAt: (row.expires_at as string | null) ?? null,
    status: row.status as DesktopProviderStatus,
    availability: row.availability as DesktopAvailability,
    lastValidatedAt: (row.last_validated_at as string | null) ?? null,
    healthReason: (row.health_reason as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapChannel(row: Record<string, unknown>): DesktopChannel {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    name: String(row.name),
    groupName: (row.group_name as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    playbackUrl: String(row.playback_url),
    contentType: row.content_type as DesktopContentType,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapOperation(row: Record<string, unknown>): DesktopIptvOperation {
  return {
    id: String(row.id),
    providerAccountId: (row.provider_account_id as string | null) ?? null,
    operationType: String(row.operation_type),
    status: String(row.status),
    processed: Number(row.processed),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    checkpoint: (row.checkpoint as string | null) ?? null,
    cancellationRequested: Number(row.cancellation_requested) === 1,
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapCatalogueCategory(row: Record<string, unknown>): DesktopCatalogueCategory {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    name: String(row.name),
    contentType: row.content_type as DesktopContentType,
    sortOrder: row.sort_order == null ? null : Number(row.sort_order),
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEpgChannel(row: Record<string, unknown>): DesktopEpgChannel {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    channelId: (row.channel_id as string | null) ?? null,
    name: String(row.name),
    logoUrl: (row.logo_url as string | null) ?? null,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEpgProgramme(row: Record<string, unknown>): DesktopEpgProgramme {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    epgChannelId: String(row.epg_channel_id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    metadataJson: (row.metadata_json as string | null) ?? null,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMovie(row: Record<string, unknown>): DesktopMovie {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    posterUrl: (row.poster_url as string | null) ?? null,
    contentType: row.content_type as DesktopContentType,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSeries(row: Record<string, unknown>): DesktopSeries {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    externalReference: (row.external_reference as string | null) ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    posterUrl: (row.poster_url as string | null) ?? null,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSeason(row: Record<string, unknown>): DesktopSeason {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    seriesId: String(row.series_id),
    externalReference: (row.external_reference as string | null) ?? null,
    seasonNumber: row.season_number == null ? null : Number(row.season_number),
    name: (row.name as string | null) ?? null,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapEpisode(row: Record<string, unknown>): DesktopEpisode {
  return {
    id: String(row.id),
    providerAccountId: String(row.provider_account_id),
    seriesId: String(row.series_id),
    seasonId: (row.season_id as string | null) ?? null,
    externalReference: (row.external_reference as string | null) ?? null,
    episodeNumber: row.episode_number == null ? null : Number(row.episode_number),
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    status: row.status as DesktopRecordStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function validatePublicationSourceReference(value: string) {
  const reference = assertString(value, "source_reference");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)) {
    throw new Error("publication_source_reference_invalid");
  }
  if (/(?:username|password|credential|token|api[_-]?key|\.m3u8?|\/live\/|\/movie\/|\/series\/|https?:\/\/)/i.test(reference)) {
    throw new Error("publication_source_reference_invalid");
  }
  return reference;
}

function mapPublicationSource(row: Record<string, unknown>): DesktopPublicationSource {
  return {
    publicationId: String(row.publication_id),
    sourceReference: String(row.source_reference),
    providerAccountId: (row.provider_account_id as string | null) ?? null,
    channelId: (row.channel_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class DesktopSqliteStore {
  private readonly database: DatabaseConnection;

  constructor(databasePath: string) {
    if (!databasePath || databasePath.includes("gito.sqlite")) throw new Error("desktop_database_path_invalid");
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS provider_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('manual', 'm3u', 'xtream')),
        base_url TEXT NOT NULL,
        credential_store_ref TEXT NOT NULL UNIQUE,
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'failed', 'invalid', 'inactive')),
        availability TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('online', 'offline', 'degraded', 'unknown')),
        last_validated_at TEXT,
        health_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        name TEXT NOT NULL,
        group_name TEXT,
        logo_url TEXT,
        playback_url TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'live' CHECK (content_type IN ('live', 'movie', 'series')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_channels_provider ON channels(provider_account_id);
      CREATE TABLE IF NOT EXISTS iptv_categories (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'live' CHECK (content_type IN ('live', 'movie', 'series')),
        sort_order INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_categories_provider ON iptv_categories(provider_account_id, content_type, status, sort_order, name);
      CREATE TABLE IF NOT EXISTS iptv_epg_channels (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        channel_id TEXT,
        name TEXT NOT NULL,
        logo_url TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_epg_channels_provider ON iptv_epg_channels(provider_account_id, channel_id, status);
      CREATE TABLE IF NOT EXISTS iptv_epg_programmes (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        epg_channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        metadata_json TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (epg_channel_id) REFERENCES iptv_epg_channels(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_epg_programmes_provider_channel_time ON iptv_epg_programmes(provider_account_id, epg_channel_id, start_at, end_at);
      CREATE TABLE IF NOT EXISTS iptv_movies (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        category_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        logo_url TEXT,
        poster_url TEXT,
        content_type TEXT NOT NULL DEFAULT 'movie' CHECK (content_type IN ('live', 'movie', 'series')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES iptv_categories(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_movies_provider_category ON iptv_movies(provider_account_id, category_id, status);
      CREATE TABLE IF NOT EXISTS iptv_series (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        external_reference TEXT,
        category_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        logo_url TEXT,
        poster_url TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES iptv_categories(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_series_provider_category ON iptv_series(provider_account_id, category_id, status);
      CREATE TABLE IF NOT EXISTS iptv_seasons (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        external_reference TEXT,
        season_number INTEGER,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (series_id) REFERENCES iptv_series(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_seasons_provider_series ON iptv_seasons(provider_account_id, series_id, status);
      CREATE TABLE IF NOT EXISTS iptv_series_episodes (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        season_id TEXT,
        external_reference TEXT,
        episode_number INTEGER,
        name TEXT,
        description TEXT,
        logo_url TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (series_id) REFERENCES iptv_series(id) ON DELETE CASCADE,
        FOREIGN KEY (season_id) REFERENCES iptv_seasons(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_iptv_episodes_provider_series on iptv_series_episodes(provider_account_id, series_id, season_id, status);
      CREATE TABLE IF NOT EXISTS publication_sources (
        publication_id TEXT PRIMARY KEY,
        source_reference TEXT NOT NULL,
        provider_account_id TEXT,
        channel_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE SET NULL,
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_publication_sources_provider ON publication_sources(provider_account_id);
      CREATE INDEX IF NOT EXISTS idx_desktop_publication_sources_channel ON publication_sources(channel_id);
      CREATE TABLE IF NOT EXISTS iptv_operations (
        id TEXT PRIMARY KEY,
        provider_account_id TEXT,
        operation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0,
        succeeded INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        checkpoint TEXT,
        cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_requested IN (0, 1)),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_account_id) REFERENCES provider_accounts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_desktop_operations_provider ON iptv_operations(provider_account_id, updated_at);
    `);
  }

  close() {
    this.database.close();
  }

  transaction<T>(work: () => T) {
    return this.database.transaction(work)();
  }

  listProviderAccounts() {
    return this.database.prepare("SELECT * FROM provider_accounts ORDER BY name, id").all().map((row) => mapProvider(row as Record<string, unknown>));
  }

  getProviderAccount(id: string) {
    const row = this.database.prepare("SELECT * FROM provider_accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapProvider(row) : null;
  }

  createProviderAccount(input: DesktopProviderAccountInput) {
    validateProviderAccountInput(input);
    const timestamp = now();
    const id = `provider_${crypto.randomUUID()}`;
    this.database.prepare(`
      INSERT INTO provider_accounts (id, name, type, base_url, credential_store_ref, expires_at, status, availability, last_validated_at, health_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name.trim(), input.type, input.baseUrl.trim(), input.credentialStoreRef.trim(), input.expiresAt ?? null, input.status ?? "pending", input.availability ?? "unknown", input.lastValidatedAt ?? null, input.healthReason ?? null, timestamp, timestamp);
    return this.getProviderAccount(id)!;
  }

  updateProviderAccount(id: string, input: Partial<DesktopProviderAccountInput>) {
    const existing = this.getProviderAccount(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...input,
      id,
      credentialStoreRef: input.credentialStoreRef ?? existing.credentialStoreRef,
      updatedAt: now()
    };
    validateProviderAccountPatch(input);
    validateProviderAccountValues(next);
    this.database.prepare(`
      UPDATE provider_accounts SET name = ?, type = ?, base_url = ?, credential_store_ref = ?, expires_at = ?, status = ?, availability = ?, last_validated_at = ?, health_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.type, next.baseUrl, next.credentialStoreRef, next.expiresAt, next.status, next.availability, next.lastValidatedAt, next.healthReason, next.updatedAt, id);
    return this.getProviderAccount(id);
  }

  deleteProviderAccount(id: string) {
    return this.database.prepare("DELETE FROM provider_accounts WHERE id = ?").run(id).changes > 0;
  }

  listChannels(providerAccountId?: string) {
    const rows = providerAccountId
      ? this.database.prepare("SELECT * FROM channels WHERE provider_account_id = ? ORDER BY group_name, name, id").all(providerAccountId)
      : this.database.prepare("SELECT * FROM channels ORDER BY group_name, name, id").all();
    return rows.map((row) => mapChannel(row as Record<string, unknown>));
  }

  getChannel(id: string) {
    const row = this.database.prepare("SELECT * FROM channels WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapChannel(row) : null;
  }

  upsertChannel(input: DesktopChannelInput) {
    validateChannelInput(input);
    const timestamp = now();
    const id = input.id ?? `channel_${crypto.randomUUID()}`;
    this.database.prepare(`
      INSERT INTO channels (id, provider_account_id, external_reference, name, group_name, logo_url, playback_url, content_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider_account_id = excluded.provider_account_id, external_reference = excluded.external_reference, name = excluded.name, group_name = excluded.group_name, logo_url = excluded.logo_url, playback_url = excluded.playback_url, content_type = excluded.content_type, status = excluded.status, updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.name, input.groupName ?? null, input.logoUrl ?? null, input.playbackUrl, input.contentType ?? "live", input.status ?? "active", timestamp, timestamp);
    return this.getChannel(id)!;
  }

  listCategories(providerAccountId?: string, contentType?: DesktopContentType) {
    const query = contentType
      ? providerAccountId
        ? "SELECT * FROM iptv_categories WHERE provider_account_id = ? AND content_type = ? ORDER BY sort_order IS NULL, sort_order, name, id"
        : "SELECT * FROM iptv_categories WHERE content_type = ? ORDER BY sort_order IS NULL, sort_order, name, id"
      : providerAccountId
        ? "SELECT * FROM iptv_categories WHERE provider_account_id = ? ORDER BY content_type, sort_order IS NULL, sort_order, name, id"
        : "SELECT * FROM iptv_categories ORDER BY content_type, sort_order IS NULL, sort_order, name, id";
    const rows = contentType
      ? providerAccountId
        ? this.database.prepare(query).all(providerAccountId, contentType)
        : this.database.prepare(query).all(contentType)
      : providerAccountId
        ? this.database.prepare(query).all(providerAccountId)
        : this.database.prepare(query).all();
    return rows.map((row) => mapCatalogueCategory(row as Record<string, unknown>));
  }

  getCategory(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_categories WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapCatalogueCategory(row) : null;
  }

  upsertCategory(input: DesktopCatalogueCategoryInput) {
    validateCatalogueCategoryInput(input);
    const timestamp = now();
    const id = input.id ?? `category_${crypto.randomUUID()}`;
    const contentType = input.contentType ?? "live";
    const existing = this.getCategory(id);
    this.database.prepare(`
      INSERT INTO iptv_categories (id, provider_account_id, external_reference, name, content_type, sort_order, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        external_reference = excluded.external_reference,
        name = excluded.name,
        content_type = excluded.content_type,
        sort_order = excluded.sort_order,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.name, contentType, input.sortOrder ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getCategory(id)!;
  }

  deleteCategory(id: string) {
    return this.database.prepare("DELETE FROM iptv_categories WHERE id = ?").run(id).changes > 0;
  }

  archiveCategory(id: string) {
    const row = this.getCategory(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_categories SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getCategory(id);
  }

  listEpgChannels(providerAccountId?: string) {
    const rows = providerAccountId
      ? this.database.prepare("SELECT * FROM iptv_epg_channels WHERE provider_account_id = ? ORDER BY name, id").all(providerAccountId)
      : this.database.prepare("SELECT * FROM iptv_epg_channels ORDER BY name, id").all();
    return rows.map((row) => mapEpgChannel(row as Record<string, unknown>));
  }

  getEpgChannel(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_epg_channels WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapEpgChannel(row) : null;
  }

  upsertEpgChannel(input: DesktopEpgChannelInput) {
    validateEpgChannelInput(input);
    if (input.channelId !== undefined && input.channelId !== null) {
      const channel = this.getChannel(input.channelId);
      if (!channel || channel.providerAccountId !== input.providerAccountId) throw new Error("epg_channel_provider_mismatch");
    }
    const timestamp = now();
    const id = input.id ?? `epg_channel_${crypto.randomUUID()}`;
    const existing = this.getEpgChannel(id);
    this.database.prepare(`
      INSERT INTO iptv_epg_channels (id, provider_account_id, external_reference, channel_id, name, logo_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        external_reference = excluded.external_reference,
        channel_id = excluded.channel_id,
        name = excluded.name,
        logo_url = excluded.logo_url,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.channelId ?? null, input.name, input.logoUrl ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getEpgChannel(id)!;
  }

  deleteEpgChannel(id: string) {
    return this.database.prepare("DELETE FROM iptv_epg_channels WHERE id = ?").run(id).changes > 0;
  }

  archiveEpgChannel(id: string) {
    const row = this.getEpgChannel(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_epg_channels SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getEpgChannel(id);
  }

  listEpgProgrammes(providerAccountId?: string, epgChannelId?: string) {
    const rows = epgChannelId
      ? providerAccountId
        ? this.database.prepare("SELECT * FROM iptv_epg_programmes WHERE provider_account_id = ? AND epg_channel_id = ? ORDER BY start_at, title, id").all(providerAccountId, epgChannelId)
        : this.database.prepare("SELECT * FROM iptv_epg_programmes WHERE epg_channel_id = ? ORDER BY start_at, title, id").all(epgChannelId)
      : providerAccountId
        ? this.database.prepare("SELECT * FROM iptv_epg_programmes WHERE provider_account_id = ? ORDER BY start_at, title, id").all(providerAccountId)
        : this.database.prepare("SELECT * FROM iptv_epg_programmes ORDER BY start_at, title, id").all();
    return rows.map((row) => mapEpgProgramme(row as Record<string, unknown>));
  }

  getEpgProgramme(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_epg_programmes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapEpgProgramme(row) : null;
  }

  upsertEpgProgramme(input: DesktopEpgProgrammeInput) {
    validateEpgProgrammeInput(input);
    const epgChannel = this.getEpgChannel(input.epgChannelId);
    if (!epgChannel || epgChannel.providerAccountId !== input.providerAccountId) throw new Error("epg_programme_provider_mismatch");
    const timestamp = now();
    const id = input.id ?? `epg_programme_${crypto.randomUUID()}`;
    const existing = this.getEpgProgramme(id);
    this.database.prepare(`
      INSERT INTO iptv_epg_programmes (id, provider_account_id, external_reference, epg_channel_id, title, description, start_at, end_at, metadata_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        external_reference = excluded.external_reference,
        epg_channel_id = excluded.epg_channel_id,
        title = excluded.title,
        description = excluded.description,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        metadata_json = excluded.metadata_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.epgChannelId, input.title, input.description ?? null, input.startAt, input.endAt, input.metadataJson ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getEpgProgramme(id)!;
  }

  deleteEpgProgramme(id: string) {
    return this.database.prepare("DELETE FROM iptv_epg_programmes WHERE id = ?").run(id).changes > 0;
  }

  archiveEpgProgramme(id: string) {
    const row = this.getEpgProgramme(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_epg_programmes SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getEpgProgramme(id);
  }

  listMovies(providerAccountId?: string) {
    const rows = providerAccountId
      ? this.database.prepare("SELECT * FROM iptv_movies WHERE provider_account_id = ? ORDER BY name, id").all(providerAccountId)
      : this.database.prepare("SELECT * FROM iptv_movies ORDER BY name, id").all();
    return rows.map((row) => mapMovie(row as Record<string, unknown>));
  }

  getMovie(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_movies WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapMovie(row) : null;
  }

  upsertMovie(input: DesktopMovieInput) {
    validateMovieInput(input);
    const timestamp = now();
    const id = input.id ?? `movie_${crypto.randomUUID()}`;
    const existing = this.getMovie(id);
    this.database.prepare(`
      INSERT INTO iptv_movies (id, provider_account_id, external_reference, category_id, name, description, logo_url, poster_url, content_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        external_reference = excluded.external_reference,
        category_id = excluded.category_id,
        name = excluded.name,
        description = excluded.description,
        logo_url = excluded.logo_url,
        poster_url = excluded.poster_url,
        content_type = excluded.content_type,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.categoryId ?? null, input.name, input.description ?? null, input.logoUrl ?? null, input.posterUrl ?? null, input.contentType ?? "movie", input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getMovie(id)!;
  }

  deleteMovie(id: string) {
    return this.database.prepare("DELETE FROM iptv_movies WHERE id = ?").run(id).changes > 0;
  }

  archiveMovie(id: string) {
    const row = this.getMovie(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_movies SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getMovie(id);
  }

  listSeries(providerAccountId?: string) {
    const rows = providerAccountId
      ? this.database.prepare("SELECT * FROM iptv_series WHERE provider_account_id = ? ORDER BY name, id").all(providerAccountId)
      : this.database.prepare("SELECT * FROM iptv_series ORDER BY name, id").all();
    return rows.map((row) => mapSeries(row as Record<string, unknown>));
  }

  getSeries(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_series WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSeries(row) : null;
  }

  upsertSeries(input: DesktopSeriesInput) {
    validateSeriesInput(input);
    const timestamp = now();
    const id = input.id ?? `series_${crypto.randomUUID()}`;
    const existing = this.getSeries(id);
    this.database.prepare(`
      INSERT INTO iptv_series (id, provider_account_id, external_reference, category_id, name, description, logo_url, poster_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        external_reference = excluded.external_reference,
        category_id = excluded.category_id,
        name = excluded.name,
        description = excluded.description,
        logo_url = excluded.logo_url,
        poster_url = excluded.poster_url,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.externalReference ?? null, input.categoryId ?? null, input.name, input.description ?? null, input.logoUrl ?? null, input.posterUrl ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getSeries(id)!;
  }

  deleteSeries(id: string) {
    return this.database.prepare("DELETE FROM iptv_series WHERE id = ?").run(id).changes > 0;
  }

  archiveSeries(id: string) {
    const row = this.getSeries(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_series SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getSeries(id);
  }

  listSeasons(providerAccountId?: string, seriesId?: string) {
    const rows = seriesId
      ? providerAccountId
        ? this.database.prepare("SELECT * FROM iptv_seasons WHERE provider_account_id = ? AND series_id = ? ORDER BY season_number IS NULL, season_number, name, id").all(providerAccountId, seriesId)
        : this.database.prepare("SELECT * FROM iptv_seasons WHERE series_id = ? ORDER BY season_number IS NULL, season_number, name, id").all(seriesId)
      : providerAccountId
        ? this.database.prepare("SELECT * FROM iptv_seasons WHERE provider_account_id = ? ORDER BY series_id, season_number IS NULL, season_number, name, id").all(providerAccountId)
        : this.database.prepare("SELECT * FROM iptv_seasons ORDER BY series_id, season_number IS NULL, season_number, name, id").all();
    return rows.map((row) => mapSeason(row as Record<string, unknown>));
  }

  getSeason(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_seasons WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSeason(row) : null;
  }

  upsertSeason(input: DesktopSeasonInput) {
    validateSeasonInput(input);
    const timestamp = now();
    const id = input.id ?? `season_${crypto.randomUUID()}`;
    const existing = this.getSeason(id);
    this.database.prepare(`
      INSERT INTO iptv_seasons (id, provider_account_id, series_id, external_reference, season_number, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        series_id = excluded.series_id,
        external_reference = excluded.external_reference,
        season_number = excluded.season_number,
        name = excluded.name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.seriesId, input.externalReference ?? null, input.seasonNumber ?? null, input.name ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getSeason(id)!;
  }

  deleteSeason(id: string) {
    return this.database.prepare("DELETE FROM iptv_seasons WHERE id = ?").run(id).changes > 0;
  }

  archiveSeason(id: string) {
    const row = this.getSeason(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_seasons SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getSeason(id);
  }

  listEpisodes(providerAccountId?: string, seriesId?: string, seasonId?: string) {
    const rows = seasonId
      ? providerAccountId
        ? this.database.prepare("SELECT * FROM iptv_series_episodes WHERE provider_account_id = ? AND season_id = ? ORDER BY episode_number IS NULL, episode_number, name, id").all(providerAccountId, seasonId)
        : this.database.prepare("SELECT * FROM iptv_series_episodes WHERE season_id = ? ORDER BY episode_number IS NULL, episode_number, name, id").all(seasonId)
      : seriesId
        ? providerAccountId
          ? this.database.prepare("SELECT * FROM iptv_series_episodes WHERE provider_account_id = ? AND series_id = ? ORDER BY episode_number IS NULL, episode_number, name, id").all(providerAccountId, seriesId)
          : this.database.prepare("SELECT * FROM iptv_series_episodes WHERE series_id = ? ORDER BY episode_number IS NULL, episode_number, name, id").all(seriesId)
        : providerAccountId
          ? this.database.prepare("SELECT * FROM iptv_series_episodes WHERE provider_account_id = ? ORDER BY series_id, episode_number IS NULL, episode_number, name, id").all(providerAccountId)
          : this.database.prepare("SELECT * FROM iptv_series_episodes ORDER BY series_id, episode_number IS NULL, episode_number, name, id").all();
    return rows.map((row) => mapEpisode(row as Record<string, unknown>));
  }

  getEpisode(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_series_episodes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapEpisode(row) : null;
  }

  upsertEpisode(input: DesktopEpisodeInput) {
    validateEpisodeInput(input);
    const timestamp = now();
    const id = input.id ?? `episode_${crypto.randomUUID()}`;
    const existing = this.getEpisode(id);
    this.database.prepare(`
      INSERT INTO iptv_series_episodes (id, provider_account_id, series_id, season_id, external_reference, episode_number, name, description, logo_url, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        series_id = excluded.series_id,
        season_id = excluded.season_id,
        external_reference = excluded.external_reference,
        episode_number = excluded.episode_number,
        name = excluded.name,
        description = excluded.description,
        logo_url = excluded.logo_url,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(id, input.providerAccountId, input.seriesId, input.seasonId ?? null, input.externalReference ?? null, input.episodeNumber ?? null, input.name ?? null, input.description ?? null, input.logoUrl ?? null, input.status ?? (existing?.status ?? "active"), existing?.createdAt ?? timestamp, timestamp);
    return this.getEpisode(id)!;
  }

  deleteEpisode(id: string) {
    return this.database.prepare("DELETE FROM iptv_series_episodes WHERE id = ?").run(id).changes > 0;
  }

  archiveEpisode(id: string) {
    const row = this.getEpisode(id);
    if (!row) return null;
    this.database.prepare("UPDATE iptv_series_episodes SET status = 'archived', updated_at = ? WHERE id = ?").run(now(), id);
    return this.getEpisode(id);
  }

  listOperations(providerAccountId?: string) {
    const rows = providerAccountId
      ? this.database.prepare("SELECT * FROM iptv_operations WHERE provider_account_id = ? ORDER BY updated_at DESC, id").all(providerAccountId)
      : this.database.prepare("SELECT * FROM iptv_operations ORDER BY updated_at DESC, id").all();
    return rows.map((row) => mapOperation(row as Record<string, unknown>));
  }

  getOperation(id: string) {
    const row = this.database.prepare("SELECT * FROM iptv_operations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapOperation(row) : null;
  }

  listPublicationSources() {
    const rows = this.database.prepare("SELECT * FROM publication_sources ORDER BY publication_id").all();
    return rows.map((row) => mapPublicationSource(row as Record<string, unknown>));
  }

  getPublicationSource(publicationId: string) {
    const row = this.database.prepare("SELECT * FROM publication_sources WHERE publication_id = ?").get(publicationId) as Record<string, unknown> | undefined;
    return row ? mapPublicationSource(row) : null;
  }

  upsertPublicationSource(input: DesktopPublicationSourceInput) {
    validatePublicationSourceInput(input);
    const timestamp = now();
    const existing = this.getPublicationSource(input.publicationId);
    this.database.prepare(`
      INSERT INTO publication_sources (publication_id, source_reference, provider_account_id, channel_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(publication_id) DO UPDATE SET
        source_reference = excluded.source_reference,
        provider_account_id = excluded.provider_account_id,
        channel_id = excluded.channel_id,
        updated_at = excluded.updated_at
    `).run(
      input.publicationId,
      validatePublicationSourceReference(input.sourceReference),
      input.providerAccountId ?? null,
      input.channelId ?? null,
      existing?.createdAt ?? timestamp,
      timestamp
    );
    return this.getPublicationSource(input.publicationId)!;
  }

  deletePublicationSource(publicationId: string) {
    return this.database.prepare("DELETE FROM publication_sources WHERE publication_id = ?").run(publicationId).changes > 0;
  }

  upsertOperation(input: DesktopIptvOperationInput) {
    validateOperationInput(input);
    const timestamp = now();
    const id = input.id ?? `iptv_${crypto.randomUUID()}`;
    this.database.prepare(`
      INSERT INTO iptv_operations (id, provider_account_id, operation_type, status, processed, succeeded, failed, checkpoint, cancellation_requested, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider_account_id = excluded.provider_account_id, operation_type = excluded.operation_type, status = excluded.status, processed = excluded.processed, succeeded = excluded.succeeded, failed = excluded.failed, checkpoint = excluded.checkpoint, cancellation_requested = excluded.cancellation_requested, error = excluded.error, updated_at = excluded.updated_at
    `).run(id, input.providerAccountId ?? null, input.operationType, input.status ?? "queued", input.processed ?? 0, input.succeeded ?? 0, input.failed ?? 0, input.checkpoint ?? null, input.cancellationRequested ? 1 : 0, input.error ?? null, timestamp, timestamp);
    return this.getOperation(id)!;
  }
}
