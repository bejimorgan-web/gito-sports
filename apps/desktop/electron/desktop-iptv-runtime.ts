import crypto from "node:crypto";
import type { IptvOperation, IptvOperationType, ProviderConnectionTest } from "@gito/shared";
import type { CredentialStore } from "./credential-store.js";
import type {
  DesktopCatalogueCategoryInput,
  DesktopChannelInput,
  DesktopEpisodeInput,
  DesktopEpgChannelInput,
  DesktopEpgProgrammeInput,
  DesktopIptvOperation,
  DesktopIptvOperationInput,
  DesktopMovieInput,
  DesktopSeasonInput,
  DesktopSeries,
  DesktopSeriesInput
} from "../src/desktop-persistence-contract.js";
import type { DesktopSqliteStore } from "./desktop-storage.js";

type DesktopRuntimeOperation = IptvOperation & { providerAccountId?: string | null; playlist?: string | null };
type CatalogueSection = "categories" | "live" | "movies" | "series" | "seasons" | "episodes";
type CatalogueSectionProgress = { status: "pending" | "running" | "completed" | "partial" | "failed"; processed: number; succeeded: number; failed: number; failures: Array<{ entityType: string; id: string; error: string }> };
type CatalogueSyncSummary = { partial: boolean };
type WorkloadMetrics = { startedAt: string; sectionStartedAt: Partial<Record<CatalogueSection, string>>; sectionDurationMs: Partial<Record<CatalogueSection, number>>; providerRequestCount: number; providerRequestDurationMs: number; persistenceDurationMs: number; persistenceRecords: number };

const CATALOGUE_BATCH_SIZE = 500;
const SERIES_DETAIL_CONCURRENCY = 4;

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

type RuntimeProviderRequest = {
  providerId?: string;
  baseUrl?: string;
  type?: string;
  playlist?: string;
  username?: string;
  password?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function safePersistenceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/gi, "[URL]")
    .replace(/(?:password|token|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function isFatalPersistenceError(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "").toUpperCase();
  return ["SQLITE_BUSY", "SQLITE_FULL", "SQLITE_IOERR", "SQLITE_CORRUPT", "SQLITE_NOTADB", "SQLITE_MISUSE"].some((fatalCode) => code.includes(fatalCode));
}

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

function validateHttpStreamUrl(value: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return "stream_url_malformed";
  }

  const supportedProtocols = new Set(["http:", "https:", "rtmp:", "rtsp:", "udp:", "srt:"]);
  if (!supportedProtocols.has(parsed.protocol)) {
    return "stream_url_protocol_unsupported";
  }

  return null;
}

function readAttribute(line: string, name: string): string | undefined {
  const attributePattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, "i");
  const match = line.match(attributePattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function readDisplayName(line: string): string {
  const separator = line.indexOf(",");
  if (separator < 0) {
    return "Unnamed Channel";
  }

  const remainder = line.slice(separator + 1).trim();
  const inlineUrlMatch = remainder.match(/(?:https?|rtmp|rtsp|udp|srt):\/\/\S+/i);

  if (inlineUrlMatch) {
    const beforeUrl = remainder.slice(0, inlineUrlMatch.index).trim();
    return beforeUrl.replace(/,$/, "") || "Unnamed Channel";
  }

  return remainder.replace(/,$/, "") || "Unnamed Channel";
}

function readInlineUrl(line: string): string | undefined {
  const separator = line.indexOf(",");
  if (separator < 0) {
    return undefined;
  }

  const remainder = line.slice(separator + 1).trim();
  const inlineUrlMatch = remainder.match(/(?:https?|rtmp|rtsp|udp|srt):\/\/\S+/i);

  return inlineUrlMatch?.[0];
}

function parseM3uPlaylist(content: string) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const channels: Array<{ name: string; url: string; externalRef?: string; groupName?: string; tvgName?: string; logoUrl?: string; contentHint?: string; seriesExternalRef?: string; seasonNumber?: number; episodeNumber?: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line || !/^#EXTINF\b/i.test(line)) {
      continue;
    }

    let url = readInlineUrl(line);
    for (let j = index + 1; j < Math.min(lines.length, index + 6); j += 1) {
      const candidate = lines[j];
      if (/^#EXTINF\b/i.test(candidate ?? "")) break;
      if (candidate && !candidate.startsWith("#") && candidate.length > 0) {
        if (/^(?:https?|rtmp|rtsp|udp|srt):\/\//i.test(candidate)) {
          url ??= candidate;
          break;
        }
      }
    }

    if (!url) {
      continue;
    }

    const externalRef = readAttribute(line, "tvg-id");
    const groupName = readAttribute(line, "group-title");
    const tvgName = readAttribute(line, "tvg-name");
    const logoUrl = readAttribute(line, "tvg-logo") ?? readAttribute(line, "logo");
    const contentHint = readAttribute(line, "tvg-type") ?? readAttribute(line, "content-type") ?? readAttribute(line, "type");
    const seriesExternalRef = readAttribute(line, "series-id") ?? readAttribute(line, "series-id-ref");
    const seasonValue = readAttribute(line, "season-num") ?? readAttribute(line, "season");
    const episodeValue = readAttribute(line, "episode-num") ?? readAttribute(line, "episode");
    const seasonNumber = seasonValue && /^\d+$/.test(seasonValue) ? Number(seasonValue) : undefined;
    const episodeNumber = episodeValue && /^\d+$/.test(episodeValue) ? Number(episodeValue) : undefined;
    channels.push({
      name: readDisplayName(line),
      url,
      ...(externalRef ? { externalRef } : {}),
      ...(groupName ? { groupName } : {}),
      ...(tvgName ? { tvgName } : {}),
      ...(logoUrl && !/^https?:\/\/.*(?:username|password|token|@)/i.test(logoUrl) ? { logoUrl } : {}),
      ...(contentHint ? { contentHint } : {}),
      ...(seriesExternalRef ? { seriesExternalRef } : {}),
      ...(seasonNumber !== undefined ? { seasonNumber } : {}),
      ...(episodeNumber !== undefined ? { episodeNumber } : {})
    });
  }

  return channels;
}

type M3uEntry = ReturnType<typeof parseM3uPlaylist>[number];
type M3uCatalogueType = "live" | "movie" | "series";

function normalizedMetadata(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function metadataHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function m3uExternalReference(entry: M3uEntry, contentType: M3uCatalogueType, categoryReference: string) {
  const explicit = normalizedMetadata(entry.externalRef);
  if (explicit && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(explicit)) return explicit;
  return metadataHash(`${contentType}:${normalizedMetadata(entry.tvgName) || normalizedMetadata(entry.name).toLowerCase()}:${categoryReference}`);
}

function m3uLocalId(kind: string, providerId: string, reference: string) {
  return `${kind}_${metadataHash(`${providerId}:${kind}:${reference}`)}`;
}

function classifyM3uEntry(entry: M3uEntry): { contentType: M3uCatalogueType; seriesName?: string; seasonNumber?: number; episodeNumber?: number } {
  const normalizedContentHint = normalizedMetadata(entry.contentHint).toLowerCase();
  const explicitMovieHint = /(^|\b)(movie|movies|film|films|vod)(\b|$)/i.test(normalizedContentHint);
  const explicitSeriesHint = /(^|\b)(series|show|shows|tv series)(\b|$)/i.test(normalizedContentHint);
  const hasStructuredSeriesMetadata = !!entry.seriesExternalRef && (entry.seasonNumber !== undefined || entry.episodeNumber !== undefined);

  if (explicitMovieHint) {
    return { contentType: "movie" };
  }

  if (explicitSeriesHint || hasStructuredSeriesMetadata) {
    return {
      contentType: "series",
      seriesName: normalizedMetadata(entry.tvgName) || normalizedMetadata(entry.name),
      ...(entry.seasonNumber !== undefined ? { seasonNumber: entry.seasonNumber } : {}),
      ...(entry.episodeNumber !== undefined ? { episodeNumber: entry.episodeNumber } : {})
    };
  }

  return { contentType: "live" };
}

function normalizeXtreamUrl(baseUrl: string): { url: string; error?: string } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { url: "", error: "URL cannot be empty." };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
    }

    const pathname = url.pathname
      .replace(/\/(?:player_api|api|get)\.php$/i, "")
      .replace(/\/+$/, "");

    return { url: `${url.origin}${pathname}` };
  } catch {
    return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
  }
}

export function normalizeXtreamPlaybackUrl(value: string): string {
  const url = new URL(value);
  return url.toString();
}

function buildXtreamEndpointCandidates(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(trimmed);
  candidates.add(`${trimmed}/player_api.php`);
  candidates.add(`${trimmed}/api.php`);
  candidates.add(`${trimmed}/get.php`);

  return Array.from(candidates);
}

