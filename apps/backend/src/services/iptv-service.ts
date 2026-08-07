import type { Channel, CreateProviderRequest, IPTVProvider } from "@gito/shared";
import { EventBus } from "../events/event-bus.js";
import { IptvProviderService } from "./iptv-provider-service.js";
import { IptvChannelService } from "./iptv-channel-service.js";
import type { IptvChannelRow, IptvProviderRow } from "../repositories/iptv-repository.js";

const channelCache = new Map<string, Channel[] | unknown[]>();

function buildCacheKey(providerId: string | undefined, mode: "active" | "includeInactive" | "debug" | "raw", opts?: { q?: string; category?: string }) {
  return `${providerId ?? "all"}:${mode}:${opts?.q ?? ""}:${opts?.category ?? ""}`;
}

function clearChannelCache(providerId?: string) {
  if (providerId) {
    for (const key of Array.from(channelCache.keys())) {
      if (key.startsWith(`${providerId}:`)) {
        channelCache.delete(key);
      }
    }
    return;
  }

  channelCache.clear();
}

EventBus.on("iptv:sync:completed", (payload) => {
  const providerId = payload && typeof payload === "object" && (payload as any).providerId;
  if (typeof providerId === "string") {
    clearChannelCache(providerId);
  }
});

EventBus.on("iptv:provider:updated", (payload) => {
  const providerId = payload && typeof payload === "object" && (payload as any).providerId;
  if (typeof providerId === "string") {
    clearChannelCache(providerId);
  }
});

export const IPTVService = {
  listProviders(): IPTVProvider[] {
    return IptvProviderService.listProviders();
  },

  getProvider(providerId: string): IPTVProvider | undefined {
    return IptvProviderService.getProvider(providerId) ?? undefined;
  },

  createProvider(input: CreateProviderRequest): IPTVProvider | null {
    return IptvProviderService.createProvider(input);
  },

  updateProvider(providerId: string, input: Partial<CreateProviderRequest>): IPTVProvider | null {
    return IptvProviderService.updateProvider(providerId, input) ?? null;
  },

  deleteProvider(providerId: string): boolean {
    return IptvProviderService.deleteProvider(providerId);
  },

  getProviderChannels(providerId?: string, mode: "active" | "includeInactive" | "debug" | "raw" = "active", opts?: { q?: string; category?: string }) {
    const cacheKey = buildCacheKey(providerId, mode, opts);
    const cached = channelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const query = {
      ...(opts ?? {})
    } as { providerId?: string; q?: string; category?: string };

    if (providerId !== undefined) {
      query.providerId = providerId;
    }

    const result = IptvChannelService.listChannels(query, mode);
    channelCache.set(cacheKey, result);
    return result;
  },

  listChannels(opts?: { providerId?: string; q?: string; category?: string }, mode: "active" | "includeInactive" | "debug" | "raw" = "active") {
    return this.getProviderChannels(opts?.providerId, mode, opts);
  },

  listChannelsDebug(opts?: { providerId?: string; q?: string; category?: string }) {
    return this.getProviderChannels(opts?.providerId, "debug", opts);
  },

  getProviderChannelDiagnostics(providerId: string) {
    return IptvChannelService.getProviderChannelDiagnostics(providerId);
  },

  listCategories(providerId?: string): string[] {
    return IptvChannelService.listCategories(providerId);
  },

  getProviderCredentials(providerId: string) {
    return IptvProviderService.getProviderCredentials(providerId);
  },

  syncProviderChannels(providerId: string, channels: any[]) {
    return IptvChannelService.syncProviderChannels(providerId, channels);
  },

  setProviderStatus(providerId: string, status: 'active' | 'failed' | 'pending' | 'invalid' | 'inactive') {
    return IptvProviderService.setProviderStatus(providerId, status);
  },

  getLatestIngestionReport(providerId: string): any {
    return IptvChannelService.getLatestIngestionReport(providerId);
  },

  getParityDiagnostics(providerId: string): any {
    return IptvChannelService.getParityDiagnostics(providerId);
  }
};
