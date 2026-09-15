import type { Channel, IPTVProvider } from "@gito/shared";

export function isSelectedChannelProviderValid(selectedChannel: Channel | undefined, providers: IPTVProvider[]) {
  if (!selectedChannel) return true;
  return providers.some((provider) => provider.id === selectedChannel.providerId);
}

export function isSelectedChannelAuthoritativelyDeleted(selectedChannel: Channel | undefined, channelExistsGlobally: boolean | undefined) {
  if (!selectedChannel || channelExistsGlobally === undefined) return false;
  return !channelExistsGlobally;
}