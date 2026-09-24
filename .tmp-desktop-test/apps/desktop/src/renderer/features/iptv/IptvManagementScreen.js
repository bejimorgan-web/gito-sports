import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { IptvImportScreen } from "./IptvImportScreen";
import { IptvOperationProgress } from "./IptvOperationProgress";
import { IptvProvidersScreen } from "./IptvProvidersScreen";
import { IptvChannelsScreen } from "./IptvChannelsScreen";
import { IptvCatalogueScreen } from "./IptvCatalogueScreen";
function getFriendlyErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/status 502|bad gateway|502/i.test(message)) {
        return "The provider service is currently rejecting the request. Please verify the URL and credentials, then try again.";
    }
    if (/failed to fetch|network|fetch/i.test(message)) {
        return "The backend could not reach the provider endpoint. Please verify the URL and connectivity and try again.";
    }
    return message;
}
export function IptvManagementScreen({ channels, channelPage, onLoadChannelPage, providers, selectedProviderId, onSelectProvider, providerDiagnostics, onCreateProvider, onIngestM3u, onUpdateProvider, onDeleteProvider, onSyncXtream, onTestProvider, onTestProviderById, onSetProviderStatus, onStartIptvOperation, onGetIptvOperation, onCancelIptvOperation, onRefreshIptv }) {
    const [providerName, setProviderName] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [type, setType] = useState("manual");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [playlist, setPlaylist] = useState("");
    const [statusMessage, setStatusMessage] = useState("Ready");
    const [importStatus, setImportStatus] = useState("Ready");
    const [operation, setOperation] = useState();
    const [providerAction, setProviderAction] = useState("idle");
    const [statusChangingProviderId, setStatusChangingProviderId] = useState(null);
    const [deletingProviderId, setDeletingProviderId] = useState(null);
    const [channelSearch, setChannelSearch] = useState("");
    const [channelCategory, setChannelCategory] = useState("");
    const [channelProviderFilter, setChannelProviderFilter] = useState("");
    const [selectedChannelId, setSelectedChannelId] = useState();
    const providerInput = {
        name: providerName.trim(),
        baseUrl: baseUrl.trim(),
        type,
        authType: type === "xtream" ? "basic" : "none",
        ...(type === "xtream" && username ? { username } : {}),
        ...(type === "xtream" && password ? { password } : {})
    };
    useEffect(() => {
        if (!operation)
            return;
        const terminal = operation.status === "completed" || operation.status === "failed" || operation.status === "timeout" || operation.status === "cancelled" || operation.status === "interrupted";
        if (terminal) {
            const message = operation.status === "completed"
                ? operation.currentMessage
                : operation.status === "timeout"
                    ? "Validation timed out. Check the provider URL and retry."
                    : operation.currentMessage || "Validation failed. Check the provider details and retry.";
            setStatusMessage(message);
            setImportStatus(message);
            setProviderAction("idle");
            void onRefreshIptv();
            return;
        }
        const timer = window.setInterval(() => {
            void onGetIptvOperation(operation.id)
                .then((nextOperation) => setOperation(nextOperation ?? null))
                .catch((error) => {
                const message = error instanceof Error ? error.message : "Unable to read validation status.";
                setStatusMessage(message);
                setImportStatus(message);
                setProviderAction("idle");
            });
        }, 750);
        return () => window.clearInterval(timer);
    }, [operation, onGetIptvOperation, onRefreshIptv]);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            void onLoadChannelPage({
                page: 1,
                ...(channelSearch.trim() ? { q: channelSearch.trim() } : {}),
                ...(channelCategory ? { category: channelCategory } : {}),
                ...(channelProviderFilter ? { providerId: channelProviderFilter } : {})
            });
        }, 250);
        return () => window.clearTimeout(timer);
    }, [channelSearch, channelCategory, channelProviderFilter, onLoadChannelPage]);
    const loadChannelPage = (page) => {
        void onLoadChannelPage({
            page,
            ...(channelSearch.trim() ? { q: channelSearch.trim() } : {}),
            ...(channelCategory ? { category: channelCategory } : {}),
            ...(channelProviderFilter ? { providerId: channelProviderFilter } : {})
        });
    };
    const startOperation = async (type, input = {}) => {
        const started = await onStartIptvOperation(type, input);
        setOperation(started);
        return started;
    };
    const handleSelectProvider = (providerId) => {
        onSelectProvider(providerId);
        setChannelProviderFilter(providerId);
        const provider = providers.find((item) => item.id === providerId);
        if (provider) {
            setProviderName(provider.name);
            setBaseUrl(provider.baseUrl);
            setType(provider.type);
            setUsername(provider.username ?? "");
            setPassword(provider.password ?? "");
            setStatusMessage("Ready");
            setImportStatus("Ready");
        }
        else {
            setProviderName("");
            setBaseUrl("");
            setType("manual");
            setUsername("");
            setPassword("");
        }
    };
    const handleCreateOrUpdateProvider = async () => {
        if (!providerName.trim() || !baseUrl.trim()) {
            setStatusMessage("Name and base URL are required.");
            return;
        }
        if (type === "xtream" && (!username.trim() || !password.trim())) {
            setStatusMessage("Xtream providers require both username and password.");
            return;
        }
        setStatusMessage(selectedProviderId ? "Saving provider..." : "Creating provider...");
        setProviderAction("saving");
        try {
            let providerId = selectedProviderId;
            if (selectedProviderId && onUpdateProvider) {
                await onUpdateProvider(selectedProviderId, providerInput);
            }
            else {
                const createdProvider = await onCreateProvider(providerInput);
                providerId = createdProvider.id;
                setStatusMessage(createdProvider.type === "xtream" ? "Provider created. Synchronizing Xtream catalogue..." : createdProvider.type === "m3u" ? "Provider created. Starting M3U catalogue sync..." : "Provider created.");
                if (createdProvider.syncOperationId) {
                    const syncOperation = await onGetIptvOperation(createdProvider.syncOperationId);
                    setOperation(syncOperation);
                }
            }
            if (providerId && onTestProviderById) {
                setStatusMessage("Validating provider connection...");
                const validationResult = await onTestProviderById(providerId);
                if (!validationResult?.ok) {
                    setStatusMessage(validationResult?.message || "Provider validation failed.");
                    return;
                }
            }
            else {
                setStatusMessage("Validating provider connection...");
                const validationResult = await onTestProvider(providerInput);
                if (!validationResult?.ok) {
                    setStatusMessage(validationResult?.message || "Provider validation failed.");
                    return;
                }
            }
            if (selectedProviderId && onUpdateProvider) {
                if (type === "xtream") {
                    setStatusMessage("Provider updated. Synchronizing live TV, movies, and series...");
                    await onSyncXtream(selectedProviderId);
                    setStatusMessage("Provider updated and full catalogue synchronization started.");
                }
                else if (type === "m3u") {
                    setStatusMessage("Provider updated. Starting M3U catalogue sync...");
                    await startOperation("m3u_import", { providerId: selectedProviderId });
                    setStatusMessage("Provider updated and M3U catalogue sync started.");
                }
                else {
                    setStatusMessage("Provider updated.");
                }
            }
            if (!selectedProviderId && type === "m3u" && providerId) {
                setStatusMessage("Provider validated. Starting M3U catalogue sync...");
                await startOperation("m3u_import", { providerId });
                setStatusMessage("Provider validated and M3U catalogue sync started.");
            }
        }
        catch (error) {
            setStatusMessage(getFriendlyErrorMessage(error) || "Provider save failed.");
        }
        finally {
            setProviderAction("idle");
        }
    };
    const handleTestConnection = async () => {
        if (!providerName.trim() || !baseUrl.trim()) {
            setStatusMessage("Name and base URL are required to test.");
            return;
        }
        if (type === "xtream" && (!username.trim() || !password.trim())) {
            setStatusMessage("Xtream providers require both username and password to test.");
            return;
        }
        setStatusMessage("Testing provider connection...");
        setProviderAction("validating");
        try {
            if (type === "xtream") {
                if (!selectedProviderId) {
                    setStatusMessage("Save the provider first so credentials can be stored securely and validated locally.");
                    return;
                }
                await startOperation("xtream_validation", {
                    providerId: selectedProviderId
                });
                setStatusMessage("Validation started. Follow the progress below.");
            }
            else if (type === "m3u") {
                const result = await onTestProvider(providerInput);
                setStatusMessage(result.message || "M3U playlist validated. No channels were saved.");
            }
            else if (selectedProviderId && onTestProviderById) {
                const result = await onTestProviderById(selectedProviderId);
                setStatusMessage(result?.message ?? "Provider test completed.");
            }
            else {
                const result = await onTestProvider(providerInput);
                setStatusMessage(result.message);
            }
        }
        catch (error) {
            setStatusMessage(getFriendlyErrorMessage(error) || "Provider test failed.");
        }
        finally {
            setProviderAction("idle");
        }
    };
    const handleImportM3u = async () => {
        if (!selectedProviderId) {
            setImportStatus("Select a provider first.");
            return;
        }
        if (!playlist.trim()) {
            setImportStatus("Paste an M3U playlist to import.");
            return;
        }
        setImportStatus("Importing M3U playlist...");
        try {
            await startOperation("m3u_import", { providerId: selectedProviderId, playlist });
            setImportStatus("Import started. Follow the progress below.");
        }
        catch (error) {
            setImportStatus(getFriendlyErrorMessage(error) || "Import failed.");
        }
    };
    const handleValidateM3u = async () => {
        if (!selectedProviderId || !playlist.trim()) {
            setImportStatus("Select a provider and provide an M3U playlist first.");
            return;
        }
        try {
            await startOperation("m3u_validation", { providerId: selectedProviderId, playlist });
            setImportStatus("M3U validation started. No channels will be saved.");
        }
        catch (error) {
            setImportStatus(getFriendlyErrorMessage(error) || "M3U validation failed.");
        }
    };
    const handleSyncXtream = async () => {
        if (!selectedProviderId) {
            setImportStatus("Select an Xtream provider first.");
            return;
        }
        setImportStatus("Syncing Xtream channels...");
        try {
            await startOperation("xtream_channel_sync", { providerId: selectedProviderId });
            setImportStatus("Xtream sync started. Follow the progress below.");
        }
        catch (error) {
            setImportStatus(getFriendlyErrorMessage(error) || "Xtream sync failed.");
        }
    };
    const handleDeleteProvider = async (providerId) => {
        if (!onDeleteProvider || deletingProviderId)
            return;
        if (!window.confirm("Delete provider and its channels?"))
            return;
        setStatusMessage("Deleting provider...");
        setDeletingProviderId(providerId);
        try {
            await onDeleteProvider(providerId);
            setStatusMessage("Provider deleted.");
            if (selectedProviderId === providerId) {
                handleSelectProvider("");
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setStatusMessage(/failed to fetch|network|502|503|504/i.test(message)
                ? "The backend is temporarily unavailable. The account was not deleted; try again when the backend is online."
                : message || "Delete failed.");
        }
        finally {
            setDeletingProviderId(null);
        }
    };
    const handleSetProviderStatus = async (providerId, nextStatus) => {
        if (!onSetProviderStatus)
            return;
        setStatusChangingProviderId(providerId);
        setStatusMessage(`${nextStatus === "active" ? "Activating" : "Deactivating"} provider...`);
        try {
            await onSetProviderStatus(providerId, nextStatus);
            setStatusMessage("Provider status updated.");
        }
        catch (error) {
            setStatusMessage(getFriendlyErrorMessage(error) || "Unable to update provider status.");
        }
        finally {
            setStatusChangingProviderId(null);
        }
    };
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "IPTV" }), _jsx("h2", { children: "IPTV Management" }), _jsx("span", { children: "Manage providers, import channels, and select IPTV sources for preview." })] }), _jsxs("div", { className: "operations-grid", children: [_jsx(IptvProvidersScreen, { providers: providers, providerDiagnostics: providerDiagnostics, selectedProviderId: selectedProviderId, providerName: providerName, baseUrl: baseUrl, type: type, username: username, password: password, statusMessage: statusMessage, onSelectProvider: handleSelectProvider, onChangeProviderName: setProviderName, onChangeBaseUrl: setBaseUrl, onChangeType: setType, onChangeUsername: setUsername, onChangePassword: setPassword, onCreateProvider: handleCreateOrUpdateProvider, onUpdateProvider: handleCreateOrUpdateProvider, onDeleteProvider: handleDeleteProvider, deletingProviderId: deletingProviderId, onSetProviderStatus: handleSetProviderStatus, onTestProviderById: onTestProviderById, onValidateProvider: handleTestConnection, providerAction: providerAction, statusChangingProviderId: statusChangingProviderId }), _jsx(IptvImportScreen, { providers: providers, selectedProviderId: selectedProviderId, playlist: playlist, importStatus: importStatus, onSelectProvider: handleSelectProvider, onChangePlaylist: setPlaylist, onValidateM3u: handleValidateM3u, onSyncXtream: handleSyncXtream, onImportM3u: handleImportM3u })] }), _jsx(IptvChannelsScreen, { providers: providers, selectedProviderId: channelProviderFilter, onProviderFilterChange: handleSelectProvider, below: selectedProviderId ? _jsx(IptvCatalogueScreen, { providerId: selectedProviderId }) : (_jsxs("section", { className: "console-panel iptv-catalogue-empty", children: [_jsx("h3", { children: "IPTV Content Browser" }), _jsx("p", { className: "field-note", children: "Select a saved IPTV provider to browse its channel groups, movies, series, seasons, episodes, and guide data." })] })) }), operation ? _jsx(IptvOperationProgress, { operation: operation, onCancel: async () => { await onCancelIptvOperation(operation.id); } }) : null, _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Account Summary" }), _jsxs("span", { children: [providers.length, " accounts connected"] })] }), _jsx("div", { className: "status-line", children: _jsx("small", { children: statusMessage }) })] })] }));
}
