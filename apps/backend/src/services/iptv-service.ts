import type { Channel, CreateProviderRequest, IPTVProvider } from "@gito/shared";
import { EventBus } from "../events/event-bus";

import {
  createProvider,
  getProviderById,
  getProviderChannelDiagnostics,
  getProviderCredentials,
  getLatestIngestionReport,
  getParityDiagnostics,
  listChannelCategories,
  listProviderChannels,
  listProviders,
  setProviderStatus,
  softDeleteProvider,
  syncProviderChannels,
  updateProvider,
  type IngestionReport,
  type ParityDiagnostic
} from "../repositories/provider-repository";

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
    return listProviders();
  },

  getProvider(providerId: string): IPTVProvider | undefined {
    return getProviderById(providerId);
  },

  createProvider(input: CreateProviderRequest): IPTVProvider {
    return createProvider(input);
  },

  updateProvider(providerId: string, input: Partial<CreateProviderRequest>): IPTVProvider | undefined {
    return updateProvider(providerId, input);
  },

  deleteProvider(providerId: string): boolean {
    return softDeleteProvider(providerId);
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

    const result = listProviderChannels(mode as any, query);
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
    return getProviderChannelDiagnostics(providerId);
  },

  listCategories(providerId?: string): string[] {
    return listChannelCategories(providerId);
  },

  getProviderCredentials,
  syncProviderChannels,
  setProviderStatus,

  getLatestIngestionReport,
  getParityDiagnostics
};

export type { IngestionReport, ParityDiagnostic };
