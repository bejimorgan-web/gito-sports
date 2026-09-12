import { Router } from "express";
import type { CreateProviderRequest } from "@gito/shared";
import { IPTVService } from "../services/iptv-service.js";
import { parseM3uPlaylist, M3uParseError } from "../services/m3u-parser.js";
import { syncParsedM3uCatalogue } from "../services/m3u-catalogue-sync.js";
import { fetchXtreamCatalogue, fetchXtreamLiveCatalogue, fetchXtreamChannels, fetchXtreamShortEpg, fetchTextWithTimeout, fetchWithTimeout, testXtreamConnection, XtreamParseError, normalizeXtreamUrl } from "../services/xtream-codes.js";
import { validateHttpStreamUrl } from "../services/url-validation.js";
import { logChannelSyncTrace } from "../services/iptv-trace.js";
import { detectProviderType } from "../services/provider-type-detector.js";
import { IptvOperationManager, type IptvOperationType } from "../services/iptv-operation-manager.js";
import {
  getIptvMovie,
  getIptvSeries,
  listIptvCategoriesPage,
  listIptvChannelsPage,
  listIptvEpgChannelsPage,
  listIptvEpgProgrammesPage,
  listIptvEpisodesPage,
  listIptvMoviesPage,
  listIptvSeasonsPage,
  listIptvSeriesPage,
  syncXtreamCategories,
  syncXtreamMoviesDetailed,
  syncXtreamSeriesDetailed,
  syncXtreamSeasonsDetailed,
  syncXtreamEpisodesDetailed,
  getXtreamCatalogueTotals,
  type CatalogueListOptions,
  type IptvCategoryContentType
} from "../repositories/iptv-catalogue-repository.js";

type ChannelListMode = "active" | "includeInactive" | "debug" | "raw";

function normalizePlaylistUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" && url.hostname.endsWith("github.io")) {
      url.protocol = "https:";
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

const catalogueStatuses = new Set(["active", "inactive", "archived", "stale"]);

function parseCatalogueQuery(request: any, response: any): CatalogueListOptions | undefined {
  const rawPage = request.query.page;
  const rawPageSize = request.query.pageSize;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const pageSize = rawPageSize === undefined ? 50 : Number(rawPageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    response.status(400).json({ error: "invalid_pagination", message: "page must be >= 1 and pageSize must be between 1 and 100." });
    return undefined;
  }

  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  if (status && !catalogueStatuses.has(status)) {
    response.status(400).json({ error: "invalid_status" });
    return undefined;
  }

  return {
    page,
    pageSize,
    search: typeof request.query.search === "string" ? request.query.search.trim() || undefined : undefined,
    categoryId: typeof request.query.categoryId === "string" ? request.query.categoryId : undefined,
    status
  };
}

function requireProvider(providerId: string, response: any) {
  const provider = IPTVService.getProvider(providerId);
  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return false;
  }
  return true;
}

function parseContentType(value: unknown): IptvCategoryContentType | undefined | null {
  if (value === undefined) return undefined;
  if (value === "live" || value === "movie" || value === "series") return value;
  return null;
}

