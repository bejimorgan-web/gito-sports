import { useMemo, useState } from "react";
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsProviderId, setDetailsProviderId] = useState<string | null>(null);
  const [providerCredentials, setProviderCredentials] = useState<Record<string, { username: string; password: string }>>({});

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const activeProviders = useMemo(() => providers.filter((provider) => provider.status !== "inactive"), [providers]);
  const inactiveProviders = useMemo(() => providers.filter((provider) => provider.status === "inactive"), [providers]);

  const openAddAccountModal = (provider?: IPTVProvider) => {
    if (provider) {
      onSelectProvider(provider.id);
      onChangeProviderName(provider.name);
      onChangeBaseUrl(provider.baseUrl);
      onChangeType(provider.type as CreateProviderRequest["type"]);
      const stored = providerCredentials[provider.id] ?? {
        username: provider.username ?? "",
        password: provider.password ?? ""
      };
      onChangeUsername(stored.username);
      onChangePassword(stored.password);
    } else {
      onSelectProvider("");
      onChangeProviderName("");
      onChangeBaseUrl("");
      onChangeType("manual");
      onChangeUsername("");
      onChangePassword("");
    }
    setShowAddModal(true);
  };

  const handleSaveAccount = async () => {
    const trimmedName = providerName.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const providerType = type;

    if (!trimmedName || !trimmedBaseUrl) {
      return;
    }

    if (providerType === "xtream" && (!username.trim() || !password.trim())) {
      return;
    }

    setProviderCredentials((current) => ({
      ...current,
      ...(selectedProviderId ? { [selectedProviderId]: { username, password } } : {})
    }));

    if (selectedProvider) {
      await onUpdateProvider();
    } else {
      await onCreateProvider();
    }

    setShowAddModal(false);
  };

  const detailsProvider = providers.find((provider) => provider.id === detailsProviderId) ?? null;
  const openDetails = (provider: IPTVProvider) => {
    setDetailsProviderId(provider.id);
    setShowDetailsModal(true);
  };

  const closeDetails = () => {
    setShowDetailsModal(false);
    setDetailsProviderId(null);
  };

  const handleDetailSave = async () => {
    if (!detailsProvider) return;
    const draftUsername = providerCredentials[detailsProvider.id]?.username ?? detailsProvider.username ?? username;
    const draftPassword = providerCredentials[detailsProvider.id]?.password ?? detailsProvider.password ?? password;

    setProviderCredentials((current) => ({
      ...current,
      [detailsProvider.id]: { username: draftUsername, password: draftPassword }
    }));

    onSelectProvider(detailsProvider.id);
    onChangeProviderName(detailsProvider.name);
    onChangeBaseUrl(detailsProvider.baseUrl);
    onChangeType(detailsProvider.type as CreateProviderRequest["type"]);
    onChangeUsername(draftUsername);
    onChangePassword(draftPassword);
    await onUpdateProvider();
    closeDetails();
  };

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Providers</h3>
        <div className="panel-heading-tools">
          <button type="button" className="primary-button" onClick={() => openAddAccountModal()}>
            Add an account
          </button>
          <span>{providers.length} provider{providers.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      {showAddModal ? (
        <div className="account-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="account-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <h3>{selectedProvider ? "Edit account" : "Add IPTV account"}</h3>
              <button type="button" className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="form-grid premium-editor-grid">
              <label className="full-width">
                Account name
                <input value={providerName} onChange={(event) => onChangeProviderName(event.target.value)} placeholder="Provider name" />
              </label>
              <label>
                Source type
                <select value={type} onChange={(event) => onChangeType(event.target.value as CreateProviderRequest["type"])}>
                  <option value="manual">Auto-detect</option>
                  <option value="m3u">Force M3U</option>
                  <option value="xtream">Force Xtream</option>
                </select>
              </label>
              <label>
                Base URL / Playlist
                <input value={baseUrl} onChange={(event) => onChangeBaseUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" />
              </label>
              {type === "xtream" ? (
                <>
                  <label>
                    Username
                    <input value={username} onChange={(event) => onChangeUsername(event.target.value)} placeholder="Xtream username" />
                  </label>
                  <label>
                    Password
                    <input type="password" value={password} onChange={(event) => onChangePassword(event.target.value)} placeholder="Xtream password" />
                  </label>
                </>
              ) : null}
            </div>
            <div className="status-line">
              <small>{statusMessage}</small>
            </div>
            <div className="button-row">
              <button type="button" className="primary-button" disabled={providerAction !== "idle"} onClick={handleSaveAccount}>
                {providerAction === "saving" ? "Saving…" : providerAction === "validating" ? "Validating…" : selectedProvider ? "Validate & Save" : "Create & Save"}
              </button>
              <button type="button" onClick={onValidateProvider} disabled={providerAction !== "idle"}>Validate Connection</button>
              <button type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {showDetailsModal && detailsProvider ? (
        <div className="account-modal-backdrop" onClick={closeDetails}>
          <div className="account-modal account-details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <h3>{detailsProvider.name}</h3>
              <button type="button" className="modal-close" onClick={closeDetails}>×</button>
            </div>
            <div className="details-stat-grid">
              <div><small>Channels</small><strong>{providerDiagnostics[detailsProvider.id]?.contentTotals.live ?? 0}</strong></div>
              <div><small>Movies</small><strong>{providerDiagnostics[detailsProvider.id]?.contentTotals.movies ?? 0}</strong></div>
              <div><small>Series</small><strong>{providerDiagnostics[detailsProvider.id]?.contentTotals.series ?? 0}</strong></div>
            </div>
            <div className="provider-card-identity-row">
              <div><small>Expiration</small><strong>{detailsProvider.expiresAt ? new Date(detailsProvider.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : detailsProvider.type === "xtream" ? "No expiry on file" : "M3U playlist source"}</strong></div>
            </div>
            <div className="form-grid premium-editor-grid">
              <label className="full-width">
                Account name
                <input value={detailsProvider.name} onChange={(event) => onChangeProviderName(event.target.value)} />
              </label>
              <label>
                Source type
                <select value={detailsProvider.type} onChange={(event) => onChangeType(event.target.value as CreateProviderRequest["type"])}>
                  <option value="manual">Auto-detect</option>
                  <option value="m3u">Force M3U</option>
                  <option value="xtream">Force Xtream</option>
                </select>
              </label>
              <label>
                Account URL / Playlist
                <input value={detailsProvider.baseUrl} onChange={(event) => onChangeBaseUrl(event.target.value)} />
              </label>
              <label>
                Username
                <input value={providerCredentials[detailsProvider.id]?.username ?? username} onChange={(event) => setProviderCredentials((current) => ({ ...current, [detailsProvider.id]: { username: event.target.value, password: current[detailsProvider.id]?.password ?? password } }))} />
              </label>
              <label>
                Password
                <input type="password" value={providerCredentials[detailsProvider.id]?.password ?? password} onChange={(event) => setProviderCredentials((current) => ({ ...current, [detailsProvider.id]: { username: current[detailsProvider.id]?.username ?? username, password: event.target.value } }))} />
              </label>
            </div>
            <div className="status-line">
              <small>{statusMessage}</small>
            </div>
            <div className="button-row">
              <button type="button" className="primary-button" onClick={handleDetailSave}>Validate & Save</button>
              <button type="button" onClick={closeDetails}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="status-line">
        <small>{statusMessage}</small>
      </div>

      <div className="provider-list">
        {providers.length === 0 ? (
          <div className="empty-row">No IPTV providers configured yet.</div>
        ) : (
          <>
            {activeProviders.map((provider) => {
              const isActive = provider.status === "active";
              const isPending = provider.status === "pending";
              const isInactive = provider.status === "inactive";
              const isFailed = provider.status === "failed";
              const stateLabel = isActive ? "Active" : isPending ? "Pending" : isInactive ? "Inactive" : isFailed ? "Failed" : provider.status;
              const stateClass = isActive ? "active" : isPending ? "pending" : isInactive ? "inactive" : isFailed ? "failed" : "inactive";
              const storedUsername = provider.username ?? providerCredentials[provider.id]?.username ?? "configured account";
              const expiryText = provider.expiresAt ? new Date(provider.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : provider.type === "xtream" ? "No expiry on file" : "M3U playlist source";

              const brandText = provider.type === "xtream" ? "XT" : provider.type === "m3u" ? "M3" : "IP";

              return (
                <article key={provider.id} className="provider-card provider-hero-card" onDoubleClick={() => openDetails(provider)}>
                  <div className="provider-card-header">
                    <div className="provider-brand-lockup">
                      <div className="provider-brand-badge" aria-hidden="true">{brandText}</div>
                      <div className="provider-account-meta">
                        <strong>{provider.name}</strong>
                        <span>{provider.type.toUpperCase()}</span>
                      </div>
                    </div>
                    <span className={`provider-status-badge ${stateClass}`}>{stateLabel}</span>
                  </div>

                  <div className="provider-card-identity-row">
                    <div>
                      <small>Username</small>
                      <strong>{storedUsername}</strong>
                    </div>
                    <div>
                      <small>Expiration</small>
                      <strong>{expiryText}</strong>
                    </div>
                  </div>

                  <div className="provider-card-footer">
                    <button type="button" className="delete-button danger-button" onClick={() => onDeleteProvider(provider.id)} disabled={Boolean(deletingProviderId)}>
                      {deletingProviderId === provider.id ? "Deleting…" : "Delete"}
                    </button>

                    <button
                      type="button"
                      className={`toggle-button ${isActive ? "active" : "inactive"}`}
                      disabled={statusChangingProviderId === provider.id}
                      onClick={() => onSetProviderStatus(provider.id, isActive ? "inactive" : "active")}
                    >
                      {statusChangingProviderId === provider.id ? (isActive ? "Deactivating…" : "Activating…") : (isActive ? "Deactivate" : "Activate")}
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
