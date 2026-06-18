import { useState } from "react";

import type { Channel, CreateProviderRequest, IPTVProvider, ProviderConnectionTest } from "@gito/shared";

interface IptvManagementScreenProps {
  channels: Channel[];
  providers: IPTVProvider[];
  selectedChannelId: string | undefined;
  onCreateProvider: (input: CreateProviderRequest) => Promise<void>;
  onIngestM3u: (providerId: string, playlist: string) => Promise<void>;
  onUpdateProvider?: (providerId: string, input: Partial<CreateProviderRequest>) => Promise<void>;
  onDeleteProvider?: (providerId: string) => Promise<void>;
  onSelectChannel: (channel: Channel) => void;
  onSyncXtream: (providerId: string) => Promise<void>;
  onTestProvider: (input: CreateProviderRequest) => Promise<ProviderConnectionTest>;
  onTestProviderById?: (providerId: string) => Promise<any>;
  onSetProviderStatus?: (providerId: string, status: string) => Promise<void>;
}

export function IptvManagementScreen({
  channels,
  providers,
  selectedChannelId,
  onCreateProvider,
  onIngestM3u,
  onUpdateProvider,
  onDeleteProvider,
  onSelectChannel,
  onSyncXtream,
  onTestProvider,
  onTestProviderById,
  onSetProviderStatus
}: IptvManagementScreenProps) {
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [type, setType] = useState<CreateProviderRequest["type"]>("m3u");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [status, setStatus] = useState("Ready");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | "">("");
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  const providerInput: CreateProviderRequest = {
    name: providerName.trim(),
    baseUrl: baseUrl.trim(),
    type,
    authType: type === "xtream" ? "basic" : "none",
    ...(type === "xtream" && username ? { username } : {}),
    ...(type === "xtream" && password ? { password } : {})
  };

  const validatedProvider = selectedProviderId ? providers.find((p) => p.id === selectedProviderId) : undefined;
  const loadedChannelCount = channels.length;
  const displayChannels = selectedProviderId ? channels.filter((channel) => channel.providerId === selectedProviderId) : channels;
  const selectedProvider = selectedProviderId ? providers.find((provider) => provider.id === selectedProviderId) : undefined;
  const activeProviders = providers.filter((provider) => provider.status === "active");
  const channelGroupCounts = displayChannels.reduce<Record<string, number>>((acc, channel) => {
    const groupName = channel.groupName?.trim() || "Uncategorized";
    acc[groupName] = (acc[groupName] ?? 0) + 1;
    return acc;
  }, {});
  const groupList = Object.keys(channelGroupCounts).sort((a, b) => a.localeCompare(b));
  const filteredChannels = displayChannels.filter((channel) => {
    const groupName = channel.groupName?.trim() || "Uncategorized";
    if (categoryFilter && groupName !== categoryFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        channel.name.toLowerCase().includes(s) ||
        (channel.externalRef ?? "").toLowerCase().includes(s) ||
        channel.url.toLowerCase().includes(s)
      );
    }

    return true;
  }).sort((a, b) => {
    const groupA = a.groupName?.trim() || "Uncategorized";
    const groupB = b.groupName?.trim() || "Uncategorized";
    return groupA.localeCompare(groupB) || a.name.localeCompare(b.name);
  });

  async function handleCreateProvider() {
    if (!providerName.trim() || !baseUrl.trim() || !type) {
      setStatus("Name, base URL, and type are required.");
      return;
    }

    const selectedProvider = selectedProviderId ? providers.find((p) => p.id === selectedProviderId) : undefined;
    const requiresXtreamCredentials =
      type === "xtream" &&
      (!selectedProvider || selectedProvider.type !== "xtream") &&
      (!username.trim() || !password.trim());

    if (requiresXtreamCredentials) {
      setStatus("Xtream providers require both username and password.");
      return;
    }

    setStatus(selectedProviderId ? "Saving provider..." : "Saving new provider...");

    if (selectedProviderId && onUpdateProvider) {
      await onUpdateProvider(selectedProviderId, providerInput);
      setStatus("Provider updated.");
    } else {
      await onCreateProvider(providerInput);
      setSelectedProviderId("");
      setStatus("Provider saved.");
    }
  }

  async function handleTestProvider() {
    if (!providerName.trim() || !baseUrl.trim() || !type) {
      setStatus("Name, base URL, and type are required to test.");
      return;
    }

    if (type === "xtream" && (!username.trim() || !password.trim())) {
      setStatus("Xtream providers require both username and password to test.");
      return;
    }

    setStatus("Testing connection...");

    try {
      if (selectedProviderId && onTestProviderById) {
        const result = await onTestProviderById(selectedProviderId);
        if (result && typeof result.message === "string") {
          setStatus(result.message);
        } else {
          setStatus("Provider validated and channel sync complete.");
        }
      } else {
        const result = await onTestProvider(providerInput);
        setStatus(result.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Provider connection test failed.");
    }
  }

  async function handleIngest() {
    if (!selectedProviderId) {
      setStatus("Select a provider first.");
      return;
    }

    if (type !== "xtream" && !playlist.trim()) {
      setStatus("Paste an M3U playlist to ingest channels.");
      return;
    }

    setStatus("Ingesting channels...");

    if (type === "xtream") {
      await onSyncXtream(selectedProviderId);
    } else {
      await onIngestM3u(selectedProviderId, playlist);
    }

    setStatus("Channel ingestion completed.");
  }

  async function handleDeleteProvider(id: string) {
    if (!onDeleteProvider) return;

    if (!window.confirm("Delete provider and mark as removed? This will hide it from lists.")) return;

    setStatus("Deleting provider...");
    await onDeleteProvider(id);
    setStatus("Provider deleted.");
    if (selectedProviderId === id) setSelectedProviderId("");
  }

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">IPTV</p>
        <h2>Provider Operations</h2>
        <span>Connect providers, extract channels, and prepare sources for match assignment.</span>
      </header>
      <div className="operations-grid">
        <section className="console-panel provider-setup-card">
          <div className="panel-heading">
            <h3>Provider Setup</h3>
            <span className="status-pill">{status}</span>
          </div>
          {!isSetupOpen ? (
            <>
              <p>Click the button below to open the provider setup window.</p>
              <div className="button-row">
                <button type="button" onClick={() => setIsSetupOpen(true)}>
                  Open provider setup
                </button>
              </div>
              <div className="provider-summary">
                <strong>{providers.length} saved provider{providers.length === 1 ? "" : "s"}</strong>
                <p>
                  Select a provider from the health panel to edit, validate, or activate it.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  Provider
                  <input
                    autoFocus
                    className="provider-input"
                    placeholder="Name your provider"
                    value={providerName}
                    onChange={(event) => setProviderName(event.target.value)}
                  />
                </label>
                <label>
                  Base URL
                  <input
                    placeholder="https://example.com/playlist.m3u or xtream base URL"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </label>
                <label>
                  Type
                  <select value={type} onChange={(event) => setType(event.target.value as CreateProviderRequest["type"])}>
                    <option value="m3u">M3U Playlist</option>
                    <option value="xtream">Xtream Codes</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                {type === "xtream" ? (
                  <>
                    <label>
                      Username
                      <input value={username} onChange={(event) => setUsername(event.target.value)} />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                  </>
                ) : null}
              </div>
              <div className="button-row">
                <button type="button" onClick={handleTestProvider}>
                  Test Connection
                </button>
                <button type="button" onClick={handleCreateProvider}>
                  {selectedProviderId ? "Save Changes" : "Save Provider"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProviderId("");
                    setProviderName("");
                    setBaseUrl("");
                    setType("m3u");
                    setUsername("");
                    setPassword("");
                    setPlaylist("");
                    setStatus("Ready");
                  }}
                >
                  New Provider
                </button>
                <button type="button" onClick={() => setIsSetupOpen(false)}>
                  Close Setup
                </button>
              </div>
              <div className="badge-row">
                <span className="mini-pill">Channels loaded: {loadedChannelCount}</span>
                <span className="mini-pill">Provider validated: {validatedProvider ? validatedProvider.status : "not selected"}</span>
              </div>
              <div className="saved-provider-list">
                <h4>Saved providers</h4>
                {providers.length === 0 ? (
                  <div className="empty-row">No saved providers yet.</div>
                ) : (
                  providers.map((provider) => (
                    <article key={provider.id} className="provider-item">
                      <strong>{provider.name}</strong>
                      <div className="provider-item-meta">
                        <span>{provider.type.toUpperCase()}</span>
                        <span>{provider.status}</span>
                        <span>{channels.filter((channel) => channel.providerId === provider.id).length} channels</span>
                      </div>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProviderId(provider.id);
                            setProviderName(provider.name);
                            setBaseUrl(provider.baseUrl);
                            setType(provider.type as CreateProviderRequest["type"]);
                            setUsername("");
                            setPassword("");
                          }}
                        >
                          Edit
                        </button>
                        {onSetProviderStatus ? (
                          <button
                            type="button"
                            onClick={async () => {
                              setStatus("Updating provider status...");
                              try {
                                const newStatus = provider.status === "active" ? "inactive" : "active";
                                await onSetProviderStatus(provider.id, newStatus);
                                setStatus("Provider status updated.");
                              } catch (e) {
                                setStatus(e instanceof Error ? e.message : "Status update failed");
                              }
                            }}
                          >
                            {provider.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </section>

        <section className="console-panel">
          <div className="panel-heading">
            <h3>Channel Extraction</h3>
            <span>{displayChannels.length} channels</span>
          </div>
          <div className="active-provider-context">
            <div>
              <span className="context-label">Active provider view</span>
              <strong>{selectedProvider ? selectedProvider.name : "All providers"}</strong>
              <small>
                {selectedProvider
                  ? `${selectedProvider.type.toUpperCase()} / ${selectedProvider.status}`
                  : `${activeProviders.length} active provider${activeProviders.length === 1 ? "" : "s"}`}
              </small>
            </div>
            <div className="context-metrics">
              <span>{displayChannels.length} channels</span>
              <span>{groupList.length} groups</span>
            </div>
          </div>
          <label>
            Search channels
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, externalRef or URL" />
          </label>
          <label>
            Provider
            <select
              value={selectedProviderId}
              onChange={(event) => {
                const id = event.target.value;
                setSelectedProviderId(id);

                const provider = providers.find((p) => p.id === id);

                if (provider) {
                  setProviderName(provider.name);
                  setBaseUrl(provider.baseUrl);
                  setType(provider.type as CreateProviderRequest["type"]);
                }
              }}
            >
              <option value="">Select provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} {provider.status !== 'active' ? `(${provider.status})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as string)}>
              <option value="">All groups</option>
              {groupList.map((cat) => (
                <option key={cat} value={cat}>
                  {cat} ({channelGroupCounts[cat]})
                </option>
              ))}
            </select>
          </label>
          {type !== "xtream" ? (
            <label>
              M3U Playlist
              <textarea
                value={playlist}
                onChange={(event) => setPlaylist(event.target.value)}
                placeholder="#EXTM3U&#10;#EXTINF:-1 group-title=&quot;Sports&quot;,Match Channel&#10;https://example.com/live.m3u8"
              />
            </label>
          ) : null}
          <button type="button" onClick={handleIngest}>
            Extract Channels
          </button>
        </section>
      </div>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Channels</h3>
          <span>{selectedProvider ? selectedProvider.name : "All providers"}</span>
        </div>
        <div className="channel-management-grid">
          <aside className="group-panel">
            <div className="group-panel-header">
              <strong>Channel Groups</strong>
              <span>{groupList.length} group{groupList.length === 1 ? "" : "s"}</span>
            </div>
            <div className="group-list">
              <button
                type="button"
                className={categoryFilter === "" ? "selected" : ""}
                onClick={() => setCategoryFilter("")}
              >
                <span>All groups</span>
                <small>{displayChannels.length}</small>
              </button>
              {groupList.map((group) => (
                <button
                  key={group}
                  type="button"
                  className={group === categoryFilter ? "selected" : ""}
                  onClick={() => setCategoryFilter(group)}
                >
                  <span>{group}</span>
                  <small>{channelGroupCounts[group]}</small>
                </button>
              ))}
            </div>
          </aside>
          <div className="channel-panel">
            <div className="channel-info-row">
              <span>{filteredChannels.length} channels</span>
              <span>{categoryFilter || "All groups"}</span>
            </div>
            <div className="channel-list">
              {filteredChannels.length === 0 ? (
                <div className="empty-row">No channels extracted yet.</div>
              ) : (
                filteredChannels.map((channel) => (
                  <button
                    className={channel.id === selectedChannelId ? "selected" : ""}
                    key={channel.id}
                    type="button"
                    onClick={() => onSelectChannel(channel)}
                  >
                    <strong>{channel.name}</strong>
                    <span>{channel.groupName?.trim() || "Uncategorized"}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Provider Health</h3>
          <span>{providers.length} providers</span>
        </div>
        <div className="provider-health-list">
          {providers.map((provider) => (
            <article key={provider.id}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <strong>{provider.name}</strong>
                  <div style={{ fontSize: 12, color: "#AAB4AE" }}>
                    {provider.availabilityStatus} / score {provider.healthScore}
                  </div>
                  <small>
                    {channels.filter((channel) => channel.providerId === provider.id).length} channels
                    {' • '}
                    {new Set(channels.filter((channel) => channel.providerId === provider.id).map((channel) => channel.groupName).filter(Boolean)).size} groups
                  </small>
                  <small>{provider.failedChannelLoads} failed channel loads</small>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className={`status-pill ${provider.status}`}>{provider.status.toUpperCase()}</span>
                  <button type="button" onClick={() => {
                    setSelectedProviderId(provider.id);
                    setProviderName(provider.name);
                    setBaseUrl(provider.baseUrl);
                    setType(provider.type as CreateProviderRequest["type"]);
                  }}>
                    Edit
                  </button>
                  {onTestProviderById ? (
                    <button type="button" onClick={async () => {
                      setStatus("Testing provider...");
                      try {
                        const res = await onTestProviderById(provider.id);
                        setStatus((res && res.message) || "Test complete.");
                      } catch (e) {
                        setStatus(e instanceof Error ? e.message : "Test failed");
                      }
                    }}>
                      Retry Test
                    </button>
                  ) : null}
                  {onDeleteProvider ? (
                    <button type="button" onClick={() => handleDeleteProvider(provider.id)}>
                      Delete
                    </button>
                  ) : null}
                  {onSetProviderStatus ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const newStatus = provider.status === "active" ? "inactive" : "active";
                        setStatus("Updating provider status...");
                        try {
                          await onSetProviderStatus(provider.id, newStatus);
                          setStatus("Provider status updated.");
                        } catch (e) {
                          setStatus(e instanceof Error ? e.message : "Status update failed");
                        }
                      }}
                    >
                      {provider.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {providers.length === 0 ? <div className="empty-row">No providers configured.</div> : null}
        </div>
      </section>
    </section>
  );
}