async function validateProviderConnection(input: {
  baseUrl?: string;
  username?: string;
  password?: string;
  type?: string;
  providerId?: string;
}) {
  const { baseUrl, type, providerId } = input;
  const validationId = `iptv_validation_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const storedCredentials = providerId ? IPTVService.getProviderCredentials(providerId) : undefined;
  const username = input.username ?? (storedCredentials as any)?.credential_username ?? undefined;
  const password = input.password ?? (storedCredentials as any)?.credential_password ?? undefined;

  if (!baseUrl) {
    return { ok: false, message: "Base URL is required." };
  }

  const resolvedType = type && type !== "manual" ? type : "manual";
  console.info("[iptv-validation] request_started", { validationId, providerType: resolvedType });

  try {
    // For Xtream, normalize and validate URL first
    if (resolvedType === "xtream") {
      const urlResult = normalizeXtreamUrl(baseUrl);
      if (urlResult.error) {
        // Could be Xtream, show the validation error
        return { ok: false, message: urlResult.error };
      }

      if (!username || !password) {
        return { ok: false, message: "Xtream providers require both username and password." };
      }

      // Test Xtream connection with normalized URL
      const testResult = await testXtreamConnection(urlResult.url, username, password);
      return {
        ...testResult,
        detectedType: "xtream",
        channels: [] as any[],
        channelsParsed: 0,
        channelsRejected: 0,
        categories: [],
        stages: [
          { name: "url_validation", ok: !testResult.ok ? false : true, message: testResult.ok ? "URL valid." : urlResult.error ?? testResult.message },
          { name: "server_reachable", ok: testResult.statusCode !== undefined && testResult.statusCode < 500 && testResult.statusCode !== 401 && testResult.statusCode !== 403, message: testResult.ok ? "Server reachable." : "Server unreachable." },
          { name: "credentials", ok: testResult.ok, message: testResult.message }
        ]
      };
    }

    const playlistUrl = normalizePlaylistUrl(baseUrl);
    const testResult = await fetchTextWithTimeout(playlistUrl, { method: "GET" }, 60_000);
    const testResponse = testResult.response;

    if (!testResponse.ok) {
      return {
        ok: false,
        statusCode: testResponse.status,
        message: "Provider returned an error."
      };
    }

    const bodyText = testResult.text;
    const detectedType = await detectProviderType({ baseUrl: playlistUrl, username, password, payload: bodyText });
    const inferredType = resolvedType === "manual" ? detectedType : resolvedType;

    if (inferredType === "xtream") {
      if (!username || !password) {
        return { ok: false, message: "Xtream providers require both username and password." };
      }

      const testResult = await testXtreamConnection(baseUrl, username, password);
      if (!testResult.ok) {
        return {
          ...testResult,
          detectedType: inferredType,
          channels: [] as any[],
          stages: [
            { name: "server_reachable", ok: true, message: "Server reachable." },
            { name: "credentials", ok: false, message: testResult.message }
          ]
        };
      }

      return {
        ok: true,
        statusCode: testResult.statusCode,
        message: "Connected — credentials accepted. Sync channels separately.",
        detectedType: inferredType,
        channels: [] as any[],
        channelsParsed: 0,
        channelsRejected: 0,
        categories: [],
        stages: [
          { name: "server_reachable", ok: true, message: "Server reachable." },
          { name: "credentials", ok: true, message: "Credentials accepted." },
          { name: "account_metadata", ok: true, message: "Account authentication completed." }
        ]
      };
    }

    const invalidEntries: M3uParseError[] = [];
    const parsed = parseM3uPlaylist(bodyText, (entry) => invalidEntries.push(entry));

    if (parsed.length === 0) {
      return {
        ok: false,
        statusCode: testResponse.status,
        message: "Provider responded but playlist is empty or invalid."
      };
    }

    const validChannels: Array<{ name: string; url: string; externalRef?: string; groupName?: string }> = [];
    const invalidChannels: Array<{ name: string; url: string; error: string }> = [];

    for (const ch of parsed) {
      const error = validateHttpStreamUrl(ch.url);
      if (error) {
        invalidChannels.push({ name: ch.name, url: ch.url, error });
      } else {
        validChannels.push(ch);
      }
    }

    return {
      ok: validChannels.length > 0,
      statusCode: testResponse.status,
      message: validChannels.length > 0 ? "Provider connection is valid." : "No valid channels could be parsed from the playlist.",
      detectedType: inferredType,
      channels: validChannels,
      channelsParsed: parsed.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(validChannels.map((channel) => channel.groupName).filter(Boolean) as string[])),
      rejectedChannels: invalidChannels.slice(0, 10)
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    const timedOut = errorName === "AbortError" || errorName === "TimeoutError" || /timeout|aborted/i.test(String(error));
    console.warn("[iptv-validation] request_failed", {
      validationId,
      providerType: resolvedType,
      classification: timedOut ? "timeout" : "provider_error"
    });
    return {
      ok: false,
      statusCode: timedOut ? 408 : undefined,
      message: timedOut ? "The provider did not respond within the allowed time." : error instanceof Error ? error.message : "Provider connection failed."
    };
  }
}

async function persistValidatedProvider(
  providerId: string,
  validation: Awaited<ReturnType<typeof validateProviderConnection>>,
  input: { type?: string },
  options?: { activate?: boolean }
) {
  if (!validation.ok) {
    return false;
  }

  if (input.type === "xtream" || validation.detectedType === "xtream") {
    IPTVService.updateProviderExpiry(providerId, (validation as { expiresAt?: string | null }).expiresAt ?? null);
  }

  if (input.type && input.type !== "manual" && Array.isArray(validation.channels) && validation.channels.length > 0) {
    if (input.type === "m3u") {
      syncParsedM3uCatalogue(providerId, validation.channels as any[]);
    } else {
      IPTVService.syncProviderChannels(providerId, validation.channels as any[]);
    }
  }

  if (options?.activate) {
    IPTVService.setProviderStatus(providerId, "active");
  }

  return true;
}

function startXtreamSyncOperation(providerId: string) {
  return IptvOperationManager.start("xtream_channel_sync", async (state, report, signal) => {
    try {
      const provider = IPTVService.getProviderCredentials(providerId);
      if (!provider) throw new Error("provider_not_found");
      const username = provider.credential_username;
      const password = provider.credential_password;
      const normalizedServerUrl = normalizeXtreamUrl(provider.base_url);
      if (normalizedServerUrl.error) throw new Error(normalizedServerUrl.error);
      const serverUrl = normalizedServerUrl.url;
      if (!username || !password || !serverUrl) throw new Error("stored_xtream_credentials_required");

      report({ currentStage: "authenticating", currentMessage: "Checking Xtream credentials." });
      const connection = await testXtreamConnection(serverUrl, username, password, signal);
      if (!connection.ok) throw new Error(connection.message);

      report({ currentStage: "discovering_channels", currentMessage: "Loading live groups and channels." });
      const invalidEntries: XtreamParseError[] = [];
      const live = await fetchXtreamLiveCatalogue(serverUrl, username, password, signal);
      syncXtreamCategories(providerId, "live", live.categories);
      const valid = live.channels.filter((channel) => !validateHttpStreamUrl(channel.url));
      report({
        total: live.channels.length,
        processed: live.channels.length,
        succeeded: valid.length,
        failed: invalidEntries.length,
        currentStage: "saving_channels",
        currentMessage: `${live.channels.length} live channels discovered.`
      });

      if (state.cancelled) return;
      if (valid.length === 0) {
        IPTVService.setProviderStatus(providerId, "failed");
        throw new Error("Xtream sync completed with zero usable channels.");
      }

      const saved = IPTVService.syncProviderChannels(providerId, valid);
      report({ currentStage: "syncing_catalogue", currentMessage: "Loading movies, series, seasons, and episodes." });
      const catalogue = await fetchXtreamCatalogue(serverUrl, username, password, signal);
      if (signal.aborted || state.cancelled) return;
      syncXtreamCategories(providerId, "movie", catalogue.movieCategories);
      syncXtreamCategories(providerId, "series", catalogue.seriesCategories);
      report({ currentStage: "saving_movies", total: catalogue.movies.length, processed: 0, currentMessage: `${catalogue.movies.length} movies discovered.` });
      const movieStats = syncXtreamMoviesDetailed(providerId, catalogue.movies);
      report({ currentStage: "saving_series", total: catalogue.series.length, processed: 0, currentMessage: `${catalogue.series.length} series discovered.` });
      const seriesStats = syncXtreamSeriesDetailed(providerId, catalogue.series);
      report({ currentStage: "saving_seasons", total: catalogue.seasons.length, processed: 0, currentMessage: `${catalogue.seasons.length} seasons discovered.` });
      const seasonStats = syncXtreamSeasonsDetailed(providerId, catalogue.seasons);
      let episodeStats = { fetched: 0, processed: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, archived: 0 };
      for (const seriesEpisodes of catalogue.episodes) {
        if (signal.aborted || state.cancelled) return;
        const result = syncXtreamEpisodesDetailed(providerId, seriesEpisodes.seriesExternalId, seriesEpisodes.records);
        episodeStats = {
          fetched: episodeStats.fetched + result.fetched,
          processed: episodeStats.processed + result.processed,
          inserted: episodeStats.inserted + result.inserted,
          updated: episodeStats.updated + result.updated,
          unchanged: episodeStats.unchanged + result.unchanged,
          failed: episodeStats.failed + result.failed,
          archived: episodeStats.archived + result.archived
        };
      }
      report({ currentStage: "diagnostics", currentMessage: "Calculating canonical catalogue totals." });
      const totals = getXtreamCatalogueTotals(providerId);
      IPTVService.updateProviderHealth({ providerId, success: true, impact: "success" });
      IPTVService.setProviderStatus(providerId, "active");
      report({
        processed: live.channels.length + movieStats.processed + seriesStats.processed + seasonStats.processed + episodeStats.processed,
        succeeded: saved.length,
        currentMessage: `${totals.movies} movies, ${totals.series} series, and ${totals.episodes} episodes are active.`,
        currentStage: "completed",
        total: live.channels.length + totals.movies + totals.series + totals.episodes
      });
    } catch (error) {
      IPTVService.updateProviderHealth({ providerId, success: false, impact: "failure" });
      throw error;
    }
  }, undefined, 10 * 60 * 1000);
}

export const iptvRouter = Router();

iptvRouter.get("/providers", (_request, response) => {
  response.json({
    data: IPTVService.listProviders()
  });
});

iptvRouter.get("/providers/:providerId", (request, response) => {
  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: provider });
});

iptvRouter.post("/providers", async (request, response) => {
  const body = request.body as CreateProviderRequest;

  if (!body.name || !body.baseUrl) {
    response.status(400).json({ error: "provider_name_and_base_url_required" });
    return;
  }

  const resolvedInput = {
    ...body,
    type: body.type ?? "manual"
  };

  const validation = await validateProviderConnection(resolvedInput);
  if (!validation.ok) {
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  const detectedType = (validation as { detectedType?: string } | undefined)?.detectedType ?? resolvedInput.type ?? "manual";
  const providerInput = {
    ...resolvedInput,
    ...(detectedType !== "xtream" ? { baseUrl: normalizePlaylistUrl(resolvedInput.baseUrl) } : {}),
    ...(detectedType === "xtream" ? { baseUrl: normalizeXtreamUrl(resolvedInput.baseUrl).url } : {}),
    type: detectedType as CreateProviderRequest["type"]
  };

  const provider = IPTVService.createProvider(providerInput);
  const persistedProvider = provider ? IPTVService.getProvider(provider.id) ?? provider : provider;

  if (persistedProvider) {
    try {
      await persistValidatedProvider(persistedProvider.id, validation, providerInput, { activate: detectedType !== "xtream" });
      if (detectedType !== "xtream") {
        IPTVService.setProviderStatus(persistedProvider.id, "active");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/foreign key|constraint/i.test(message)) {
        IPTVService.setProviderStatus(persistedProvider.id, "failed");
        response.status(201).json({
          data: IPTVService.getProvider(persistedProvider.id) ?? persistedProvider,
          meta: {
            warning: "provider_saved_without_channels",
            message: "The provider record was saved, but the channel import could not be completed because the database rejected the channel link."
          }
        });
        return;
      }
      throw error;
    }
  }

  const syncOperation = detectedType === "xtream" && persistedProvider
    ? startXtreamSyncOperation(persistedProvider.id)
    : undefined;
  response.status(201).json({
    data: persistedProvider ? { ...persistedProvider, ...(syncOperation ? { syncOperationId: syncOperation.id } : {}) } : persistedProvider
  });
});

iptvRouter.put("/providers/:providerId", async (request, response) => {
  const input = request.body as Partial<CreateProviderRequest>;
  const existing = IPTVService.getProvider(request.params.providerId);

  if (!existing) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const validation = await validateProviderConnection({
    baseUrl: input.baseUrl ?? existing.baseUrl,
    username: input.username ?? undefined,
    password: input.password ?? undefined,
    type: input.type ?? existing.type,
    providerId: request.params.providerId
  });

  if (!validation.ok) {
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  const detectedType = (validation as { detectedType?: string } | undefined)?.detectedType ?? input.type ?? existing.type;
  const updated = IPTVService.updateProvider(request.params.providerId, {
    ...input,
    type: detectedType as CreateProviderRequest["type"]
  });

  if (!updated) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const persistedUpdated = IPTVService.getProvider(updated.id) ?? updated;

  try {
    await persistValidatedProvider(persistedUpdated.id, validation, {
      ...persistedUpdated,
      type: detectedType as CreateProviderRequest["type"]
    }, { activate: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/foreign key|constraint/i.test(message)) {
      IPTVService.setProviderStatus(persistedUpdated.id, "failed");
      response.json({
        data: IPTVService.getProvider(persistedUpdated.id) ?? persistedUpdated,
        meta: {
          warning: "provider_saved_without_channels",
          message: "The provider was updated, but the channel import could not be completed because the database rejected the channel link."
        }
      });
      return;
    }
    throw error;
  }

  const syncOperation = detectedType === "xtream" ? startXtreamSyncOperation(persistedUpdated.id) : undefined;
  response.json({ data: { ...persistedUpdated, ...(syncOperation ? { syncOperationId: syncOperation.id } : {}) } });
});

iptvRouter.delete("/providers/:providerId", (request, response) => {
  const ok = IPTVService.deleteProvider(request.params.providerId);

  if (!ok) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.status(204).send();
});

iptvRouter.get("/channels", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;
  const q = typeof request.query.q === "string" ? request.query.q.trim() : undefined;
  const category = typeof request.query.category === "string" ? request.query.category : undefined;
  const mode = typeof request.query.mode === "string" ? request.query.mode : undefined;
  const debug = request.query.debug === "true";
  const includeInactive = request.query.includeInactive === "true";
  const page = typeof request.query.page === "string" ? Number(request.query.page) : undefined;
  const pageSize = typeof request.query.pageSize === "string" ? Number(request.query.pageSize) : undefined;

  const opts: { providerId?: string; q?: string; category?: string } = {};
  if (providerId) opts.providerId = providerId;
  if (q) opts.q = q;
  if (category) opts.category = category;

  const allowedModes = new Set(["active", "includeInactive", "debug", "raw"] as const);
  let channelMode: ChannelListMode = "active";

  if (typeof mode === "string") {
    if (!allowedModes.has(mode as any)) {
      response.status(400).json({ error: "invalid_mode_value", message: "mode must be one of active, includeInactive, debug, or raw." });
      return;
    }
    channelMode = mode as ChannelListMode;
  } else if (debug) {
    channelMode = "debug";
  } else if (includeInactive) {
    channelMode = "includeInactive";
  }

  response.json({
    data: page !== undefined || pageSize !== undefined
      ? IPTVService.listChannelsPage(opts, page ?? 1, pageSize ?? 100, channelMode === "debug" ? "active" : channelMode)
      : IPTVService.listChannels(opts, channelMode)
  });
});

iptvRouter.get("/channels/debug", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;
  const q = typeof request.query.q === "string" ? request.query.q.trim() : undefined;
  const category = typeof request.query.category === "string" ? request.query.category : undefined;

  const opts: { providerId?: string; q?: string; category?: string } = {};
  if (providerId) opts.providerId = providerId;
  if (q) opts.q = q;
  if (category) opts.category = category;

  response.json({
    data: IPTVService.listChannelsDebug(opts)
  });
});

iptvRouter.get("/providers/:providerId/diagnostics", (request, response) => {
  const providerId = request.params.providerId;
  const diagnostics = IPTVService.getProviderChannelDiagnostics(providerId);

  if (!diagnostics) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: diagnostics });
});

iptvRouter.get("/categories", (request, response) => {
  const providerId = typeof request.query.providerId === "string" ? request.query.providerId : undefined;

  response.json({
    data: IPTVService.listCategories(providerId)
  });
});

iptvRouter.post("/operations", async (request, response) => {
  const body = request.body as {
    type?: IptvOperationType;
    providerId?: string;
    playlist?: string;
    baseUrl?: string;
    username?: string;
    password?: string;
  };
  const type = body.type;
  if (!type || !["xtream_validation", "m3u_validation", "m3u_import", "xtream_channel_sync"].includes(type)) {
    response.status(400).json({ error: "invalid_iptv_operation_type" });
    return;
  }

  if (type === "m3u_import" && !body.playlist) {
    response.status(400).json({ error: "playlist_required" });
    return;
  }
  if (type === "m3u_validation" && !body.playlist && !body.providerId) {
    response.status(400).json({ error: "playlist_or_provider_id_required" });
    return;
  }
  if (type === "xtream_channel_sync" && !body.providerId) {
    response.status(400).json({ error: "provider_id_required" });
    return;
  }

  if (type === "xtream_channel_sync") {
    const operation = startXtreamSyncOperation(body.providerId!);
    response.status(202).json({ data: operation });
    return;
  }

  const operation = IptvOperationManager.start(type, async (state, report, signal) => {
    if (type === "m3u_validation" || type === "m3u_import") {
      report({ currentStage: "parsing", currentMessage: "Parsing playlist." });
      let playlist = body.playlist ?? "";
      if (!playlist && body.providerId) {
        const provider = IPTVService.getProvider(body.providerId);
        if (!provider?.baseUrl) throw new Error("provider_not_found");
        const playlistResult = await fetchTextWithTimeout(normalizePlaylistUrl(provider.baseUrl), { signal }, 60_000);
        const playlistResponse = playlistResult.response;
        if (!playlistResponse.ok) throw new Error(`Provider returned HTTP ${playlistResponse.status}.`);
        playlist = playlistResult.text;
      }
      const invalidEntries: M3uParseError[] = [];
      const parsed = parseM3uPlaylist(playlist, (entry) => invalidEntries.push(entry));
      const valid = parsed.filter((channel) => !validateHttpStreamUrl(channel.url));
      report({ total: parsed.length, processed: parsed.length, succeeded: valid.length, failed: invalidEntries.length + parsed.length - valid.length, currentStage: type === "m3u_import" ? "saving_channels" : "finalizing", currentMessage: `${parsed.length} playlist entries parsed.` });
      if (type === "m3u_import" && valid.length > 0 && !state.cancelled) {
        const synced = syncParsedM3uCatalogue(body.providerId!, valid);
        report({ processed: valid.length, succeeded: synced.liveChannels + synced.movies + synced.series + synced.episodes, currentMessage: `${synced.liveChannels} live channels, ${synced.movies} movies, ${synced.series} series, and ${synced.episodes} episodes saved.` });
      }
      return;
    }

    try {
      const provider = body.username && body.password && body.baseUrl
        ? { credential_username: body.username, credential_password: body.password, server_url: body.baseUrl, type: "xtream" }
        : IPTVService.getProviderCredentials(body.providerId!);
      if (!provider) throw new Error("provider_not_found");
      const username = (provider as any).credential_username ?? (provider as any).username;
      const password = (provider as any).credential_password ?? (provider as any).password;
      const serverUrl = (provider as any).server_url ?? (provider as any).base_url ?? (provider as any).baseUrl;
      if (!username || !password || !serverUrl) throw new Error("stored_xtream_credentials_required");
      report({ currentStage: "authenticating", currentMessage: "Checking Xtream credentials." });
      const connection = await testXtreamConnection(serverUrl, username, password, signal);
      if (!connection.ok) throw new Error(connection.message);
      if (type === "xtream_validation") {
        report({ currentStage: "completed", currentMessage: "Server reachable and credentials accepted. Channel sync is starting." });
        return;
      }
      report({ currentStage: "discovering_channels", currentMessage: "Loading channel inventory." });
      const invalidEntries: XtreamParseError[] = [];
      const parsed = await fetchXtreamChannels(serverUrl, username, password, (entry) => invalidEntries.push(entry), signal);
      const valid = parsed.filter((channel) => !validateHttpStreamUrl(channel.url));
      report({ total: parsed.length, processed: parsed.length, succeeded: valid.length, failed: invalidEntries.length, currentStage: "saving_channels", currentMessage: `${parsed.length} channels discovered.` });
      if (state.cancelled) return;
      if (valid.length === 0) {
        IPTVService.setProviderStatus(body.providerId!, "failed");
        throw new Error("Xtream sync completed with zero usable channels.");
      }
      IPTVService.syncProviderChannels(body.providerId!, valid);
      IPTVService.setProviderStatus(body.providerId!, "active");
      report({ currentStage: "completed", currentMessage: `${valid.length} channels saved. Provider activated.` });
    } catch (error) {
      if (body.providerId) IPTVService.setProviderStatus(body.providerId, "failed");
      throw error;
    }
  });

  response.status(202).json({ data: operation });
});

iptvRouter.get("/operations/:operationId", (request, response) => {
  const operation = IptvOperationManager.get(request.params.operationId);
  if (!operation) {
    response.status(404).json({ error: "iptv_operation_not_found" });
    return;
  }
  response.json({ data: operation });
});

iptvRouter.post("/operations/:operationId/cancel", (request, response) => {
  if (!IptvOperationManager.cancel(request.params.operationId)) {
    response.status(409).json({ error: "iptv_operation_not_cancellable" });
    return;
  }
  response.json({ data: IptvOperationManager.get(request.params.operationId) });
});

iptvRouter.post("/providers/test", async (request: any, response: any) => {
  const { baseUrl, username, password, type } = request.body as {
    baseUrl?: string;
    username?: string;
    password?: string;
    type?: string;
  };

  const providerId = String(request.params?.providerId ?? request.body?.providerId ?? "");

  const validation = await validateProviderConnection({ baseUrl, username, password, type, providerId });
  if (!validation.ok) {
    if (providerId) {
      IPTVService.setProviderStatus(providerId, 'failed');
    }
    response.status(400).json({
      error: "provider_validation_failed",
      message: validation.message
    });
    return;
  }

  if (providerId) {
    await persistValidatedProvider(providerId, validation, { type }, { activate: false });
  }

  response.json({
    data: {
      ok: true,
      statusCode: (validation as any).statusCode,
      message: validation.message,
      channelsCreated: Array.isArray(validation.channels) ? validation.channels.length : 0,
      channelsParsed: (validation as any).channelsParsed ?? 0,
      channelsRejected: (validation as any).channelsRejected ?? 0,
      categories: (validation as any).categories ?? [],
      rejectedChannels: (validation as any).rejectedChannels ?? []
    }
  });
});

iptvRouter.post("/providers/:providerId/test", async (request, response) => {
  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const validation = await validateProviderConnection({
    baseUrl: provider.baseUrl,
    username: undefined,
    password: undefined,
    type: provider.type,
    providerId: provider.id
  });

  if (!validation.ok) {
    IPTVService.setProviderStatus(provider.id, 'failed');
    response.status(400).json({ error: "provider_validation_failed", message: validation.message });
    return;
  }

  await persistValidatedProvider(provider.id, validation, provider);

  response.json({
    data: {
      ok: true,
      statusCode: (validation as any).statusCode,
      message: validation.message,
      channelsCreated: Array.isArray(validation.channels) ? validation.channels.length : 0,
      channelsParsed: (validation as any).channelsParsed ?? 0,
      channelsRejected: (validation as any).channelsRejected ?? 0,
      categories: (validation as any).categories ?? [],
      rejectedChannels: (validation as any).rejectedChannels ?? []
    }
  });
});

iptvRouter.post("/providers/:providerId/m3u", (request, response) => {
  const { playlist } = request.body as { playlist?: string };
  const providerId = request.params.providerId;

  if (!playlist) {
    response.status(400).json({ error: "playlist_required" });
    return;
  }

  const provider = IPTVService.getProvider(providerId);
  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  const invalidEntries: M3uParseError[] = [];
  const parsedChannels = parseM3uPlaylist(playlist, (entry) => invalidEntries.push(entry));
  const validChannels: typeof parsedChannels = [];
  const invalidChannels: { name: string; url: string; error: string }[] = [];

  for (const invalid of invalidEntries) {
    logChannelSyncTrace({
      providerId,
      providerMode: (provider as any)?.syncMode ?? "partial",
      syncPhase: "parse",
      action: "reject",
      reason: invalid.reason,
      payload: invalid
    });
  }

  for (const ch of parsedChannels) {
    const error = validateHttpStreamUrl(ch.url);
    if (error) {
      invalidChannels.push({ name: ch.name, url: ch.url, error });
    } else {
      validChannels.push(ch);
    }
  }

  const synced = validChannels.length > 0 ? syncParsedM3uCatalogue(providerId, validChannels) : { liveChannels: 0, movies: 0, series: 0, episodes: 0 };
  const totalSynced = synced.liveChannels + synced.movies + synced.series + synced.episodes;
  IPTVService.setProviderStatus(providerId, totalSynced > 0 ? "active" : "failed");

  response.status(201).json({
    data: {
      channelsCreated: synced.liveChannels,
      moviesCreated: synced.movies,
      seriesCreated: synced.series,
      episodesCreated: synced.episodes,
      channelsParsed: parsedChannels.length,
      channelsRejected: invalidChannels.length,
      categories: Array.from(new Set(validChannels.map((channel) => channel.groupName).filter(Boolean))),
      rejectedChannels: invalidChannels.slice(0, 10)
    }
  });
});

// Allow operator to manually set provider status (active, inactive, failed, pending, invalid)
iptvRouter.post("/providers/:providerId/status", async (request, response) => {
  const { status } = request.body as { status?: string };
  const allowed = new Set(["active", "inactive", "failed", "pending", "invalid"]);

  if (!status || typeof status !== "string" || !allowed.has(status)) {
    response.status(400).json({ error: "invalid_status_value" });
    return;
  }

  const provider = IPTVService.getProvider(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  if (status === "active") {
    const provider = IPTVService.getProvider(request.params.providerId);
    if (!provider) {
      response.status(404).json({ error: "provider_not_found" });
      return;
    }

    const validation = await validateProviderConnection({
      baseUrl: provider.baseUrl,
      username: undefined,
      password: undefined,
      type: provider.type,
      providerId: provider.id
    });

    if (!validation.ok) {
      IPTVService.setProviderStatus(request.params.providerId, 'failed');
      response.status(400).json({ error: "provider_validation_failed", message: validation.message });
      return;
    }

    await persistValidatedProvider(provider.id, validation, provider, { activate: true });
  } else {
    IPTVService.setProviderStatus(request.params.providerId, status as any);
  }

  response.json({ data: IPTVService.getProvider(request.params.providerId) });
});

iptvRouter.post("/providers/:providerId/xtream/sync", async (request, response) => {
  const provider = IPTVService.getProviderCredentials(request.params.providerId);

  if (!provider) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  if (provider.type !== "xtream") {
    response.status(400).json({ error: "provider_not_xtream" });
    return;
  }

  const operation = startXtreamSyncOperation(request.params.providerId);
  response.status(202).json({ data: operation });
});

// IPTV parity diagnostic endpoint: compares external expectations vs GiTO storage
iptvRouter.get("/parity/:providerId", (request, response) => {
  const diagnostic = IPTVService.getParityDiagnostics(request.params.providerId);

  if (!diagnostic) {
    response.status(404).json({ error: "provider_not_found" });
    return;
  }

  response.json({ data: diagnostic });
});

// Phase 3: Catalogue API endpoints (public access, no authentication required)
iptvRouter.get("/providers/:providerId/categories", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const contentType = parseContentType(request.query.contentType);
  if (contentType === null) {
    response.status(400).json({ error: "invalid_content_type" });
    return;
  }
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  response.json({ data: listIptvCategoriesPage(providerId, contentType, options) });
});

iptvRouter.get("/providers/:providerId/channels", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  response.json({ data: listIptvChannelsPage(providerId, options) });
});

iptvRouter.get("/providers/:providerId/movies", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  response.json({ data: listIptvMoviesPage(providerId, options) });
});

iptvRouter.get("/providers/:providerId/movies/:movieId", (request, response) => {
  const providerId = request.params.providerId;
  const movieId = request.params.movieId;
  if (!providerId || !movieId || !requireProvider(providerId, response)) return;
  const movie = getIptvMovie(providerId, movieId);
  if (!movie) {
    response.status(404).json({ error: "movie_not_found" });
    return;
  }
  response.json({ data: movie });
});

iptvRouter.get("/providers/:providerId/series", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  response.json({ data: listIptvSeriesPage(providerId, options) });
});

iptvRouter.get("/providers/:providerId/series/:seriesId", (request, response) => {
  const providerId = request.params.providerId;
  const seriesId = request.params.seriesId;
  if (!providerId || !seriesId || !requireProvider(providerId, response)) return;
  const series = getIptvSeries(providerId, seriesId);
  if (!series) {
    response.status(404).json({ error: "series_not_found" });
    return;
  }
  response.json({ data: series });
});

iptvRouter.get("/providers/:providerId/series/:seriesId/seasons", (request, response) => {
  const providerId = request.params.providerId;
  const seriesId = request.params.seriesId;
  if (!providerId || !seriesId || !requireProvider(providerId, response)) return;
  if (!getIptvSeries(providerId, seriesId)) {
    response.status(404).json({ error: "series_not_found" });
    return;
  }
  response.json({ data: listIptvSeasonsPage(providerId, seriesId) });
});

iptvRouter.get("/providers/:providerId/seasons/:seasonId/episodes", (request, response) => {
  const providerId = request.params.providerId;
  const seasonId = request.params.seasonId;
  if (!providerId || !seasonId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  const episodes = listIptvEpisodesPage(providerId, seasonId, options);
  if (!episodes) {
    response.status(404).json({ error: "season_not_found" });
    return;
  }
  response.json({ data: episodes });
});

iptvRouter.get("/providers/:providerId/epg/channels", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  response.json({ data: listIptvEpgChannelsPage(providerId, options) });
});

iptvRouter.get("/providers/:providerId/epg/programmes", (request, response) => {
  const providerId = request.params.providerId;
  if (!providerId || !requireProvider(providerId, response)) return;
  const options = parseCatalogueQuery(request, response);
  if (!options) return;
  const booleanQuery = (value: unknown) => value === undefined ? false : value === "true";
  if (request.query.current !== undefined && request.query.current !== "true" && request.query.current !== "false") {
    response.status(400).json({ error: "invalid_current_filter" });
    return;
  }
  if (request.query.upcoming !== undefined && request.query.upcoming !== "true" && request.query.upcoming !== "false") {
    response.status(400).json({ error: "invalid_upcoming_filter" });
    return;
  }
  for (const field of ["from", "to"] as const) {
    const value = request.query[field];
    if (value !== undefined && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) {
      response.status(400).json({ error: `invalid_${field}_time` });
      return;
    }
  }
  const channelExternalRef = typeof request.query.channelExternalRef === "string" ? request.query.channelExternalRef : undefined;
  if (channelExternalRef) {
    void (async () => {
      const provider = IPTVService.getProviderCredentials(providerId);
      if (!provider || provider.type !== "xtream" || !provider.credential_username || !provider.credential_password) {
        response.json({ data: { items: [], page: 1, pageSize: options.pageSize ?? 20, total: 0, totalPages: 1 } });
        return;
      }
      try {
        const baseUrl = normalizeXtreamUrl(provider.base_url);
        if (baseUrl.error) throw new Error(baseUrl.error);
        const items = await fetchXtreamShortEpg(baseUrl.url, provider.credential_username, provider.credential_password, channelExternalRef);
        response.json({ data: { items, page: 1, pageSize: options.pageSize ?? 20, total: items.length, totalPages: 1 } });
      } catch {
        response.json({ data: { items: [], page: 1, pageSize: options.pageSize ?? 20, total: 0, totalPages: 1 } });
      }
    })();
    return;
  }
  response.json({
    data: listIptvEpgProgrammesPage(providerId, {
      ...options,
      epgChannelId: typeof request.query.epgChannelId === "string" ? request.query.epgChannelId : undefined,
      from: typeof request.query.from === "string" ? request.query.from : undefined,
      to: typeof request.query.to === "string" ? request.query.to : undefined,
      current: booleanQuery(request.query.current),
      upcoming: booleanQuery(request.query.upcoming)
    })
  });
});

export default iptvRouter;
