import { useEffect, useState } from "react";

import type { Channel, CreateProviderRequest, IptvOperation, IptvOperationType, IPTVProvider, PaginatedChannels, ProviderChannelDiagnostics, ProviderConnectionTest } from "@gito/shared";
import { IptvImportScreen } from "./IptvImportScreen";
import { IptvOperationProgress } from "./IptvOperationProgress";
import { IptvProvidersScreen } from "./IptvProvidersScreen";
import { IptvChannelsScreen } from "./IptvChannelsScreen";
import { IptvCatalogueScreen } from "./IptvCatalogueScreen";

function getFriendlyErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/status 502|bad gateway|502/i.test(message)) {
    return "The provider service is currently rejecting the request. Please verify the URL and credentials, then try again.";
  }

  if (/failed to fetch|network|fetch/i.test(message)) {
    return "The backend could not reach the provider endpoint. Please verify the URL and connectivity and try again.";
  }

  return message;
}

interface IptvManagementScreenProps {
  channels: Channel[];
  channelPage: PaginatedChannels<Channel>;
  onLoadChannelPage: (options: { page: number; q?: string; category?: string; providerId?: string }) => Promise<void>;
  providers: IPTVProvider[];
  providerDiagnostics: Record<string, ProviderChannelDiagnostics>;
  onCreateProvider: (input: CreateProviderRequest) => Promise<IPTVProvider & { syncOperationId?: string }>;
  onIngestM3u: (providerId: string, playlist: string) => Promise<void>;
  onUpdateProvider?: (providerId: string, input: Partial<CreateProviderRequest>) => Promise<void>;
  onDeleteProvider?: (providerId: string) => Promise<void>;
  onSyncXtream: (providerId: string) => Promise<void>;
  onTestProvider: (input: CreateProviderRequest) => Promise<ProviderConnectionTest>;
  onTestProviderById?: (providerId: string) => Promise<any>;
  onSetProviderStatus?: (providerId: string, status: string) => Promise<void>;
  onStartIptvOperation: (type: IptvOperationType, input?: { providerId?: string; playlist?: string; baseUrl?: string; username?: string; password?: string }) => Promise<IptvOperation>;
  onGetIptvOperation: (operationId: string) => Promise<IptvOperation>;
  onCancelIptvOperation: (operationId: string) => Promise<IptvOperation>;
  onRefreshIptv: () => Promise<void>;
}

