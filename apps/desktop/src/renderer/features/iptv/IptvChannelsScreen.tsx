import type { ReactNode } from "react";
import type { IPTVProvider } from "@gito/shared";

interface IptvChannelsScreenProps {
  providers: IPTVProvider[];
  selectedProviderId: string;
  onProviderFilterChange: (value: string) => void;
  below?: ReactNode;
}

export function IptvChannelsScreen({
  providers,
  selectedProviderId,
  onProviderFilterChange,
  below
}: IptvChannelsScreenProps) {
  const visibleProviders = providers.filter((provider) => provider.status === "active");
  const filteredProvider = visibleProviders.find((provider) => provider.id === selectedProviderId);

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>IPTV Channels</h3>
        <span>Browse provider catalogue</span>
      </div>

      <div className="filters-row">
        <label>
          Provider
          <select value={selectedProviderId} onChange={(event) => onProviderFilterChange(event.target.value)}>
            <option value="">All providers</option>
            {visibleProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="provider-summary-row">
        <span>{filteredProvider ? filteredProvider.name : "Select a saved provider"}</span>
        {filteredProvider ? <small>{filteredProvider.status.toUpperCase()}</small> : null}
      </div>
      {below}
    </section>
  );
}
