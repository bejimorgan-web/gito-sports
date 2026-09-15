import type { MatchAssignmentRequest, PublicationArtifact, PublicationArtifactSubmission } from "@gito/shared";
import type {
  DesktopChannel,
  DesktopPublicationSource,
  DesktopProviderAccount
} from "../../desktop-persistence-contract";

export type DesktopPublicationProviderLike = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  availability?: string;
  availabilityStatus?: string;
};

export type DesktopPublicationChannelLike = {
  id: string;
  providerAccountId?: string | null;
  externalReference?: string | null;
  name?: string;
  groupName?: string | null;
  logoUrl?: string | null;
  playbackUrl?: string;
  contentType?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LocalPublicationContext = {
  matchId: string;
  sourceReference?: string;
  publicationStatus?: PublicationArtifactSubmission["publicationStatus"];
  availability?: PublicationArtifactSubmission["availability"];
  expiresAt?: string | null;
  localSource?: {
    providerId?: string;
    channelId?: string;
    providerName?: string;
    channelName?: string;
    username?: string;
    password?: string;
    url?: string;
    streamUrl?: string;
    provider?: unknown;
    channel?: unknown;
    metadata?: unknown;
  };
};

export class CanonicalFixtureRequiredError extends Error {
  readonly code = "canonical_fixture_required";

  constructor() {
    super("Select a canonical fixture before publishing this match.");
    this.name = "CanonicalFixtureRequiredError";
  }
}

export class PublicationWorkflowError extends Error {
  constructor(readonly stage: "fixture_creation" | "stream_assignment" | "stream_approval" | "stream_publish" | "creation" | "bind" | "approval" | "publish", cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Publication ${stage} failed: ${detail}`);
    this.name = "PublicationWorkflowError";
  }
}

export function validateDirectPlaybackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("publication_playback_url_invalid");
  }

  if (url.protocol !== "https:") {
    throw new Error("publication_playback_url_requires_https");
  }
  if (url.username || url.password) {
    throw new Error("publication_playback_url_rejects_userinfo");
  }
  for (const key of ["token", "key", "password", "secret", "auth", "user"]) {
    if (url.searchParams.has(key)) {
      throw new Error(`publication_playback_url_rejects_${key}_query`);
    }
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const xtreamMediaKind = pathSegments[0]?.toLowerCase();
  if (["live", "movie", "series"].includes(xtreamMediaKind ?? "") && pathSegments.length >= 4) {
    throw new Error("publication_playback_url_rejects_xtream_credential_path");
  }

  return url.toString();
}

export function buildLegacyStreamAssignment(input: {
  canonicalFixtureId: string;
  sportName?: unknown;
  competitionName?: unknown;
  homeTeamName?: unknown;
  awayTeamName?: unknown;
  startsAt?: unknown;
  streamUrl: string;
  venueName?: unknown;
}): MatchAssignmentRequest {
  const assignment = {
    canonicalFixtureId: input.canonicalFixtureId,
    sportName: input.sportName,
    competitionName: input.competitionName,
    homeTeamName: input.homeTeamName,
    awayTeamName: input.awayTeamName,
    startsAt: input.startsAt,
    streamUrl: input.streamUrl,
    venueName: input.venueName
  };

  if (Object.entries(assignment).some(([key, value]) => key !== "venueName" && (typeof value !== "string" || !value.trim()))) {
    throw new Error("stream_assignment_fields_required");
  }

  return assignment as MatchAssignmentRequest;
}

export function resolvePublicationMatchId(input: { canonicalFixtureId?: unknown; matchId?: unknown }) {
  const candidate = [input.canonicalFixtureId, input.matchId].find((value) => typeof value === "string" && value.trim());
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new CanonicalFixtureRequiredError();
  }
  return candidate.trim();
}

export async function resolveOrCreatePublicationMatchId(
  input: {
    canonicalFixtureId?: unknown;
    matchId?: unknown;
    competitionId?: unknown;
    homeTeamId?: unknown;
    awayTeamId?: unknown;
    startsAt?: unknown;
  },
  createFixture: (fixture: { competitionId: string; homeTeamId: string; awayTeamId: string; startsAt: string }) => Promise<{ id: string }>
) {
  if (input.canonicalFixtureId || input.matchId) {
    return resolvePublicationMatchId(input);
  }

  const fixture = {
    competitionId: input.competitionId,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    startsAt: input.startsAt
  };
  if (Object.values(fixture).some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("publication_fixture_fields_required");
  }

  const created = await createFixture(fixture as { competitionId: string; homeTeamId: string; awayTeamId: string; startsAt: string });
  return resolvePublicationMatchId({ matchId: created.id });
}

function opaqueId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${randomUuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function safeSourceReference(value: string | undefined) {
  if (!value) return opaqueId("source");
  const reference = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)) {
    throw new Error("publication_source_reference_unsafe");
  }
  return reference;
}

export function buildSafePublicationPackage(context: LocalPublicationContext): PublicationArtifactSubmission {
  if (!context.matchId.trim()) throw new Error("publication_match_id_required");

  const localSource = context.localSource;
  if (localSource && [
    localSource.username,
    localSource.password,
    localSource.metadata && JSON.stringify(localSource.metadata),
  ].some((value) => typeof value === "string" && /(?:cookie|authorization|bearer|session|header|token|secret|password|credential)/i.test(value))) {
    throw new Error("publication_source_requires_secret_state");
  }

  return {
    schemaVersion: 1,
    publicationId: opaqueId("publication"),
    matchId: context.matchId,
    sourceReference: safeSourceReference(context.sourceReference),
    capability: "live",
    publicationStatus: context.publicationStatus ?? "draft",
    availability: context.availability ?? "ready",
    expiresAt: context.expiresAt ?? null
  };
}

export type DesktopPublicationFeedMatch = {
  id: string;
  competitionId?: string;
  seasonId?: string | null;
  homeTeamId?: string;
  awayTeamId?: string;
  startsAt?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  venueName?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  competitionName?: string | null;
  sportName?: string | null;
};

export type DesktopPublicationFeedEntry = {
  publication: PublicationArtifact;
  match: DesktopPublicationFeedMatch;
};

export type DesktopPublicationSourceContext = {
  publicationId: string;
  sourceReference: string;
  providerAccountId: string | null;
  channelId: string | null;
  provider: {
    id: string;
    name: string;
    type: string;
    status: string;
    availability: string;
  } | null;
  channel: {
    id: string;
    name: string;
    providerAccountId: string;
    contentType: string | null;
    status: string;
    groupName: string | null;
  } | null;
  hasLocalMapping: boolean;
  isResolved: boolean;
};

export type DesktopPublicationContext = {
  publication: PublicationArtifact;
  match: DesktopPublicationFeedMatch;
  source: DesktopPublicationSourceContext;
};

function safeProvider(provider: DesktopPublicationProviderLike | null | undefined) {
  if (!provider) return null;

  return {
    id: provider.id,
    name: provider.name,
    type: provider.type ?? "manual",
    status: provider.status ?? "active",
    availability: provider.availability ?? provider.availabilityStatus ?? "unknown"
  };
}

function safeChannel(channel: DesktopPublicationChannelLike | null | undefined) {
  if (!channel) return null;

  return {
    id: channel.id,
    name: channel.name ?? "Unknown channel",
    providerAccountId: channel.providerAccountId ?? "",
    contentType: channel.contentType ?? null,
    status: channel.status ?? "active",
    groupName: channel.groupName ?? null
  };
}

export function buildDesktopPublicationContexts(
  feed: DesktopPublicationFeedEntry[],
  publicationSources: DesktopPublicationSource[],
  providers: DesktopPublicationProviderLike[],
  channels: DesktopPublicationChannelLike[]
): DesktopPublicationContext[] {
  const sourcesByPublicationId = new Map(publicationSources.map((source) => [source.publicationId, source]));
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));

  return feed.map((entry) => {
    const sourceMapping = sourcesByPublicationId.get(entry.publication.publicationId) ?? null;
    const provider = sourceMapping?.providerAccountId
      ? providersById.get(sourceMapping.providerAccountId) ?? null
      : null;
    const channel = sourceMapping?.channelId
      ? channelsById.get(sourceMapping.channelId) ?? null
      : null;

    const resolved = Boolean(sourceMapping && provider && channel);

    return {
      publication: entry.publication,
      match: entry.match,
      source: {
        publicationId: entry.publication.publicationId,
        sourceReference: entry.publication.sourceReference,
        providerAccountId: sourceMapping?.providerAccountId ?? null,
        channelId: sourceMapping?.channelId ?? null,
        provider: safeProvider(provider),
        channel: safeChannel(channel),
        hasLocalMapping: Boolean(sourceMapping),
        isResolved: resolved
      }
    };
  });
}
