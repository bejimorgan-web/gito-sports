import { validateCatalogueCategoryInput, validateChannelInput, validateCredentialWrite, validateEpgChannelInput, validateEpgProgrammeInput, validateEpisodeInput, validateMovieInput, validateOperationInput, validateProviderAccountInput, validateProviderAccountPatch, validateSeasonInput, validateSeriesInput } from "./desktop-storage.js";
export function createDesktopPersistenceHandlers(storage, credentials, iptvRuntime, playback) {
    return {
        providerAccountsList: () => storage.listProviderAccounts(),
        providerAccountsGet: (id) => storage.getProviderAccount(String(id)),
        providerAccountsCreate: (input) => {
            validateProviderAccountInput(input);
            return storage.createProviderAccount(input);
        },
        providerAccountsUpdate: (id, input) => {
            validateProviderAccountPatch(input);
            return storage.updateProviderAccount(String(id), input);
        },
        providerAccountsDelete: (id) => storage.deleteProviderAccount(String(id)),
        channelsList: (providerAccountId) => storage.listChannels(providerAccountId === undefined ? undefined : String(providerAccountId)),
        channelsGet: (id) => storage.getChannel(String(id)),
        channelsUpsert: (input) => {
            validateChannelInput(input);
            return storage.upsertChannel(input);
        },
        categoriesList: (providerAccountId, contentType) => storage.listCategories(providerAccountId === undefined ? undefined : String(providerAccountId), contentType === undefined || contentType === null ? undefined : String(contentType)),
        categoriesGet: (id) => storage.getCategory(String(id)),
        categoriesUpsert: (input) => {
            validateCatalogueCategoryInput(input);
            return storage.upsertCategory(input);
        },
        categoriesDelete: (id) => storage.deleteCategory(String(id)),
        categoriesArchive: (id) => storage.archiveCategory(String(id)),
        epgChannelsList: (providerAccountId) => storage.listEpgChannels(providerAccountId === undefined ? undefined : String(providerAccountId)),
        epgChannelsGet: (id) => storage.getEpgChannel(String(id)),
        epgChannelsUpsert: (input) => {
            validateEpgChannelInput(input);
            return storage.upsertEpgChannel(input);
        },
        epgChannelsDelete: (id) => storage.deleteEpgChannel(String(id)),
        epgChannelsArchive: (id) => storage.archiveEpgChannel(String(id)),
        epgProgrammesList: (providerAccountId, epgChannelId) => storage.listEpgProgrammes(providerAccountId === undefined ? undefined : String(providerAccountId), epgChannelId === undefined || epgChannelId === null ? undefined : String(epgChannelId)),
        epgProgrammesGet: (id) => storage.getEpgProgramme(String(id)),
        epgProgrammesUpsert: (input) => {
            validateEpgProgrammeInput(input);
            return storage.upsertEpgProgramme(input);
        },
        epgProgrammesDelete: (id) => storage.deleteEpgProgramme(String(id)),
        epgProgrammesArchive: (id) => storage.archiveEpgProgramme(String(id)),
        moviesList: (providerAccountId) => storage.listMovies(providerAccountId === undefined ? undefined : String(providerAccountId)),
        moviesGet: (id) => storage.getMovie(String(id)),
        moviesUpsert: (input) => {
            validateMovieInput(input);
            return storage.upsertMovie(input);
        },
        moviesDelete: (id) => storage.deleteMovie(String(id)),
        moviesArchive: (id) => storage.archiveMovie(String(id)),
        seriesList: (providerAccountId) => storage.listSeries(providerAccountId === undefined ? undefined : String(providerAccountId)),
        seriesGet: (id) => storage.getSeries(String(id)),
        seriesUpsert: (input) => {
            validateSeriesInput(input);
            return storage.upsertSeries(input);
        },
        seriesDelete: (id) => storage.deleteSeries(String(id)),
        seriesArchive: (id) => storage.archiveSeries(String(id)),
        seasonsList: (providerAccountId, seriesId) => storage.listSeasons(providerAccountId === undefined ? undefined : String(providerAccountId), seriesId === undefined || seriesId === null ? undefined : String(seriesId)),
        seasonsGet: (id) => storage.getSeason(String(id)),
        seasonsUpsert: (input) => {
            validateSeasonInput(input);
            return storage.upsertSeason(input);
        },
        seasonsDelete: (id) => storage.deleteSeason(String(id)),
        seasonsArchive: (id) => storage.archiveSeason(String(id)),
        episodesList: (providerAccountId, seriesId, seasonId) => storage.listEpisodes(providerAccountId === undefined ? undefined : String(providerAccountId), seriesId === undefined || seriesId === null ? undefined : String(seriesId), seasonId === undefined || seasonId === null ? undefined : String(seasonId)),
        episodesGet: (id) => storage.getEpisode(String(id)),
        episodesUpsert: (input) => {
            validateEpisodeInput(input);
            return storage.upsertEpisode(input);
        },
        episodesDelete: (id) => storage.deleteEpisode(String(id)),
        episodesArchive: (id) => storage.archiveEpisode(String(id)),
        publicationSourcesList: () => storage.listPublicationSources(),
        publicationSourcesGet: (publicationId) => storage.getPublicationSource(String(publicationId)),
        publicationSourcesUpsert: (input) => {
            return storage.upsertPublicationSource(input);
        },
        publicationSourcesDelete: (publicationId) => storage.deletePublicationSource(String(publicationId)),
        operationsList: (providerAccountId) => storage.listOperations(providerAccountId === undefined ? undefined : String(providerAccountId)),
        operationsGet: (id) => storage.getOperation(String(id)),
        operationsUpsert: (input) => {
            validateOperationInput(input);
            return storage.upsertOperation(input);
        },
        credentialsSet: (ref, username, password) => {
            validateCredentialWrite({ ref: String(ref), username: String(username), password: String(password) });
            credentials.set(String(ref), String(username), String(password));
        },
        credentialsDelete: (ref) => credentials.delete(String(ref)),
        validateProvider: (input) => iptvRuntime ? iptvRuntime.validateProvider(input) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        validateProviderById: (providerId) => iptvRuntime ? iptvRuntime.validateProviderById(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        startEpgSync: (providerId) => iptvRuntime ? iptvRuntime.startEpgSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        startXtreamCatalogueSync: (providerId) => iptvRuntime ? iptvRuntime.startXtreamCatalogueSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        startM3uCatalogueSync: (providerId) => iptvRuntime ? iptvRuntime.startM3uCatalogueSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        startOperation: (type, input) => iptvRuntime ? iptvRuntime.startOperation(String(type), input) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        getOperation: (operationId) => iptvRuntime ? iptvRuntime.getOperation(String(operationId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        cancelOperation: (operationId) => iptvRuntime ? iptvRuntime.cancelOperation(String(operationId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
        playbackStart: (input) => playback ? playback.start(input) : Promise.reject(new Error("desktop_playback_unavailable")),
        playbackRead: (input) => playback ? playback.read(input) : Promise.reject(new Error("desktop_playback_unavailable")),
        playbackCancel: (sessionId) => playback ? playback.cancel(String(sessionId)) : Promise.reject(new Error("desktop_playback_unavailable"))
    };
}
