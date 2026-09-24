import crypto from "node:crypto";
function nowIso() {
    return new Date().toISOString();
}
function normalizePlaylistUrl(value) {
    try {
        const url = new URL(value.trim());
        if (url.protocol === "http:" && url.hostname.endsWith("github.io")) {
            url.protocol = "https:";
        }
        return url.toString();
    }
    catch {
        return value.trim();
    }
}
function validateHttpStreamUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        return "stream_url_malformed";
    }
    const supportedProtocols = new Set(["http:", "https:", "rtmp:", "rtsp:", "udp:", "srt:"]);
    if (!supportedProtocols.has(parsed.protocol)) {
        return "stream_url_protocol_unsupported";
    }
    return null;
}
function readAttribute(line, name) {
    const attributePattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, "i");
    const match = line.match(attributePattern);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}
function readDisplayName(line) {
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
function readInlineUrl(line) {
    const separator = line.indexOf(",");
    if (separator < 0) {
        return undefined;
    }
    const remainder = line.slice(separator + 1).trim();
    const inlineUrlMatch = remainder.match(/(?:https?|rtmp|rtsp|udp|srt):\/\/\S+/i);
    return inlineUrlMatch?.[0];
}
function parseM3uPlaylist(content) {
    const lines = content
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const channels = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line || !/^#EXTINF\b/i.test(line)) {
            continue;
        }
        let url = readInlineUrl(line);
        for (let j = index + 1; j < Math.min(lines.length, index + 6); j += 1) {
            const candidate = lines[j];
            if (/^#EXTINF\b/i.test(candidate ?? ""))
                break;
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
function normalizedMetadata(value) {
    return (value ?? "").trim().replace(/\s+/g, " ");
}
function metadataHash(value) {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}
function m3uExternalReference(entry, contentType, categoryReference) {
    const explicit = normalizedMetadata(entry.externalRef);
    if (explicit && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(explicit))
        return explicit;
    return metadataHash(`${contentType}:${normalizedMetadata(entry.tvgName) || normalizedMetadata(entry.name).toLowerCase()}:${categoryReference}`);
}
function m3uLocalId(kind, providerId, reference) {
    return `${kind}_${metadataHash(`${providerId}:${kind}:${reference}`)}`;
}
function classifyM3uEntry(entry) {
    const text = `${normalizedMetadata(entry.contentHint)} ${normalizedMetadata(entry.groupName)} ${normalizedMetadata(entry.name)}`.toLowerCase();
    const explicitMovie = /(^|\b)(movie|movies|film|films|vod)(\b|$)/i.test(text);
    const explicitSeries = /(^|\b)(series|show|shows|tv series)(\b|$)/i.test(text);
    const episodePattern = /\bS(\d{1,3})\s*E(\d{1,3})\b/i.exec(entry.name) ?? /\b(\d{1,3})x(\d{1,3})\b/i.exec(entry.name);
    const seasonNumber = entry.seasonNumber ?? (episodePattern ? Number(episodePattern[1]) : undefined);
    const episodeNumber = entry.episodeNumber ?? (episodePattern ? Number(episodePattern[2]) : undefined);
    if (explicitSeries) {
        return {
            contentType: "series",
            seriesName: normalizedMetadata(entry.tvgName) || entry.name.replace(/\s*[Ss]\d{1,3}\s*[Ee]\d{1,3}.*$/, "").trim(),
            ...(seasonNumber !== undefined ? { seasonNumber } : {}),
            ...(episodeNumber !== undefined ? { episodeNumber } : {})
        };
    }
    if (explicitMovie)
        return { contentType: "movie" };
    return { contentType: "live" };
}
function normalizeXtreamUrl(baseUrl) {
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
    }
    catch {
        return { url: "", error: "Enter a valid HTTP/HTTPS Xtream server URL." };
    }
}
function buildXtreamEndpointCandidates(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/$/, "");
    if (!trimmed) {
        return [];
    }
    const candidates = new Set();
    candidates.add(trimmed);
    candidates.add(`${trimmed}/player_api.php`);
    candidates.add(`${trimmed}/api.php`);
    candidates.add(`${trimmed}/get.php`);
    return Array.from(candidates);
}
function buildXtreamUrl(baseUrl, params) {
    const normalizedBase = baseUrl.trim().replace(/\/$/, "");
    const candidateBase = normalizedBase.endsWith("/player_api.php") || normalizedBase.endsWith("/get.php") || normalizedBase.endsWith("/api.php")
        ? normalizedBase
        : `${normalizedBase}/player_api.php`;
    const url = new URL(candidateBase);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}
async function fetchTextWithTimeout(input, init = {}, timeoutMs = 60_000) {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        const text = await response.text();
        return { response, text };
    }
    finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abortFromExternal);
    }
}
function unwrapXtreamArray(payload, key) {
    if (Array.isArray(payload))
        return payload;
    if (payload && typeof payload === "object" && Array.isArray(payload[key])) {
        return payload[key];
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
        return payload.data;
    }
    return null;
}
function readXtreamExpiry(payload) {
    if (!payload || typeof payload !== "object")
        return null;
    const userInfo = payload.user_info;
    if (!userInfo || typeof userInfo !== "object")
        return null;
    const rawExpiry = userInfo.exp_date;
    if (rawExpiry === undefined || rawExpiry === null || rawExpiry === "")
        return null;
    const numericExpiry = Number(rawExpiry);
    if (Number.isFinite(numericExpiry) && numericExpiry > 0) {
        return new Date(numericExpiry < 10_000_000_000 ? numericExpiry * 1000 : numericExpiry).toISOString();
    }
    const parsedExpiry = new Date(String(rawExpiry));
    return Number.isNaN(parsedExpiry.getTime()) ? null : parsedExpiry.toISOString();
}
function isXtreamAuthFailure(payload) {
    if (!payload || typeof payload !== "object")
        return false;
    const userInfo = payload.user_info;
    if (!userInfo || typeof userInfo !== "object")
        return false;
    const info = userInfo;
    return info.auth === 0 || String(info.auth).toLowerCase() === "false" || ["disabled", "expired", "banned"].includes(String(info.status ?? "").toLowerCase());
}
function buildRequestInit(signal, init = {}) {
    const nextInit = { ...init };
    if (signal) {
        nextInit.signal = signal;
    }
    return nextInit;
}
async function testXtreamConnection(baseUrl, username, password, signal) {
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
            const response = await fetch(buildXtreamUrl(candidate, { username, password }), buildRequestInit(signal, { headers: { accept: "application/json" } }));
            lastStatusCode = response.status;
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    authFailureCount += 1;
                }
                continue;
            }
            const text = await response.text();
            if (!text.trim()) {
                malformedResponse = true;
                continue;
            }
            const payload = JSON.parse(text);
            if (isXtreamAuthFailure(payload)) {
                authFailureCount += 1;
                continue;
            }
            if (payload && typeof payload === "object") {
                return {
                    ok: true,
                    statusCode: response.status,
                    expiresAt: readXtreamExpiry(payload),
                    message: "Connected — credentials accepted."
                };
            }
            malformedResponse = true;
        }
        catch (error) {
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
async function fetchXtreamLiveChannels(baseUrl, username, password, signal) {
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
    const records = unwrapXtreamArray(payload, "streams") ?? [];
    return records.flatMap((entry) => {
        const id = entry.stream_id === undefined ? "" : String(entry.stream_id);
        const name = String(entry.name ?? entry.stream_name ?? "").trim();
        if (!id || !name) {
            return [];
        }
        const streamUrl = entry.stream_url && /^https?:\/\//i.test(entry.stream_url)
            ? entry.stream_url
            : `${normalized.url.replace(/\/$/, "")}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(id)}.${entry.container_extension ? String(entry.container_extension).replace(/^\./, "") : "m3u8"}`;
        return [{
                name,
                url: streamUrl,
                externalRef: id,
                groupName: entry.category_id ? String(entry.category_id) : undefined
            }];
    });
}
function safeExternalReference(value, fallback) {
    const candidate = String(value ?? "").trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate))
        return candidate;
    return crypto.createHash("sha256").update(fallback).digest("hex").slice(0, 32);
}
function localCatalogueId(kind, providerId, externalReference) {
    return `${kind}_${crypto.createHash("sha256").update(`${providerId}:${kind}:${externalReference}`).digest("hex").slice(0, 32)}`;
}
function readObjectArray(payload, key) {
    return unwrapXtreamArray(payload, key) ?? [];
}
async function fetchXtreamJson(baseUrl, username, password, action, signal, extra = {}) {
    const normalized = normalizeXtreamUrl(baseUrl);
    if (normalized.error)
        throw new Error("Xtream base URL is invalid.");
    const response = await fetch(buildXtreamUrl(normalized.url, { username, password, action, ...extra }), buildRequestInit(signal, { headers: { accept: "application/json" } }));
    if (!response.ok)
        throw new Error(`Xtream request failed with status ${response.status}.`);
    const text = await response.text();
    if (!text.trim())
        throw new Error("Xtream returned an empty response.");
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error("Xtream returned malformed JSON.");
    }
}
function categoryInput(providerId, category, contentType) {
    const externalReference = safeExternalReference(category.category_id, `${contentType}:${category.category_name ?? category.name ?? ""}`);
    return {
        id: localCatalogueId("category", providerId, `${contentType}:${externalReference}`),
        providerAccountId: providerId,
        externalReference,
        name: String(category.category_name ?? category.name ?? "Unnamed category").trim(),
        contentType,
        sortOrder: null,
        status: "active"
    };
}
function movieInput(providerId, movie, categoryId) {
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
        contentType: "movie",
        status: "active"
    };
}
function seriesInput(providerId, series, categoryId) {
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
        status: "active"
    };
}
function normalizeEpgTimestamp(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function epgChannelExternalReference(channel) {
    return safeExternalReference(channel.epg_channel_id ?? channel.channel_id ?? channel.id, `epg-channel:${channel.name ?? channel.epg_name ?? ""}`);
}
function epgChannelInput(providerId, channel, linkedChannelId) {
    const externalReference = epgChannelExternalReference(channel);
    return {
        id: localCatalogueId("epg_channel", providerId, externalReference),
        providerAccountId: providerId,
        externalReference,
        channelId: linkedChannelId,
        name: String(channel.name ?? channel.epg_name ?? "Unnamed EPG channel").trim(),
        logoUrl: channel.logo ?? channel.logo_url ?? null,
        status: "active"
    };
}
function epgProgrammeInput(providerId, epgChannelId, channelExternalReference, programme) {
    const startAt = normalizeEpgTimestamp(programme.start ?? programme.start_time ?? programme.start_timestamp);
    const endAt = normalizeEpgTimestamp(programme.end ?? programme.end_time ?? programme.stop_timestamp);
    if (!startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime())
        return null;
    const title = String(programme.title ?? programme.name ?? "").trim();
    if (!title)
        return null;
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
        metadataJson: null,
        status: "active"
    };
}
function makeChannelInput(providerId, channel) {
    return {
        providerAccountId: providerId,
        externalReference: channel.externalRef ?? null,
        name: channel.name,
        groupName: channel.groupName ?? null,
        logoUrl: null,
        playbackUrl: channel.url,
        contentType: "live",
        status: "active"
    };
}
export class DesktopIptvRuntime {
    storage;
    credentials;
    operationSnapshots = new Map();
    operationControllers = new Map();
    constructor(storage, credentials) {
        this.storage = storage;
        this.credentials = credentials;
    }
    async startXtreamCatalogueSync(providerId) {
        return this.startOperation("xtream_catalogue_sync", { providerId });
    }
    async startM3uCatalogueSync(providerId) {
        return this.startOperation("m3u_catalogue_sync", { providerId });
    }
    async startEpgSync(providerId) {
        return this.startOperation("xtream_epg_sync", { providerId });
    }
    async validateProvider(input) {
        const provider = input.providerId ? this.storage.getProviderAccount(input.providerId) : null;
        const resolvedType = (input.type && input.type !== "manual") ? input.type : provider?.type ?? "manual";
        const baseUrl = (input.baseUrl ?? provider?.baseUrl ?? "").trim();
        if (!baseUrl) {
            return { ok: false, message: "Base URL is required." };
        }
        if (resolvedType === "xtream") {
            if (!provider) {
                return { ok: false, message: "provider_not_found" };
            }
            const providerCredentials = this.credentials.get(provider.credentialStoreRef);
            if (!providerCredentials?.username || !providerCredentials.password) {
                return { ok: false, message: "Xtream providers require both username and password." };
            }
            return testXtreamConnection(baseUrl, providerCredentials.username, providerCredentials.password);
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
    async validateProviderById(providerId) {
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
    async startOperation(type, input = {}) {
        const providerAccountId = input.providerId ?? null;
        const operation = {
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
            providerAccountId
        };
        this.operationSnapshots.set(operation.id, operation);
        this.persistSnapshot(operation);
        const controller = new AbortController();
        this.operationControllers.set(operation.id, controller);
        void this.runOperation(operation.id, type, input, controller.signal);
        return { ...operation };
    }
    async getOperation(operationId) {
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
    async cancelOperation(operationId) {
        const snapshot = this.operationSnapshots.get(operationId);
        if (!snapshot) {
            const stored = this.storage.getOperation(operationId);
            if (!stored) {
                return null;
            }
            const operation = this.buildOperationResponse(stored);
            if (["completed", "failed", "timeout", "cancelled", "interrupted"].includes(operation.status)) {
                return operation;
            }
            const cancelled = {
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
        if (["completed", "failed", "timeout", "cancelled", "interrupted"].includes(snapshot.status)) {
            return { ...snapshot };
        }
        this.operationControllers.get(operationId)?.abort();
        const cancelled = {
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
    async runOperation(operationId, type, input, signal) {
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
                    for (const channel of valid) {
                        if (signal.aborted) {
                            break;
                        }
                        this.storage.upsertChannel(makeChannelInput(providerId, channel));
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
                        processed: valid.length,
                        succeeded: valid.length,
                        failed: Math.max(0, parsed.length - valid.length),
                        currentStage: "completed",
                        currentMessage: `${valid.length} channels imported.`
                    });
                    break;
                }
                case "m3u_catalogue_sync": {
                    const providerId = input.providerId;
                    if (!providerId)
                        throw new Error("provider_id_required");
                    const provider = this.storage.getProviderAccount(providerId);
                    if (!provider)
                        throw new Error("provider_not_found");
                    if (provider.type !== "m3u")
                        throw new Error("m3u_provider_required");
                    const response = await fetchTextWithTimeout(normalizePlaylistUrl(provider.baseUrl), { method: "GET", signal }, 60_000);
                    if (!response.response.ok)
                        throw new Error(`Provider returned HTTP ${response.response.status}.`);
                    const parsed = parseM3uPlaylist(response.text);
                    const valid = parsed.filter((entry) => !validateHttpStreamUrl(entry.url));
                    if (valid.length === 0)
                        throw new Error("M3U catalogue produced zero usable entries.");
                    await this.syncM3uCatalogue(operationId, providerId, valid, valid.length === parsed.length, signal);
                    if (signal.aborted)
                        throw new Error("operation_cancelled");
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
                    if (!providerId)
                        throw new Error("provider_id_required");
                    const provider = this.storage.getProviderAccount(providerId);
                    if (!provider)
                        throw new Error("provider_not_found");
                    if (provider.type !== "xtream")
                        throw new Error("xtream_provider_required");
                    const providerCredentials = this.credentials.get(provider.credentialStoreRef);
                    if (!providerCredentials)
                        throw new Error("stored_xtream_credentials_required");
                    await this.syncXtreamCatalogue(operationId, providerId, provider.baseUrl, providerCredentials.username, providerCredentials.password, signal);
                    if (signal.aborted)
                        throw new Error("operation_cancelled");
                    this.updateOperation(operationId, {
                        status: "completed",
                        currentStage: "completed",
                        currentMessage: "Xtream catalogue synchronized."
                    });
                    break;
                }
                case "xtream_epg_sync": {
                    const providerId = input.providerId;
                    if (!providerId)
                        throw new Error("provider_id_required");
                    const provider = this.storage.getProviderAccount(providerId);
                    if (!provider)
                        throw new Error("provider_not_found");
                    if (provider.type !== "xtream")
                        throw new Error("xtream_provider_required");
                    const providerCredentials = this.credentials.get(provider.credentialStoreRef);
                    if (!providerCredentials)
                        throw new Error("stored_xtream_credentials_required");
                    await this.syncXtreamEpg(operationId, providerId, provider.baseUrl, providerCredentials.username, providerCredentials.password, signal);
                    if (signal.aborted)
                        throw new Error("operation_cancelled");
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateOperation(operationId, {
                status: signal.aborted ? "cancelled" : "failed",
                currentStage: signal.aborted ? "cancelled" : "failed",
                currentMessage: signal.aborted ? "Operation cancelled." : message,
                ...(signal.aborted ? {} : { error: message }),
                cancelled: signal.aborted
            });
        }
        finally {
            this.operationControllers.delete(operationId);
            this.operationSnapshots.delete(operationId);
        }
    }
    async syncXtreamCatalogue(operationId, providerId, baseUrl, username, password, signal) {
        const assertActive = () => {
            if (signal.aborted)
                throw new Error("operation_cancelled");
        };
        const increment = (message) => {
            const current = this.operationSnapshots.get(operationId);
            if (!current)
                return;
            this.updateOperation(operationId, {
                processed: current.processed + 1,
                succeeded: current.succeeded + 1,
                currentStage: "persisting_catalogue",
                currentMessage: message
            });
        };
        this.updateOperation(operationId, { currentStage: "fetching_categories", currentMessage: "Fetching Xtream categories." });
        const liveCategories = readObjectArray(await fetchXtreamJson(baseUrl, username, password, "get_live_categories", signal), "categories");
        assertActive();
        const vodCategories = readObjectArray(await fetchXtreamJson(baseUrl, username, password, "get_vod_categories", signal), "categories");
        assertActive();
        const categoryIds = new Map();
        const seenCategoryIds = new Set();
        for (const category of [...liveCategories.map((item) => ({ item, type: "live" })), ...vodCategories.map((item) => ({ item, type: "movie" }))]) {
            if (!category.item.category_id && !category.item.category_name && !category.item.name)
                throw new Error("Xtream category missing identity.");
            const input = categoryInput(providerId, category.item, category.type);
            const persisted = this.storage.upsertCategory(input);
            categoryIds.set(`${category.type}:${input.externalReference}`, persisted.id);
            seenCategoryIds.add(persisted.id);
            increment("Xtream category persisted.");
        }
        this.updateOperation(operationId, { currentStage: "fetching_movies", currentMessage: "Fetching Xtream movies." });
        const movies = readObjectArray(await fetchXtreamJson(baseUrl, username, password, "get_vod_streams", signal), "streams");
        assertActive();
        const seenMovieIds = new Set();
        for (const movie of movies) {
            if (movie.stream_id === undefined && !movie.name && !movie.stream_name)
                throw new Error("Xtream movie missing identity.");
            const externalReference = safeExternalReference(movie.stream_id, `movie:${movie.name ?? movie.stream_name ?? ""}`);
            const categoryId = movie.category_id === undefined ? null : categoryIds.get(`movie:${safeExternalReference(movie.category_id, `movie-category:${movie.category_id}`)}`) ?? null;
            const persisted = this.storage.upsertMovie(movieInput(providerId, movie, categoryId));
            seenMovieIds.add(persisted.id);
            increment("Xtream movie persisted.");
        }
        this.updateOperation(operationId, { currentStage: "fetching_series", currentMessage: "Fetching Xtream series." });
        const seriesRecords = readObjectArray(await fetchXtreamJson(baseUrl, username, password, "get_series", signal), "series");
        assertActive();
        const seenSeriesIds = new Set();
        const seenSeasonIds = new Set();
        const seenEpisodeIds = new Set();
        for (const seriesRecord of seriesRecords) {
            if (seriesRecord.series_id === undefined && !seriesRecord.name)
                throw new Error("Xtream series missing identity.");
            const seriesExternalReference = safeExternalReference(seriesRecord.series_id, `series:${seriesRecord.name ?? ""}`);
            const categoryId = seriesRecord.category_id === undefined ? null : categoryIds.get(`movie:${safeExternalReference(seriesRecord.category_id, `series-category:${seriesRecord.category_id}`)}`) ?? null;
            const persistedSeries = this.storage.upsertSeries(seriesInput(providerId, seriesRecord, categoryId));
            seenSeriesIds.add(persistedSeries.id);
            increment("Xtream series persisted.");
            assertActive();
            const detail = await fetchXtreamJson(baseUrl, username, password, "get_series_info", signal, { series_id: seriesExternalReference });
            const detailRecord = detail && typeof detail === "object" ? detail : {};
            const rawEpisodes = detailRecord.episodes;
            const episodeGroups = rawEpisodes && typeof rawEpisodes === "object" && !Array.isArray(rawEpisodes)
                ? Object.entries(rawEpisodes).map(([seasonNumber, entries]) => ({ seasonNumber, entries: Array.isArray(entries) ? entries : [] }))
                : Array.isArray(rawEpisodes) ? [{ seasonNumber: "0", entries: rawEpisodes }] : [];
            const rawSeasons = Array.isArray(detailRecord.seasons) ? detailRecord.seasons : [];
            const seasonNumbers = new Set([...episodeGroups.map((group) => group.seasonNumber), ...rawSeasons.map((season) => String(season.season_num ?? "0"))]);
            for (const seasonNumber of seasonNumbers) {
                const seasonRecord = rawSeasons.find((season) => String(season.season_num ?? "0") === seasonNumber);
                const seasonExternalReference = safeExternalReference(seasonRecord?.id ?? seasonRecord?.season_id, `${seriesExternalReference}:season:${seasonNumber}`);
                const seasonInput = {
                    id: localCatalogueId("season", providerId, `${seriesExternalReference}:${seasonExternalReference}`),
                    providerAccountId: providerId,
                    seriesId: persistedSeries.id,
                    externalReference: seasonExternalReference,
                    seasonNumber: Number.isFinite(Number(seasonNumber)) ? Number(seasonNumber) : null,
                    name: seasonRecord?.name ?? null,
                    status: "active"
                };
                const persistedSeason = this.storage.upsertSeason(seasonInput);
                seenSeasonIds.add(persistedSeason.id);
                increment("Xtream season persisted.");
                const group = episodeGroups.find((candidate) => candidate.seasonNumber === seasonNumber);
                for (const episode of group?.entries ?? []) {
                    const episodeExternalReference = safeExternalReference(episode.id ?? episode.episode_id, `${seriesExternalReference}:${seasonNumber}:${episode.episode_num ?? episode.name ?? ""}`);
                    const episodeInput = {
                        id: localCatalogueId("episode", providerId, `${seriesExternalReference}:${episodeExternalReference}`),
                        providerAccountId: providerId,
                        seriesId: persistedSeries.id,
                        seasonId: persistedSeason.id,
                        externalReference: episodeExternalReference,
                        episodeNumber: episode.episode_num == null ? null : Number(episode.episode_num),
                        name: episode.title ?? episode.name ?? null,
                        description: episode.info?.plot ?? episode.info?.description ?? null,
                        logoUrl: episode.info?.movie_image ?? episode.info?.cover_big ?? episode.movie_image ?? episode.cover_big ?? null,
                        status: "active"
                    };
                    const persistedEpisode = this.storage.upsertEpisode(episodeInput);
                    seenEpisodeIds.add(persistedEpisode.id);
                    increment("Xtream episode persisted.");
                }
            }
        }
        assertActive();
        this.updateOperation(operationId, { currentStage: "archiving_stale", currentMessage: "Archiving stale Xtream catalogue records." });
        for (const category of this.storage.listCategories(providerId))
            if (!seenCategoryIds.has(category.id))
                this.storage.archiveCategory(category.id);
        for (const movie of this.storage.listMovies(providerId))
            if (!seenMovieIds.has(movie.id))
                this.storage.archiveMovie(movie.id);
        for (const series of this.storage.listSeries(providerId))
            if (!seenSeriesIds.has(series.id))
                this.storage.archiveSeries(series.id);
        for (const season of this.storage.listSeasons(providerId))
            if (!seenSeasonIds.has(season.id))
                this.storage.archiveSeason(season.id);
        for (const episode of this.storage.listEpisodes(providerId))
            if (!seenEpisodeIds.has(episode.id))
                this.storage.archiveEpisode(episode.id);
    }
    async syncM3uCatalogue(operationId, providerId, entries, complete, signal) {
        const seenCategories = new Set();
        const seenMovies = new Set();
        const seenSeries = new Set();
        const seenSeasons = new Set();
        const seenEpisodes = new Set();
        let processed = 0;
        let skipped = 0;
        this.updateOperation(operationId, {
            total: entries.length,
            currentStage: "persisting_m3u_catalogue",
            currentMessage: "Classifying M3U catalogue entries."
        });
        for (const entry of entries) {
            if (signal.aborted)
                throw new Error("operation_cancelled");
            const classification = classifyM3uEntry(entry);
            const categoryName = normalizedMetadata(entry.groupName);
            const categoryId = categoryName
                ? m3uLocalId("category", providerId, `${classification.contentType}:${categoryName.toLowerCase()}`)
                : null;
            if (categoryName) {
                const category = this.storage.upsertCategory({
                    id: categoryId,
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
            }
            else if (classification.contentType === "series") {
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
                }
                else {
                    skipped += 1;
                }
            }
            processed += 1;
            this.updateOperation(operationId, {
                processed,
                succeeded: processed - skipped,
                skipped,
                currentStage: "persisting_m3u_catalogue",
                currentMessage: `${processed} M3U entries processed.`
            });
        }
        if (!complete || skipped > 0)
            return;
        this.updateOperation(operationId, { currentStage: "archiving_stale_m3u_catalogue", currentMessage: "Archiving stale M3U catalogue records." });
        for (const category of this.storage.listCategories(providerId))
            if (!seenCategories.has(category.id))
                this.storage.archiveCategory(category.id);
        for (const movie of this.storage.listMovies(providerId))
            if (!seenMovies.has(movie.id))
                this.storage.archiveMovie(movie.id);
        for (const series of this.storage.listSeries(providerId))
            if (!seenSeries.has(series.id))
                this.storage.archiveSeries(series.id);
        for (const season of this.storage.listSeasons(providerId))
            if (!seenSeasons.has(season.id))
                this.storage.archiveSeason(season.id);
        for (const episode of this.storage.listEpisodes(providerId))
            if (!seenEpisodes.has(episode.id))
                this.storage.archiveEpisode(episode.id);
    }
    async syncXtreamEpg(operationId, providerId, baseUrl, username, password, signal) {
        const assertActive = () => {
            if (signal.aborted)
                throw new Error("operation_cancelled");
        };
        const channels = this.storage.listChannels(providerId);
        const seenChannelIds = new Set();
        const seenProgrammeIds = new Set();
        let invalidRecords = 0;
        this.updateOperation(operationId, { currentStage: "fetching_epg_channels", currentMessage: "Fetching Xtream EPG channels." });
        const channelPayload = await fetchXtreamJson(baseUrl, username, password, "get_epg_channels", signal);
        const providerChannels = readObjectArray(channelPayload, "epg_list");
        if (!Array.isArray(providerChannels))
            throw new Error("Xtream EPG channels response was invalid.");
        for (const providerChannel of providerChannels) {
            assertActive();
            const externalReference = epgChannelExternalReference(providerChannel);
            const name = String(providerChannel.name ?? providerChannel.epg_name ?? "").trim();
            if (!name) {
                invalidRecords += 1;
                continue;
            }
            const linkedChannel = channels.find((channel) => (providerChannel.channel_id !== undefined && channel.externalReference === String(providerChannel.channel_id)) ||
                (providerChannel.stream_id !== undefined && channel.externalReference === String(providerChannel.stream_id)) ||
                channel.name === name);
            const persistedChannel = this.storage.upsertEpgChannel(epgChannelInput(providerId, providerChannel, linkedChannel?.id ?? null));
            seenChannelIds.add(persistedChannel.id);
            const streamReference = providerChannel.stream_id ?? providerChannel.channel_id ?? providerChannel.epg_channel_id ?? providerChannel.id;
            if (streamReference === undefined) {
                invalidRecords += 1;
                continue;
            }
            this.updateOperation(operationId, { processed: this.operationSnapshots.get(operationId)?.processed ?? 0, currentStage: "fetching_epg_programmes", currentMessage: `Fetching EPG for ${name}.` });
            const programmePayload = await fetchXtreamJson(baseUrl, username, password, "get_short_epg", signal, { stream_id: String(streamReference) });
            const programmes = readObjectArray(programmePayload, "epg_list");
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
        for (const channel of this.storage.listEpgChannels(providerId))
            if (!seenChannelIds.has(channel.id))
                this.storage.archiveEpgChannel(channel.id);
        for (const programme of this.storage.listEpgProgrammes(providerId))
            if (!seenProgrammeIds.has(programme.id))
                this.storage.archiveEpgProgramme(programme.id);
    }
    updateOperation(operationId, patch) {
        const current = this.operationSnapshots.get(operationId) ?? this.buildOperationResponse(this.storage.getOperation(operationId) ?? undefined);
        if (!current) {
            return;
        }
        const next = { ...current, ...patch };
        this.operationSnapshots.set(operationId, next);
        this.persistSnapshot(next);
    }
    persistSnapshot(operation) {
        const persisted = {
            id: operation.id,
            providerAccountId: operation.providerAccountId ?? null,
            operationType: operation.type,
            status: operation.status,
            processed: operation.processed,
            succeeded: operation.succeeded,
            failed: operation.failed,
            checkpoint: JSON.stringify({ currentStage: operation.currentStage, currentMessage: operation.currentMessage }),
            cancellationRequested: operation.cancelled,
            error: operation.error ?? null
        };
        this.storage.upsertOperation(persisted);
    }
    buildOperationResponse(operation) {
        const jsonCheckpoint = operation?.checkpoint ? (() => {
            try {
                return JSON.parse(operation.checkpoint);
            }
            catch {
                return undefined;
            }
        })() : undefined;
        const response = {
            id: operation?.id ?? `iptv_${crypto.randomUUID()}`,
            type: operation?.operationType ?? "m3u_validation",
            status: operation?.status ?? "queued",
            startedAt: operation?.createdAt ?? nowIso(),
            processed: operation?.processed ?? 0,
            succeeded: operation?.succeeded ?? 0,
            updated: 0,
            skipped: 0,
            failed: operation?.failed ?? 0,
            currentStage: jsonCheckpoint?.currentStage ?? "queued",
            currentMessage: jsonCheckpoint?.currentMessage ?? operation?.error ?? "Operation queued.",
            cancelled: operation?.cancellationRequested ?? false,
            providerAccountId: operation?.providerAccountId ?? null
        };
        if (operation?.error) {
            response.error = operation.error;
        }
        return response;
    }
}
