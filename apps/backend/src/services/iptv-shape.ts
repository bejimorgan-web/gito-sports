import type { Channel, IPTVProvider } from "@gito/shared";
import type { IptvChannelRow, IptvProviderRow } from "../repositories/iptv-repository.js";

export function mapIptvProviderRow(row: IptvProviderRow): IPTVProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.server_url,
    type: row.type as IPTVProvider["type"],
    authType: "none",
    syncMode: undefined,
    status: row.enabled === 1 ? (row.health_status === "failed" ? "failed" : "active") : "inactive",
    availabilityStatus: (row.health_status as IPTVProvider["availabilityStatus"]) ?? "unknown",
    failedChannelLoads: 0,
    healthScore: 100,
    lastSuccessfulStreamLoadAt: row.last_refresh_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapIptvChannelRow(row: IptvChannelRow): Channel {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    externalRef: row.provider_channel_id ?? undefined,
    groupName: row.category ?? undefined,
    url: row.stream_url,
    status: "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
