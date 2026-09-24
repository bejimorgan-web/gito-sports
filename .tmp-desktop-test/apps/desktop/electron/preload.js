import { contextBridge, ipcRenderer } from "electron";
const desktopStorage = {
    providerAccounts: {
        list: () => ipcRenderer.invoke("desktop-storage:provider-accounts:list"),
        get: (id) => ipcRenderer.invoke("desktop-storage:provider-accounts:get", id),
        create: (input) => ipcRenderer.invoke("desktop-storage:provider-accounts:create", input),
        update: (id, input) => ipcRenderer.invoke("desktop-storage:provider-accounts:update", id, input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:provider-accounts:delete", id)
    },
    channels: {
        list: (providerAccountId) => ipcRenderer.invoke("desktop-storage:channels:list", providerAccountId),
        get: (id) => ipcRenderer.invoke("desktop-storage:channels:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:channels:upsert", input)
    },
    categories: {
        list: (providerAccountId, contentType) => ipcRenderer.invoke("desktop-storage:categories:list", providerAccountId, contentType),
        get: (id) => ipcRenderer.invoke("desktop-storage:categories:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:categories:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:categories:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:categories:archive", id)
    },
    epgChannels: {
        list: (providerAccountId) => ipcRenderer.invoke("desktop-storage:epg-channels:list", providerAccountId),
        get: (id) => ipcRenderer.invoke("desktop-storage:epg-channels:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:epg-channels:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:epg-channels:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:epg-channels:archive", id)
    },
    epgProgrammes: {
        list: (providerAccountId, epgChannelId) => ipcRenderer.invoke("desktop-storage:epg-programmes:list", providerAccountId, epgChannelId),
        get: (id) => ipcRenderer.invoke("desktop-storage:epg-programmes:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:epg-programmes:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:epg-programmes:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:epg-programmes:archive", id)
    },
    movies: {
        list: (providerAccountId) => ipcRenderer.invoke("desktop-storage:movies:list", providerAccountId),
        get: (id) => ipcRenderer.invoke("desktop-storage:movies:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:movies:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:movies:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:movies:archive", id)
    },
    series: {
        list: (providerAccountId) => ipcRenderer.invoke("desktop-storage:series:list", providerAccountId),
        get: (id) => ipcRenderer.invoke("desktop-storage:series:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:series:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:series:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:series:archive", id)
    },
    seasons: {
        list: (providerAccountId, seriesId) => ipcRenderer.invoke("desktop-storage:seasons:list", providerAccountId, seriesId),
        get: (id) => ipcRenderer.invoke("desktop-storage:seasons:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:seasons:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:seasons:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:seasons:archive", id)
    },
    episodes: {
        list: (providerAccountId, seriesId, seasonId) => ipcRenderer.invoke("desktop-storage:episodes:list", providerAccountId, seriesId, seasonId),
        get: (id) => ipcRenderer.invoke("desktop-storage:episodes:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:episodes:upsert", input),
        delete: (id) => ipcRenderer.invoke("desktop-storage:episodes:delete", id),
        archive: (id) => ipcRenderer.invoke("desktop-storage:episodes:archive", id)
    },
    publicationSources: {
        list: () => ipcRenderer.invoke("desktop-storage:publication-sources:list"),
        get: (publicationId) => ipcRenderer.invoke("desktop-storage:publication-sources:get", publicationId),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:publication-sources:upsert", input),
        delete: (publicationId) => ipcRenderer.invoke("desktop-storage:publication-sources:delete", publicationId)
    },
    operations: {
        list: (providerAccountId) => ipcRenderer.invoke("desktop-storage:operations:list", providerAccountId),
        get: (id) => ipcRenderer.invoke("desktop-storage:operations:get", id),
        upsert: (input) => ipcRenderer.invoke("desktop-storage:operations:upsert", input)
    }
};
const desktopCredentials = {
    set: (ref, username, password) => ipcRenderer.invoke("desktop-credentials:set", ref, username, password),
    delete: (ref) => ipcRenderer.invoke("desktop-credentials:delete", ref)
};
const desktopIptv = {
    validateProvider: (input) => ipcRenderer.invoke("desktop-iptv:validate-provider", input),
    validateProviderById: (providerId) => ipcRenderer.invoke("desktop-iptv:validate-provider-by-id", providerId),
    startEpgSync: (providerId) => ipcRenderer.invoke("desktop-iptv:start-epg-sync", providerId),
    startXtreamCatalogueSync: (providerId) => ipcRenderer.invoke("desktop-iptv:start-xtream-catalogue-sync", providerId),
    startM3uCatalogueSync: (providerId) => ipcRenderer.invoke("desktop-iptv:start-m3u-catalogue-sync", providerId),
    startOperation: (type, input) => ipcRenderer.invoke("desktop-iptv:start-operation", type, input),
    getOperation: (operationId) => ipcRenderer.invoke("desktop-iptv:get-operation", operationId),
    cancelOperation: (operationId) => ipcRenderer.invoke("desktop-iptv:cancel-operation", operationId)
};
const desktopPlayback = {
    start: (input) => ipcRenderer.invoke("desktop-playback:start", input),
    read: (input) => ipcRenderer.invoke("desktop-playback:read", input),
    cancel: (sessionId) => ipcRenderer.invoke("desktop-playback:cancel", sessionId)
};
contextBridge.exposeInMainWorld("gito", {
    platform: "desktop",
    onNavigateToScreen: (callback) => {
        const listener = (_event, screen) => callback(screen);
        ipcRenderer.on("navigate-to-screen", listener);
        return () => ipcRenderer.removeListener("navigate-to-screen", listener);
    },
    sendRendererError: (error) => {
        try {
            ipcRenderer.send('renderer-error', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : null,
                timestamp: new Date().toISOString(),
            });
        }
        catch {
            // best effort
        }
    },
    sendRendererConsoleError: (args) => {
        try {
            ipcRenderer.send('renderer-console-error', args);
        }
        catch {
            // best effort
        }
    },
    desktopStorage,
    desktopCredentials,
    desktopIptv,
    desktopPlayback
});
