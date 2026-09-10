import type { ParsedChannel, ProviderConnectionTest } from "@gito/shared";

/**
 * Normalize an Xtream server URL to standard form.
 * Handles:
 * - http://host:port
 * - https://host:port
 * - http://host:port/player_api.php (strips redundant path)
 * - Validates protocol is HTTP or HTTPS
 * - Strips trailing slashes
 */
export function normalizeXtreamUrl(baseUrl: string): { url: string; error?: string } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { url: "", error: "URL cannot be empty." };
  }

  // Simple protocol check - must start with http:// or https://
  if (!/^https?:\/\//i.test(trimmed)) {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }

  try {
    const url = new URL(trimmed);

    // Validate protocol
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
    }

    // Preserve legitimate installation subpaths, but remove a supplied API filename.
    const pathname = url.pathname
      .replace(/\/(?:player_api|api|get)\.php$/i, "")
      .replace(/\/+$/, "");
    const baseWithoutPath = `${url.origin}${pathname}`;

    return { url: baseWithoutPath };
  } catch {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }
}

export function buildXtreamEndpointCandidates(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(trimmed);
  candidates.add(`${trimmed}/player_api.php`);
  candidates.add(`${trimmed}/api.php`);
  candidates.add(`${trimmed}/get.php`);

  if (/player_api\.php$/i.test(trimmed)) {
    candidates.add(trimmed);
  }

  if (/get\.php$/i.test(trimmed)) {
    candidates.add(trimmed);
  }

  return Array.from(candidates);
}

interface XtreamCategory {
  category_id?: string | number;
  category_name?: string;
}

interface XtreamStream {
  name?: string;
  stream_name?: string;
  stream_id?: string | number;
  category_id?: string | number;
  container_extension?: string;
}

function unwrapXtreamArray<T>(payload: unknown, key: string): T[] | null {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, unknown>)[key] as T[];
  }
  return null;
}

function isXtreamAuthFailure(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const userInfo = (payload as Record<string, unknown>).user_info;
  if (!userInfo || typeof userInfo !== "object") return false;
  const info = userInfo as Record<string, unknown>;
  return info.auth === 0 || String(info.auth).toLowerCase() === "false" || ["disabled", "expired", "banned"].includes(String(info.status ?? "").toLowerCase());
}

function safeXtreamHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-host";
  }
}

export async function fetchWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function readResponseTextWithTimeout(response: Response, timeoutMs = 15_000, signal?: AbortSignal): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const body = response.text();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException("Response body timed out", "TimeoutError")), timeoutMs);
    abortHandler = () => reject(new DOMException("Response body aborted", "AbortError"));
    signal?.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([body, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  }
}

export async function fetchTextWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function fetchJsonWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const result = await fetchTextWithTimeout(input, init, timeoutMs);
  if (!result.text.trim()) {
    return { response: result.response, payload: null, parseError: false };
  }

  try {
    return { response: result.response, payload: JSON.parse(result.text), parseError: false };
  } catch {
    return { response: result.response, payload: null, parseError: true };
  }
}

function buildUrl(baseUrl: string, params: Record<string, string>) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, "");
  const candidateBase = normalizedBase.endsWith("/player_api.php") || normalizedBase.endsWith("/get.php") || normalizedBase.endsWith("/api.php")
    ? normalizedBase
    : `${normalizedBase}/player_api.php`;
  const url = new URL(candidateBase);

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  return url;
}