function buildXtreamUrl(baseUrl: string, params: Record<string, string>) {
  const normalizedBase = baseUrl.trim().replace(/\/$/, "");
  const candidateBase = normalizedBase.endsWith("/player_api.php") || normalizedBase.endsWith("/get.php") || normalizedBase.endsWith("/api.php")
    ? normalizedBase
    : `${normalizedBase}/player_api.php`;

  const url = new URL(candidateBase);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function fetchTextWithTimeout(input: string | URL, init: RequestInit = {}, timeoutMs = 60_000) {
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

function unwrapXtreamArray<T>(payload: unknown, key: string): T[] | null {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, unknown>)[key] as T[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).data)) {
    return (payload as Record<string, unknown>).data as T[];
  }
  return null;
}

function readXtreamExpiry(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const userInfo = (payload as Record<string, unknown>).user_info;
  if (!userInfo || typeof userInfo !== "object") return null;
  const rawExpiry = (userInfo as Record<string, unknown>).exp_date;
  if (rawExpiry === undefined || rawExpiry === null || rawExpiry === "") return null;
  const numericExpiry = Number(rawExpiry);
  if (Number.isFinite(numericExpiry) && numericExpiry > 0) {
    return new Date(numericExpiry < 10_000_000_000 ? numericExpiry * 1000 : numericExpiry).toISOString();
  }
  const parsedExpiry = new Date(String(rawExpiry));
  return Number.isNaN(parsedExpiry.getTime()) ? null : parsedExpiry.toISOString();
}

function isXtreamAuthFailure(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const userInfo = (payload as Record<string, unknown>).user_info;
  if (!userInfo || typeof userInfo !== "object") return false;
  const info = userInfo as Record<string, unknown>;
  return info.auth === 0 || String(info.auth).toLowerCase() === "false" || ["disabled", "expired", "banned"].includes(String(info.status ?? "").toLowerCase());
}

function buildRequestInit(signal?: AbortSignal, init: RequestInit = {}): RequestInit {
  const nextInit: RequestInit = { ...init };
  if (signal) {
    nextInit.signal = signal;
  }
  return nextInit;
}

async function testXtreamConnection(baseUrl: string, username: string, password: string, signal?: AbortSignal): Promise<ProviderConnectionTest> {
  const normalized = normalizeXtreamUrl(baseUrl);
  if (normalized.error) {
    return { ok: false, message: normalized.error, statusCode: 400 };
  }

  const endpointCandidates = buildXtreamEndpointCandidates(normalized.url);
  let lastStatusCode = 500;
  let malformedResponse = false;
  let authFailureCount = 0;
  let networkFailureCount = 0;

  for (const candidate of endpointCandidates) {
    try {
      const result = await fetchTextWithTimeout(
        buildXtreamUrl(candidate, { username, password }),
        buildRequestInit(signal, { headers: { accept: "application/json" } }),
        60_000
      );
      const response = result.response;
      lastStatusCode = response.status;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          authFailureCount += 1;
        }
        continue;
      }

      const text = result.text;
      if (!text.trim()) {
        malformedResponse = true;
        continue;
      }

      const payload = JSON.parse(text);
      if (isXtreamAuthFailure(payload)) {
        authFailureCount += 1;
        continue;
      }

      const expiresAt = readXtreamExpiry(payload);
      if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
        return {
          ok: false,
          statusCode: 401,
          expiresAt,
          message: "The Xtream account has expired."
        };
      }

      if (payload && typeof payload === "object") {
        return {
          ok: true,
          statusCode: response.status,
          ...(expiresAt ? { expiresAt } : {}),
          message: "Connected — credentials accepted."
        };
      }

      malformedResponse = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/(AbortError|timeout)/i.test(message)) {
        return {
          ok: false,
          statusCode: 408,
          message: "The provider did not respond within the allowed time."
        };
      }
      if (/(ENOTFOUND|ECONNREFUSED|Failed host lookup|network)/i.test(message)) {
        networkFailureCount += 1;
      }
    }
  }

  if (networkFailureCount > 0) {
    return {
      ok: false,
      statusCode: 503,
      message: "GiTO could not reach the provider server."
    };
  }

  if (authFailureCount > 0 || lastStatusCode === 401 || lastStatusCode === 403) {
    return {
      ok: false,
      statusCode: lastStatusCode === 500 ? 401 : lastStatusCode,
      message: "Username or password was rejected by the provider."
    };
  }

  if (malformedResponse) {
    return {
      ok: false,
      statusCode: lastStatusCode,
      message: "Xtream provider returned an invalid response."
    };
  }

  return {
    ok: false,
    statusCode: lastStatusCode,
    message: "Xtream provider returned an error."
  };
}

