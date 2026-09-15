import crypto from "node:crypto";
import type { CredentialStore } from "./credential-store.js";
import type { DesktopMovie, DesktopEpisode, DesktopProviderAccount } from "../src/desktop-persistence-contract.js";
import type { DesktopSqliteStore } from "./desktop-storage.js";

export type PlaybackEntityType = "movie" | "episode";
export type PlaybackSessionStatus = "active" | "cancelled" | "expired";

export type PlaybackStartRequest = {
  entityType: PlaybackEntityType;
  entityId: string;
};

export type PlaybackSessionView = {
  sessionId: string;
  entityType: PlaybackEntityType;
  entityId: string;
  providerAccountId: string;
  createdAt: string;
  expiresAt: string;
  status: PlaybackSessionStatus;
};

export type PlaybackMediaEvent = {
  sessionId: string;
  sequence: number;
  data: Uint8Array;
  done: boolean;
};

type PlaybackSession = PlaybackSessionView & { status: PlaybackSessionStatus };
type CatalogueEntity = DesktopMovie | DesktopEpisode;
type FixtureM3uEntry = {
  externalReference: string;
  name: string;
  groupName?: string;
  sourceUrl: string;
};
type InternalPlaybackSource = {
  chunks: Uint8Array[];
};
type ResolverContext = {
  provider: DesktopProviderAccount;
  credentials: { username: string; password: string };
  entity: CatalogueEntity;
  entityType: PlaybackEntityType;
};

export interface PlaybackSourceResolver {
  resolveXtream(context: ResolverContext): Promise<InternalPlaybackSource>;
  fetchM3u(context: ResolverContext): Promise<FixtureM3uEntry[]>;
  resolveM3u(context: ResolverContext, entry: FixtureM3uEntry): Promise<InternalPlaybackSource>;
}

function nowIso(clock: () => number) {
  return new Date(clock()).toISOString();
}

function assertSafeStartRequest(input: unknown): asserts input is PlaybackStartRequest {
  if (!input || typeof input !== "object") throw new Error("playback_request_invalid");
  const keys = Object.keys(input as Record<string, unknown>);
  if (keys.some((key) => !["entityType", "entityId"].includes(key))) throw new Error("playback_request_field_not_allowed");
  const request = input as Record<string, unknown>;
  if (request.entityType !== "movie" && request.entityType !== "episode") throw new Error("playback_entity_type_invalid");
  if (typeof request.entityId !== "string" || !request.entityId.trim()) throw new Error("playback_entity_id_required");
}

function safeSessionId() {
  return crypto.randomBytes(32).toString("base64url");
}

function entityExternalReference(entity: CatalogueEntity) {
  const value = entity.externalReference?.trim();
  if (!value) throw new Error("playback_identity_missing");
  return value;
}

function resolveM3uMatch(entity: CatalogueEntity, entries: FixtureM3uEntry[]) {
  const reference = entityExternalReference(entity);
  const matches = entries.filter((entry) => entry.externalReference === reference);
  if (matches.length === 0) throw new Error("m3u_playback_identity_not_found");
  if (matches.length !== 1) throw new Error("m3u_playback_identity_ambiguous");
  return matches[0]!;
}

export function createPlaybackTransportHandlers(transport: DesktopPlaybackTransportPrototype) {
  return {
    start: (input: unknown) => transport.start(input),
    media: (sessionId: unknown) => transport.readMedia(String(sessionId)),
    cancel: (sessionId: unknown) => transport.cancel(String(sessionId))
  };
}

export class DesktopPlaybackTransportPrototype {
  private readonly sessions = new Map<string, PlaybackSession>();
  private readonly sources = new Map<string, InternalPlaybackSource>();
  private readonly chunkIndexes = new Map<string, number>();
  private readonly clock: () => number;
  private readonly sessionLifetimeMs: number;

  constructor(
    private readonly storage: DesktopSqliteStore,
    private readonly credentials: CredentialStore,
    private readonly resolver: PlaybackSourceResolver,
    options: { clock?: () => number; sessionLifetimeMs?: number } = {}
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.sessionLifetimeMs = options.sessionLifetimeMs ?? 60_000;
  }

  async start(input: unknown): Promise<PlaybackSessionView> {
    assertSafeStartRequest(input);
    const entity = input.entityType === "movie"
      ? this.storage.getMovie(input.entityId)
      : this.storage.getEpisode(input.entityId);
    if (!entity) throw new Error("playback_entity_not_found");
    const provider = this.storage.getProviderAccount(entity.providerAccountId);
    if (!provider) throw new Error("playback_provider_not_found");
    const credentials = this.credentials.get(provider.credentialStoreRef);
    if (!credentials) throw new Error("playback_credentials_unavailable");

    const context = { provider, credentials, entity, entityType: input.entityType } satisfies ResolverContext;
    const source = provider.type === "m3u"
      ? await this.resolveM3u(context)
      : await this.resolver.resolveXtream(context);
    const createdAt = this.clock();
    const session: PlaybackSession = {
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

  async readMedia(sessionId: string): Promise<PlaybackMediaEvent | null> {
    const session = this.requireActive(sessionId);
    const source = this.sources.get(session.sessionId);
    if (!source) throw new Error("playback_source_unavailable");
    const index = this.chunkIndexes.get(session.sessionId) ?? 0;
    const data = source.chunks[index];
    if (!data) return { sessionId, sequence: index, data: new Uint8Array(), done: true };
    this.chunkIndexes.set(session.sessionId, index + 1);
    return { sessionId, sequence: index, data: new Uint8Array(data), done: index + 1 >= source.chunks.length };
  }

  cancel(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
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

  getSession(sessionId: string): PlaybackSessionView | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (this.isExpired(session)) {
      this.expire(session);
      return null;
    }
    return { ...session, status: "active" };
  }

  private async resolveM3u(context: ResolverContext): Promise<InternalPlaybackSource> {
    const entries = await this.resolver.fetchM3u(context);
    const match = resolveM3uMatch(context.entity, entries);
    return this.resolver.resolveM3u(context, match);
  }

  private requireActive(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("playback_session_not_found");
    if (this.isExpired(session)) {
      this.expire(session);
      throw new Error("playback_session_expired");
    }
    if (session.status !== "active") throw new Error("playback_session_inactive");
    return session;
  }

  private isExpired(session: PlaybackSession) {
    return this.clock() >= Date.parse(session.expiresAt);
  }

  private expire(session: PlaybackSession) {
    session.status = "expired";
    this.sources.delete(session.sessionId);
    this.chunkIndexes.delete(session.sessionId);
  }
}

export function describePlaybackSession(session: PlaybackSessionView) {
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

export function safePlaybackError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^(playback_|m3u_playback_)/.test(message) ? message : "playback_failed";
}

export function playbackSessionNow(session: PlaybackSessionView) {
  return nowIso(() => Date.parse(session.createdAt));
}
