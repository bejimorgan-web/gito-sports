import type { Channel, IPTVProvider, PaginatedChannels } from "@gito/shared";

interface IptvChannelsScreenProps {
  page: PaginatedChannels<Channel>;
  providers: IPTVProvider[];
  selectedChannelId: string | undefined;
  search: string;
  category: string;
  selectedProviderId: string;
  onSelectChannel: (channel: Channel) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export function IptvChannelsScreen({
  page,
  providers,
  selectedChannelId,
  search,
  category,
  selectedProviderId,
  onSelectChannel,
  onSearchChange,
  onCategoryChange,
  onProviderFilterChange,
  onPageChange
}: IptvChannelsScreenProps) {
  const visibleProviders = providers.filter((provider) => provider.status === "active");
  const filteredProvider = visibleProviders.find((provider) => provider.id === selectedProviderId);

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Channels</h3>
        <span>{page.total} channels</span>
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
          Category
          <input value={category} onChange={(event) => onCategoryChange(event.target.value)} placeholder="Exact category" />
        </label>
      </div>

      <div className="channel-list">
        {page.items.length === 0 ? (
          <div className="empty-row">No channels found.</div>
        ) : (
          page.items.map((channel) => (
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
        <button type="button" disabled={page.page <= 1} onClick={() => onPageChange(page.page - 1)}>Previous</button>
        <span>Page {page.page} of {Math.max(page.totalPages, 1)}</span>
        <button type="button" disabled={page.page >= page.totalPages} onClick={() => onPageChange(page.page + 1)}>Next</button>
      </div>

      <div className="provider-summary-row">
        <span>{filteredProvider ? filteredProvider.name : "All providers"}</span>
        {filteredProvider ? <small>{filteredProvider.status.toUpperCase()}</small> : null}
      </div>
    </section>
  );
}
