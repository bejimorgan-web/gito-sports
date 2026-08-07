import type { Channel, ParsedChannel } from "@gito/shared";
import * as LegacyProviderRepository from "../repositories/provider-repository.js";

export class IptvChannelService {
  static upsertChannel(input: Partial<Channel>) {
    return LegacyProviderRepository.syncProviderChannels(input.providerId ?? "", []);
  }

  static listByProvider(providerId: string) {
    return LegacyProviderRepository.listChannels({ providerId });
  }

  static listChannels(opts?: { providerId?: string; q?: string; category?: string }, mode: "active" | "includeInactive" | "debug" | "raw" = "active") {
    if (mode === "debug") {
      return LegacyProviderRepository.listChannelsDebug(opts) as unknown as Channel[];
    }

    if (mode === "active") {
      return LegacyProviderRepository.listChannels(opts);
    }

    return LegacyProviderRepository.listChannelsDebug(opts) as unknown as Channel[];
  }

  static listChannelsDebug(opts?: { providerId?: string; q?: string; category?: string }) {
    return LegacyProviderRepository.listChannelsDebug(opts) as unknown as Channel[];
  }

  static listCategories(providerId?: string) {
    return LegacyProviderRepository.listChannelCategories(providerId);
  }

  static syncProviderChannels(providerId: string, channels: ParsedChannel[]) {
    return LegacyProviderRepository.syncProviderChannels(providerId, channels);
  }

  static getProviderChannelDiagnostics(providerId: string) {
    return LegacyProviderRepository.getProviderChannelDiagnostics(providerId);
  }

  static getLatestIngestionReport(providerId: string) {
    return LegacyProviderRepository.getLatestIngestionReport(providerId);
  }

  static getParityDiagnostics(providerId: string) {
    return LegacyProviderRepository.getParityDiagnostics(providerId);
  }

  static search(q: string, limit = 50) {
    return LegacyProviderRepository.listChannels({ q }).slice(0, limit);
  }
}
