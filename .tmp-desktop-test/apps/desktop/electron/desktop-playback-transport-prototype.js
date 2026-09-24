import crypto from "node:crypto";
function nowIso(clock) {
    return new Date(clock()).toISOString();
}
function assertSafeStartRequest(input) {
    if (!input || typeof input !== "object")
        throw new Error("playback_request_invalid");
    const keys = Object.keys(input);
    if (keys.some((key) => !["entityType", "entityId"].includes(key)))
        throw new Error("playback_request_field_not_allowed");
    const request = input;
    if (request.entityType !== "movie" && request.entityType !== "episode")
        throw new Error("playback_entity_type_invalid");
    if (typeof request.entityId !== "string" || !request.entityId.trim())
        throw new Error("playback_entity_id_required");
}
function safeSessionId() {
    return crypto.randomBytes(32).toString("base64url");
}
function entityExternalReference(entity) {
    const value = entity.externalReference?.trim();
    if (!value)
        throw new Error("playback_identity_missing");
    return value;
}
function resolveM3uMatch(entity, entries) {
    const reference = entityExternalReference(entity);
    const matches = entries.filter((entry) => entry.externalReference === reference);
    if (matches.length === 0)
        throw new Error("m3u_playback_identity_not_found");
    if (matches.length !== 1)
        throw new Error("m3u_playback_identity_ambiguous");
    return matches[0];
}
export function createPlaybackTransportHandlers(transport) {
    return {
        start: (input) => transport.start(input),
        media: (sessionId) => transport.readMedia(String(sessionId)),
        cancel: (sessionId) => transport.cancel(String(sessionId))
    };
}
export class DesktopPlaybackTransportPrototype {
    storage;
    credentials;
    resolver;
    sessions = new Map();
    sources = new Map();
    chunkIndexes = new Map();
    clock;
    sessionLifetimeMs;
    constructor(storage, credentials, resolver, options = {}) {
        this.storage = storage;
        this.credentials = credentials;
        this.resolver = resolver;
        this.clock = options.clock ?? (() => Date.now());
        this.sessionLifetimeMs = options.sessionLifetimeMs ?? 60_000;
    }
    async start(input) {
        assertSafeStartRequest(input);
        const entity = input.entityType === "movie"
            ? this.storage.getMovie(input.entityId)
            : this.storage.getEpisode(input.entityId);
        if (!entity)
            throw new Error("playback_entity_not_found");
        const provider = this.storage.getProviderAccount(entity.providerAccountId);
        if (!provider)
            throw new Error("playback_provider_not_found");
        const credentials = this.credentials.get(provider.credentialStoreRef);
        if (!credentials)
            throw new Error("playback_credentials_unavailable");
        const context = { provider, credentials, entity, entityType: input.entityType };
        const source = provider.type === "m3u"
            ? await this.resolveM3u(context)
            : await this.resolver.resolveXtream(context);
        const createdAt = this.clock();
        const session = {
            sessionId: safeSessionId(),
            entityType: input.entityType,
            entityId: input.entityId,
            providerAccountId: provider.id,
            createdAt: new Date(createdAt).toISOString(),
            expiresAt: new Date(createdAt + this.sessionLifetimeMs).toISOString(),
            status: "active"
        };
        this.sessions.set(session.sessionId, session);
        this.sources.set(session.sessionId, source);
        this.chunkIndexes.set(session.sessionId, 0);
        return { ...session };
    }
    async readMedia(sessionId) {
        const session = this.requireActive(sessionId);
        const source = this.sources.get(session.sessionId);
        if (!source)
            throw new Error("playback_source_unavailable");
        const index = this.chunkIndexes.get(session.sessionId) ?? 0;
        const data = source.chunks[index];
        if (!data)
            return { sessionId, sequence: index, data: new Uint8Array(), done: true };
        this.chunkIndexes.set(session.sessionId, index + 1);
        return { sessionId, sequence: index, data: new Uint8Array(data), done: index + 1 >= source.chunks.length };
    }
    cancel(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        session.status = "cancelled";
        this.sources.delete(sessionId);
        this.chunkIndexes.delete(sessionId);
        return true;
    }
    shutdown() {
        this.sessions.clear();
        this.sources.clear();
        this.chunkIndexes.clear();
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        if (this.isExpired(session)) {
            this.expire(session);
            return null;
        }
        return { ...session, status: "active" };
    }
    async resolveM3u(context) {
        const entries = await this.resolver.fetchM3u(context);
        const match = resolveM3uMatch(context.entity, entries);
        return this.resolver.resolveM3u(context, match);
    }
    requireActive(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error("playback_session_not_found");
        if (this.isExpired(session)) {
            this.expire(session);
            throw new Error("playback_session_expired");
        }
        if (session.status !== "active")
            throw new Error("playback_session_inactive");
        return session;
    }
    isExpired(session) {
        return this.clock() >= Date.parse(session.expiresAt);
    }
    expire(session) {
        session.status = "expired";
        this.sources.delete(session.sessionId);
        this.chunkIndexes.delete(session.sessionId);
    }
}
export function describePlaybackSession(session) {
    return {
        sessionId: session.sessionId,
        entityType: session.entityType,
        entityId: session.entityId,
        providerAccountId: session.providerAccountId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        status: session.status
    };
}
export function safePlaybackError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /^(playback_|m3u_playback_)/.test(message) ? message : "playback_failed";
}
export function playbackSessionNow(session) {
    return nowIso(() => Date.parse(session.createdAt));
}