export async function testXtreamConnection(
  baseUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal
): Promise<ProviderConnectionTest> {
  // First validate and normalize the URL
  const urlResult = normalizeXtreamUrl(baseUrl);
  if (urlResult.error) {
    return {
      ok: false,
      message: urlResult.error,
      statusCode: 400
    };
  }

  const normalizedUrl = urlResult.url;

  try {
    const endpointCandidates = buildXtreamEndpointCandidates(normalizedUrl);
    if (endpointCandidates.length === 0) {
      return {
        ok: false,
        message: "Could not build valid Xtream endpoints.",
        statusCode: 400
      };
    }

    const responses = await Promise.allSettled(
      endpointCandidates.map((candidate) =>
        fetchJsonWithTimeout(
          buildUrl(candidate, {
            username,
            password
          }),
          { signal }
        )
      )
    );

    // Look for successful response
    let malformedResponse = false;
    for (const response of responses) {
      if (response.status !== "fulfilled" || !response.value.response.ok) {
        continue;
      }

      try {
        const payload = response.value.payload;
        if (isXtreamAuthFailure(payload)) {
          continue;
        }
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          return {
            ok: true,
            statusCode: response.value.response.status,
            message: "Connected — credentials accepted."
          };
        }
        malformedResponse = malformedResponse || response.value.parseError;
      } catch {
        malformedResponse = true;
      }
    }

    // Classify the failure by examining responses
    let authFailureCount = 0;
    let networkFailureCount = 0;
    let timeoutFailureCount = 0;
    let lastStatusCode: number | undefined;

    for (const response of responses) {
      if (response.status === "fulfilled") {
        const status = response.value.response.status;
        lastStatusCode = status;

        if (status === 401 || status === 403) {
          authFailureCount++;
        }
      } else if (response.status === "rejected") {
        const reason = response.reason;
        const errorMessage = String(reason);

        if (errorMessage.includes("AbortError") || errorMessage.includes("timeout")) {
          timeoutFailureCount++;
        } else if (
          errorMessage.includes("ENOTFOUND") ||
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("Failed host lookup") ||
          errorMessage.includes("network")
        ) {
          networkFailureCount++;
        }
      }
    }

    // Return classified error
    if (timeoutFailureCount > 0) {
      return {
        ok: false,
        statusCode: 408,
        message: "The provider did not respond within the allowed time."
      };
    }

    if (networkFailureCount > 0 || responses.every((r) => r.status === "rejected")) {
      return {
        ok: false,
        statusCode: 503,
        message: "GiTO could not reach the provider server."
      };
    }

    if (authFailureCount > 0 || lastStatusCode === 401 || lastStatusCode === 403) {
      return {
        ok: false,
        statusCode: lastStatusCode ?? 401,
        message: "Username or password was rejected by the provider."
      };
    }

    if (malformedResponse) {
      return {
        ok: false,
        statusCode: lastStatusCode ?? 502,
        message: "Xtream provider returned an invalid response."
      };
    }

    // Generic provider error
    return {
      ok: false,
      statusCode: lastStatusCode ?? 500,
      message: "Xtream provider returned an error."
    };
  } catch (error) {
    // Network or system error
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("AbortError") || errorMessage.includes("timeout")) {
      return {
        ok: false,
        statusCode: 408,
        message: "The provider did not respond within the allowed time."
      };
    }

    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("Failed host lookup")
    ) {
      return {
        ok: false,
        statusCode: 503,
        message: "GiTO could not reach the provider server."
      };
    }

    return {
      ok: false,
      statusCode: 500,
      message: "GiTO could not validate this provider."
    };
  }
}

export interface XtreamParseError {
  rawEntry: XtreamStream;
  reason: string;
}

export type XtreamMovieRecord = {
  externalId: string;
  categoryId?: string;
  name: string;
  streamUrl: string;
  posterUrl?: string;
  metadata: unknown;
};

export type XtreamSeriesRecord = {
  externalId: string;
  categoryId?: string;
  name: string;
  posterUrl?: string;
  metadata: unknown;
};

export type XtreamSeasonRecord = {
  seriesExternalId: string;
  providerSeasonId: string;
  seasonNumber?: number;
  name?: string;
  posterUrl?: string;
  metadata: unknown;
};

export type XtreamEpisodeRecord = {
  externalId: string;
  seasonNumber?: number;
  episodeNumber?: number;
  name?: string;
  streamUrl: string;
  metadata: unknown;
};

export type XtreamCatalogue = {
  movieCategories: Array<{ providerCategoryId: string; name: string; metadata: unknown }>;
  movies: XtreamMovieRecord[];
  seriesCategories: Array<{ providerCategoryId: string; name: string; metadata: unknown }>;
  series: XtreamSeriesRecord[];
  seasons: XtreamSeasonRecord[];
  episodes: Array<{ seriesExternalId: string; records: XtreamEpisodeRecord[] }>;
};

async function fetchXtreamAction(baseUrl: string, username: string, password: string, action: string, signal?: AbortSignal, extra: Record<string, string> = {}): Promise<unknown> {
  for (const candidate of buildXtreamEndpointCandidates(baseUrl)) {
    try {
      const result = await fetchJsonWithTimeout(buildUrl(candidate, { username, password, action, ...extra }), { signal });
        if (!result.response.ok || result.parseError || result.payload === null) {
          continue;
        }
        if (result.payload && typeof result.payload === "object" && !Array.isArray(result.payload)) {
          const payload = result.payload as Record<string, unknown>;
          if (payload.error || isXtreamAuthFailure(payload)) continue;
        }
      return result.payload;
    } catch {
      // Try the next compatible endpoint shape.
    }
  }
  throw new Error(`Xtream action failed: ${action}`);
}

function asRecords(payload: unknown, key: string): any[] {
  return unwrapXtreamArray<any>(payload, key) ?? [];
}

