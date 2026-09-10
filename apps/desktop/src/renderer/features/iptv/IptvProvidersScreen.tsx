import { useMemo } from "react";
import type { CreateProviderRequest, IPTVProvider, ProviderChannelDiagnostics } from "@gito/shared";

interface IptvProvidersScreenProps {
  providers: IPTVProvider[];
  providerDiagnostics: Record<string, ProviderChannelDiagnostics>;
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
  onValidateProvider?: () => Promise<void>;
  providerAction?: "idle" | "validating" | "saving";
  statusChangingProviderId?: string | null;
  deletingProviderId?: string | null;
}

export function IptvProvidersScreen({
  providers,
  providerDiagnostics,
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
  onTestProviderById,
  onValidateProvider,
  providerAction = "idle",
  statusChangingProviderId = null,
  deletingProviderId = null
}: IptvProvidersScreenProps) {
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const activeProviders = useMemo(() => providers.filter((provider) => provider.status !== "inactive"), [providers]);
  const inactiveProviders = useMemo(() => providers.filter((provider) => provider.status === "inactive"), [providers]);
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
            <option value="manual">Auto-detect</option>
            <option value="m3u">Force M3U</option>
            <option value="xtream">Force Xtream</option>
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
        <button type="button" disabled={providerAction !== "idle"} onClick={selectedProvider ? onUpdateProvider : onCreateProvider}>
          {providerAction === "saving" ? "Saving…" : providerAction === "validating" ? "Validating…" : "Validate & Save"}
        </button>
        <button type="button" disabled={providerAction !== "idle"} onClick={onValidateProvider}>
          {providerAction === "validating" ? "Validating…" : "Validate Connection"}
        </button>
        <button type="button" onClick={() => onSelectProvider("")}>Clear</button>
        {selectedProvider && onTestProviderById ? (
          <button type="button" onClick={() => onTestProviderById(selectedProvider.id)}>
            Test Saved Provider
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
          <>
            {activeProviders.map((provider) => {
              const diagnostics = providerDiagnostics[provider.id];
              const channelMetrics = diagnostics
                ? { total: diagnostics.contentTotals.live, movies: diagnostics.contentTotals.movies, series: diagnostics.contentTotals.series }
                : { total: 0, movies: 0, series: 0 };
              const isActive = provider.status === "active";
              const isPending = provider.status === "pending";
              const isInactive = provider.status === "inactive";
              const isFailed = provider.status === "failed";
              const stateLabel = isActive ? "Active" : isPending ? "Pending" : isInactive ? "Deactivated" : isFailed ? "Failed" : provider.status;
              const stateClass = isActive ? "active" : isPending ? "pending" : isInactive ? "inactive" : isFailed ? "failed" : "inactive";
              return (
                <article key={provider.id} className="provider-card provider-hero-card">
                  <div className="provider-card-header">
                    <div>
                      <strong>{provider.name}</strong>
                      <span>{provider.type.toUpperCase()}</span>
                    </div>
                    <span className={`provider-status-badge ${stateClass}`}>
                      {stateLabel}
                    </span>
                  </div>

                  <div className="provider-card-details">
                    <div>
                      <small>Channels</small>
                      <strong>{channelMetrics.total}</strong>
                    </div>
                    <div>
                      <small>Movies</small>
                      <strong>{channelMetrics.movies}</strong>
                    </div>
                    <div>
                      <small>Series</small>
                      <strong>{channelMetrics.series}</strong>
                    </div>
                    <div>
                      <small>Status</small>
                      <strong>{provider.status}</strong>
                    </div>
                    <div>
                      <small>Availability</small>
                      <strong>{provider.availabilityStatus}</strong>
                    </div>
                  </div>

                  <div className="provider-card-actions">
                    <button type="button" onClick={() => onSelectProvider(provider.id)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => onSelectProvider(provider.id)}>
                      Browse Catalogue
                    </button>
                    <button
                      type="button"
                      disabled={statusChangingProviderId === provider.id}
                      onClick={() => onSetProviderStatus(provider.id, isActive ? "inactive" : "active")}
                    >
                      {statusChangingProviderId === provider.id ? (isActive ? "Deactivating…" : "Activating…") : (isActive ? "Deactivate" : "Activate")}
                    </button>
                    <button type="button" onClick={() => onDeleteProvider(provider.id)} disabled={Boolean(deletingProviderId)}>
                      {deletingProviderId === provider.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}

            {inactiveProviders.length > 0 ? (
              <div style={{ marginTop: 18, borderTop: "1px solid #243649", paddingTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <strong style={{ color: "#8fa1b3" }}>Disabled accounts</strong>
                  <span style={{ color: "#6f7d8a", fontSize: "0.9rem" }}>{inactiveProviders.length} inactive</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {inactiveProviders.map((provider) => (
                    <div
                      key={provider.id}
                      style={{
                        border: "1px solid #243649",
                        background: "rgba(8, 16, 24, 0.76)",
                        borderRadius: 10,
                        padding: "10px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: "#e7edf4" }}>{provider.name}</div>
                        <div style={{ color: "#8fa1b3", fontSize: "0.9rem" }}>{provider.type.toUpperCase()}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="provider-status-badge inactive">Deactivated</span>
                        <button type="button" disabled={statusChangingProviderId === provider.id} onClick={() => onSetProviderStatus(provider.id, "active")}>
                          {statusChangingProviderId === provider.id ? "Activating…" : "Activate"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
