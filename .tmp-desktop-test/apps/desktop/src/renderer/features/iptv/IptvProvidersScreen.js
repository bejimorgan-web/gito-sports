import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from "react";
export function IptvProvidersScreen({ providers, providerDiagnostics, selectedProviderId, providerName, baseUrl, type, username, password, statusMessage, onSelectProvider, onChangeProviderName, onChangeBaseUrl, onChangeType, onChangeUsername, onChangePassword, onCreateProvider, onUpdateProvider, onDeleteProvider, onSetProviderStatus, onTestProviderById, onValidateProvider, providerAction = "idle", statusChangingProviderId = null, deletingProviderId = null }) {
    const [showAddModal, setShowAddModal] = useState(false);
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [detailsProviderId, setDetailsProviderId] = useState(null);
    const [providerCredentials, setProviderCredentials] = useState({});
    const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
    const activeProviders = useMemo(() => providers.filter((provider) => provider.status !== "inactive"), [providers]);
    const inactiveProviders = useMemo(() => providers.filter((provider) => provider.status === "inactive"), [providers]);
    const openAddAccountModal = (provider) => {
        if (provider) {
            onSelectProvider(provider.id);
            onChangeProviderName(provider.name);
            onChangeBaseUrl(provider.baseUrl);
            onChangeType(provider.type);
            const stored = providerCredentials[provider.id] ?? {
                username: provider.username ?? "",
                password: provider.password ?? ""
            };
            onChangeUsername(stored.username);
            onChangePassword(stored.password);
        }
        else {
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
        }
        else {
            await onCreateProvider();
        }
        setShowAddModal(false);
    };
    const detailsProvider = providers.find((provider) => provider.id === detailsProviderId) ?? null;
    const openDetails = (provider) => {
        setDetailsProviderId(provider.id);
        setShowDetailsModal(true);
    };
    const closeDetails = () => {
        setShowDetailsModal(false);
        setDetailsProviderId(null);
    };
    const handleDetailSave = async () => {
        if (!detailsProvider)
            return;
        const draftUsername = providerCredentials[detailsProvider.id]?.username ?? detailsProvider.username ?? username;
        const draftPassword = providerCredentials[detailsProvider.id]?.password ?? detailsProvider.password ?? password;
        setProviderCredentials((current) => ({
            ...current,
            [detailsProvider.id]: { username: draftUsername, password: draftPassword }
        }));
        onSelectProvider(detailsProvider.id);
        onChangeProviderName(detailsProvider.name);
        onChangeBaseUrl(detailsProvider.baseUrl);
        onChangeType(detailsProvider.type);
        onChangeUsername(draftUsername);
        onChangePassword(draftPassword);
        await onUpdateProvider();
        closeDetails();
    };
    return (_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "IPTV Providers" }), _jsxs("div", { className: "panel-heading-tools", children: [_jsx("button", { type: "button", className: "primary-button", onClick: () => openAddAccountModal(), children: "Add an account" }), _jsxs("span", { children: [providers.length, " provider", providers.length === 1 ? "" : "s"] })] })] }), showAddModal ? (_jsx("div", { className: "account-modal-backdrop", onClick: () => setShowAddModal(false), children: _jsxs("div", { className: "account-modal", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedProvider ? "Edit account" : "Add IPTV account" }), _jsx("button", { type: "button", className: "modal-close", onClick: () => setShowAddModal(false), children: "\u00D7" })] }), _jsxs("div", { className: "form-grid premium-editor-grid", children: [_jsxs("label", { className: "full-width", children: ["Account name", _jsx("input", { value: providerName, onChange: (event) => onChangeProviderName(event.target.value), placeholder: "Provider name" })] }), _jsxs("label", { children: ["Source type", _jsxs("select", { value: type, onChange: (event) => onChangeType(event.target.value), children: [_jsx("option", { value: "manual", children: "Auto-detect" }), _jsx("option", { value: "m3u", children: "Force M3U" }), _jsx("option", { value: "xtream", children: "Force Xtream" })] })] }), _jsxs("label", { children: ["Base URL / Playlist", _jsx("input", { value: baseUrl, onChange: (event) => onChangeBaseUrl(event.target.value), placeholder: "https://example.com/playlist.m3u" })] }), type === "xtream" ? (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Username", _jsx("input", { value: username, onChange: (event) => onChangeUsername(event.target.value), placeholder: "Xtream username" })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: (event) => onChangePassword(event.target.value), placeholder: "Xtream password" })] })] })) : null] }), _jsx("div", { className: "status-line", children: _jsx("small", { children: statusMessage }) }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", className: "primary-button", disabled: providerAction !== "idle", onClick: handleSaveAccount, children: providerAction === "saving" ? "Saving…" : providerAction === "validating" ? "Validating…" : selectedProvider ? "Validate & Save" : "Create & Save" }), _jsx("button", { type: "button", onClick: onValidateProvider, disabled: providerAction !== "idle", children: "Validate Connection" }), _jsx("button", { type: "button", onClick: () => setShowAddModal(false), children: "Cancel" })] })] }) })) : null, showDetailsModal && detailsProvider ? (_jsx("div", { className: "account-modal-backdrop", onClick: closeDetails, children: _jsxs("div", { className: "account-modal account-details-modal", onClick: (event) => event.stopPropagation(), children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: detailsProvider.name }), _jsx("button", { type: "button", className: "modal-close", onClick: closeDetails, children: "\u00D7" })] }), _jsxs("div", { className: "details-stat-grid", children: [_jsxs("div", { children: [_jsx("small", { children: "Channels" }), _jsx("strong", { children: providerDiagnostics[detailsProvider.id]?.contentTotals.live ?? 0 })] }), _jsxs("div", { children: [_jsx("small", { children: "Movies" }), _jsx("strong", { children: providerDiagnostics[detailsProvider.id]?.contentTotals.movies ?? 0 })] }), _jsxs("div", { children: [_jsx("small", { children: "Series" }), _jsx("strong", { children: providerDiagnostics[detailsProvider.id]?.contentTotals.series ?? 0 })] })] }), _jsx("div", { className: "provider-card-identity-row", children: _jsxs("div", { children: [_jsx("small", { children: "Expiration" }), _jsx("strong", { children: detailsProvider.expiresAt ? new Date(detailsProvider.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : detailsProvider.type === "xtream" ? "No expiry on file" : "M3U playlist source" })] }) }), _jsxs("div", { className: "form-grid premium-editor-grid", children: [_jsxs("label", { className: "full-width", children: ["Account name", _jsx("input", { value: detailsProvider.name, onChange: (event) => onChangeProviderName(event.target.value) })] }), _jsxs("label", { children: ["Source type", _jsxs("select", { value: detailsProvider.type, onChange: (event) => onChangeType(event.target.value), children: [_jsx("option", { value: "manual", children: "Auto-detect" }), _jsx("option", { value: "m3u", children: "Force M3U" }), _jsx("option", { value: "xtream", children: "Force Xtream" })] })] }), _jsxs("label", { children: ["Account URL / Playlist", _jsx("input", { value: detailsProvider.baseUrl, onChange: (event) => onChangeBaseUrl(event.target.value) })] }), _jsxs("label", { children: ["Username", _jsx("input", { value: providerCredentials[detailsProvider.id]?.username ?? username, onChange: (event) => setProviderCredentials((current) => ({ ...current, [detailsProvider.id]: { username: event.target.value, password: current[detailsProvider.id]?.password ?? password } })) })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: providerCredentials[detailsProvider.id]?.password ?? password, onChange: (event) => setProviderCredentials((current) => ({ ...current, [detailsProvider.id]: { username: current[detailsProvider.id]?.username ?? username, password: event.target.value } })) })] })] }), _jsx("div", { className: "status-line", children: _jsx("small", { children: statusMessage }) }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", className: "primary-button", onClick: handleDetailSave, children: "Validate & Save" }), _jsx("button", { type: "button", onClick: closeDetails, children: "Close" })] })] }) })) : null, _jsx("div", { className: "status-line", children: _jsx("small", { children: statusMessage }) }), _jsx("div", { className: "provider-list", children: providers.length === 0 ? (_jsx("div", { className: "empty-row", children: "No IPTV providers configured yet." })) : (_jsxs(_Fragment, { children: [activeProviders.map((provider) => {
                            const isActive = provider.status === "active";
                            const isPending = provider.status === "pending";
                            const isInactive = provider.status === "inactive";
                            const isFailed = provider.status === "failed";
                            const stateLabel = isActive ? "Active" : isPending ? "Pending" : isInactive ? "Inactive" : isFailed ? "Failed" : provider.status;
                            const stateClass = isActive ? "active" : isPending ? "pending" : isInactive ? "inactive" : isFailed ? "failed" : "inactive";
                            const storedUsername = provider.username ?? providerCredentials[provider.id]?.username ?? "configured account";
                            const expiryText = provider.expiresAt ? new Date(provider.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : provider.type === "xtream" ? "No expiry on file" : "M3U playlist source";
                            const brandText = provider.type === "xtream" ? "XT" : provider.type === "m3u" ? "M3" : "IP";
                            return (_jsxs("article", { className: "provider-card provider-hero-card", onDoubleClick: () => openDetails(provider), children: [_jsxs("div", { className: "provider-card-header", children: [_jsxs("div", { className: "provider-brand-lockup", children: [_jsx("div", { className: "provider-brand-badge", "aria-hidden": "true", children: brandText }), _jsxs("div", { className: "provider-account-meta", children: [_jsx("strong", { children: provider.name }), _jsx("span", { children: provider.type.toUpperCase() })] })] }), _jsx("span", { className: `provider-status-badge ${stateClass}`, children: stateLabel })] }), _jsxs("div", { className: "provider-card-identity-row", children: [_jsxs("div", { children: [_jsx("small", { children: "Username" }), _jsx("strong", { children: storedUsername })] }), _jsxs("div", { children: [_jsx("small", { children: "Expiration" }), _jsx("strong", { children: expiryText })] })] }), _jsxs("div", { className: "provider-card-footer", children: [_jsx("button", { type: "button", className: "delete-button danger-button", onClick: () => onDeleteProvider(provider.id), disabled: Boolean(deletingProviderId), children: deletingProviderId === provider.id ? "Deleting…" : "Delete" }), _jsx("button", { type: "button", className: `toggle-button ${isActive ? "active" : "inactive"}`, disabled: statusChangingProviderId === provider.id, onClick: () => onSetProviderStatus(provider.id, isActive ? "inactive" : "active"), children: statusChangingProviderId === provider.id ? (isActive ? "Deactivating…" : "Activating…") : (isActive ? "Deactivate" : "Activate") })] })] }, provider.id));
                        }), inactiveProviders.length > 0 ? (_jsxs("div", { style: { marginTop: 18, borderTop: "1px solid #243649", paddingTop: 16 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }, children: [_jsx("strong", { style: { color: "#8fa1b3" }, children: "Disabled accounts" }), _jsxs("span", { style: { color: "#6f7d8a", fontSize: "0.9rem" }, children: [inactiveProviders.length, " inactive"] })] }), _jsx("div", { style: { display: "grid", gap: 10 }, children: inactiveProviders.map((provider) => (_jsxs("div", { style: {
                                            border: "1px solid #243649",
                                            background: "rgba(8, 16, 24, 0.76)",
                                            borderRadius: 10,
                                            padding: "10px 12px",
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 12
                                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, color: "#e7edf4" }, children: provider.name }), _jsx("div", { style: { color: "#8fa1b3", fontSize: "0.9rem" }, children: provider.type.toUpperCase() })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { className: "provider-status-badge inactive", children: "Deactivated" }), _jsx("button", { type: "button", disabled: statusChangingProviderId === provider.id, onClick: () => onSetProviderStatus(provider.id, "active"), children: statusChangingProviderId === provider.id ? "Activating…" : "Activate" })] })] }, provider.id))) })] })) : null] })) })] }));
}