export function IptvManagementScreen({
  channels,
  channelPage,
  onLoadChannelPage,
  providers,
  providerDiagnostics,
  onCreateProvider,
  onIngestM3u,
  onUpdateProvider,
  onDeleteProvider,
  onSyncXtream,
  onTestProvider,
  onTestProviderById,
  onSetProviderStatus,
  onStartIptvOperation,
  onGetIptvOperation,
  onCancelIptvOperation,
  onRefreshIptv
}: IptvManagementScreenProps) {
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [type, setType] = useState<CreateProviderRequest["type"]>("manual");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [importStatus, setImportStatus] = useState("Ready");
  const [operation, setOperation] = useState<IptvOperation>();
  const [providerAction, setProviderAction] = useState<"idle" | "validating" | "saving">("idle");
  const [statusChangingProviderId, setStatusChangingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelCategory, setChannelCategory] = useState("");
  const [channelProviderFilter, setChannelProviderFilter] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>();
  const providerInput: CreateProviderRequest = {
    name: providerName.trim(),
    baseUrl: baseUrl.trim(),
    type,
    authType: type === "xtream" ? "basic" : "none",
    ...(type === "xtream" && username ? { username } : {}),
    ...(type === "xtream" && password ? { password } : {})
  };

  useEffect(() => {
    if (!operation) return;
    const terminal = operation.status === "completed" || operation.status === "failed" || operation.status === "timeout" || operation.status === "cancelled";
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
        .then(setOperation)
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

  useEffect(() => {
    if (!selectedProviderId) {
      const firstActiveProvider = providers.find((provider) => provider.status === "active");
      if (firstActiveProvider) setSelectedProviderId(firstActiveProvider.id);
    }
    if (!channelProviderFilter) {
      const firstActiveProvider = providers.find((provider) => provider.status === "active");
      if (firstActiveProvider) setChannelProviderFilter(firstActiveProvider.id);
    }
  }, [channelProviderFilter, providers, selectedProviderId]);

  const loadChannelPage = (page: number) => {
    void onLoadChannelPage({
      page,
      ...(channelSearch.trim() ? { q: channelSearch.trim() } : {}),
      ...(channelCategory ? { category: channelCategory } : {}),
      ...(channelProviderFilter ? { providerId: channelProviderFilter } : {})
    });
  };

  const startOperation = async (type: IptvOperationType, input: { providerId?: string; playlist?: string; baseUrl?: string; username?: string; password?: string } = {}) => {
    const started = await onStartIptvOperation(type, input);
    setOperation(started);
    return started;
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setChannelProviderFilter(providerId);
    const provider = providers.find((item) => item.id === providerId);

    if (provider) {
      setProviderName(provider.name);
      setBaseUrl(provider.baseUrl);
      setType(provider.type as CreateProviderRequest["type"]);
      setUsername(provider.username ?? "");
      setPassword(provider.password ?? "");
      setStatusMessage("Ready");
      setImportStatus("Ready");
    } else {
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

    setStatusMessage("Validating provider connection...");
    setProviderAction("validating");

    try {
      const validationResult = await onTestProvider(providerInput);
      if (!validationResult.ok) {
        setStatusMessage(validationResult.message || "Provider validation failed.");
        return;
      }

      setStatusMessage(selectedProviderId ? "Saving provider..." : "Creating provider...");
      setProviderAction("saving");

      if (selectedProviderId && onUpdateProvider) {
        await onUpdateProvider(selectedProviderId, providerInput);
        if (type === "xtream") {
          setStatusMessage("Provider updated. Synchronizing live TV, movies, and series...");
          await onSyncXtream(selectedProviderId);
          setStatusMessage("Provider updated and full catalogue synchronization started.");
        } else {
          setStatusMessage("Provider updated.");
        }
      } else {
        const createdProvider = await onCreateProvider(providerInput);
        setStatusMessage(createdProvider.type === "xtream" ? "Provider created. Synchronizing Xtream catalogue..." : "Provider created.");
        if (createdProvider.syncOperationId) {
          const syncOperation = await onGetIptvOperation(createdProvider.syncOperationId);
          setOperation(syncOperation);
        }
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Provider save failed.");
    } finally {
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
        await startOperation("xtream_validation", {
          ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
          baseUrl: baseUrl.trim(),
          username: username.trim(),
          password
        });
        setStatusMessage("Validation started. Follow the progress below.");
      } else if (type === "m3u") {
        await startOperation("m3u_validation", {
          ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
          ...(playlist.trim() ? { playlist } : {})
        });
        setStatusMessage("M3U validation started. No channels will be saved.");
      } else if (selectedProviderId && onTestProviderById) {
        const result = await onTestProviderById(selectedProviderId);
        setStatusMessage(result?.message ?? "Provider test completed.");
      } else {
        const result = await onTestProvider(providerInput);
        setStatusMessage(result.message);
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Provider test failed.");
    } finally {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      setImportStatus(getFriendlyErrorMessage(error) || "Xtream sync failed.");
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!onDeleteProvider || deletingProviderId) return;

    if (!window.confirm("Delete provider and its channels?")) return;

    setStatusMessage("Deleting provider...");
    setDeletingProviderId(providerId);

    try {
      await onDeleteProvider(providerId);
      setStatusMessage("Provider deleted.");
      if (selectedProviderId === providerId) {
        handleSelectProvider("");
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Delete failed.");
    } finally {
      setDeletingProviderId(null);
    }
  };

  const handleSetProviderStatus = async (providerId: string, nextStatus: string) => {
    if (!onSetProviderStatus) return;

    setStatusChangingProviderId(providerId);
    setStatusMessage(`${nextStatus === "active" ? "Activating" : "Deactivating"} provider...`);

    try {
      await onSetProviderStatus(providerId, nextStatus);
      setStatusMessage("Provider status updated.");
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Unable to update provider status.");
    } finally {
      setStatusChangingProviderId(null);
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">IPTV</p>
        <h2>IPTV Management</h2>
        <span>Manage providers, import channels, and select IPTV sources for preview.</span>
      </header>

      <div className="operations-grid">
        <IptvProvidersScreen
          providers={providers}
          providerDiagnostics={providerDiagnostics}
          selectedProviderId={selectedProviderId}
          providerName={providerName}
          baseUrl={baseUrl}
          type={type}
          username={username}
          password={password}
          statusMessage={statusMessage}
          onSelectProvider={handleSelectProvider}
          onChangeProviderName={setProviderName}
          onChangeBaseUrl={setBaseUrl}
          onChangeType={setType}
          onChangeUsername={setUsername}
          onChangePassword={setPassword}
          onCreateProvider={handleCreateOrUpdateProvider}
          onUpdateProvider={handleCreateOrUpdateProvider}
          onDeleteProvider={handleDeleteProvider}
          deletingProviderId={deletingProviderId}
          onSetProviderStatus={handleSetProviderStatus}
          onTestProviderById={onTestProviderById}
          onValidateProvider={handleTestConnection}
          providerAction={providerAction}
          statusChangingProviderId={statusChangingProviderId}
        />

        <IptvImportScreen
          providers={providers}
          selectedProviderId={selectedProviderId}
          playlist={playlist}
          importStatus={importStatus}
          onSelectProvider={handleSelectProvider}
          onChangePlaylist={setPlaylist}
          onValidateM3u={handleValidateM3u}
          onSyncXtream={handleSyncXtream}
          onImportM3u={handleImportM3u}
        />
      </div>

      <IptvChannelsScreen
        providers={providers}
        selectedProviderId={channelProviderFilter}
        onProviderFilterChange={setChannelProviderFilter}
        below={channelProviderFilter ? <IptvCatalogueScreen providerId={channelProviderFilter} /> : (
          <section className="console-panel iptv-catalogue-empty">
            <h3>IPTV Content Browser</h3>
            <p className="field-note">Select a saved IPTV provider to browse its channel groups, movies, series, seasons, episodes, and guide data.</p>
          </section>
        )}
      />

      {operation ? <IptvOperationProgress operation={operation} onCancel={async () => { await onCancelIptvOperation(operation.id); }} /> : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Account Summary</h3>
          <span>{providers.length} accounts connected</span>
        </div>
        <div className="status-line">
          <small>{statusMessage}</small>
        </div>
      </section>
    </section>
  );
}
