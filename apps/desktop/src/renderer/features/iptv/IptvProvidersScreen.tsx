import { useMemo } from "react";
import type { Channel, CreateProviderRequest, IPTVProvider } from "@gito/shared";

interface IptvProvidersScreenProps {
  providers: IPTVProvider[];
  channels: Channel[];
  selectedProviderId: string;
  providerName: string;
  baseUrl: string;
  type: CreateProviderRequest["type"];
  username: string;
  password: string;
  statusMessage: string;
  onSelectProvider: (providerId: string) => void;
  onChangeProviderName: (value: string) => void;
  onChangeBaseUrl: (value: string) => void;
  onChangeType: (value: CreateProviderRequest["type"]) => void;
  onChangeUsername: (value: string) => void;
  onChangePassword: (value: string) => void;
  onCreateProvider: () => Promise<void>;
  onUpdateProvider: () => Promise<void>;
  onDeleteProvider: (providerId: string) => Promise<void>;
  onSetProviderStatus: (providerId: string, status: string) => Promise<void>;
  onTestProviderById: ((providerId: string) => Promise<any>) | undefined;
}

export function IptvProvidersScreen({
  providers,
  channels,
  selectedProviderId,
  providerName,
  baseUrl,
  type,
  username,
  password,
  statusMessage,
  onSelectProvider,
  onChangeProviderName,
  onChangeBaseUrl,
  onChangeType,
  onChangeUsername,
  onChangePassword,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onSetProviderStatus,
  onTestProviderById
}: IptvProvidersScreenProps) {
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const providerChannelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const channel of channels) {
      counts[channel.providerId] = (counts[channel.providerId] ?? 0) + 1;
    }
    return counts;
  }, [channels]);

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Providers</h3>
        <span>{providers.length} provider{providers.length === 1 ? "" : "s"}</span>
      </div>

      <div className="form-grid">
        <label>
          Name
          <input
            value={providerName}
            onChange={(event) => onChangeProviderName(event.target.value)}
            placeholder="Provider name"
          />
        </label>

        <label>
          Base URL
          <input
            value={baseUrl}
            onChange={(event) => onChangeBaseUrl(event.target.value)}
            placeholder="https://example.com/playlist.m3u"
          />
        </label>

        <label>
          Type
          <select value={type} onChange={(event) => onChangeType(event.target.value as CreateProviderRequest["type"])}>
            <option value="m3u">M3U</option>
            <option value="xtream">Xtream</option>
            <option value="manual">Manual</option>
          </select>
        </label>

        {type === "xtream" ? (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => onChangeUsername(event.target.value)}
                placeholder="Xtream username"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => onChangePassword(event.target.value)}
                placeholder="Xtream password"
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="button-row">
        <button type="button" onClick={selectedProvider ? onUpdateProvider : onCreateProvider}>
          {selectedProvider ? "Update Provider" : "Create Provider"}
        </button>
        <button type="button" onClick={() => onSelectProvider("")}>Clear</button>
        {selectedProvider && onTestProviderById ? (
          <button type="button" onClick={() => onTestProviderById(selectedProvider.id)}>
            Test Connection
          </button>
        ) : null}
      </div>

      <div className="status-line">
        <small>{statusMessage}</small>
      </div>

      <div className="provider-list">
        {providers.length === 0 ? (
          <div className="empty-row">No IPTV providers configured yet.</div>
        ) : (
          providers.map((provider) => (
            <article key={provider.id} className="provider-card">
              <div>
                <strong>{provider.name}</strong>
                <span>{provider.type.toUpperCase()}</span>
              </div>
              <div>
                <small>Status: {provider.status}</small>
                <small>Availability: {provider.availabilityStatus}</small>
                <small>{providerChannelCounts[provider.id] ?? 0} channels</small>
              </div>
              <div className="button-row">
                <button type="button" onClick={() => onSelectProvider(provider.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onSetProviderStatus(provider.id, provider.status === "active" ? "inactive" : "active")}
                >
                  {provider.status === "active" ? "Disable" : "Enable"}
                </button>
                <button type="button" onClick={() => onDeleteProvider(provider.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