function xtreamStreamUrl(baseUrl: string, username: string, password: string, kind: "movie" | "series", id: string, extension?: string) {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = String(extension ?? "mp4").replace(/^\./, "") || "mp4";
  return `${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(id)}.${suffix}`;
}

export async function fetchXtreamLiveCatalogue(baseUrl: string, username: string, password: string, signal?: AbortSignal) {
  const categoriesPayload = await fetchXtreamAction(baseUrl, username, password, "get_live_categories", signal);
  const categories = asRecords(categoriesPayload, "categories").map((category) => ({
    providerCategoryId: String(category.category_id ?? ""),
    name: String(category.category_name ?? "Unnamed"),
    metadata: category
  })).filter((category) => category.providerCategoryId);
  const channels = await fetchXtreamChannels(baseUrl, username, password, undefined, signal);
  return { categories, channels };
}

export async function fetchXtreamCatalogue(baseUrl: string, username: string, password: string, signal?: AbortSignal): Promise<XtreamCatalogue> {
  const movieCategoriesPayload = await fetchXtreamAction(baseUrl, username, password, "get_vod_categories", signal);
  const movieStreamsPayload = await fetchXtreamAction(baseUrl, username, password, "get_vod_streams", signal);
  const seriesCategoriesPayload = await fetchXtreamAction(baseUrl, username, password, "get_series_categories", signal);
  const seriesPayload = await fetchXtreamAction(baseUrl, username, password, "get_series", signal);
  const movieCategories = asRecords(movieCategoriesPayload, "categories").map((category) => ({ providerCategoryId: String(category.category_id ?? ""), name: String(category.category_name ?? "Unnamed"), metadata: category })).filter((category) => category.providerCategoryId);
  const seriesCategories = asRecords(seriesCategoriesPayload, "categories").map((category) => ({ providerCategoryId: String(category.category_id ?? ""), name: String(category.category_name ?? "Unnamed"), metadata: category })).filter((category) => category.providerCategoryId);
  const normalizedBase = normalizeXtreamUrl(baseUrl).url;
  const movies = asRecords(movieStreamsPayload, "streams").flatMap((movie) => {
    const id = movie.stream_id === undefined ? "" : String(movie.stream_id);
    const name = String(movie.name ?? movie.stream_name ?? "").trim();
    return id && name ? [{ externalId: id, categoryId: movie.category_id === undefined ? undefined : String(movie.category_id), name, streamUrl: xtreamStreamUrl(normalizedBase, username, password, "movie", id, movie.container_extension), posterUrl: movie.stream_icon ?? movie.cover, metadata: movie }] : [];
  });
  const series = asRecords(seriesPayload, "series").flatMap((item) => {
    const id = item.series_id === undefined ? "" : String(item.series_id);
    const name = String(item.name ?? item.series_name ?? "").trim();
    return id && name ? [{ externalId: id, categoryId: item.category_id === undefined ? undefined : String(item.category_id), name, posterUrl: item.cover ?? item.cover_big, metadata: item }] : [];
  });
    if (!movieCategories.length && !movies.length && !seriesCategories.length && !series.length) {
      throw new Error("Xtream provider returned no VOD or series catalogue data. Verify the account has VOD and series access.");
    }
  const seasons: XtreamSeasonRecord[] = [];
  const episodes: Array<{ seriesExternalId: string; records: XtreamEpisodeRecord[] }> = [];
  for (const item of series) {
    if (signal?.aborted) break;
    try {
      const details = await fetchXtreamAction(baseUrl, username, password, "get_series_info", signal, { series_id: item.externalId });
      const payload = details as any;
      const info = payload?.info ?? {};
      const episodeGroups = payload?.episodes ?? {};
      for (const [seasonKey, seasonEpisodes] of Object.entries(episodeGroups)) {
        const seasonNumber = Number(seasonKey);
        const providerSeasonId = `${item.externalId}:${seasonKey}`;
        seasons.push({ seriesExternalId: item.externalId, providerSeasonId, seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : undefined, name: `Season ${seasonKey}`, metadata: { info } });
        const records = (Array.isArray(seasonEpisodes) ? seasonEpisodes : []).flatMap((episode: any) => {
          const episodeId = episode.id ?? episode.episode_id;
          if (episodeId === undefined) return [];
          return [{ externalId: String(episodeId), seasonNumber, episodeNumber: Number(episode.episode_num ?? episode.episode_number) || undefined, name: episode.title ?? episode.name, streamUrl: xtreamStreamUrl(normalizedBase, username, password, "series", String(episodeId), episode.container_extension), metadata: episode }];
        });
        episodes.push({ seriesExternalId: item.externalId, records });
      }
    } catch {
      // Preserve the series even when one provider omits its detail response.
    }
  }
  return { movieCategories, movies, seriesCategories, series, seasons, episodes };
}

