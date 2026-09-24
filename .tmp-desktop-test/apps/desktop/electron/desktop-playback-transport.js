import crypto from "node:crypto";
const MAX_LIFETIME_MS = 10 * 60_000;
const INACTIVITY_MS = 60_000;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const MAX_IN_FLIGHT = 4;
function sessionId() { return crypto.randomBytes(32).toString("base64url"); }
function resourceId() { return `resource-${crypto.randomBytes(18).toString("base64url")}`; }
function requestId() { return crypto.randomBytes(16).toString("hex"); }
function assertObject(value, allowed) {
    if (!value || typeof value !== "object")
        throw new Error("playback_request_invalid");
    if (Object.keys(value).some((key) => !allowed.includes(key)))
        throw new Error("playback_request_field_not_allowed");
}
function assertStart(value) {
    assertObject(value, ["entityType", "entityId"]);
    const input = value;
    if (input.entityType !== "movie" && input.entityType !== "episode")
        throw new Error("playback_entity_type_invalid");
    if (typeof input.entityId !== "string" || !/^[A-Za-z0-9._:-]+$/.test(input.entityId))
        throw new Error("playback_entity_id_invalid");
}
function assertRead(value) {
    assertObject(value, ["sessionId", "requestId", "resourceId", "resourceType", "byteRange"]);
    const input = value;
    if (!["manifest", "playlist", "segment", "init", "key", "subtitle", "media"].includes(String(input.resourceType)))
        throw new Error("playback_resource_type_invalid");
    for (const field of ["sessionId", "requestId", "resourceId"])
        if (typeof input[field] !== "string" || !input[field])
            throw new Error("playback_request_invalid");
    if (input.byteRange !== undefined) {
        if (!input.byteRange || typeof input.byteRange !== "object")
            throw new Error("playback_range_invalid");
        const range = input.byteRange;
        if (!Number.isInteger(range.start) || Number(range.start) < 0 || (range.end !== undefined && (!Number.isInteger(range.end) || Number(range.end) < Number(range.start))))
            throw new Error("playback_range_invalid");
        if (range.end !== undefined && Number(range.end) - Number(range.start) + 1 > MAX_RANGE_BYTES)
            throw new Error("playback_range_invalid");
    }
}
function safeError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /^(playback_|m3u_playback_)/.test(message) ? message : "playback_upstream_failed";
}
function xtreamBase(value) {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/(?:player_api|api|get)\.php$/i, "").replace(/\/+$/, "");
    return url.toString();
}
function xtreamUrl(base, credentials, action, extra = {}) {
    const url = new URL(`${xtreamBase(base).replace(/\/$/, "")}/player_api.php`);
    url.searchParams.set("username", credentials.username);
    url.searchParams.set("password", credentials.password);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(extra))
        url.searchParams.set(key, value);
    return url.toString();
}
async function jsonFetch(url, signal) {
    const response = await fetch(url, { signal, headers: { accept: "application/json" }, redirect: "manual" });
    if (!response.ok || response.status >= 300)
        throw new Error("playback_upstream_failed");
    try {
        return await response.json();
    }
    catch {
        throw new Error("playback_upstream_failed");
    }
}
const SAFE_MEDIA_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/mp2t", "video/iso.segment", "application/octet-stream"]);
function safeContentType(value) {
    const normalized = (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!SAFE_MEDIA_TYPES.has(normalized))
        throw new Error("playback_unsupported_format");
    return normalized;
}
async function fetchMedia(url, signal, headers, providerOrigin) {
    let current = url;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const response = await fetch(current, { signal, headers, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location)
                throw new Error("playback_upstream_failed");
            let next;
            try {
                next = new URL(location, current);
            }
            catch {
                throw new Error("playback_upstream_failed");
            }
            if (next.origin !== providerOrigin)
                throw new Error("playback_upstream_failed");
            current = next.toString();
            continue;
        }
        return response;
    }
    throw new Error("playback_upstream_failed");
}
function arrayPayload(value, key) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object" && Array.isArray(value[key]))
        return value[key];
    if (value && typeof value === "object" && Array.isArray(value.data))
        return value.data;
    return [];
}
function parseM3u(content) {
    const lines = content.split(/\r?\n/).map((line) => line.trim());
    const entries = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!/^#EXTINF\b/i.test(line))
            continue;
        const match = line.match(/(?:^|\s)tvg-id\s*=\s*["']?([^"'\s,]+)["']?/i);
        const source = lines.slice(index + 1, index + 5).find((item) => /^(?:https?|rtmp|rtsp|udp|srt):\/\//i.test(item));
        if (match?.[1] && source)
            entries.push({ externalReference: match[1], sourceUrl: source });
    }
    return entries;
}
async function resolveSource(context, signal) {
    const reference = context.entity.externalReference?.trim();
    if (!reference)
        throw new Error("playback_identity_missing");
    if (context.provider.type === "m3u") {
        const response = await fetch(context.provider.baseUrl, { signal, redirect: "manual" });
        if (!response.ok || response.status >= 300)
            throw new Error("playback_upstream_failed");
        const matches = parseM3u(await response.text()).filter((entry) => entry.externalReference === reference);
        if (!matches.length)
            throw new Error("m3u_playback_identity_not_found");
        if (matches.length !== 1)
            throw new Error("m3u_playback_identity_ambiguous");
        return { destination: matches[0].sourceUrl };
    }
    if (context.provider.type !== "xtream")
        throw new Error("playback_provider_unavailable");
    if (context.entityType === "movie") {
        const records = arrayPayload(await jsonFetch(xtreamUrl(context.provider.baseUrl, context.credentials, "get_vod_streams"), signal), "streams");
        const matches = records.filter((record) => String(record.stream_id ?? "") === reference);
        if (matches.length !== 1)
            throw new Error("playback_identity_not_found");
        const record = matches[0];
        if (typeof record.stream_url !== "string" || !record.stream_url)
            throw new Error("playback_source_not_found");
        return { destination: record.stream_url };
    }
    const episode = context.entity;
    const series = context.entityType === "episode" ? null : null;
    if (!episode.seriesId)
        throw new Error("playback_identity_missing");
    const localSeries = context.storage?.getSeries(episode.seriesId);
    if (!localSeries || localSeries.providerAccountId !== context.provider.id || !localSeries.externalReference)
        throw new Error("playback_provider_mismatch");
    const detail = await jsonFetch(xtreamUrl(context.provider.baseUrl, context.credentials, "get_series_info", { series_id: localSeries.externalReference }), signal);
    const records = Object.values((detail && typeof detail === "object" ? detail.episodes : {}) ?? {}).flatMap((value) => Array.isArray(value) ? value : []);
    const matches = records.filter((record) => String(record.id ?? record.episode_id ?? "") === reference);
    if (matches.length !== 1 || typeof matches[0].movie_url !== "string")
        throw new Error("playback_source_not_found");
    return { destination: matches[0].movie_url };
}
export class DesktopPlaybackTransport {
    storage;
    credentials;
    sessions = new Map();
    clock;
    constructor(storage, credentials, options = {}) {
        this.storage = storage;
        this.credentials = credentials;
        this.clock = options.clock ?? (() => Date.now());
    }
    async start(input) {
        assertStart(input);
        const entity = input.entityType === "movie" ? this.storage.getMovie(input.entityId) : this.storage.getEpisode(input.entityId);
        if (!entity || entity.status !== "active")
            throw new Error("playback_entity_not_found");
        const provider = this.storage.getProviderAccount(entity.providerAccountId);
        if (!provider)
            throw new Error("playback_provider_not_found");
        const credentials = this.credentials.get(provider.credentialStoreRef);
        if (!credentials)
            throw new Error("playback_authentication_failed");
        const controller = new AbortController();
        const source = await resolveSource({ provider, credentials, entity, entityType: input.entityType, storage: this.storage }, controller.signal);
        const now = this.clock();
        const id = sessionId();
        const rootIsHls = /\.m3u8(?:$|\?)/i.test(source.destination);
        const rootType = rootIsHls ? "manifest" : "media";
        const providerOrigin = new URL(provider.baseUrl).origin;
        const session = { sessionId: id, entityType: input.entityType, entityId: input.entityId, providerAccountId: provider.id, createdAtMs: now, expiresAt: new Date(now + MAX_LIFETIME_MS).toISOString(), lastActivityAtMs: now, status: "active", resources: new Map([["resource-001", { type: rootType, destination: source.destination, mediaMode: rootIsHls ? "hls" : "non-hls", providerOrigin }]]), controllers: new Set([controller]), requests: new Set(), inFlight: 0 };
        this.sessions.set(id, session);
        return { sessionId: id, entityType: session.entityType, entityId: session.entityId, expiresAt: session.expiresAt };
    }
    async read(input) {
        assertRead(input);
        const session = this.sessions.get(input.sessionId);
        if (!session)
            throw new Error("playback_session_expired");
        if (session.status !== "active")
            throw new Error(`playback_session_${session.status}`);
        const now = this.clock();
        if (now >= Date.parse(session.expiresAt) || now - session.lastActivityAtMs > INACTIVITY_MS) {
            this.cancel(input.sessionId);
            throw new Error("playback_session_expired");
        }
        const resource = session.resources.get(input.resourceId);
        if (!resource || resource.type !== input.resourceType)
            throw new Error("playback_resource_mismatch");
        if (session.requests.has(input.requestId))
            throw new Error("playback_request_invalid");
        if (session.inFlight >= MAX_IN_FLIGHT)
            throw new Error("playback_concurrency_limited");
        session.requests.add(input.requestId);
        if (resource.mediaMode === "non-hls" && !input.byteRange)
            throw new Error("playback_range_required");
        session.inFlight += 1;
        session.lastActivityAtMs = now;
        const controller = new AbortController();
        session.controllers.add(controller);
        try {
            const headers = { accept: "*/*" };
            if (input.byteRange)
                headers.range = `bytes=${input.byteRange.start}-${input.byteRange.end ?? ""}`;
            const response = resource.mediaMode === "non-hls" ? await fetchMedia(resource.destination, controller.signal, headers, resource.providerOrigin) : await fetch(resource.destination, { signal: controller.signal, headers, redirect: "manual" });
            if (!response.ok || response.status >= 300)
                throw new Error("playback_upstream_failed");
            const contentType = response.headers.get("content-type") ?? "application/octet-stream";
            if (input.resourceType === "manifest" || input.resourceType === "playlist") {
                const text = await response.text();
                const sanitized = this.sanitizeManifest(session, resource.destination, text);
                const data = new TextEncoder().encode(sanitized).buffer;
                return { sessionId: input.sessionId, requestId: input.requestId, resourceType: input.resourceType, contentType: "application/vnd.apple.mpegurl", data, done: true, status: 200 };
            }
            const upstreamLength = Number(response.headers.get("content-length"));
            if (resource.mediaMode === "non-hls" && Number.isFinite(upstreamLength) && upstreamLength > MAX_RANGE_BYTES)
                throw new Error("playback_range_required");
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
        }
        catch (error) {
            throw new Error(safeError(error));
        }
        finally {
            session.inFlight -= 1;
            session.controllers.delete(controller);
        }
    }
    cancel(id) { const session = this.sessions.get(id); if (!session)
        return; session.status = "cancelled"; for (const controller of session.controllers)
        controller.abort(); session.controllers.clear(); session.resources.clear(); this.sessions.delete(id); }
    shutdown() { for (const id of this.sessions.keys())
        this.cancel(id); }
    sanitizeManifest(session, baseDestination, manifest) {
        const lines = manifest.split(/\r?\n/);
        return lines.map((line) => {
            if (!line || line.startsWith("#EXTM3U") || (line.startsWith("#") && !/URI=/i.test(line)))
                return line;
            if (line.startsWith("#") && /URI=/i.test(line)) {
                return line.replace(/URI=("[^"]*"|'[^']*')/gi, (_match, quoted) => {
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
    addResource(session, baseDestination, child, type) {
        const id = resourceId();
        let destination;
        try {
            destination = new URL(child, baseDestination).toString();
        }
        catch {
            throw new Error("playback_upstream_failed");
        }
        session.resources.set(id, { type, destination, mediaMode: "hls", providerOrigin: session.resources.get("resource-001")?.providerOrigin ?? new URL(baseDestination).origin });
        return id;
    }
    resourceTypeForTag(line) {
        if (/EXT-X-KEY/i.test(line))
            return "key";
        if (/EXT-X-MAP/i.test(line))
            return "init";
        if (/SUBTITLES/i.test(line))
            return "subtitle";
        return "playlist";
    }
}
export function createDesktopPlaybackHandlers(playback) { return { start: (input) => playback.start(input), read: (input) => playback.read(input), cancel: (sessionId) => playback.cancel(String(sessionId)) }; }
