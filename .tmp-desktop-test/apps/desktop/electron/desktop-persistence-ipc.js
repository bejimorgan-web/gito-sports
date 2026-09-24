import { app, ipcMain, safeStorage } from "electron";
import path from "node:path";
import { SafeStorageCredentialStore } from "./credential-store.js";
import { DesktopIptvRuntime } from "./desktop-iptv-runtime.js";
import { createDesktopPersistenceHandlers } from "./desktop-persistence-handlers.js";
import { DesktopSqliteStore } from "./desktop-storage.js";
import { DesktopPlaybackTransport } from "./desktop-playback-transport.js";
let storage;
let credentials;
let iptvRuntime;
let playback;
function getStorage() {
    return storage ??= new DesktopSqliteStore(path.join(app.getPath("userData"), "gito-desktop.sqlite"));
}
function getCredentials() {
    return credentials ??= new SafeStorageCredentialStore(path.join(app.getPath("userData"), "gito-desktop-credentials.json"), safeStorage);
}
function getIptvRuntime() {
    return iptvRuntime ??= new DesktopIptvRuntime(getStorage(), getCredentials());
}
function getPlayback() {
    return playback ??= new DesktopPlaybackTransport(getStorage(), getCredentials());
}
function register(channel, handler) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_event, ...args) => handler(...args));
}
export function registerDesktopPersistenceIpc() {
    const handlers = createDesktopPersistenceHandlers(getStorage(), getCredentials(), getIptvRuntime(), getPlayback());
    register("desktop-storage:provider-accounts:list", handlers.providerAccountsList);
    register("desktop-storage:provider-accounts:get", handlers.providerAccountsGet);
    register("desktop-storage:provider-accounts:create", handlers.providerAccountsCreate);
    register("desktop-storage:provider-accounts:update", handlers.providerAccountsUpdate);
    register("desktop-storage:provider-accounts:delete", handlers.providerAccountsDelete);
    register("desktop-storage:channels:list", handlers.channelsList);
    register("desktop-storage:channels:get", handlers.channelsGet);
    register("desktop-storage:channels:upsert", handlers.channelsUpsert);
    register("desktop-storage:categories:list", handlers.categoriesList);
    register("desktop-storage:categories:get", handlers.categoriesGet);
    register("desktop-storage:categories:upsert", handlers.categoriesUpsert);
    register("desktop-storage:categories:delete", handlers.categoriesDelete);
    register("desktop-storage:categories:archive", handlers.categoriesArchive);
    register("desktop-storage:epg-channels:list", handlers.epgChannelsList);
    register("desktop-storage:epg-channels:get", handlers.epgChannelsGet);
    register("desktop-storage:epg-channels:upsert", handlers.epgChannelsUpsert);
    register("desktop-storage:epg-channels:delete", handlers.epgChannelsDelete);
    register("desktop-storage:epg-channels:archive", handlers.epgChannelsArchive);
    register("desktop-storage:epg-programmes:list", handlers.epgProgrammesList);
    register("desktop-storage:epg-programmes:get", handlers.epgProgrammesGet);
    register("desktop-storage:epg-programmes:upsert", handlers.epgProgrammesUpsert);
    register("desktop-storage:epg-programmes:delete", handlers.epgProgrammesDelete);
    register("desktop-storage:epg-programmes:archive", handlers.epgProgrammesArchive);
    register("desktop-storage:movies:list", handlers.moviesList);
    register("desktop-storage:movies:get", handlers.moviesGet);
    register("desktop-storage:movies:upsert", handlers.moviesUpsert);
    register("desktop-storage:movies:delete", handlers.moviesDelete);
    register("desktop-storage:movies:archive", handlers.moviesArchive);
    register("desktop-storage:series:list", handlers.seriesList);
    register("desktop-storage:series:get", handlers.seriesGet);
    register("desktop-storage:series:upsert", handlers.seriesUpsert);
    register("desktop-storage:series:delete", handlers.seriesDelete);
    register("desktop-storage:series:archive", handlers.seriesArchive);
    register("desktop-storage:seasons:list", handlers.seasonsList);
    register("desktop-storage:seasons:get", handlers.seasonsGet);
    register("desktop-storage:seasons:upsert", handlers.seasonsUpsert);
    register("desktop-storage:seasons:delete", handlers.seasonsDelete);
    register("desktop-storage:seasons:archive", handlers.seasonsArchive);
    register("desktop-storage:episodes:list", handlers.episodesList);
    register("desktop-storage:episodes:get", handlers.episodesGet);
    register("desktop-storage:episodes:upsert", handlers.episodesUpsert);
    register("desktop-storage:episodes:delete", handlers.episodesDelete);
    register("desktop-storage:episodes:archive", handlers.episodesArchive);
    register("desktop-storage:publication-sources:list", handlers.publicationSourcesList);
    register("desktop-storage:publication-sources:get", handlers.publicationSourcesGet);
    register("desktop-storage:publication-sources:upsert", handlers.publicationSourcesUpsert);
    register("desktop-storage:publication-sources:delete", handlers.publicationSourcesDelete);
    register("desktop-storage:operations:list", handlers.operationsList);
    register("desktop-storage:operations:get", handlers.operationsGet);
    register("desktop-storage:operations:upsert", handlers.operationsUpsert);
    register("desktop-credentials:set", handlers.credentialsSet);
    register("desktop-credentials:delete", handlers.credentialsDelete);
    register("desktop-iptv:validate-provider", handlers.validateProvider);
    register("desktop-iptv:validate-provider-by-id", handlers.validateProviderById);
    register("desktop-iptv:start-epg-sync", handlers.startEpgSync);
    register("desktop-iptv:start-xtream-catalogue-sync", handlers.startXtreamCatalogueSync);
    register("desktop-iptv:start-m3u-catalogue-sync", handlers.startM3uCatalogueSync);
    register("desktop-iptv:start-operation", handlers.startOperation);
    register("desktop-iptv:get-operation", handlers.getOperation);
    register("desktop-iptv:cancel-operation", handlers.cancelOperation);
    register("desktop-playback:start", handlers.playbackStart);
    register("desktop-playback:read", handlers.playbackRead);
    register("desktop-playback:cancel", handlers.playbackCancel);
    app.once("before-quit", closeDesktopPersistenceForTests);
}
export function closeDesktopPersistenceForTests() {
    storage?.close();
    storage = undefined;
    credentials = undefined;
    iptvRuntime = undefined;
    playback?.shutdown();
    playback = undefined;
}
