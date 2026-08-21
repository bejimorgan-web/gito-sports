import { useEffect, useState } from "react";

import type { Channel, CreateProviderRequest, IptvOperation, IptvOperationType, IPTVProvider, PaginatedChannels, ProviderConnectionTest } from "@gito/shared";
import { IptvImportScreen } from "./IptvImportScreen";
import { IptvOperationProgress } from "./IptvOperationProgress";
import { IptvProvidersScreen } from "./IptvProvidersScreen";
import { IptvChannelsScreen } from "./IptvChannelsScreen";

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
  onCreateProvider: (input: CreateProviderRequest) => Promise<void>;
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
}

export function IptvManagementScreen({
  channels,
  channelPage,
  onLoadChannelPage,
  providers,
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
  onCancelIptvOperation
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
    if (!operation || operation.status === "completed" || operation.status === "failed" || operation.status === "cancelled") return;
    const timer = window.setInterval(() => {
      void onGetIptvOperation(operation.id).then(setOperation).catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [operation, onGetIptvOperation]);

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
    const provider = providers.find((item) => item.id === providerId);

    if (provider) {
      setProviderName(provider.name);
      setBaseUrl(provider.baseUrl);
      setType(provider.type as CreateProviderRequest["type"]);
      setUsername("");
      setPassword("");
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
        setStatusMessage("Provider updated.");
      } else {
        await onCreateProvider(providerInput);
        setStatusMessage("Provider created.");
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
          channels={channels}
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
        page={channelPage}
        providers={providers}
        selectedChannelId={selectedChannelId}
        search={channelSearch}
        category={channelCategory}
        selectedProviderId={channelProviderFilter}
        onSelectChannel={(channel) => setSelectedChannelId(channel.id)}
        onSearchChange={setChannelSearch}
        onCategoryChange={setChannelCategory}
        onProviderFilterChange={setChannelProviderFilter}
        onPageChange={loadChannelPage}
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
