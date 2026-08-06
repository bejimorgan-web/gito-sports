import crypto from "node:crypto";
import type { ParsedChannel } from "@gito/shared";
import { IptvRepository, IptvChannelRow } from "../repositories/iptv-repository.js";

function checksumForChannel(obj: { name?: string; stream_url?: string }) {
  const hasher = crypto.createHash('sha256');
  hasher.update((obj.name ?? '') + '::' + (obj.stream_url ?? ''));
  return hasher.digest('hex');
}

export class IptvChannelService {
  static upsertChannel(input: Partial<IptvChannelRow>) {
    const checksum = checksumForChannel({ name: input.name, stream_url: input.stream_url });
    const row: Partial<IptvChannelRow> = {
      id: input.id,
      provider_id: input.provider_id!,
      provider_channel_id: input.provider_channel_id ?? null,
      name: input.name ?? 'Unknown',
      logo_url: input.logo_url ?? null,
      category: input.category ?? null,
      language: input.language ?? null,
      country: input.country ?? null,
      resolution: input.resolution ?? null,
      stream_url: input.stream_url ?? '',
      checksum
    };

    return IptvRepository.upsertChannel(row);
  }

  static listByProvider(providerId: string) {
    return IptvRepository.listChannelsByProvider(providerId);
  }

  static listChannels(opts?: { providerId?: string; q?: string; category?: string }, mode: "active" | "includeInactive" | "debug" | "raw" = "active") {
    return IptvRepository.listChannels(mode, opts);
  }

  static listChannelsDebug(opts?: { providerId?: string; q?: string; category?: string }) {
    return IptvRepository.listChannels("debug", opts);
  }

  static listCategories(providerId?: string) {
    return IptvRepository.listCategories(providerId);
  }

  static syncProviderChannels(providerId: string, channels: ParsedChannel[]) {
    const synced: IptvChannelRow[] = [];

    for (const channel of channels) {
      const checksum = checksumForChannel({ name: channel.name, stream_url: channel.url });
      const existing = channel.externalRef
        ? IptvRepository.findChannelByProviderIdAndProviderChannelId(providerId, channel.externalRef)
        : null;

      const existingByChecksum = existing ?? IptvRepository.findChannelByProviderIdAndChecksum(providerId, checksum);

      const result = IptvRepository.upsertChannel({
        id: existingByChecksum?.id,
        provider_id: providerId,
        provider_channel_id: channel.externalRef ?? null,
        name: channel.name,
        logo_url: null,
        category: channel.groupName ?? null,
        language: null,
        country: null,
        resolution: null,
        stream_url: channel.url,
        checksum
      });

      if (result) {
        synced.push(result);
      }
    }

    IptvRepository.refreshProviderChannelCount(providerId);
    return synced;
  }

  static getProviderChannelDiagnostics(providerId: string) {
    return IptvRepository.getProviderChannelDiagnostics(providerId);
  }

  static getLatestIngestionReport(providerId: string) {
    return IptvRepository.getLatestIngestionReport(providerId);
  }

  static getParityDiagnostics(providerId: string) {
    return IptvRepository.getParityDiagnostics(providerId);
  }

  static search(q: string, limit = 50) {
    return IptvRepository.searchChannels(q, limit);
  }
}
