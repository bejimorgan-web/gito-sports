import type { CredentialStore } from "./credential-store.js";
import type {
  DesktopCatalogueCategoryInput,
  DesktopChannelInput,
  DesktopEpisodeInput,
  DesktopEpgChannelInput,
  DesktopEpgProgrammeInput,
  DesktopIptvOperationInput,
  DesktopMovieInput,
  DesktopProviderAccountInput,
  DesktopSeasonInput,
  DesktopSeriesInput
} from "../src/desktop-persistence-contract.js";
import type { DesktopPlaybackTransport } from "./desktop-playback-transport.js";
import type { DesktopIptvRuntime } from "./desktop-iptv-runtime.js";
import { DesktopSqliteStore, validateCatalogueCategoryInput, validateChannelInput, validateCredentialWrite, validateEpgChannelInput, validateEpgProgrammeInput, validateEpisodeInput, validateMovieInput, validateOperationInput, validateProviderAccountInput, validateProviderAccountPatch, validateSeasonInput, validateSeriesInput } from "./desktop-storage.js";

export function createDesktopPersistenceHandlers(storage: DesktopSqliteStore, credentials: CredentialStore, iptvRuntime?: DesktopIptvRuntime, playback?: DesktopPlaybackTransport) {
  return {
    providerAccountsList: () => storage.listProviderAccounts(),
    providerAccountsGet: (id: unknown) => storage.getProviderAccount(String(id)),
    providerAccountsCreate: (input: DesktopProviderAccountInput) => {
      validateProviderAccountInput(input);
      return storage.createProviderAccount(input);
    },
    providerAccountsUpdate: (id: unknown, input: Partial<DesktopProviderAccountInput>) => {
      validateProviderAccountPatch(input);
      return storage.updateProviderAccount(String(id), input);
    },
    providerAccountsDelete: (id: unknown) => storage.deleteProviderAccount(String(id)),
    channelsList: (providerAccountId?: unknown) => storage.listChannels(providerAccountId === undefined ? undefined : String(providerAccountId)),
    channelsGet: (id: unknown) => storage.getChannel(String(id)),
    channelsUpsert: (input: DesktopChannelInput) => {
      validateChannelInput(input);
      return storage.upsertChannel(input);
    },
    categoriesList: (providerAccountId?: unknown, contentType?: unknown) => storage.listCategories(
      providerAccountId === undefined ? undefined : String(providerAccountId),
      contentType === undefined || contentType === null ? undefined : String(contentType) as any
    ),
    categoriesGet: (id: unknown) => storage.getCategory(String(id)),
    categoriesUpsert: (input: DesktopCatalogueCategoryInput) => {
      validateCatalogueCategoryInput(input);
      return storage.upsertCategory(input);
    },
    categoriesDelete: (id: unknown) => storage.deleteCategory(String(id)),
    categoriesArchive: (id: unknown) => storage.archiveCategory(String(id)),
    epgChannelsList: (providerAccountId?: unknown) => storage.listEpgChannels(providerAccountId === undefined ? undefined : String(providerAccountId)),
    epgChannelsGet: (id: unknown) => storage.getEpgChannel(String(id)),
    epgChannelsUpsert: (input: DesktopEpgChannelInput) => {
      validateEpgChannelInput(input);
      return storage.upsertEpgChannel(input);
    },
    epgChannelsDelete: (id: unknown) => storage.deleteEpgChannel(String(id)),
    epgChannelsArchive: (id: unknown) => storage.archiveEpgChannel(String(id)),
    epgProgrammesList: (providerAccountId?: unknown, epgChannelId?: unknown) => storage.listEpgProgrammes(
      providerAccountId === undefined ? undefined : String(providerAccountId),
      epgChannelId === undefined || epgChannelId === null ? undefined : String(epgChannelId)
    ),
    epgProgrammesGet: (id: unknown) => storage.getEpgProgramme(String(id)),
    epgProgrammesUpsert: (input: DesktopEpgProgrammeInput) => {
      validateEpgProgrammeInput(input);
      return storage.upsertEpgProgramme(input);
    },
    epgProgrammesDelete: (id: unknown) => storage.deleteEpgProgramme(String(id)),
    epgProgrammesArchive: (id: unknown) => storage.archiveEpgProgramme(String(id)),
    moviesList: (providerAccountId?: unknown) => storage.listMovies(providerAccountId === undefined ? undefined : String(providerAccountId)),
    moviesGet: (id: unknown) => storage.getMovie(String(id)),
    moviesUpsert: (input: DesktopMovieInput) => {
      validateMovieInput(input);
      return storage.upsertMovie(input);
    },
    moviesDelete: (id: unknown) => storage.deleteMovie(String(id)),
    moviesArchive: (id: unknown) => storage.archiveMovie(String(id)),
    seriesList: (providerAccountId?: unknown) => storage.listSeries(providerAccountId === undefined ? undefined : String(providerAccountId)),
    seriesGet: (id: unknown) => storage.getSeries(String(id)),
    seriesUpsert: (input: DesktopSeriesInput) => {
      validateSeriesInput(input);
      return storage.upsertSeries(input);
    },
    seriesDelete: (id: unknown) => storage.deleteSeries(String(id)),
    seriesArchive: (id: unknown) => storage.archiveSeries(String(id)),
    seasonsList: (providerAccountId?: unknown, seriesId?: unknown) => storage.listSeasons(
      providerAccountId === undefined ? undefined : String(providerAccountId),
      seriesId === undefined || seriesId === null ? undefined : String(seriesId)
    ),
    seasonsGet: (id: unknown) => storage.getSeason(String(id)),
    seasonsUpsert: (input: DesktopSeasonInput) => {
      validateSeasonInput(input);
      return storage.upsertSeason(input);
    },
    seasonsDelete: (id: unknown) => storage.deleteSeason(String(id)),
    seasonsArchive: (id: unknown) => storage.archiveSeason(String(id)),
    episodesList: (providerAccountId?: unknown, seriesId?: unknown, seasonId?: unknown) => storage.listEpisodes(
      providerAccountId === undefined ? undefined : String(providerAccountId),
      seriesId === undefined || seriesId === null ? undefined : String(seriesId),
      seasonId === undefined || seasonId === null ? undefined : String(seasonId)
    ),
    episodesGet: (id: unknown) => storage.getEpisode(String(id)),
    episodesUpsert: (input: DesktopEpisodeInput) => {
      validateEpisodeInput(input);
      return storage.upsertEpisode(input);
    },
    episodesDelete: (id: unknown) => storage.deleteEpisode(String(id)),
    episodesArchive: (id: unknown) => storage.archiveEpisode(String(id)),
    publicationSourcesList: () => storage.listPublicationSources(),
    publicationSourcesGet: (publicationId: unknown) => storage.getPublicationSource(String(publicationId)),
    publicationSourcesUpsert: (input: { publicationId: string; sourceReference: string; providerAccountId?: string | null; channelId?: string | null }) => {
      return storage.upsertPublicationSource(input);
    },
    publicationSourcesDelete: (publicationId: unknown) => storage.deletePublicationSource(String(publicationId)),
    operationsList: (providerAccountId?: unknown) => storage.listOperations(providerAccountId === undefined ? undefined : String(providerAccountId)),
    operationsGet: (id: unknown) => storage.getOperation(String(id)),
    operationsUpsert: (input: DesktopIptvOperationInput) => {
      validateOperationInput(input);
      return storage.upsertOperation(input);
    },
    credentialsSet: (ref: unknown, username: unknown, password: unknown) => {
      validateCredentialWrite({ ref: String(ref), username: String(username), password: String(password) });
      credentials.set(String(ref), String(username), String(password));
    },
    credentialsDelete: (ref: unknown) => credentials.delete(String(ref)),
    validateProvider: async (input: { providerId?: string; baseUrl?: string; type?: string; playlist?: string }) => {
      if (!iptvRuntime) return Promise.reject(new Error("desktop_iptv_runtime_unavailable"));
      return iptvRuntime.validateProvider(input);
    },
    validateProviderById: async (providerId: unknown) => {
      if (!iptvRuntime) return Promise.reject(new Error("desktop_iptv_runtime_unavailable"));
      return iptvRuntime.validateProviderById(String(providerId));
    },
    startEpgSync: (providerId: unknown) => iptvRuntime ? iptvRuntime.startEpgSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
    startXtreamCatalogueSync: (providerId: unknown) => iptvRuntime ? iptvRuntime.startXtreamCatalogueSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
    startM3uCatalogueSync: (providerId: unknown) => iptvRuntime ? iptvRuntime.startM3uCatalogueSync(String(providerId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
    startOperation: (type: unknown, input?: { providerId?: string; playlist?: string; baseUrl?: string }) => iptvRuntime ? iptvRuntime.startOperation(String(type) as any, input) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
    getOperation: (operationId: unknown) => iptvRuntime ? iptvRuntime.getOperation(String(operationId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable")),
    cancelOperation: (operationId: unknown) => iptvRuntime ? iptvRuntime.cancelOperation(String(operationId)) : Promise.reject(new Error("desktop_iptv_runtime_unavailable"))
    ,playbackStart: (input: unknown) => playback ? playback.start(input) : Promise.reject(new Error("desktop_playback_unavailable"))
    ,playbackRead: (input: unknown) => playback ? playback.read(input) : Promise.reject(new Error("desktop_playback_unavailable"))
    ,playbackCancel: (sessionId: unknown) => playback ? playback.cancel(String(sessionId)) : Promise.reject(new Error("desktop_playback_unavailable"))
  };
}