export async function fetchXtreamChannels(
  baseUrl: string,
  username: string,
  password: string,
  onInvalidStream?: (entry: XtreamParseError) => void,
  signal?: AbortSignal
): Promise<ParsedChannel[]> {
  const normalizedResult = normalizeXtreamUrl(baseUrl);
  if (normalizedResult.error) throw new Error(normalizedResult.error);
  const normalizedBaseUrl = normalizedResult.url;
  const endpointCandidates = buildXtreamEndpointCandidates(normalizedBaseUrl);
  const categoryResponses = await Promise.allSettled(
    endpointCandidates.map((candidate) =>
      fetchTextWithTimeout(
        buildUrl(candidate, {
          username,
          password,
          action: "get_live_categories"
        }),
        { signal }
      )
    )
  );

  const streamsResponses = await Promise.allSettled(
    endpointCandidates.map((candidate) =>
      fetchTextWithTimeout(
        buildUrl(candidate, {
          username,
          password,
          action: "get_live_streams"
        }),
        { signal }
      )
    )
  );

  const categoriesResponse = categoryResponses.find((result) => {
    if (result.status !== "fulfilled" || !result.value.response.ok) return false;
    try { return unwrapXtreamArray(result.value.text.trim() ? JSON.parse(result.value.text) : null, "categories") !== null; } catch { return false; }
  });
  const streamsResponse = streamsResponses.find((result) => {
    if (result.status !== "fulfilled" || !result.value.response.ok) return false;
    try { return unwrapXtreamArray(result.value.text.trim() ? JSON.parse(result.value.text) : null, "streams") !== null; } catch { return false; }
  });

  if (!categoriesResponse || !streamsResponse) {
    throw new Error("Xtream channel extraction failed.");
  }

  const resolvedCategoriesResponse = categoriesResponse.status === "fulfilled" ? categoriesResponse.value : null;
  const resolvedStreamsResponse = streamsResponse.status === "fulfilled" ? streamsResponse.value : null;

  if (!resolvedCategoriesResponse || !resolvedStreamsResponse) {
    throw new Error("Xtream channel extraction failed.");
  }

  const categoriesResponseData = resolvedCategoriesResponse;
  const streamsResponseData = resolvedStreamsResponse;

  if (!categoriesResponseData.response.ok || !streamsResponseData.response.ok) {
    throw new Error("Xtream channel extraction failed.");
  }

  const categoriesPayload = JSON.parse(categoriesResponseData.text);
  const streamsPayload = JSON.parse(streamsResponseData.text);
  const categories = unwrapXtreamArray<XtreamCategory>(categoriesPayload, "categories") ?? [];
  const streams = unwrapXtreamArray<XtreamStream>(streamsPayload, "streams") ?? [];
  console.info("[iptv-validation] xtream_catalogue_received", {
    host: safeXtreamHost(normalizedBaseUrl),
    categoriesStatus: categoriesResponseData.response.status,
    categoriesBytes: categoriesResponseData.text.length,
    streamsStatus: streamsResponseData.response.status,
    streamsBytes: streamsResponseData.text.length,
    categoriesCount: Array.isArray(categories) ? categories.length : 0,
    streamsCount: Array.isArray(streams) ? streams.length : 0
  });
  const categoryNames = new Map<string, string>();
  categories.forEach((category) => {
    const id = String(category.category_id ?? "");
    const name = category.category_name?.trim();
    if (id && name) categoryNames.set(id, name);
  });
  const streamBase = normalizedBaseUrl.endsWith("/") ? normalizedBaseUrl.slice(0, -1) : normalizedBaseUrl;

  return streams.flatMap((stream) => {
    const streamId = stream.stream_id === undefined || stream.stream_id === null ? "" : String(stream.stream_id);
    const streamName = stream.name ?? stream.stream_name;
    if (!streamId || !streamName) {
      onInvalidStream?.({ rawEntry: stream, reason: "invalid_xtream_stream" });
      return [];
    }

    const groupName = stream.category_id === undefined ? undefined : categoryNames.get(String(stream.category_id));
    const extension = String(stream.container_extension ?? "m3u8").replace(/^\./, "") || "m3u8";
    const channel: ParsedChannel = {
      name: streamName,
      externalRef: streamId,
      categoryId: stream.category_id === undefined ? undefined : String(stream.category_id),
      url: `${streamBase}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.${extension}`
    };

    if (groupName) {
      channel.groupName = groupName;
    }

    return [channel];
  });
}
