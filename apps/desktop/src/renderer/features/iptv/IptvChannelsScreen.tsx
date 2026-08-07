import { useMemo } from "react";
import type { Channel, IPTVProvider } from "@gito/shared";

interface IptvChannelsScreenProps {
  channels: Channel[];
  providers: IPTVProvider[];
  selectedChannelId: string | undefined;
  search: string;
  category: string;
  selectedProviderId: string;
  contentType: "all" | "live" | "movies" | "series";
  onSelectChannel: (channel: Channel) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onContentTypeChange: (value: "all" | "live" | "movies" | "series") => void;
}

export function IptvChannelsScreen({
  channels,
  providers,
  selectedChannelId,
  search,
  category,
  selectedProviderId,
  contentType,
  onSelectChannel,
  onSearchChange,
  onCategoryChange,
  onProviderFilterChange,
  onContentTypeChange
}: IptvChannelsScreenProps) {
  const visibleProviders = useMemo(() => providers.filter((provider) => provider.status === "active"), [providers]);
  const visibleProviderIds = useMemo(() => new Set(visibleProviders.map((provider) => provider.id)), [visibleProviders]);
  const filteredProvider = visibleProviders.find((provider) => provider.id === selectedProviderId);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const channel of channels) {
      if (!visibleProviderIds.has(channel.providerId)) continue;
      const group = channel.groupName?.trim() || "Uncategorized";
      set.add(group);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [channels, visibleProviderIds]);

  const contentTypeMatches = (channel: Channel) => {
    if (contentType === "all") return true;

    const group = (channel.groupName ?? "").toLowerCase();
    const categoryValue = (channel.groupName ?? channel.externalRef ?? "").toLowerCase();

    if (contentType === "movies") {
      return group.includes("movie") || categoryValue.includes("movie") || channel.name.toLowerCase().includes("movie");
    }

    if (contentType === "series") {
      return group.includes("series") || categoryValue.includes("series") || channel.name.toLowerCase().includes("series");
    }

    return !(group.includes("movie") || group.includes("series") || categoryValue.includes("movie") || categoryValue.includes("series"));
  };

  const displayChannels = useMemo(() => {
    return channels
      .filter((channel) => {
        if (!visibleProviderIds.has(channel.providerId)) return false;
        if (selectedProviderId && channel.providerId !== selectedProviderId) return false;
        if (!contentTypeMatches(channel)) return false;
        if (category && category !== "") {
          const group = channel.groupName?.trim() || "Uncategorized";
          if (group !== category) return false;
        }

        if (!search) return true;
        const needle = search.toLowerCase();
        return (
          channel.name.toLowerCase().includes(needle) ||
          channel.url.toLowerCase().includes(needle) ||
          (channel.externalRef ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels, selectedProviderId, category, contentType, search, visibleProviderIds]);

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Channels</h3>
        <span>{displayChannels.length} channels</span>
      </div>

      <div className="filters-row">
        <label>
          Search
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search content" />
        </label>
        <label>
          Provider
          <select value={selectedProviderId} onChange={(event) => onProviderFilterChange(event.target.value)}>
            <option value="">All providers</option>
            {visibleProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={contentType} onChange={(event) => onContentTypeChange(event.target.value as "all" | "live" | "movies" | "series") }>
            <option value="all">All content</option>
            <option value="live">Live channels</option>
            <option value="movies">VOD movies</option>
            <option value="series">Series</option>
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="channel-list">
        {displayChannels.length === 0 ? (
          <div className="empty-row">No channels found.</div>
        ) : (
          displayChannels.map((channel) => (
            <button
              type="button"
              key={channel.id}
              className={channel.id === selectedChannelId ? "selected" : undefined}
              onClick={() => onSelectChannel(channel)}
            >
              <strong>{channel.name}</strong>
              <span>{channel.groupName || "Uncategorized"}</span>
              <small>{channel.url}</small>
            </button>
          ))
        )}
      </div>

      <div className="provider-summary-row">
        <span>{filteredProvider ? filteredProvider.name : "All providers"}</span>
        {filteredProvider ? <small>{filteredProvider.status.toUpperCase()}</small> : null}
      </div>
    </section>
  );
}
