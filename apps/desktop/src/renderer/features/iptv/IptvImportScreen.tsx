import type { Channel, IPTVProvider } from "@gito/shared";

interface IptvImportScreenProps {
  providers: IPTVProvider[];
  selectedProviderId: string;
  playlist: string;
  importStatus: string;
  onSelectProvider: (providerId: string) => void;
  onChangePlaylist: (value: string) => void;
  onSyncXtream: () => Promise<void>;
  onImportM3u: () => Promise<void>;
}

export function IptvImportScreen({
  providers,
  selectedProviderId,
  playlist,
  importStatus,
  onSelectProvider,
  onChangePlaylist,
  onSyncXtream,
  onImportM3u
}: IptvImportScreenProps) {
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Import</h3>
        <span>{selectedProvider ? selectedProvider.name : "Select a provider"}</span>
      </div>

      <label>
        Provider
        <select value={selectedProviderId} onChange={(event) => onSelectProvider(event.target.value)}>
          <option value="">Choose provider</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} {provider.type.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      <div className="button-row">
        <button type="button" onClick={onSyncXtream} disabled={!selectedProvider || selectedProvider.type !== "xtream"}>
          Sync Xtream
        </button>
        <button type="button" onClick={onImportM3u} disabled={!selectedProvider || selectedProvider.type === "xtream"}>
          Import M3U
        </button>
      </div>

      {selectedProvider && selectedProvider.type !== "xtream" ? (
        <label>
          Playlist
          <textarea
            value={playlist}
            onChange={(event) => onChangePlaylist(event.target.value)}
            placeholder="#EXTM3U\n#EXTINF:-1,Channel\nhttps://stream.example.com/live.m3u8"
          />
        </label>
      ) : null}

      <div className="status-line">
        <small>{importStatus}</small>
      </div>

      <div className="hint-row">
        <span>Use Xtream for provider sync and M3U for manual playlist import.</span>
      </div>
    </section>
  );
}
