export function isSelectedChannelProviderValid(selectedChannel, providers) {
    if (!selectedChannel)
        return true;
    return providers.some((provider) => provider.id === selectedChannel.providerId);
}
export function isSelectedChannelAuthoritativelyDeleted(selectedChannel, channelExistsGlobally) {
    if (!selectedChannel || channelExistsGlobally === undefined)
        return false;
    return !channelExistsGlobally;
}
