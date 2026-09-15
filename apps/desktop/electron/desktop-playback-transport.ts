import crypto from "node:crypto";
import type { CredentialStore } from "./credential-store.js";
import type { DesktopEpisode, DesktopMovie, DesktopProviderAccount } from "../src/desktop-persistence-contract.js";
import type { DesktopSqliteStore } from "./desktop-storage.js";

export type PlaybackEntityType = "movie" | "episode";
export type PlaybackResourceType = "manifest" | "playlist" | "segment" | "init" | "key" | "subtitle" | "media";
export type PlaybackSessionStatus = "active" | "cancelled" | "expired";
export type PlaybackStartRequest = { entityType: PlaybackEntityType; entityId: string };
export type PlaybackSessionView = { sessionId: string; entityType: PlaybackEntityType; entityId: string; expiresAt: string };
export type PlaybackReadRequest = { sessionId: string; requestId: string; resourceId: string; resourceType: PlaybackResourceType; byteRange?: { start: number; end?: number } };
export type PlaybackResourceResponse = { sessionId: string; requestId: string; resourceType: PlaybackResourceType; contentType: string; data: ArrayBuffer; done: boolean; status?: 200 | 206; contentLength?: number; totalLength?: number; range?: { start: number; end: number; total: number } };

type Entity = DesktopMovie | DesktopEpisode;
type Session = PlaybackSessionView & { providerAccountId: string; createdAtMs: number; lastActivityAtMs: number; status: PlaybackSessionStatus; resources: Map<string, Resource>; controllers: Set<AbortController>; requests: Set<string>; inFlight: number };
type Resource = { type: PlaybackResourceType; destination: string; contentType?: string; mediaMode?: "hls" | "non-hls"; providerOrigin: string };
type ProviderContext = { provider: DesktopProviderAccount; credentials: { username: string; password: string }; entity: Entity; entityType: PlaybackEntityType; storage?: DesktopSqliteStore };
type ResolvedSource = { destination: string; contentType?: string };

const MAX_LIFETIME_MS = 10 * 60_000;
const INACTIVITY_MS = 60_000;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const MAX_IN_FLIGHT = 4;