async function fetchXtreamLiveChannels(baseUrl: string, username: string, password: string, signal?: AbortSignal): Promise<Array<{ name: string; url: string; externalRef?: string; groupName?: string; metadataJson?: string | null }>> {
  const normalized = normalizeXtreamUrl(baseUrl);
  if (normalized.error) {
    throw new Error(normalized.error);
  }

  const response = await fetch(buildXtreamUrl(normalized.url, { username, password, action: "get_live_streams" }), buildRequestInit(signal, {
    headers: { accept: "application/json" }
  }));

  if (!response.ok) {
    throw new Error(`Xtream request failed with status ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return [];
  }

  const payload = JSON.parse(text);
  const records = unwrapXtreamArray<{ stream_id?: string | number; name?: string; stream_name?: string; category_id?: string | number; stream_icon?: string; direct_source?: string; stream_url?: string; container_extension?: string }>(payload, "streams") ?? [];

  return records.flatMap((entry) => {
    const id = entry.stream_id === undefined ? "" : String(entry.stream_id);
    const name = String(entry.name ?? entry.stream_name ?? "").trim();
    if (!id || !name) {
      return [];
    }

    const directSource = typeof entry.direct_source === "string" && /^https?:\/\//i.test(entry.direct_source) ? entry.direct_source : undefined;
    const streamUrlValue = typeof entry.stream_url === "string" && /^https?:\/\//i.test(entry.stream_url) ? entry.stream_url : undefined;
    const directUrlValue = typeof (entry as Record<string, unknown>).direct_url === "string" ? String((entry as Record<string, unknown>).direct_url) : undefined;
    const urlValue = typeof (entry as Record<string, unknown>).url === "string" ? String((entry as Record<string, unknown>).url) : undefined;
    const extension = entry.container_extension ? String(entry.container_extension).replace(/^\./, "") : "m3u8";
    const fallbackUrl = `${normalized.url.replace(/\/$/, "")}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(id)}.${extension}`;
    const selectedSource = directSource ? "direct_source" : streamUrlValue ? "stream_url" : "fallback";
    const selectedUrl = normalizeXtreamPlaybackUrl(directSource ?? streamUrlValue ?? fallbackUrl);

    return [{
      name,
      url: selectedUrl,
      externalRef: id,
      ...(entry.category_id ? { groupName: String(entry.category_id) } : {}),
      metadataJson: safeMetadataJson(entry)
    }];
  });
}

type XtreamCategory = Record<string, unknown> & { category_id?: string | number; category_name?: string; name?: string; parent_id?: string | number; }
type XtreamMovie = Record<string, unknown> & { stream_id?: string | number; name?: string; stream_name?: string; category_id?: string | number; stream_icon?: string; poster?: string; cover?: string; plot?: string; description?: string; }
type XtreamSeries = Record<string, unknown> & { series_id?: string | number; name?: string; category_id?: string | number; cover?: string; cover_big?: string; plot?: string; description?: string; }
type XtreamEpisode = Record<string, unknown> & { id?: string | number; episode_id?: string | number; episode_num?: string | number; title?: string; name?: string; info?: { plot?: string; description?: string; movie_image?: string; cover_big?: string; }; movie_image?: string; cover_big?: string; }
type XtreamEpgChannel = Record<string, unknown> & { id?: string | number; epg_channel_id?: string | number; channel_id?: string | number; name?: string; epg_name?: string; logo?: string; logo_url?: string; stream_id?: string | number; }
type XtreamEpgProgramme = Record<string, unknown> & { id?: string | number; epg_id?: string | number; programme_id?: string | number; title?: string; name?: string; description?: string; plot?: string; start?: string | number; start_time?: string | number; end?: string | number; end_time?: string | number; start_timestamp?: string | number; stop_timestamp?: string | number; }

function safeExternalReference(value: unknown, fallback: string) {
  const candidate = String(value ?? "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate)) return candidate;
  return crypto.createHash("sha256").update(fallback).digest("hex").slice(0, 32);
}

function localCatalogueId(kind: string, providerId: string, externalReference: string) {
  return `${kind}_${crypto.createHash("sha256").update(`${providerId}:${kind}:${externalReference}`).digest("hex").slice(0, 32)}`;
}

function readObjectArray<T>(payload: unknown, key: string): T[] {
  return unwrapXtreamArray<T>(payload, key) ?? [];
}

async function fetchXtreamJson(baseUrl: string, username: string, password: string, action: string, signal?: AbortSignal, extra: Record<string, string> = {}) {
  const normalized = normalizeXtreamUrl(baseUrl);
  if (normalized.error) throw new Error("Xtream base URL is invalid.");
  const response = await fetch(buildXtreamUrl(normalized.url, { username, password, action, ...extra }), buildRequestInit(signal, { headers: { accept: "application/json" } }));
  if (!response.ok) throw new Error(`Xtream request failed for ${action} with status ${response.status}.`);
  const text = await response.text();
  if (!text.trim()) throw new Error("Xtream returned an empty response.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Xtream returned malformed JSON.");
  }
}

function categoryInput(providerId: string, category: XtreamCategory, contentType: "live" | "movie" | "series") {
  const externalReference = safeExternalReference(category.category_id, `${contentType}:${category.category_name ?? category.name ?? ""}`);
  return {
    id: localCatalogueId("category", providerId, `${contentType}:${externalReference}`),
    providerAccountId: providerId,
    externalReference,
    name: String(category.category_name ?? category.name ?? "Unnamed category").trim(),
    contentType,
    sortOrder: null,
    status: "active"
  } satisfies DesktopCatalogueCategoryInput;
}

function movieInput(providerId: string, movie: XtreamMovie, categoryId: string | null): DesktopMovieInput {
  const externalReference = safeExternalReference(movie.stream_id, `movie:${movie.name ?? movie.stream_name ?? ""}`);
  return {
    id: localCatalogueId("movie", providerId, externalReference),
    providerAccountId: providerId,
    externalReference,
    categoryId,
    name: String(movie.name ?? movie.stream_name ?? "Untitled movie").trim(),
    description: movie.plot ?? movie.description ?? null,
    logoUrl: movie.stream_icon ?? null,
    posterUrl: movie.poster ?? movie.cover ?? null,
    metadataJson: safeMetadataJson(movie),
    contentType: "movie",
    status: "active"
  };
}

function seriesInput(providerId: string, series: XtreamSeries, categoryId: string | null): DesktopSeriesInput {
  const externalReference = safeExternalReference(series.series_id, `series:${series.name ?? ""}`);
  return {
    id: localCatalogueId("series", providerId, externalReference),
    providerAccountId: providerId,
    externalReference,
    categoryId,
    name: String(series.name ?? "Untitled series").trim(),
    description: series.plot ?? series.description ?? null,
    logoUrl: series.cover ?? null,
    posterUrl: series.cover_big ?? series.cover ?? null,
    metadataJson: safeMetadataJson(series),
    status: "active"
  };
}

function normalizeEpgTimestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function epgChannelExternalReference(channel: XtreamEpgChannel) {
  return safeExternalReference(channel.epg_channel_id ?? channel.channel_id ?? channel.id, `epg-channel:${channel.name ?? channel.epg_name ?? ""}`);
}

function epgChannelInput(providerId: string, channel: XtreamEpgChannel, linkedChannelId: string | null): DesktopEpgChannelInput {
  const externalReference = epgChannelExternalReference(channel);
  return {
    id: localCatalogueId("epg_channel", providerId, externalReference),
    providerAccountId: providerId,
    externalReference,
    channelId: linkedChannelId,
    name: String(channel.name ?? channel.epg_name ?? "Unnamed EPG channel").trim(),
    logoUrl: channel.logo ?? channel.logo_url ?? null,
    metadataJson: safeMetadataJson(channel),
    status: "active"
  };
}

function epgProgrammeInput(providerId: string, epgChannelId: string, channelExternalReference: string, programme: XtreamEpgProgramme): DesktopEpgProgrammeInput | null {
  const startAt = normalizeEpgTimestamp(programme.start ?? programme.start_time ?? programme.start_timestamp);
  const endAt = normalizeEpgTimestamp(programme.end ?? programme.end_time ?? programme.stop_timestamp);
  if (!startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()) return null;
  const title = String(programme.title ?? programme.name ?? "").trim();
  if (!title) return null;
  const externalReference = safeExternalReference(programme.id ?? programme.epg_id ?? programme.programme_id, `${channelExternalReference}:${startAt}:${endAt}:${title}`);
  return {
    id: localCatalogueId("epg_programme", providerId, `${channelExternalReference}:${externalReference}`),
    providerAccountId: providerId,
    externalReference,
    epgChannelId,
    title,
    description: programme.description ?? programme.plot ?? null,
    startAt,
    endAt,
    metadataJson: safeMetadataJson(programme),
    status: "active"
  };
}

function makeChannelInput(providerId: string, channel: { name: string; url: string; externalRef?: string; groupName?: string; metadataJson?: string | null }): DesktopChannelInput {
  return {
    providerAccountId: providerId,
    externalReference: channel.externalRef ?? null,
    name: channel.name,
    groupName: channel.groupName ?? null,
    logoUrl: null,
    playbackUrl: channel.url,
    metadataJson: channel.metadataJson ?? null,
    contentType: "live",
    status: "active"
  };
}

function safeMetadataJson(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const redact = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(redact);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry)
      .filter(([key]) => !/(username|password|token|auth|credential|stream_url|movie_url|episode_url)/i.test(key))
      .map(([key, item]) => [key, redact(item)]));
  };
  try { return JSON.stringify(redact(value)); } catch { return null; }
}

export class DesktopIptvRuntime {
  private readonly operationSnapshots = new Map<string, DesktopRuntimeOperation>();
  private readonly operationControllers = new Map<string, AbortController>();
  private readonly shutdownOperationIds = new Set<string>();

  constructor(
    private readonly storage: DesktopSqliteStore,
    private readonly credentials: CredentialStore
  ) {}

  async startXtreamCatalogueSync(providerId: string): Promise<IptvOperation> {
    return this.startOperation("xtream_catalogue_sync", { providerId });
  }

  async startM3uCatalogueSync(providerId: string): Promise<IptvOperation> {
    return this.startOperation("m3u_catalogue_sync", { providerId });
  }

  async startEpgSync(providerId: string): Promise<IptvOperation> {
    return this.startOperation("xtream_epg_sync", { providerId });
  }

  async validateProvider(input: RuntimeProviderRequest): Promise<ProviderConnectionTest> {
    const provider = input.providerId ? this.storage.getProviderAccount(input.providerId) : null;
    const resolvedType = (input.type && input.type !== "manual") ? input.type : provider?.type ?? "manual";
    const baseUrl = (input.baseUrl ?? provider?.baseUrl ?? "").trim();
    if (!baseUrl) {
      return { ok: false, message: "Base URL is required." };
    }

    if (resolvedType === "xtream") {
      const providerCredentials = provider ? this.credentials.get(provider.credentialStoreRef) : null;
      const username = input.username?.trim() || providerCredentials?.username;
      const password = input.password || providerCredentials?.password;
      if (!username || !password) {
        return { ok: false, message: "Xtream providers require both username and password." };
      }

      return testXtreamConnection(baseUrl, username, password);
    }

    const playlistSource = input.playlist ?? baseUrl;
    const playlistResponse = await fetchTextWithTimeout(normalizePlaylistUrl(playlistSource), { method: "GET" }, 60_000);
    if (!playlistResponse.response.ok) {
      return {
        ok: false,
        statusCode: playlistResponse.response.status,
        message: "Provider returned an error."
      };
    }

    const parsed = parseM3uPlaylist(playlistResponse.text);
    const validChannels = parsed.filter((channel) => !validateHttpStreamUrl(channel.url));

    if (validChannels.length === 0) {
      return {
        ok: false,
        statusCode: playlistResponse.response.status,
        message: "Provider responded but playlist is empty or invalid."
      };
    }

    return {
      ok: true,
      statusCode: playlistResponse.response.status,
      message: "Provider connection is valid."
    };
  }

  async validateProviderById(providerId: string): Promise<ProviderConnectionTest> {
    const provider = this.storage.getProviderAccount(providerId);
    if (!provider) {
      return { ok: false, message: "provider_not_found" };
    }

    return this.validateProvider({
      providerId,
      baseUrl: provider.baseUrl,
      type: provider.type
    });
  }

  async startOperation(type: IptvOperationType, input: RuntimeProviderRequest = {}): Promise<IptvOperation> {
    const providerAccountId = input.providerId ?? null;
    const activeOperation = providerAccountId
      ? this.storage.listOperations(providerAccountId).find((candidate) =>
        candidate.status === "queued" || candidate.status === "running"
      )
      : undefined;
    if (activeOperation) {
      throw new Error(`iptv_operation_in_progress:${activeOperation.id}`);
    }
    const operation: DesktopRuntimeOperation = {
      id: `iptv_${crypto.randomUUID()}`,
      type,
      status: "queued",
      startedAt: nowIso(),
      processed: 0,
      succeeded: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      currentStage: "queued",
      currentMessage: "Operation queued.",
      cancelled: false,
      providerAccountId,
      playlist: type === "m3u_import" ? (input.playlist ?? null) : null
    };

    this.operationSnapshots.set(operation.id, operation);
    this.persistSnapshot(operation);

    this.launchOperation(operation.id, type, input);

    return { ...operation };
  }

  async resumePendingOperations() {
    // Catalogue sync is intentionally operator-controlled. Resuming a large
    // IPTV import while Electron is booting blocks the main process and can
    // make the login window appear frozen.
    return;
  }

  shutdownForAppExit() {
    for (const [operationId, controller] of this.operationControllers) {
      const current = this.operationSnapshots.get(operationId);
      if (!current || ["completed", "failed", "partial", "cancelled", "timeout", "interrupted"].includes(current.status)) continue;
      this.shutdownOperationIds.add(operationId);
      const interrupted: DesktopRuntimeOperation = {
        ...current,
        status: "interrupted",
        currentStage: "interrupted",
        currentMessage: "Operation interrupted by application shutdown."
      };
      this.operationSnapshots.set(operationId, interrupted);
      this.persistSnapshot(interrupted);
      controller.abort();
    }
  }

  private launchOperation(operationId: string, type: IptvOperationType, input: RuntimeProviderRequest) {
    const controller = new AbortController();
    this.operationControllers.set(operationId, controller);
    void this.runOperation(operationId, type, input, controller.signal);
  }

  async getOperation(operationId: string): Promise<IptvOperation | null> {
    const snapshot = this.operationSnapshots.get(operationId);
    if (!snapshot) {
      const stored = this.storage.getOperation(operationId);
      if (!stored) {
        return null;
      }

      const operation = this.buildOperationResponse(stored);
      this.operationSnapshots.set(operationId, operation);
      return operation;
    }

    return { ...snapshot };
  }

  async cancelOperation(operationId: string): Promise<IptvOperation | null> {
    const snapshot = this.operationSnapshots.get(operationId);
    if (!snapshot) {
      const stored = this.storage.getOperation(operationId);
      if (!stored) {
        return null;
      }
      const operation = this.buildOperationResponse(stored);
      if (["completed", "partial", "failed", "timeout", "cancelled", "interrupted"].includes(operation.status)) {
        return operation;
      }
      const cancelled: DesktopRuntimeOperation = {
      ...operation,
      status: "cancelled",
      cancelled: true,
      currentStage: "cancelled",
      currentMessage: "Operation cancelled by the user."
    };
      this.operationSnapshots.set(operationId, cancelled);
      this.persistSnapshot(cancelled);
      return cancelled;
    }

    if (["completed", "partial", "failed", "timeout", "cancelled", "interrupted"].includes(snapshot.status)) {
      return { ...snapshot };
    }

    this.operationControllers.get(operationId)?.abort();
    const cancelled: DesktopRuntimeOperation = {
      ...snapshot,
      status: "cancelled",
      cancelled: true,
      currentStage: "cancelled",
      currentMessage: "Operation cancelled by the user."
    };

    this.operationSnapshots.set(operationId, cancelled);
    this.persistSnapshot(cancelled);
    return { ...cancelled };
  }

  private async runOperation(operationId: string, type: IptvOperationType, input: RuntimeProviderRequest, signal: AbortSignal) {
    const snapshot = this.operationSnapshots.get(operationId);
    if (!snapshot) {
      return;
    }

    try {
      this.updateOperation(operationId, {
        status: "running",
        currentStage: "starting",
        currentMessage: "Operation started."
      });

      switch (type) {
        case "xtream_validation": {
          const result = await this.validateProvider({ ...input, type: "xtream" });
          if (!result.ok) {
            throw new Error(result.message);
          }
          this.updateOperation(operationId, {
            status: "completed",
            processed: 1,
            succeeded: 1,
            currentStage: "completed",
            currentMessage: result.message
          });
          break;
        }
        case "m3u_validation": {
          const result = await this.validateProvider({ ...input, type: "m3u" });
          if (!result.ok) {
            throw new Error(result.message);
          }
          this.updateOperation(operationId, {
            status: "completed",
            processed: 1,
            succeeded: 1,
            currentStage: "completed",
            currentMessage: result.message
          });
          break;
        }
        case "m3u_import": {
          const providerId = input.providerId;
          if (!providerId) {
            throw new Error("provider_id_required");
          }
          const provider = this.storage.getProviderAccount(providerId);
          if (!provider) {
            throw new Error("provider_not_found");
          }

          const playlistSource = input.playlist ?? provider.baseUrl;
          const response = await fetchTextWithTimeout(normalizePlaylistUrl(playlistSource), { method: "GET", signal }, 60_000);
          if (!response.response.ok) {
            throw new Error(`Provider returned HTTP ${response.response.status}.`);
          }

          const parsed = parseM3uPlaylist(response.text);
          const valid = parsed.filter((channel) => !validateHttpStreamUrl(channel.url));

          this.updateOperation(operationId, {
            status: "running",
            total: parsed.length,
            processed: parsed.length,
            succeeded: valid.length,
            failed: parsed.length - valid.length,
            currentStage: "saving_channels",
            currentMessage: `${parsed.length} playlist entries parsed.`
          });

          if (valid.length === 0) {
            throw new Error("M3U import produced zero usable channels.");
          }

          const channelInputs = valid.map((channel) => makeChannelInput(providerId, channel));
          for (let offset = 0; offset < channelInputs.length; offset += CATALOGUE_BATCH_SIZE) {
            if (signal.aborted) break;
            const batch = channelInputs.slice(offset, offset + CATALOGUE_BATCH_SIZE);
            try {
              this.storage.upsertChannelsBatch(batch);
            } catch (error) {
              if (isFatalPersistenceError(error)) throw error;
              for (const channelInput of batch) this.storage.upsertChannel(channelInput);
            }
            await yieldToEventLoop();
          }

          await this.syncM3uCatalogue(operationId, providerId, valid, valid.length === parsed.length, signal);
          if (signal.aborted) {
            throw new Error("operation_cancelled");
          }

          this.storage.updateProviderAccount(providerId, {
            status: "active",
            availability: "online",
            lastValidatedAt: nowIso(),
            healthReason: null
          });

          this.updateOperation(operationId, {
            status: "completed",
            total: parsed.length,
            currentStage: "completed",
            currentMessage: `M3U import completed. ${valid.length} channels and local catalogue records were persisted.`,
            failed: Math.max(0, parsed.length - valid.length)
          });
          break;
        }
        case "m3u_catalogue_sync": {
          const providerId = input.providerId;
          if (!providerId) throw new Error("provider_id_required");
          const provider = this.storage.getProviderAccount(providerId);
          if (!provider) throw new Error("provider_not_found");
          if (provider.type !== "m3u" && provider.type !== "manual") throw new Error("m3u_provider_required");

          const response = await fetchTextWithTimeout(normalizePlaylistUrl(provider.baseUrl), { method: "GET", signal }, 60_000);
          if (!response.response.ok) throw new Error(`Provider returned HTTP ${response.response.status}.`);
          const parsed = parseM3uPlaylist(response.text);
          const valid = parsed.filter((entry) => !validateHttpStreamUrl(entry.url));
          if (valid.length === 0) throw new Error("M3U catalogue produced zero usable entries.");
          await this.syncM3uCatalogue(operationId, providerId, valid, valid.length === parsed.length, signal);
          if (signal.aborted) throw new Error("operation_cancelled");
          this.updateOperation(operationId, {
            status: "completed",
            currentStage: "completed",
            currentMessage: "M3U catalogue synchronized.",
            failed: parsed.length - valid.length
          });
          break;
        }
        case "xtream_channel_sync": {
          const providerId = input.providerId;
          if (!providerId) {
            throw new Error("provider_id_required");
          }
          const provider = this.storage.getProviderAccount(providerId);
          if (!provider) {
            throw new Error("provider_not_found");
          }

          const credentials = this.credentials.get(provider.credentialStoreRef);
          if (!credentials) {
            throw new Error("stored_xtream_credentials_required");
          }

          const connection = await testXtreamConnection(provider.baseUrl, credentials.username, credentials.password, signal);
          if (!connection.ok) {
            throw new Error(connection.message);
          }

          const liveChannels = await fetchXtreamLiveChannels(provider.baseUrl, credentials.username, credentials.password, signal);
          if (signal.aborted || liveChannels.length === 0) {
            throw new Error("Xtream sync completed with zero usable channels.");
          }

          this.updateOperation(operationId, {
            status: "running",
            total: liveChannels.length,
            processed: 0,
            succeeded: 0,
            failed: 0,
            currentStage: "saving_channels",
            currentMessage: "Persisting Xtream channels."
          });

          let persisted = 0;
          for (const channel of liveChannels) {
            if (signal.aborted) {
              break;
            }
            this.storage.upsertChannel(makeChannelInput(providerId, channel));
            persisted += 1;
            this.updateOperation(operationId, {
              processed: persisted,
              succeeded: persisted,
              failed: Math.max(0, liveChannels.length - persisted),
              currentStage: "saving_channels",
              currentMessage: `${persisted} Xtream channels persisted.`
            });
          }

          this.storage.updateProviderAccount(providerId, {
            status: "active",
            availability: "online",
            lastValidatedAt: nowIso(),
            healthReason: null
          });

          this.updateOperation(operationId, {
            status: "completed",
            total: liveChannels.length,
            processed: liveChannels.length,
            succeeded: liveChannels.length,
            failed: 0,
            currentStage: "completed",
            currentMessage: `${liveChannels.length} channels saved. Provider activated.`
          });
          break;
        }
        case "xtream_catalogue_sync": {
          const providerId = input.providerId;
          if (!providerId) throw new Error("provider_id_required");
          const provider = this.storage.getProviderAccount(providerId);
          if (!provider) throw new Error("provider_not_found");
          if (provider.type !== "xtream") throw new Error("xtream_provider_required");

          const providerCredentials = this.credentials.get(provider.credentialStoreRef);
          if (!providerCredentials) throw new Error("stored_xtream_credentials_required");

          const summary = await this.syncXtreamCatalogue(operationId, providerId, provider.baseUrl, providerCredentials.username, providerCredentials.password, signal);
          if (signal.aborted) throw new Error("operation_cancelled");
          this.updateOperation(operationId, {
            status: summary.partial ? "partial" : "completed",
            currentStage: "completed",
            currentMessage: summary.partial ? "Xtream catalogue synchronized with record-level failures." : "Xtream catalogue synchronized."
          });
          break;
        }
        case "xtream_epg_sync": {
          const providerId = input.providerId;
          if (!providerId) throw new Error("provider_id_required");
          const provider = this.storage.getProviderAccount(providerId);
          if (!provider) throw new Error("provider_not_found");
          if (provider.type !== "xtream") throw new Error("xtream_provider_required");
          const providerCredentials = this.credentials.get(provider.credentialStoreRef);
          if (!providerCredentials) throw new Error("stored_xtream_credentials_required");
          await this.syncXtreamEpg(operationId, providerId, provider.baseUrl, providerCredentials.username, providerCredentials.password, signal);
          if (signal.aborted) throw new Error("operation_cancelled");
          this.updateOperation(operationId, {
            status: "completed",
            currentStage: "completed",
            currentMessage: "Xtream EPG synchronized."
          });
          break;
        }
        default:
          throw new Error(`unsupported_operation_type:${type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const interrupted = this.shutdownOperationIds.has(operationId);
      if (interrupted) return;
      const failedProviderId = input.providerId;
      if (!signal.aborted && failedProviderId) {
        this.storage.updateProviderAccount(failedProviderId, {
          status: "failed",
          availability: "offline",
          healthReason: message
        });
      }
      this.updateOperation(operationId, {
        status: signal.aborted ? "cancelled" : "failed",
        currentStage: signal.aborted ? "cancelled" : "failed",
        currentMessage: signal.aborted ? "Operation cancelled." : message,
        ...(!signal.aborted ? { error: message } : {}),
        cancelled: signal.aborted
      });
    } finally {
      this.operationControllers.delete(operationId);
      this.operationSnapshots.delete(operationId);
      this.shutdownOperationIds.delete(operationId);
    }
  }

  private async syncXtreamCatalogue(operationId: string, providerId: string, baseUrl: string, username: string, password: string, signal: AbortSignal): Promise<CatalogueSyncSummary> {
    const assertActive = () => {
      if (signal.aborted) throw new Error("operation_cancelled");
    };
    const connection = await testXtreamConnection(baseUrl, username, password, signal);
    if (!connection.ok) throw new Error(connection.message);
    this.storage.updateProviderAccount(providerId, {
      status: "active",
      availability: "online",
      ...(connection.expiresAt ? { expiresAt: connection.expiresAt } : {}),
      lastValidatedAt: nowIso(),
      healthReason: null
    });
    assertActive();
    const sections = new Map<CatalogueSection, CatalogueSectionProgress>([
      ["categories", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }],
      ["live", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }],
      ["movies", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }],
      ["series", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }],
      ["seasons", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }],
      ["episodes", { status: "pending", processed: 0, succeeded: 0, failed: 0, failures: [] }]
    ]);
    const workload: WorkloadMetrics = {
      startedAt: nowIso(),
      sectionStartedAt: {},
      sectionDurationMs: {},
      providerRequestCount: 0,
      providerRequestDurationMs: 0,
      persistenceDurationMs: 0,
      persistenceRecords: 0
    };
    const writeCheckpoint = () => {
      const current = this.operationSnapshots.get(operationId);
      if (!current) return;
      this.persistSnapshot(current, { sections: Object.fromEntries(sections), workload });
    };
    const setSectionStatus = (section: CatalogueSection, status: CatalogueSectionProgress["status"]) => {
      const progress = sections.get(section)!;
      if (status === "running" && !workload.sectionStartedAt[section]) workload.sectionStartedAt[section] = nowIso();
      if (["completed", "partial", "failed"].includes(status) && workload.sectionStartedAt[section]) {
        workload.sectionDurationMs[section] = Date.now() - Date.parse(workload.sectionStartedAt[section]!);
      }
      progress.status = status;
      writeCheckpoint();
    };
    const recordSuccess = (section: CatalogueSection, message: string) => {
      const progress = sections.get(section)!;
      progress.processed += 1;
      progress.succeeded += 1;
      const current = this.operationSnapshots.get(operationId);
      if (!current) return;
      const next = { ...current, processed: current.processed + 1, succeeded: current.succeeded + 1, currentStage: "persisting_catalogue", currentMessage: message };
      this.operationSnapshots.set(operationId, next);
      if (next.processed % 100 === 0) writeCheckpoint();
    };
    const recordFailure = (section: CatalogueSection, entityType: string, id: string, error: unknown) => {
      const progress = sections.get(section)!;
      progress.processed += 1;
      progress.failed += 1;
      progress.failures.push({ entityType, id, error: safePersistenceError(error) });
      const current = this.operationSnapshots.get(operationId);
      if (!current) return;
      const next = { ...current, processed: current.processed + 1, failed: current.failed + 1, currentStage: "persisting_catalogue", currentMessage: `${entityType} persistence failed; continuing.` };
      this.operationSnapshots.set(operationId, next);
      writeCheckpoint();
    };
    const persistRecord = <T>(section: CatalogueSection, entityType: string, id: string, callback: () => T) => {
      const startedAt = Date.now();
      try {
        const result = callback();
        workload.persistenceDurationMs += Date.now() - startedAt;
        workload.persistenceRecords += 1;
        recordSuccess(section, `${entityType} persisted.`);
        return result;
      } catch (error) {
        workload.persistenceDurationMs += Date.now() - startedAt;
        workload.persistenceRecords += 1;
        if (isFatalPersistenceError(error)) throw error;
        recordFailure(section, entityType, id, error);
        return null;
      }
    };
    const persistBatch = (records: number, callback: () => void) => {
      const startedAt = Date.now();
      try {
        callback();
      } finally {
        workload.persistenceDurationMs += Date.now() - startedAt;
        workload.persistenceRecords += records;
      }
    };
    const fetchCatalogueJson = async (action: string, extra: Record<string, string> = {}) => {
      const startedAt = Date.now();
      try {
        return await fetchXtreamJson(baseUrl, username, password, action, signal, extra);
      } finally {
        workload.providerRequestCount += 1;
        workload.providerRequestDurationMs += Date.now() - startedAt;
      }
    };
    const fetchOptionalCatalogueJson = async (section: CatalogueSection, action: string) => {
      try {
        return await fetchCatalogueJson(action);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/Xtream request failed for .* with status 5\d\d\./.test(message)) throw error;
        recordFailure(section, action, action, error);
        return null;
      }
    };
    setSectionStatus("categories", "running");
    this.updateOperation(operationId, { currentStage: "fetching_categories", currentMessage: "Fetching Xtream categories." });
    const liveCategories = readObjectArray<XtreamCategory>(await fetchOptionalCatalogueJson("categories", "get_live_categories"), "categories");
    assertActive();

    const categoryIds = new Map<string, string>();
    const seenCategoryIds = new Set<string>();
    const categoryCandidates: Array<{ type: "live" | "movie" | "series"; input: DesktopCatalogueCategoryInput }> = [];
    for (const category of liveCategories.map((item) => ({ item, type: "live" as const }))) {
      if (!category.item.category_id && !category.item.category_name && !category.item.name) {
        recordFailure("categories", "category", "unknown", new Error("Xtream category missing identity."));
        continue;
      }
      const input = categoryInput(providerId, category.item, category.type);
      categoryCandidates.push({ type: category.type, input });
    }
    try {
      persistBatch(categoryCandidates.length, () => this.storage.upsertCategoriesBatch(categoryCandidates.map((candidate) => candidate.input)));
      for (const candidate of categoryCandidates) {
        categoryIds.set(`${candidate.type}:${candidate.input.externalReference}`, candidate.input.id!);
        seenCategoryIds.add(candidate.input.id!);
        recordSuccess("categories", "Xtream category persisted.");
      }
    } catch (error) {
      if (isFatalPersistenceError(error)) throw error;
      for (const candidate of categoryCandidates) {
        const persisted = persistRecord("categories", "category", candidate.input.id!, () => this.storage.upsertCategory(candidate.input));
        if (!persisted) continue;
        categoryIds.set(`${candidate.type}:${candidate.input.externalReference}`, persisted.id);
        seenCategoryIds.add(persisted.id);
      }
    }
    setSectionStatus("categories", sections.get("categories")!.failed ? "partial" : "completed");

    setSectionStatus("live", "running");
    this.updateOperation(operationId, { currentStage: "fetching_channels", currentMessage: "Fetching Xtream live channels." });
    const liveRequestStartedAt = Date.now();
    let liveChannels: Array<{ name: string; url: string; externalRef?: string; groupName?: string; metadataJson?: string | null }>;
    try {
      liveChannels = await fetchXtreamLiveChannels(baseUrl, username, password, signal);
    } finally {
      workload.providerRequestCount += 1;
      workload.providerRequestDurationMs += Date.now() - liveRequestStartedAt;
    }
    assertActive();
    const channelInputs = liveChannels.map((channel) => {
      const category = liveCategories.find((item) => String(item.category_id ?? "") === String(channel.groupName ?? ""));
      const categoryName = category?.category_name ?? category?.name ?? channel.groupName;
      return makeChannelInput(providerId, {
        ...channel,
        ...(categoryName ? { groupName: categoryName } : {})
      });
    });
    for (let offset = 0; offset < channelInputs.length; offset += CATALOGUE_BATCH_SIZE) {
      const batch = channelInputs.slice(offset, offset + CATALOGUE_BATCH_SIZE);
      try {
        persistBatch(batch.length, () => this.storage.upsertChannelsBatch(batch));
        batch.forEach(() => recordSuccess("live", "Xtream channel persisted."));
      } catch (error) {
        if (isFatalPersistenceError(error)) throw error;
        batch.forEach((input) => persistRecord("live", "channel", input.id ?? input.externalReference ?? input.name, () => this.storage.upsertChannel(input)));
      }
      await yieldToEventLoop();
    }
    setSectionStatus("live", sections.get("live")!.failed ? "partial" : "completed");

    // The desktop IPTV workflow is intentionally live-only. Keep old VOD data
    // intact for recovery, but remove it from the active catalogue.
    setSectionStatus("movies", "completed");
    setSectionStatus("series", "completed");
    setSectionStatus("seasons", "completed");
    setSectionStatus("episodes", "completed");
    for (const category of this.storage.listCategories(providerId)) {
      if (category.contentType !== "live") this.storage.archiveCategory(category.id);
    }
    for (const movie of this.storage.listMovies(providerId)) this.storage.archiveMovie(movie.id);
    for (const series of this.storage.listSeries(providerId)) this.storage.archiveSeries(series.id);
    for (const season of this.storage.listSeasons(providerId)) this.storage.archiveSeason(season.id);
    for (const episode of this.storage.listEpisodes(providerId)) this.storage.archiveEpisode(episode.id);
    this.storage.updateProviderAccount(providerId, {
      status: "active",
      availability: "online",
      lastValidatedAt: nowIso(),
      healthReason: null
    });
    this.persistSnapshot(this.operationSnapshots.get(operationId)!, { sections: Object.fromEntries(sections), workload });
    return { partial: Array.from(sections.values()).some((section) => section.failed > 0) };

    setSectionStatus("movies", "running");
    this.updateOperation(operationId, { currentStage: "fetching_movies", currentMessage: "Fetching Xtream movies." });
    const movies = readObjectArray<XtreamMovie>(await fetchCatalogueJson("get_vod_streams"), "streams");
    assertActive();
    const seenMovieIds = new Set<string>();
    for (let offset = 0; offset < movies.length; offset += CATALOGUE_BATCH_SIZE) {
      const batch = movies.slice(offset, offset + CATALOGUE_BATCH_SIZE);
      const inputs = batch.map((movie) => movie.stream_id === undefined && !movie.name && !movie.stream_name
        ? null
        : movieInput(providerId, movie, movie.category_id === undefined ? null : categoryIds.get(`movie:${safeExternalReference(movie.category_id, `movie-category:${movie.category_id}`)}`) ?? null));
      try {
        if (inputs.some((input) => !input)) throw new Error("Xtream movie missing identity.");
        persistBatch(inputs.length, () => this.storage.upsertMoviesBatch(inputs as DesktopMovieInput[]));
        for (const input of inputs) {
          if (!input) {
            recordFailure("movies", "movie", "unknown", new Error("Xtream movie missing identity."));
            continue;
          }
          seenMovieIds.add((input as DesktopMovieInput).id!);
          recordSuccess("movies", "Xtream movie persisted.");
        }
      } catch (error) {
        if (isFatalPersistenceError(error)) throw error;
        for (const input of inputs) {
          if (!input) {
            recordFailure("movies", "movie", "unknown", new Error("Xtream movie missing identity."));
            continue;
          }
          const movieInputValue = input as DesktopMovieInput;
          const persisted = persistRecord("movies", "movie", movieInputValue.id!, () => this.storage.upsertMovie(movieInputValue));
          if (persisted) seenMovieIds.add(persisted!.id);
        }
      }
      await yieldToEventLoop();
    }
    setSectionStatus("movies", sections.get("movies")!.failed ? "partial" : "completed");

    setSectionStatus("series", "running");
    this.updateOperation(operationId, { currentStage: "fetching_series", currentMessage: "Fetching Xtream series." });
    const seriesRecords = readObjectArray<XtreamSeries>(await fetchCatalogueJson("get_series"), "series");
    assertActive();
    const seenSeriesIds = new Set<string>();
    const seenSeasonIds = new Set<string>();
    const seenEpisodeIds = new Set<string>();
    setSectionStatus("seasons", "running");
    setSectionStatus("episodes", "running");
    const seriesCandidates: Array<{ series: XtreamSeries; input: DesktopSeriesInput; externalReference: string }> = [];
    for (const seriesRecord of seriesRecords) {
      if (seriesRecord.series_id === undefined && !seriesRecord.name) {
        recordFailure("series", "series", "unknown", new Error("Xtream series missing identity."));
        continue;
      }
      const seriesExternalReference = safeExternalReference(seriesRecord.series_id, `series:${seriesRecord.name ?? ""}`);
      const categoryId = seriesRecord.category_id === undefined ? null : categoryIds.get(`series:${safeExternalReference(seriesRecord.category_id, `series-category:${seriesRecord.category_id}`)}`) ?? null;
      const seriesInputValue = seriesInput(providerId, seriesRecord, categoryId);
      seriesCandidates.push({ series: seriesRecord, input: seriesInputValue, externalReference: seriesExternalReference });
    }
    const seriesWork: Array<{ series: XtreamSeries; persisted: DesktopSeries; externalReference: string }> = [];
    for (let offset = 0; offset < seriesCandidates.length; offset += CATALOGUE_BATCH_SIZE) {
      const batch = seriesCandidates.slice(offset, offset + CATALOGUE_BATCH_SIZE);
      try {
        persistBatch(batch.length, () => this.storage.upsertSeriesBatch(batch.map((candidate) => candidate.input)));
        for (const candidate of batch) {
          const persistedSeries = { ...candidate.input, id: candidate.input.id! } as DesktopSeries;
          seenSeriesIds.add(persistedSeries!.id);
          seriesWork.push({ series: candidate.series, persisted: persistedSeries!, externalReference: candidate.externalReference });
          recordSuccess("series", "Xtream series persisted.");
        }
      } catch (error) {
        if (isFatalPersistenceError(error)) throw error;
        for (const candidate of batch) {
          const persistedSeries = persistRecord("series", "series", candidate.input.id!, () => this.storage.upsertSeries(candidate.input));
          if (!persistedSeries) continue;
          seenSeriesIds.add(persistedSeries!.id);
          seriesWork.push({ series: candidate.series, persisted: persistedSeries!, externalReference: candidate.externalReference });
        }
      }
      await yieldToEventLoop();
    }

    const seriesDetails = await mapWithConcurrency(seriesWork, SERIES_DETAIL_CONCURRENCY, async (work) => {
      assertActive();
      try {
        return { work, detail: await fetchCatalogueJson("get_series_info", { series_id: work.externalReference }) };
      } catch (error) {
        return { work, error };
      }
    });
    for (const result of seriesDetails) {
      const { work } = result;
      if ("error" in result) {
        recordFailure("series", "series_info", work.persisted.id, result.error);
        continue;
      }
      const detail = result.detail;
      const detailRecord = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
      const rawEpisodes = detailRecord.episodes;
      const episodeGroups = rawEpisodes && typeof rawEpisodes === "object" && !Array.isArray(rawEpisodes)
        ? Object.entries(rawEpisodes as Record<string, unknown>).map(([seasonNumber, entries]) => ({ seasonNumber, entries: Array.isArray(entries) ? entries as XtreamEpisode[] : [] }))
        : Array.isArray(rawEpisodes) ? [{ seasonNumber: "0", entries: rawEpisodes as XtreamEpisode[] }] : [];
      const rawSeasons = Array.isArray(detailRecord.seasons) ? detailRecord.seasons as Array<{ id?: string | number; season_id?: string | number; season_num?: string | number; name?: string }> : [];
      const seasonNumbers = new Set<string>([...episodeGroups.map((group) => group.seasonNumber), ...rawSeasons.map((season) => String(season.season_num ?? "0"))]);
      for (const seasonNumber of seasonNumbers) {
        const seasonRecord = rawSeasons.find((season) => String(season.season_num ?? "0") === seasonNumber);
        const seasonExternalReference = safeExternalReference(seasonRecord?.id ?? seasonRecord?.season_id, `${work.externalReference}:season:${seasonNumber}`);
        const seasonInput: DesktopSeasonInput = {
          id: localCatalogueId("season", providerId, `${work.externalReference}:${seasonExternalReference}`),
          providerAccountId: providerId,
          seriesId: work.persisted.id,
          externalReference: seasonExternalReference,
          seasonNumber: Number.isFinite(Number(seasonNumber)) ? Number(seasonNumber) : null,
          name: seasonRecord?.name ?? null,
          metadataJson: safeMetadataJson(seasonRecord),
          status: "active"
        };
        const persistedSeason = persistRecord("seasons", "season", seasonInput.id!, () => this.storage.upsertSeason(seasonInput));
        if (!persistedSeason) continue;
        seenSeasonIds.add(persistedSeason!.id);
        const group = episodeGroups.find((candidate) => candidate.seasonNumber === seasonNumber);
        let episodesSinceYield = 0;
        for (const episode of group?.entries ?? []) {
          const episodeExternalReference = safeExternalReference(episode.id ?? episode.episode_id, `${work.externalReference}:${seasonNumber}:${episode.episode_num ?? episode.name ?? ""}`);
          const episodeInput: DesktopEpisodeInput = {
            id: localCatalogueId("episode", providerId, `${work.externalReference}:${episodeExternalReference}`),
            providerAccountId: providerId,
            seriesId: work.persisted.id,
            seasonId: persistedSeason!.id,
            externalReference: episodeExternalReference,
            episodeNumber: episode.episode_num == null ? null : Number(episode.episode_num),
            name: episode.title ?? episode.name ?? null,
            description: episode.info?.plot ?? episode.info?.description ?? null,
            logoUrl: episode.info?.movie_image ?? episode.info?.cover_big ?? episode.movie_image ?? episode.cover_big ?? null,
            metadataJson: safeMetadataJson(episode),
            status: "active"
          };
          const persistedEpisode = persistRecord("episodes", "episode", episodeInput.id!, () => this.storage.upsertEpisode(episodeInput));
          if (!persistedEpisode) continue;
          seenEpisodeIds.add(persistedEpisode!.id);
          episodesSinceYield += 1;
          if (episodesSinceYield >= 100) {
            episodesSinceYield = 0;
            await yieldToEventLoop();
          }
        }
      }
      await yieldToEventLoop();
    }
    setSectionStatus("series", sections.get("series")!.failed ? "partial" : "completed");
    setSectionStatus("seasons", sections.get("seasons")!.failed ? "partial" : "completed");
    setSectionStatus("episodes", sections.get("episodes")!.failed ? "partial" : "completed");

    assertActive();
    this.updateOperation(operationId, { currentStage: "archiving_stale", currentMessage: "Archiving stale Xtream catalogue records." });
    if (!sections.get("categories")!.failed) for (const category of this.storage.listCategories(providerId)) if (!seenCategoryIds.has(category.id)) this.storage.archiveCategory(category.id);
    if (!sections.get("movies")!.failed) for (const movie of this.storage.listMovies(providerId)) if (!seenMovieIds.has(movie.id)) this.storage.archiveMovie(movie.id);
    if (!sections.get("series")!.failed) for (const series of this.storage.listSeries(providerId)) if (!seenSeriesIds.has(series.id)) this.storage.archiveSeries(series.id);
    if (!sections.get("seasons")!.failed) for (const season of this.storage.listSeasons(providerId)) if (!seenSeasonIds.has(season.id)) this.storage.archiveSeason(season.id);
    if (!sections.get("episodes")!.failed) for (const episode of this.storage.listEpisodes(providerId)) if (!seenEpisodeIds.has(episode.id)) this.storage.archiveEpisode(episode.id);
    this.storage.updateProviderAccount(providerId, {
      status: "active",
      availability: "online",
      lastValidatedAt: nowIso(),
      healthReason: null
    });
    const current = this.operationSnapshots.get(operationId);
    if (current) this.persistSnapshot(current!);
    writeCheckpoint();
    return { partial: Array.from(sections.values()).some((section) => section.failed > 0) };
  }

  private async syncM3uCatalogue(operationId: string, providerId: string, entries: M3uEntry[], complete: boolean, signal: AbortSignal) {
    const liveEntries = entries.filter((entry) => classifyM3uEntry(entry).contentType === "live");
    const seenCategories = new Set<string>();
    const seenMovies = new Set<string>();
    const seenSeries = new Set<string>();
    const seenSeasons = new Set<string>();
    const seenEpisodes = new Set<string>();
    let processed = 0;
    let skipped = 0;

    this.updateOperation(operationId, {
      total: liveEntries.length,
      currentStage: "persisting_m3u_catalogue",
      currentMessage: "Classifying M3U catalogue entries."
    });

    for (const entry of liveEntries) {
      if (signal.aborted) throw new Error("operation_cancelled");
      const classification = classifyM3uEntry(entry);
      const categoryName = normalizedMetadata(entry.groupName);
      const categoryId = categoryName
        ? m3uLocalId("category", providerId, `${classification.contentType}:${categoryName.toLowerCase()}`)
        : null;
      if (categoryName) {
        const category = this.storage.upsertCategory({
          id: categoryId!,
          providerAccountId: providerId,
          externalReference: metadataHash(`${classification.contentType}:${categoryName.toLowerCase()}`),
          name: categoryName,
          contentType: classification.contentType,
          status: "active"
        });
        seenCategories.add(category.id);
      }

      if (classification.contentType === "movie") {
        const externalReference = m3uExternalReference(entry, "movie", categoryId ?? "uncategorized");
        const movie = this.storage.upsertMovie({
          id: m3uLocalId("movie", providerId, externalReference),
          providerAccountId: providerId,
          externalReference,
          categoryId,
          name: normalizedMetadata(entry.tvgName) || normalizedMetadata(entry.name),
          description: null,
          logoUrl: entry.logoUrl ?? null,
          posterUrl: entry.logoUrl ?? null,
          contentType: "movie",
          status: "active"
        });
        seenMovies.add(movie.id);
      } else if (classification.contentType === "series") {
        const seriesReference = safeExternalReference(entry.seriesExternalRef, `series:${normalizedMetadata(classification.seriesName) || normalizedMetadata(entry.name)}:${categoryId ?? "uncategorized"}`);
        const series = this.storage.upsertSeries({
          id: m3uLocalId("series", providerId, seriesReference),
          providerAccountId: providerId,
          externalReference: seriesReference,
          categoryId,
          name: normalizedMetadata(classification.seriesName) || normalizedMetadata(entry.name),
          description: null,
          logoUrl: entry.logoUrl ?? null,
          posterUrl: entry.logoUrl ?? null,
          status: "active"
        });
        seenSeries.add(series.id);

        if (classification.seasonNumber !== undefined && classification.episodeNumber !== undefined) {
          const seasonReference = safeExternalReference(undefined, `${seriesReference}:season:${classification.seasonNumber}`);
          const season = this.storage.upsertSeason({
            id: m3uLocalId("season", providerId, `${seriesReference}:${seasonReference}`),
            providerAccountId: providerId,
            seriesId: series.id,
            externalReference: seasonReference,
            seasonNumber: classification.seasonNumber,
            name: `Season ${classification.seasonNumber}`,
            status: "active"
          });
          seenSeasons.add(season.id);
          const episodeReference = m3uExternalReference(entry, "series", `${seriesReference}:${seasonReference}:${classification.episodeNumber}`);
          const episode = this.storage.upsertEpisode({
            id: m3uLocalId("episode", providerId, `${seriesReference}:${seasonReference}:${episodeReference}`),
            providerAccountId: providerId,
            seriesId: series.id,
            seasonId: season.id,
            externalReference: episodeReference,
            episodeNumber: classification.episodeNumber,
            name: normalizedMetadata(entry.tvgName) || normalizedMetadata(entry.name),
            description: null,
            logoUrl: entry.logoUrl ?? null,
            status: "active"
          });
          seenEpisodes.add(episode.id);
        } else {
          skipped += 1;
        }
      }

      processed += 1;
      if (processed % CATALOGUE_BATCH_SIZE === 0 || processed === liveEntries.length) {
        this.updateOperation(operationId, {
          processed,
          succeeded: processed - skipped,
          skipped,
          currentStage: "persisting_m3u_catalogue",
          currentMessage: `${processed} M3U entries processed.`
        });
        await yieldToEventLoop();
      }
    }

    if (!complete || skipped > 0) return;
    this.updateOperation(operationId, { currentStage: "archiving_stale_m3u_catalogue", currentMessage: "Archiving stale M3U catalogue records." });
    for (const category of this.storage.listCategories(providerId)) if (!seenCategories.has(category.id)) this.storage.archiveCategory(category.id);
    for (const movie of this.storage.listMovies(providerId)) this.storage.archiveMovie(movie.id);
    for (const series of this.storage.listSeries(providerId)) this.storage.archiveSeries(series.id);
    for (const season of this.storage.listSeasons(providerId)) this.storage.archiveSeason(season.id);
    for (const episode of this.storage.listEpisodes(providerId)) this.storage.archiveEpisode(episode.id);
  }

  private async syncXtreamEpg(operationId: string, providerId: string, baseUrl: string, username: string, password: string, signal: AbortSignal) {
    const assertActive = () => {
      if (signal.aborted) throw new Error("operation_cancelled");
    };
    const channels = this.storage.listChannels(providerId);
    const seenChannelIds = new Set<string>();
    const seenProgrammeIds = new Set<string>();
    let invalidRecords = 0;
    this.updateOperation(operationId, { currentStage: "fetching_epg_channels", currentMessage: "Fetching Xtream EPG channels." });
    const channelPayload = await fetchXtreamJson(baseUrl, username, password, "get_epg_channels", signal);
    const providerChannels = readObjectArray<XtreamEpgChannel>(channelPayload, "epg_list");
    if (!Array.isArray(providerChannels)) throw new Error("Xtream EPG channels response was invalid.");

    for (const providerChannel of providerChannels) {
      assertActive();
      const externalReference = epgChannelExternalReference(providerChannel);
      const name = String(providerChannel.name ?? providerChannel.epg_name ?? "").trim();
      if (!name) {
        invalidRecords += 1;
        continue;
      }
      const linkedChannel = channels.find((channel) =>
        (providerChannel.channel_id !== undefined && channel.externalReference === String(providerChannel.channel_id)) ||
        (providerChannel.stream_id !== undefined && channel.externalReference === String(providerChannel.stream_id)) ||
        channel.name === name
      );
      const persistedChannel = this.storage.upsertEpgChannel(epgChannelInput(providerId, providerChannel, linkedChannel?.id ?? null));
      seenChannelIds.add(persistedChannel.id);
      const streamReference = providerChannel.stream_id ?? providerChannel.channel_id ?? providerChannel.epg_channel_id ?? providerChannel.id;
      if (streamReference === undefined) {
        invalidRecords += 1;
        continue;
      }
      this.updateOperation(operationId, { processed: this.operationSnapshots.get(operationId)?.processed ?? 0, currentStage: "fetching_epg_programmes", currentMessage: `Fetching EPG for ${name}.` });
      const programmePayload = await fetchXtreamJson(baseUrl, username, password, "get_short_epg", signal, { stream_id: String(streamReference) });
      const programmes = readObjectArray<XtreamEpgProgramme>(programmePayload, "epg_list");
      for (const programme of programmes) {
        assertActive();
        const input = epgProgrammeInput(providerId, persistedChannel.id, externalReference, programme);
        if (!input) {
          invalidRecords += 1;
          continue;
        }
        const persistedProgramme = this.storage.upsertEpgProgramme(input);
        seenProgrammeIds.add(persistedProgramme.id);
        const current = this.operationSnapshots.get(operationId);
        this.updateOperation(operationId, {
          processed: (current?.processed ?? 0) + 1,
          succeeded: (current?.succeeded ?? 0) + 1,
          currentStage: "persisting_epg",
          currentMessage: `Persisted EPG programme for ${name}.`
        });
      }
    }

    assertActive();
    if (invalidRecords > 0) {
      this.updateOperation(operationId, { failed: invalidRecords, currentMessage: "EPG synchronized with skipped malformed records." });
      return;
    }
    this.updateOperation(operationId, { currentStage: "archiving_stale_epg", currentMessage: "Archiving stale EPG records." });
    for (const channel of this.storage.listEpgChannels(providerId)) if (!seenChannelIds.has(channel.id)) this.storage.archiveEpgChannel(channel.id);
    for (const programme of this.storage.listEpgProgrammes(providerId)) if (!seenProgrammeIds.has(programme.id)) this.storage.archiveEpgProgramme(programme.id);
  }

  private updateOperation(operationId: string, patch: Partial<DesktopRuntimeOperation>) {
    const current = this.operationSnapshots.get(operationId) ?? this.buildOperationResponse(this.storage.getOperation(operationId) ?? undefined);
    if (!current) {
      return;
    }

    const next = { ...current, ...patch };
    this.operationSnapshots.set(operationId, next);
    this.persistSnapshot(next);
  }

  private persistSnapshot(operation: DesktopRuntimeOperation, details?: Record<string, unknown>) {
    const checkpoint = (() => {
      const current = this.storage.getOperation(operation.id)?.checkpoint ?? null;
      if (!current) return {};
      try {
        const parsed = JSON.parse(current);
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    })();

    const nextCheckpoint: Record<string, unknown> = {
      ...checkpoint,
      currentStage: operation.currentStage,
      currentMessage: operation.currentMessage,
      ...(details ?? {})
    };

    if (typeof operation.playlist === "string" && operation.playlist.trim()) {
      nextCheckpoint.playlist = operation.playlist;
    }

    const persisted: DesktopIptvOperationInput = {
      id: operation.id,
      providerAccountId: operation.providerAccountId ?? null,
      operationType: operation.type,
      status: operation.status,
      processed: operation.processed,
      succeeded: operation.succeeded,
      failed: operation.failed,
      checkpoint: JSON.stringify(nextCheckpoint),
      cancellationRequested: operation.cancelled,
      error: operation.error ?? null
    };

    this.storage.upsertOperation(persisted);
  }

  private buildOperationResponse(operation: DesktopIptvOperation | undefined): DesktopRuntimeOperation {
    const jsonCheckpoint = operation?.checkpoint ? (() => {
      try {
        return JSON.parse(operation.checkpoint) as { currentStage?: string; currentMessage?: string; playlist?: string };
      } catch {
        return undefined;
      }
    })() : undefined;

    const response: DesktopRuntimeOperation = {
      id: operation?.id ?? `iptv_${crypto.randomUUID()}`,
      type: (operation?.operationType as IptvOperationType) ?? "m3u_validation",
      status: (operation?.status as IptvOperation["status"]) ?? "queued",
      startedAt: operation?.createdAt ?? nowIso(),
      processed: operation?.processed ?? 0,
      succeeded: operation?.succeeded ?? 0,
      updated: 0,
      skipped: 0,
      failed: operation?.failed ?? 0,
      currentStage: jsonCheckpoint?.currentStage ?? "queued",
      currentMessage: jsonCheckpoint?.currentMessage ?? operation?.error ?? "Operation queued.",
      cancelled: operation?.cancellationRequested ?? false,
      providerAccountId: operation?.providerAccountId ?? null,
      playlist: typeof jsonCheckpoint?.playlist === "string" ? jsonCheckpoint.playlist : null
    };

    if (operation?.error) {
      response.error = operation.error;
    }

    return response;
  }
}
