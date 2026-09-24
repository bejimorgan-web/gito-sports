function opaqueId(prefix) {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}_${randomUuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}
function safeSourceReference(value) {
    if (!value)
        return opaqueId("source");
    const reference = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)) {
        throw new Error("publication_source_reference_unsafe");
    }
    return reference;
}
export function buildSafePublicationPackage(context) {
    if (!context.matchId.trim())
        throw new Error("publication_match_id_required");
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
function safeProvider(provider) {
    if (!provider)
        return null;
    return {
        id: provider.id,
        name: provider.name,
        type: provider.type ?? "manual",
        status: provider.status ?? "active",
        availability: provider.availability ?? provider.availabilityStatus ?? "unknown"
    };
}
function safeChannel(channel) {
    if (!channel)
        return null;
    return {
        id: channel.id,
        name: channel.name ?? "Unknown channel",
        providerAccountId: channel.providerAccountId ?? "",
        contentType: channel.contentType ?? null,
        status: channel.status ?? "active",
        groupName: channel.groupName ?? null
    };
}
export function buildDesktopPublicationContexts(feed, publicationSources, providers, channels) {
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
