function resourceTypeForContext(context) {
    if (context.type === "manifest" || context.type === "playlist")
        return context.type;
    if (context.type === "key")
        return "key";
    if (context.type === "subtitle")
        return "subtitle";
    if (context.type === "init")
        return "init";
    return context.url?.includes(".m3u8") ? "playlist" : "segment";
}
function resourceIdFromUrl(value) {
    const prefix = "gito-resource://";
    if (!value.startsWith(prefix))
        throw new Error("playback_resource_invalid");
    const resourceId = value.slice(prefix.length).split(/[/?#]/, 1)[0] ?? "";
    if (!/^resource-[A-Za-z0-9_-]+$/.test(resourceId))
        throw new Error("playback_resource_invalid");
    return resourceId;
}
export function createDesktopPlaybackLoader(playback, sessionId) {
    return class DesktopPlaybackLoader {
        aborted = false;
        load(context, _config, callbacks) {
            const requestId = crypto.randomUUID();
            let resourceId;
            try {
                resourceId = resourceIdFromUrl(String(context.url));
            }
            catch (error) {
                callbacks.onError({ code: 0, text: error instanceof Error ? error.message : "playback_resource_invalid" }, context, null, null);
                return;
            }
            const resourceType = resourceTypeForContext(context);
            void playback.read({ sessionId, requestId, resourceId, resourceType }).then((response) => {
                if (this.aborted)
                    return;
                callbacks.onSuccess({ data: response.data, url: context.url }, context, response);
            }).catch((error) => {
                if (this.aborted)
                    return;
                callbacks.onError({ code: 0, text: error instanceof Error ? error.message : "playback_transport_error" }, context, null, null);
            });
        }
        abort() { this.aborted = true; }
        destroy() { this.aborted = true; }
    };
}