function sessionId() { return crypto.randomBytes(32).toString("base64url"); }
function resourceId() { return `resource-${crypto.randomBytes(18).toString("base64url")}`; }
function requestId() { return crypto.randomBytes(16).toString("hex"); }
function assertObject(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object") throw new Error("playback_request_invalid");
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("playback_request_field_not_allowed");
}
function assertStart(value: unknown): asserts value is PlaybackStartRequest {
  assertObject(value, ["entityType", "entityId"]);
  const input = value as Record<string, unknown>;
  if (input.entityType !== "movie" && input.entityType !== "episode") throw new Error("playback_entity_type_invalid");
  if (typeof input.entityId !== "string" || !/^[A-Za-z0-9._:-]+$/.test(input.entityId)) throw new Error("playback_entity_id_invalid");
}
function assertRead(value: unknown): asserts value is PlaybackReadRequest {
  assertObject(value, ["sessionId", "requestId", "resourceId", "resourceType", "byteRange"]);
  const input = value as Record<string, unknown>;
  if (!["manifest", "playlist", "segment", "init", "key", "subtitle", "media"].includes(String(input.resourceType))) throw new Error("playback_resource_type_invalid");
  for (const field of ["sessionId", "requestId", "resourceId"]) if (typeof input[field] !== "string" || !input[field]) throw new Error("playback_request_invalid");
  if (input.byteRange !== undefined) {
    if (!input.byteRange || typeof input.byteRange !== "object") throw new Error("playback_range_invalid");
    const range = input.byteRange as Record<string, unknown>;
    if (!Number.isInteger(range.start) || Number(range.start) < 0 || (range.end !== undefined && (!Number.isInteger(range.end) || Number(range.end) < Number(range.start)))) throw new Error("playback_range_invalid");
    if (range.end !== undefined && Number(range.end) - Number(range.start) + 1 > MAX_RANGE_BYTES) throw new Error("playback_range_invalid");
  }
}
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^(playback_|m3u_playback_)/.test(message) ? message : "playback_upstream_failed";
}
function xtreamBase(value: string) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/(?:player_api|api|get)\.php$/i, "").replace(/\/+$/, "");
  return url.toString();
}
function xtreamUrl(base: string, credentials: { username: string; password: string }, action: string, extra: Record<string, string> = {}) {
  const url = new URL(`${xtreamBase(base).replace(/\/$/, "")}/player_api.php`);
  url.searchParams.set("username", credentials.username); url.searchParams.set("password", credentials.password); url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.toString();
}
async function jsonFetch(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, headers: { accept: "application/json" }, redirect: "manual" });
  if (!response.ok || response.status >= 300) throw new Error("playback_upstream_failed");
  try { return await response.json() as unknown; } catch { throw new Error("playback_upstream_failed"); }
}
const SAFE_MEDIA_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/mp2t", "video/iso.segment", "application/octet-stream"]);
function safeContentType(value: string | null) {
  const normalized = (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!SAFE_MEDIA_TYPES.has(normalized)) throw new Error("playback_unsupported_format");
  return normalized;
}
async function fetchMedia(url: string, signal: AbortSignal, headers: Record<string, string>, providerOrigin: string) {
  let current = url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(current, { signal, headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("playback_upstream_failed");
      let next: URL;
      try { next = new URL(location, current); } catch { throw new Error("playback_upstream_failed"); }
      if (next.origin !== providerOrigin) throw new Error("playback_upstream_failed");
      current = next.toString();
      continue;
    }
    return response;
  }
  throw new Error("playback_upstream_failed");
}
function arrayPayload(value: unknown, key: string): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) return (value as Record<string, unknown>)[key] as any[];
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).data)) return (value as Record<string, unknown>).data as any[];
  return [];
}
function parseM3u(content: string) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()); const entries: Array<{ externalReference: string; sourceUrl: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""; if (!/^#EXTINF\b/i.test(line)) continue;
    const match = line.match(/(?:^|\s)tvg-id\s*=\s*["']?([^"'\s,]+)["']?/i); const source = lines.slice(index + 1, index + 5).find((item) => /^(?:https?|rtmp|rtsp|udp|srt):\/\//i.test(item));
    if (match?.[1] && source) entries.push({ externalReference: match[1], sourceUrl: source });
  }
  return entries;
}
async function resolveSource(context: ProviderContext, signal: AbortSignal): Promise<ResolvedSource> {
  const reference = context.entity.externalReference?.trim(); if (!reference) throw new Error("playback_identity_missing");
  if (context.provider.type === "m3u") {
    const response = await fetch(context.provider.baseUrl, { signal, redirect: "manual" }); if (!response.ok || response.status >= 300) throw new Error("playback_upstream_failed");
    const matches = parseM3u(await response.text()).filter((entry) => entry.externalReference === reference);
    if (!matches.length) throw new Error("m3u_playback_identity_not_found"); if (matches.length !== 1) throw new Error("m3u_playback_identity_ambiguous");
    return { destination: matches[0]!.sourceUrl };
  }
  if (context.provider.type !== "xtream") throw new Error("playback_provider_unavailable");
  if (context.entityType === "movie") {
    const records = arrayPayload(await jsonFetch(xtreamUrl(context.provider.baseUrl, context.credentials, "get_vod_streams"), signal), "streams");
    const matches = records.filter((record) => String(record.stream_id ?? "") === reference);
    if (matches.length !== 1) throw new Error("playback_identity_not_found");
    const record = matches[0]; if (typeof record.stream_url !== "string" || !record.stream_url) throw new Error("playback_source_not_found");
    return { destination: record.stream_url };
  }
  const episode = context.entity as DesktopEpisode; const series = context.entityType === "episode" ? null : null;
  if (!episode.seriesId) throw new Error("playback_identity_missing");
  const localSeries = (context as ProviderContext & { storage?: DesktopSqliteStore }).storage?.getSeries(episode.seriesId);
  if (!localSeries || localSeries.providerAccountId !== context.provider.id || !localSeries.externalReference) throw new Error("playback_provider_mismatch");
  const detail = await jsonFetch(xtreamUrl(context.provider.baseUrl, context.credentials, "get_series_info", { series_id: localSeries.externalReference }), signal);
  const records = Object.values((detail && typeof detail === "object" ? (detail as Record<string, unknown>).episodes : {}) ?? {}).flatMap((value) => Array.isArray(value) ? value : []);
  const matches = records.filter((record: any) => String(record.id ?? record.episode_id ?? "") === reference);
  if (matches.length !== 1 || typeof (matches[0] as any).movie_url !== "string") throw new Error("playback_source_not_found");
  return { destination: (matches[0] as any).movie_url };
}

export class DesktopPlaybackTransport {
  private readonly sessions = new Map<string, Session>();
  private readonly clock: () => number;
  constructor(private readonly storage: DesktopSqliteStore, private readonly credentials: CredentialStore, options: { clock?: () => number } = {}) { this.clock = options.clock ?? (() => Date.now()); }
  async start(input: unknown) {
    assertStart(input); const entity = input.entityType === "movie" ? this.storage.getMovie(input.entityId) : this.storage.getEpisode(input.entityId); if (!entity || entity.status !== "active") throw new Error("playback_entity_not_found");
    const provider = this.storage.getProviderAccount(entity.providerAccountId); if (!provider) throw new Error("playback_provider_not_found"); const credentials = this.credentials.get(provider.credentialStoreRef); if (!credentials) throw new Error("playback_authentication_failed");
    const controller = new AbortController(); const source = await resolveSource({ provider, credentials, entity, entityType: input.entityType, storage: this.storage }, controller.signal); const now = this.clock(); const id = sessionId();
    const rootIsHls = /\.m3u8(?:$|\?)/i.test(source.destination);
    const rootType: PlaybackResourceType = rootIsHls ? "manifest" : "media";
    const providerOrigin = new URL(provider.baseUrl).origin;
    const session: Session = { sessionId: id, entityType: input.entityType, entityId: input.entityId, providerAccountId: provider.id, createdAtMs: now, expiresAt: new Date(now + MAX_LIFETIME_MS).toISOString(), lastActivityAtMs: now, status: "active", resources: new Map([["resource-001", { type: rootType, destination: source.destination, mediaMode: rootIsHls ? "hls" : "non-hls", providerOrigin }]]), controllers: new Set([controller]), requests: new Set(), inFlight: 0 };
    this.sessions.set(id, session); return { sessionId: id, entityType: session.entityType, entityId: session.entityId, expiresAt: session.expiresAt };
  }
  async read(input: unknown): Promise<PlaybackResourceResponse> {
    assertRead(input); const session = this.sessions.get(input.sessionId); if (!session) throw new Error("playback_session_expired"); if (session.status !== "active") throw new Error(`playback_session_${session.status}`); const now = this.clock(); if (now >= Date.parse(session.expiresAt) || now - session.lastActivityAtMs > INACTIVITY_MS) { this.cancel(input.sessionId); throw new Error("playback_session_expired"); }
    const resource = session.resources.get(input.resourceId); if (!resource || resource.type !== input.resourceType) throw new Error("playback_resource_mismatch"); if (session.requests.has(input.requestId)) throw new Error("playback_request_invalid"); if (session.inFlight >= MAX_IN_FLIGHT) throw new Error("playback_concurrency_limited"); session.requests.add(input.requestId);
    if (resource.mediaMode === "non-hls" && !input.byteRange) throw new Error("playback_range_required");
    session.inFlight += 1; session.lastActivityAtMs = now; const controller = new AbortController(); session.controllers.add(controller);
    try {
      const headers: Record<string, string> = { accept: "*/*" }; if (input.byteRange) headers.range = `bytes=${input.byteRange.start}-${input.byteRange.end ?? ""}`;
      const response = resource.mediaMode === "non-hls" ? await fetchMedia(resource.destination, controller.signal, headers, resource.providerOrigin) : await fetch(resource.destination, { signal: controller.signal, headers, redirect: "manual" });
      if (!response.ok || response.status >= 300) throw new Error("playback_upstream_failed");
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      if (input.resourceType === "manifest" || input.resourceType === "playlist") {
        const text = await response.text();
        const sanitized = this.sanitizeManifest(session, resource.destination, text);
        const data = new TextEncoder().encode(sanitized).buffer;
        return { sessionId: input.sessionId, requestId: input.requestId, resourceType: input.resourceType, contentType: "application/vnd.apple.mpegurl", data, done: true, status: 200 };
      }
      const upstreamLength = Number(response.headers.get("content-length"));
      if (resource.mediaMode === "non-hls" && Number.isFinite(upstreamLength) && upstreamLength > MAX_RANGE_BYTES) throw new Error("playback_range_required");
      const data = await response.arrayBuffer();
      const safeType = resource.mediaMode === "non-hls" ? safeContentType(contentType) : contentType;
      const contentLengthHeader = response.headers.get("content-length");
      const contentRange = response.headers.get("content-range");
      const rangeMatch = contentRange?.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
      const contentLength = Number(contentLengthHeader);
      return {
        sessionId: input.sessionId,
        requestId: input.requestId,
        resourceType: input.resourceType,
        contentType: safeType,
        data,
        done: true,
        status: response.status === 206 ? 206 : 200,
        ...(Number.isFinite(contentLength) ? { contentLength } : {}),
        ...(rangeMatch && rangeMatch[3] !== "*" ? { range: { start: Number(rangeMatch[1]), end: Number(rangeMatch[2]), total: Number(rangeMatch[3]) }, totalLength: Number(rangeMatch[3]) } : {})
      };
    } catch (error) { throw new Error(safeError(error)); } finally { session.inFlight -= 1; session.controllers.delete(controller); }
  }
  cancel(id: string) { const session = this.sessions.get(id); if (!session) return; session.status = "cancelled"; for (const controller of session.controllers) controller.abort(); session.controllers.clear(); session.resources.clear(); this.sessions.delete(id); }
  shutdown() { for (const id of this.sessions.keys()) this.cancel(id); }

  private sanitizeManifest(session: Session, baseDestination: string, manifest: string) {
    const lines = manifest.split(/\r?\n/);
    return lines.map((line) => {
      if (!line || line.startsWith("#EXTM3U") || (line.startsWith("#") && !/URI=/i.test(line))) return line;
      if (line.startsWith("#") && /URI=/i.test(line)) {
        return line.replace(/URI=("[^"]*"|'[^']*')/gi, (_match, quoted: string) => {
          const original = quoted.slice(1, -1);
          const id = this.addResource(session, baseDestination, original, this.resourceTypeForTag(line));
          return `URI="gito-resource://${id}"`;
        });
      }
      if (!line.startsWith("#")) {
        const id = this.addResource(session, baseDestination, line, line.includes(".m3u8") ? "playlist" : "segment");
        return `gito-resource://${id}`;
      }
      return line;
    }).join("\n");
  }

  private addResource(session: Session, baseDestination: string, child: string, type: PlaybackResourceType) {
    const id = resourceId();
    let destination: string;
    try { destination = new URL(child, baseDestination).toString(); } catch { throw new Error("playback_upstream_failed"); }
    session.resources.set(id, { type, destination, mediaMode: "hls", providerOrigin: session.resources.get("resource-001")?.providerOrigin ?? new URL(baseDestination).origin });
    return id;
  }

  private resourceTypeForTag(line: string): PlaybackResourceType {
    if (/EXT-X-KEY/i.test(line)) return "key";
    if (/EXT-X-MAP/i.test(line)) return "init";
    if (/SUBTITLES/i.test(line)) return "subtitle";
    return "playlist";
  }
}

export function createDesktopPlaybackHandlers(playback: DesktopPlaybackTransport) { return { start: (input: unknown) => playback.start(input), read: (input: unknown) => playback.read(input), cancel: (sessionId: unknown) => playback.cancel(String(sessionId)) }; }
