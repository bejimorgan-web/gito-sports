import { useState } from "react";

import type { Channel, CreateProviderRequest, IPTVProvider, ProviderConnectionTest } from "@gito/shared";
import { IptvImportScreen } from "./IptvImportScreen";
import { IptvProvidersScreen } from "./IptvProvidersScreen";

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
  providers: IPTVProvider[];
  onCreateProvider: (input: CreateProviderRequest) => Promise<void>;
  onIngestM3u: (providerId: string, playlist: string) => Promise<void>;
  onUpdateProvider?: (providerId: string, input: Partial<CreateProviderRequest>) => Promise<void>;
  onDeleteProvider?: (providerId: string) => Promise<void>;
  onSyncXtream: (providerId: string) => Promise<void>;
  onTestProvider: (input: CreateProviderRequest) => Promise<ProviderConnectionTest>;
  onTestProviderById?: (providerId: string) => Promise<any>;
  onSetProviderStatus?: (providerId: string, status: string) => Promise<void>;
}

export function IptvManagementScreen({
  channels,
  providers,
  onCreateProvider,
  onIngestM3u,
  onUpdateProvider,
  onDeleteProvider,
  onSyncXtream,
  onTestProvider,
  onTestProviderById,
  onSetProviderStatus
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
  const providerInput: CreateProviderRequest = {
    name: providerName.trim(),
    baseUrl: baseUrl.trim(),
    type,
    authType: type === "xtream" ? "basic" : "none",
    ...(type === "xtream" && username ? { username } : {}),
    ...(type === "xtream" && password ? { password } : {})
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

    try {
      const validationResult = await onTestProvider(providerInput);
      if (!validationResult.ok) {
        setStatusMessage(validationResult.message || "Provider validation failed.");
        return;
      }

      setStatusMessage(selectedProviderId ? "Saving provider..." : "Creating provider...");

      if (selectedProviderId && onUpdateProvider) {
        await onUpdateProvider(selectedProviderId, providerInput);
        setStatusMessage("Provider updated.");
      } else {
        await onCreateProvider(providerInput);
        setStatusMessage("Provider created.");
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Provider save failed.");
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

    try {
      if (selectedProviderId && onTestProviderById) {
        const result = await onTestProviderById(selectedProviderId);
        setStatusMessage(result?.message ?? "Provider test completed.");
      } else {
        const result = await onTestProvider(providerInput);
        setStatusMessage(result.message);
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Provider test failed.");
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
      await onIngestM3u(selectedProviderId, playlist);
      setImportStatus("Import completed.");
    } catch (error) {
      setImportStatus(getFriendlyErrorMessage(error) || "Import failed.");
    }
  };

  const handleSyncXtream = async () => {
    if (!selectedProviderId) {
      setImportStatus("Select an Xtream provider first.");
      return;
    }

    setImportStatus("Syncing Xtream channels...");

    try {
      await onSyncXtream(selectedProviderId);
      setImportStatus("Xtream sync completed.");
    } catch (error) {
      setImportStatus(getFriendlyErrorMessage(error) || "Xtream sync failed.");
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!onDeleteProvider) return;

    if (!window.confirm("Delete provider and its channels?")) return;

    setStatusMessage("Deleting provider...");

    try {
      await onDeleteProvider(providerId);
      setStatusMessage("Provider deleted.");
      if (selectedProviderId === providerId) {
        handleSelectProvider("");
      }
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Delete failed.");
    }
  };

  const handleSetProviderStatus = async (providerId: string, nextStatus: string) => {
    if (!onSetProviderStatus) return;

    setStatusMessage("Updating provider status...");

    try {
      await onSetProviderStatus(providerId, nextStatus);
      setStatusMessage("Provider status updated.");
    } catch (error) {
      setStatusMessage(getFriendlyErrorMessage(error) || "Unable to update provider status.");
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
          onSetProviderStatus={handleSetProviderStatus}
          onTestProviderById={onTestProviderById}
          onValidateProvider={handleTestConnection}
        />

        <IptvImportScreen
          providers={providers}
          selectedProviderId={selectedProviderId}
          playlist={playlist}
          importStatus={importStatus}
          onSelectProvider={handleSelectProvider}
          onChangePlaylist={setPlaylist}
          onSyncXtream={handleSyncXtream}
          onImportM3u={handleImportM3u}
        />
      </div>

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
