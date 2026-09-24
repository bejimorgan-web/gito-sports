import { IptvCatalogueScreen, type CataloguePreviewMetadata } from "./features/iptv/IptvCatalogueScreen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveEventState } from "@gito/shared";
import type { Channel, MatchAssignmentRequest, Sport, Country, Competition, Team, Stream, ProviderChannelDiagnostics, PublicationArtifact, IPTVProvider } from "@gito/shared";
import { useRealtimeSync } from "@gito/shared";

import { LiveMatchApprovalScreen } from "./features/approvals/LiveMatchApprovalScreen";
import { BroadcastConsoleScreen, type ContentTypeOption } from "./features/broadcast/BroadcastConsoleScreen";
import { DashboardShell } from "./features/dashboard/DashboardShell";
import { MatchSchedulerScreen } from "./features/matches/MatchSchedulerScreen";
import { IptvManagementScreen } from "./features/iptv/IptvManagementScreen";
import { SportsWorkspaceScreen } from "./features/sports/SportsWorkspaceScreen";
import { StreamPreviewPanel } from "./features/preview/StreamPreviewPanel";
import { AnalyticsOverviewScreen } from "./features/analytics/AnalyticsOverviewScreen";
import { StreamingAnalyticsScreen } from "./features/analytics/StreamingAnalyticsScreen";
import { UsersAnalyticsScreen } from "./features/analytics/UsersAnalyticsScreen";
import { MatchesAnalyticsScreen } from "./features/analytics/MatchesAnalyticsScreen";
import { AdsAnalyticsScreen } from "./features/analytics/AdsAnalyticsScreen";
import { MobileFeatureControlScreen } from "./features/mobile/MobileFeatureControlScreen";
import { NewsWorkspaceScreen } from "./features/news/NewsWorkspaceScreen";
import { ClubManagementScreen } from "./features/clubs/ClubManagementScreen";
import { FixtureWorkspaceScreen } from "./features/clubs/FixtureWorkspaceScreen";
import { SquadManagementScreen } from "./features/teams/SquadManagementScreen";
import { FormationManagementScreen } from "./features/sports/FormationManagementScreen";
import { AuthenticatedLayout } from "./layouts/AuthenticatedLayout";
import { LoginScreen } from "./screens/LoginScreen";
import { apiClient, API_BASE_URL, setAccessToken as setClientAccessToken } from "./services/api-client";
import { buildDesktopPublicationContexts, buildLegacyStreamAssignment, buildSafePublicationPackage, PublicationWorkflowError, resolveOrCreatePublicationMatchId, resolvePublicationDeliveryUrl } from "./services/publication-artifact";
import type { DesktopPublicationContext } from "./services/publication-artifact";
import type { DesktopChannel, DesktopProviderAccount } from "../desktop-persistence-contract";
import type { NavigationKey } from "./types/navigation";
import { isSelectedChannelProviderValid } from "./selection-validation";

type ProviderList = Awaited<ReturnType<typeof apiClient.listProviders>>;
type ChannelPage = Awaited<ReturnType<typeof apiClient.listChannelPage>>;
type BackendStatus = "online" | "offline" | "reconnecting";

const AUTH_STORAGE_KEY = "gito-live-sports-auth";

function mapDesktopProviderAccount(provider: DesktopProviderAccount): IPTVProvider {
  const providerType = provider.type === "manual" ? "m3u" : provider.type;
  const mappedProvider: IPTVProvider = {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    type: providerType,
    authType: providerType === "xtream" ? "basic" : "none",
    status: provider.status,
    availabilityStatus: provider.availability,
    failedChannelLoads: 0,
    healthScore: provider.availability === "online" ? 100 : provider.availability === "degraded" ? 60 : provider.availability === "offline" ? 0 : 50,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };

  if (provider.expiresAt) {
    mappedProvider.expiresAt = provider.expiresAt;
  }

  if (provider.lastValidatedAt) {
    mappedProvider.lastSuccessfulStreamLoadAt = provider.lastValidatedAt;
  }

  return mappedProvider;
}

function mapDesktopChannel(channel: DesktopChannel): Channel {
  let playbackHeaders: Channel["playbackHeaders"];
  if (channel.metadataJson) {
    try {
      const parsed = JSON.parse(channel.metadataJson) as { playbackHeaders?: Channel["playbackHeaders"] };
      const candidate = parsed.playbackHeaders;
      if (candidate && typeof candidate === "object") {
        playbackHeaders = Object.fromEntries(Object.entries(candidate).filter(([, value]) => typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\r\n]/.test(value))) as Channel["playbackHeaders"];
      }
    } catch {
      playbackHeaders = undefined;
    }
  }
  return {
    id: channel.id,
    providerId: channel.providerAccountId,
    name: channel.name,
    url: channel.playbackUrl,
    contentType: channel.contentType ?? "live",
    status: channel.status,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    ...(channel.externalReference ? { externalRef: channel.externalReference } : {}),
    ...(channel.groupName ? { groupName: channel.groupName } : {}),
    ...(channel.logoUrl ? { logoUrl: channel.logoUrl } : {}),
    ...(playbackHeaders && Object.keys(playbackHeaders).length ? { playbackHeaders } : {})
  };
}

function buildLocalProviderDiagnostics(provider: IPTVProvider, channels: Channel[]): ProviderChannelDiagnostics {
  const providerChannels = channels.filter((channel) => channel.providerId === provider.id);
  const counts = providerChannels.reduce(
    (result, channel) => {
      const status = channel.status === "active" || channel.status === "inactive" || channel.status === "stale" || channel.status === "archived"
        ? channel.status
        : "inactive";
      result[status] += 1;
      return result;
    },
    { active: 0, inactive: 0, stale: 0, archived: 0 }
  );

  return {
    providerId: provider.id,
    status: provider.status,
    availabilityStatus: provider.availabilityStatus ?? "unknown",
    healthScore: provider.healthScore ?? 0,
    ...(provider.lastSuccessfulStreamLoadAt ? { lastSuccessfulStreamLoadAt: provider.lastSuccessfulStreamLoadAt } : {}),
    totalChannels: providerChannels.length,
    contentTotals: {
      live: providerChannels.filter((channel) => channel.contentType === "live").length,
      movies: providerChannels.filter((channel) => channel.contentType === "movie").length,
      series: providerChannels.filter((channel) => channel.contentType === "series").length
    },
    counts
  };
}

function buildChannelPage(channels: Channel[], options?: { page?: number; q?: string; category?: string; providerId?: string }): ChannelPage {
  const pageSize = 50;
  const query = options?.q?.trim().toLowerCase() ?? "";
  const category = options?.category?.trim().toLowerCase() ?? "";
  const providerId = options?.providerId?.trim() ?? "";

  const filteredChannels = [...channels]
    .filter((channel) => {
      if (providerId && channel.providerId !== providerId) {
        return false;
      }

      if (category) {
        const channelCategory = channel.groupName?.toLowerCase() ?? "";
        if (!channelCategory.includes(category) && !(channel.categoryId ?? "").toLowerCase().includes(category)) {
          return false;
        }
      }

      if (query) {
        const haystack = [channel.name, channel.groupName, channel.externalRef].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    })
    .sort((left, right) => {
      const groupCompare = (left.groupName ?? "").localeCompare(right.groupName ?? "");
      if (groupCompare !== 0) {
        return groupCompare;
      }

      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });

  const total = filteredChannels.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Math.max(1, Math.min(options?.page ?? 1, totalPages));
  const startIndex = (requestedPage - 1) * pageSize;

  return {
    items: filteredChannels.slice(startIndex, startIndex + pageSize),
    page: requestedPage,
    pageSize,
    total,
    totalPages
  };
}

async function loadDesktopProviderList(): Promise<ProviderList> {
  const desktopStorage = window.gito?.desktopStorage?.providerAccounts;
  if (!desktopStorage?.list) {
    throw new Error("desktop_iptv_storage_unavailable");
  }
  try {
    return (await desktopStorage.list()).map(mapDesktopProviderAccount);
  } catch (error) {
    throw new Error("desktop_iptv_provider_storage_unavailable", { cause: error });
  }
}

function requireDesktopStorage() {
  const storage = window.gito?.desktopStorage;
  if (!storage) {
    throw new Error("desktop_iptv_storage_unavailable");
  }
  return storage;
}

function requireDesktopIptvRuntime() {
  const runtime = window.gito?.desktopIptv;
  if (!runtime) {
    throw new Error("desktop_iptv_runtime_unavailable");
  }
  return runtime;
}

function localProviderId() {
  return `provider_${crypto.randomUUID()}`;
}

function localCredentialRef(providerId: string) {
  return `credential_${providerId}`;
}

function selectionSnapshot(channel: Channel | undefined) {
  return channel ? { id: channel.id, providerId: channel.providerId, name: channel.name } : null;
}

function selectionTrace(event: string, detail: Record<string, unknown> = {}) {
  console.info(`[GITO-SELECTION-TRACE][time=${new Date().toISOString()}] ${event}`, detail);
}

function renderScreen(
  activeScreen: NavigationKey,
  state: {
    accessToken: string;
    assignment: DesktopPublicationContext | undefined;
    backendStatus: BackendStatus;
    channels: Channel[];
    channelPage: ChannelPage;
    liveMatches: DesktopPublicationContext[];
    previewedChannelId: string | undefined;
    selectedMatchId?: string | undefined;
    providers: ProviderList;
    providerDiagnostics: Record<string, ProviderChannelDiagnostics>;
    selectedChannel: Channel | undefined;
    selectedPlaybackEntity: { entityType: "movie" | "episode"; entityId: string } | undefined;
    selectedIptvProviderId: string;
    preferredProviderId: string | undefined;
    liveMode: boolean;
    channelSearch: string;
    channelCategory: string;
    channelProviderFilter: string;
    channelContentType: "all" | "live" | "movies" | "series";
    matchAssignmentCatalogueContext: { providerId: string; contentType: ContentTypeOption; favoriteChannelIds: string[] };
    cataloguePreviewMetadata: CataloguePreviewMetadata;
  },
  actions: {
    approveStream: (publicationId: string) => Promise<void>;
    assignMatch: (input: any) => Promise<DesktopPublicationContext>;
    createProvider: Parameters<typeof IptvManagementScreen>[0]["onCreateProvider"];
    updateProvider: (providerId: string, input: Partial<Parameters<typeof apiClient.createProvider>[0]>) => Promise<void>;
    deleteProvider: (providerId: string) => Promise<void>;
    ingestM3u: Parameters<typeof IptvManagementScreen>[0]["onIngestM3u"];
    markPreviewReady: (channelId: string) => void;
    publishStream: (publicationId: string) => Promise<void>;
    reportStreamHealth: (status: Stream["healthStatus"], reason?: string) => void;
    selectChannel: (channel: Channel) => void;
    selectPlaybackEntity: (entity: { entityType: "movie" | "episode"; entityId: string }) => void;
    clearAssignment: () => void;
    setLiveMode: (enabled: boolean) => void;
    setMatchAssignmentCatalogueContext: (context: { providerId: string; contentType: ContentTypeOption; favoriteChannelIds: string[] }) => void;
    setCataloguePreviewMetadata: (metadata: CataloguePreviewMetadata) => void;
    selectIptvProvider: (providerId: string) => void;
    reassignStream: (publicationId: string, channelId: string) => Promise<void>;
    deleteStream: (publicationId: string) => Promise<void>;
    syncXtream: Parameters<typeof IptvManagementScreen>[0]["onSyncXtream"];
    testProvider: Parameters<typeof IptvManagementScreen>[0]["onTestProvider"];
    testProviderById: (providerId: string) => Promise<any>;
    setProviderStatus: (providerId: string, status: string) => Promise<void>;
    startIptvOperation: typeof apiClient.startIptvOperation;
    getIptvOperation: typeof apiClient.getIptvOperation;
    cancelIptvOperation: typeof apiClient.cancelIptvOperation;
    refreshIptv: () => Promise<void>;
    loadChannelPage: (options: { page: number; q?: string; category?: string; providerId?: string }) => Promise<void>;
    openMatch: (matchId?: string) => void;
  }
) {
  switch (activeScreen) {
    case "iptv":
      return (
        <IptvManagementScreen
          channels={state.channels}
          channelPage={state.channelPage}
          onLoadChannelPage={actions.loadChannelPage}
          providers={state.providers}
          selectedProviderId={state.selectedIptvProviderId}
          onSelectProvider={actions.selectIptvProvider}
          providerDiagnostics={state.providerDiagnostics}
          onCreateProvider={actions.createProvider}
          onUpdateProvider={actions.updateProvider}
          onDeleteProvider={actions.deleteProvider}
          onIngestM3u={actions.ingestM3u}
          onSyncXtream={actions.syncXtream}
          onTestProvider={actions.testProvider}
          onTestProviderById={actions.testProviderById}
          onSetProviderStatus={actions.setProviderStatus}
          onStartIptvOperation={actions.startIptvOperation}
          onGetIptvOperation={actions.getIptvOperation}
          onCancelIptvOperation={actions.cancelIptvOperation}
          onRefreshIptv={actions.refreshIptv}
        />
      );
    case "matchAssignment":
      return (
        <>
          <BroadcastConsoleScreen
            assignment={state.assignment}
            backendStatus={state.backendStatus}
            channels={state.channels}
            liveMatches={state.liveMatches}
            previewedChannelId={state.previewedChannelId}
            providers={state.providers}
            selectedChannel={state.selectedChannel}
            preferredProviderId={state.preferredProviderId}
            liveMode={state.liveMode}
            onApprove={actions.approveStream}
            onAssignMatch={actions.assignMatch}
            onClearAssignment={actions.clearAssignment}
            onPreviewReady={actions.markPreviewReady}
            onPublish={actions.publishStream}
            onReportHealth={actions.reportStreamHealth}
            onSelectChannel={actions.selectChannel}
            onSetLiveMode={actions.setLiveMode}
            onOpenMatch={actions.openMatch}
            showLegacyChannelBrowser={false}
            onCatalogueContextChange={actions.setMatchAssignmentCatalogueContext}
            cataloguePreviewMetadata={state.cataloguePreviewMetadata}
            onCataloguePreviewMetadataChange={actions.setCataloguePreviewMetadata}
            catalogueBrowser={state.matchAssignmentCatalogueContext.providerId ? (
              <IptvCatalogueScreen
                providerId={state.matchAssignmentCatalogueContext.providerId}
                contentType={state.matchAssignmentCatalogueContext.contentType}
                favoriteChannelIds={state.matchAssignmentCatalogueContext.favoriteChannelIds}
                showContentTypeCounts={false}
                onSelectChannel={actions.selectChannel}
                onSelectPlaybackEntity={actions.selectPlaybackEntity}
                onPreviewMetadataChange={actions.setCataloguePreviewMetadata}
              />
            ) : (
              <section className="console-panel">
                <h3>IPTV Content Browser</h3>
                <p className="field-note">Create or activate an IPTV provider in IPTV Management to browse its catalogue.</p>
              </section>
            )}
          />
        </>
      );
    case "preview":
      return (
        <StreamPreviewPanel
          channel={state.selectedChannel}
            {...(state.selectedPlaybackEntity ? { playbackEntity: state.selectedPlaybackEntity } : {})}
          providerType={state.providers.find((provider) => provider.id === state.selectedChannel?.providerId)?.type}
          onPreviewReady={actions.markPreviewReady}
          apiBaseUrl={API_BASE_URL ?? ""}
          onHealthChange={actions.reportStreamHealth}
        />
      );
    case "sports":
      return <SportsWorkspaceScreen accessToken={state.accessToken} />;
    case "matches":
      return <MatchSchedulerScreen selectedMatchId={state.selectedMatchId} accessToken={state.accessToken} />;
    case "approvals":
      return (
        <LiveMatchApprovalScreen
          assignment={state.assignment}
          liveMatches={state.liveMatches}
          channels={state.channels}
          onApprove={actions.approveStream}
          onPublish={actions.publishStream}
          onReassign={actions.reassignStream}
          onDelete={actions.deleteStream}
          onOpenMatch={actions.openMatch}
        />
      );
    case "analyticsOverview":
      return <AnalyticsOverviewScreen />;
    case "analyticsStreaming":
      return <StreamingAnalyticsScreen />;
    case "analyticsUsers":
      return <UsersAnalyticsScreen />;
    case "analyticsMatches":
      return <MatchesAnalyticsScreen />;
    case "analyticsAds":
      return <AdsAnalyticsScreen />;
    case "mobileFeatures":
      return <MobileFeatureControlScreen accessToken={state.accessToken} />;
    case "news":
      return <NewsWorkspaceScreen accessToken={state.accessToken} />;
    case "clubs":
      return <><ClubManagementScreen accessToken={state.accessToken} /><FixtureWorkspaceScreen accessToken={state.accessToken} /></>;
    case "squads":
      return <SquadManagementScreen accessToken={state.accessToken} />;
    case "formations":
      return <FormationManagementScreen accessToken={state.accessToken} />;
    case "dashboard":
      return (
        <DashboardShell
          actionableAlertCount={(state.backendStatus !== "online" ? 1 : 0) + (state.assignment?.publication.availability === "offline" ? 1 : 0) + (state.assignment && state.assignment.publication.publicationStatus === "draft" ? 1 : 0) + (state.providers.length === 0 ? 1 : 0)}
          backendStatus={state.backendStatus}
          failedStreamCount={state.assignment?.publication.availability === "offline" ? 1 : 0}
          pendingApprovalCount={state.assignment && state.assignment.publication.publicationStatus === "draft" ? 1 : 0}
          liveMatchCount={state.liveMatches.length}
          channelCount={state.channels.length}
          providerCount={state.providers.length}
          systemStatusDetail={state.backendStatus === "online" ? `Operations active · ${state.channels.length} channels · ${state.providers.length} providers` : "Service availability check in progress"}
          systemStatusLabel={state.backendStatus === "online" ? "Operational" : state.backendStatus === "reconnecting" ? "Reconnecting" : "Offline"}
        />
      );
    default:
      return (
        <BroadcastConsoleScreen
          assignment={state.assignment}
          backendStatus={state.backendStatus}
          channels={state.channels}
          liveMatches={state.liveMatches}
          previewedChannelId={state.previewedChannelId}
          providers={state.providers}
          selectedChannel={state.selectedChannel}
          preferredProviderId={state.preferredProviderId}
          liveMode={state.liveMode}
          onApprove={actions.approveStream}
          onAssignMatch={actions.assignMatch}
          onClearAssignment={actions.clearAssignment}
          onPreviewReady={actions.markPreviewReady}
          onPublish={actions.publishStream}
          onReportHealth={actions.reportStreamHealth}
          onSelectChannel={actions.selectChannel}
          onSetLiveMode={actions.setLiveMode}
          onOpenMatch={actions.openMatch}
        />
      );
  }
}

export function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  
  // Screen state
  const [activeScreen, setActiveScreen] = useState<NavigationKey>("dashboard");
  const [accessToken, setAccessToken] = useState("");
  const [assignment, setAssignment] = useState<DesktopPublicationContext>();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("reconnecting");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelPage, setChannelPage] = useState<ChannelPage>({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [liveMatches, setLiveMatches] = useState<DesktopPublicationContext[]>([]);
  const [providers, setProviders] = useState<ProviderList>([]);
  const [providerDiagnostics, setProviderDiagnostics] = useState<Record<string, ProviderChannelDiagnostics>>({});
  const [previewedChannelId, setPreviewedChannelId] = useState<string>();
  const [selectedChannel, setSelectedChannel] = useState<Channel>();
  const [selectedPlaybackEntity, setSelectedPlaybackEntity] = useState<{ entityType: "movie" | "episode"; entityId: string }>();
  const [selectedIptvProviderId, setSelectedIptvProviderId] = useState("");
  const [preferredProviderId, setPreferredProviderId] = useState<string | undefined>(undefined);
  const [matchAssignmentCatalogueContext, setMatchAssignmentCatalogueContext] = useState<{
    providerId: string;
    contentType: ContentTypeOption;
    favoriteChannelIds: string[];
  }>({ providerId: "", contentType: "live", favoriteChannelIds: [] });
    const [cataloguePreviewMetadata, setCataloguePreviewMetadata] = useState<CataloguePreviewMetadata>({ guide: [] });
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(undefined);
  const [liveMode, setLiveMode] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelCategory, setChannelCategory] = useState("");
  const [channelProviderFilter, setChannelProviderFilter] = useState("");
  const [channelContentType, setChannelContentType] = useState<"all" | "live" | "movies" | "series">("all");
  const assignmentRef = useRef<DesktopPublicationContext>();
  const backendStatusRef = useRef<BackendStatus>("reconnecting");
  const lastHealthReportRef = useRef<{ status: Stream["healthStatus"]; reason?: string; sentAt: number }>();
  const liveModeRef = useRef(liveMode);
  const selectedChannelRef = useRef<Channel>();
  const previousSelectedChannelRef = useRef<Channel>();

  // Restore auth on mount
  useEffect(() => {
    // no local persistence for auth to keep backend source of truth and avoid client-only state.
  }, []);

  // Handle login
  const handleLogin = useCallback((email: string, accessToken: string) => {
    setCurrentEmail(email);
    setAccessToken(accessToken);
    setClientAccessToken(accessToken);
    setIsAuthenticated(true);
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    selectionTrace("LOGOUT_CLEAR", { previous: selectionSnapshot(selectedChannelRef.current), reason: "logout" });
    setIsAuthenticated(false);
    setCurrentEmail(null);
    setAccessToken("");
    setClientAccessToken(null);
    setActiveScreen("dashboard");
    setAssignment(undefined);
    setChannels([]);
    setChannelPage({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
    setLiveMatches([]);
    setProviders([]);
    setPreviewedChannelId(undefined);
    setSelectedPlaybackEntity(undefined);
    setSelectedChannel((previous) => {
      selectionTrace("SELECTED_CHANNEL_MUTATION", { source: "handleLogout", previous: selectionSnapshot(previous), next: null, reason: "logout" });
      return undefined;
    });
    setSelectedIptvProviderId("");
    setSelectedMatchId(undefined);
  }, []);

  const clearPreviewState = useCallback(() => {
    setSelectedChannel((previous) => {
      selectionTrace("SELECTED_CHANNEL_MUTATION", { source: "clearPreviewState", previous: selectionSnapshot(previous), next: null, reason: "preview_state_clear" });
      return undefined;
    });
    setPreviewedChannelId(undefined);
    setSelectedPlaybackEntity(undefined);
    setCataloguePreviewMetadata({ guide: [] });
  }, []);

  function applyResolvedState<T>(
    key: string,
    value: T,
    setter: (nextValue: T) => void,
    source: "api-refresh" | "cache"
  ) {
    const resolution = resolveEventState(key, value, source);
    selectionTrace("STATE_RESOLUTION", {
      key,
      source,
      shouldApply: resolution.shouldApply,
      selectedChannel: selectionSnapshot(selectedChannelRef.current),
      valueCount: Array.isArray(value) ? value.length : (value as any)?.items?.length ?? null
    });
    if (resolution.shouldApply) {
      setter(resolution.value as T);
    }
  }

  useEffect(() => {
    assignmentRef.current = assignment;
  }, [assignment]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") {
        setActiveScreen(detail as NavigationKey);
      }
    };

    window.addEventListener("gito:navigate", handleNavigation as EventListener);

    const dispose = window.gito?.onNavigateToScreen?.((screen) => {
      setActiveScreen(screen as NavigationKey);
    });

    return () => {
      window.removeEventListener("gito:navigate", handleNavigation as EventListener);
      if (typeof dispose === "function") {
        dispose();
      }
    };
  }, []);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    liveModeRef.current = liveMode;
  }, [liveMode]);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
    selectionTrace("SELECTED_CHANNEL_RENDER", {
      previous: selectionSnapshot(previousSelectedChannelRef.current),
      next: selectionSnapshot(selectedChannel),
      sameObjectReference: previousSelectedChannelRef.current === selectedChannel,
      selectedIptvProviderId,
      activeScreen
    });
    previousSelectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  useEffect(() => {
    if (
      selectedChannel &&
      ((selectedIptvProviderId && selectedChannel.providerId !== selectedIptvProviderId) ||
        (matchAssignmentCatalogueContext.providerId && selectedChannel.providerId !== matchAssignmentCatalogueContext.providerId))
    ) {
      selectionTrace("SELECTED_CHANNEL_INVALIDATED", {
        selectedChannel: selectionSnapshot(selectedChannel),
        selectedIptvProviderId,
        catalogueProviderId: matchAssignmentCatalogueContext.providerId,
        reason: "provider_context_mismatch"
      });
      clearPreviewState();
    }
  }, [clearPreviewState, matchAssignmentCatalogueContext.providerId, selectedChannel, selectedIptvProviderId]);

  const refreshOperations = useCallback(async (scope: "full" | "live" = liveModeRef.current ? "live" : "full") => {
    try {
      const [providerData, channelData, publicationSourcesData, publicationFeedData] = await Promise.all([
        loadDesktopProviderList(),
        (async () => (await window.gito?.desktopStorage?.channels.list?.() ?? []).map(mapDesktopChannel))(),
        (async () => {
          try {
            return window.gito?.desktopStorage?.publicationSources.list ? await window.gito.desktopStorage.publicationSources.list() : [];
          } catch {
            return [];
          }
        })(),
        apiClient.listPublishedPublicationFeed()
      ]);

      setBackendStatus("online");
      setProviderDiagnostics(Object.fromEntries(providerData.map((provider) => [provider.id, buildLocalProviderDiagnostics(provider, channelData)])));
      applyResolvedState("iptv:providers", providerData, setProviders, "api-refresh");
      const resolvedChannelPage = buildChannelPage(channelData);
      applyResolvedState("iptv:channels-page", resolvedChannelPage, setChannelPage, "api-refresh");
      applyResolvedState("iptv:channels", resolvedChannelPage.items, setChannels, "api-refresh");

      const liveContexts = buildDesktopPublicationContexts(publicationFeedData, publicationSourcesData, providerData, resolvedChannelPage.items);
      applyResolvedState("live:matches", liveContexts, setLiveMatches, "api-refresh");

      const currentSelectedChannel = selectedChannelRef.current;
      const providerStillValid = isSelectedChannelProviderValid(currentSelectedChannel, providerData);
      selectionTrace("REFRESH_SELECTION_VALIDATION", {
        selectedChannel: selectionSnapshot(currentSelectedChannel),
        channelPageCount: resolvedChannelPage.items.length,
        channelPageTotal: resolvedChannelPage.total,
        providerCount: providerData.length,
        selectedChannelPresentInRefresh: currentSelectedChannel ? resolvedChannelPage.items.some((channel) => channel.id === currentSelectedChannel.id) : null,
        selectedProviderPresentInRefresh: currentSelectedChannel ? providerData.some((provider) => provider.id === currentSelectedChannel.providerId) : null,
        providerStillValid,
        reason: providerStillValid ? "page_absence_is_not_deletion" : "provider_missing"
      });
      if (!providerStillValid) {
        clearPreviewState();
      }
    } catch {
      setBackendStatus((current) => current === "online" ? "reconnecting" : "offline");
    }
  }, [clearPreviewState]);

  useEffect(() => {
    setClientAccessToken(accessToken || null);
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      void refreshOperations("full");
    }
  }, [refreshOperations, accessToken]);


  const realtimeSyncConfig = useMemo(
    () => ({
    apiBaseUrl: API_BASE_URL ?? "",
      onIPTVRefetch: () => refreshOperations("full"),
      onScoresRefetch: () => refreshOperations("live"),
      onStreamsRefetch: () => refreshOperations(liveModeRef.current ? "live" : "full"),
      onBackendStatusChange: (online: boolean) => {
        setBackendStatus(online ? "online" : "offline");
      }
    }),
    [refreshOperations]
  );

  // Setup real-time event subscriptions
  useRealtimeSync(realtimeSyncConfig);

  useEffect(() => {
    const intervalMs = liveMode ? 3000 : 10000;
    const intervalId = window.setInterval(() => {
      void apiClient
        .health()
        .then(() => {
          setBackendStatus("online");
          void refreshOperations(liveMode ? "live" : "full");
        })
        .catch(() => {
          setBackendStatus((current) => (current === "offline" ? "offline" : "reconnecting"));
        });
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [liveMode, refreshOperations]);

  const createProvider = useCallback(async (input: Parameters<typeof apiClient.createProvider>[0]) => {
    const desktopStorage = requireDesktopStorage();
    const credentialStoreRef = localCredentialRef(localProviderId());
    const providerType = input.type === "manual" ? "m3u" : input.type;
    const createdProvider = await desktopStorage.providerAccounts.create({
      name: input.name,
      type: providerType,
      baseUrl: input.baseUrl,
      credentialStoreRef,
      status: "pending",
      availability: "unknown"
    });

    if (providerType === "xtream" && input.username && input.password) {
      await window.gito?.desktopCredentials?.set?.(credentialStoreRef, input.username, input.password);
    }

    const mappedProvider = mapDesktopProviderAccount(createdProvider);
    let syncOperationId: string | undefined;
    if (providerType === "xtream" && window.gito?.desktopIptv?.startOperation) {
      const syncOperation = await requireDesktopIptvRuntime().startOperation("xtream_catalogue_sync", { providerId: mappedProvider.id });
      syncOperationId = syncOperation.id;
    }

    const providerWithSyncOperation = syncOperationId ? { ...mappedProvider, syncOperationId } : mappedProvider;
    setPreferredProviderId(mappedProvider.id);
    setProviders((current) => current.some((item) => item.id === mappedProvider.id) ? current : [...current, mappedProvider]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
    return providerWithSyncOperation;
  }, [refreshOperations]);

  const updateProvider = useCallback(async (providerId: string, input: Partial<Parameters<typeof apiClient.createProvider>[0]>) => {
    const desktopStorage = requireDesktopStorage();
    const existing = await desktopStorage.providerAccounts.get(providerId);
    if (!existing) {
      throw new Error("provider_not_found");
    }

    const nextProvider = await desktopStorage.providerAccounts.update(providerId, {
      name: input.name ?? existing.name,
      type: input.type ?? existing.type,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      credentialStoreRef: existing.credentialStoreRef,
      expiresAt: existing.expiresAt,
      status: existing.status,
      availability: existing.availability,
      lastValidatedAt: existing.lastValidatedAt,
      healthReason: existing.healthReason
    });

    if (input.type === "xtream" && input.username && input.password && window.gito?.desktopCredentials?.set) {
      await window.gito.desktopCredentials.set(existing.credentialStoreRef, input.username, input.password);
    } else if (existing.type === "xtream" && input.type !== "xtream" && window.gito?.desktopCredentials?.delete) {
      await window.gito.desktopCredentials.delete(existing.credentialStoreRef);
    }

    const mappedProvider = mapDesktopProviderAccount(nextProvider ?? existing);
    setPreferredProviderId(providerId);
    setProviders((current) => current.map((item) => item.id === providerId ? mappedProvider : item));
    setChannels([]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
  }, [refreshOperations]);

  const deleteProvider = useCallback(async (providerId: string) => {
    const desktopStorage = requireDesktopStorage();
    const existing = await desktopStorage.providerAccounts.get(providerId);
    await desktopStorage.providerAccounts.delete(providerId);

    if (existing?.credentialStoreRef && window.gito?.desktopCredentials?.delete) {
      await window.gito.desktopCredentials.delete(existing.credentialStoreRef);
    }

    const currentSelectedChannel = selectedChannelRef.current;
    if (currentSelectedChannel?.providerId === providerId) {
      clearPreviewState();
    }

    if (selectedIptvProviderId === providerId) {
      setSelectedIptvProviderId("");
    }

    await refreshOperations("full");
  }, [refreshOperations, clearPreviewState, selectedIptvProviderId]);

  const selectIptvProvider = useCallback((providerId: string) => {
    setSelectedIptvProviderId(providerId);
    clearPreviewState();
  }, [clearPreviewState]);

  const ingestM3u = useCallback(async (providerId: string, playlist: string) => {
    await requireDesktopIptvRuntime().startOperation("m3u_import", { providerId, playlist });
    await refreshOperations("full");
  }, [refreshOperations]);

  const syncXtream = useCallback(async (providerId: string) => {
    await requireDesktopIptvRuntime().startOperation("xtream_catalogue_sync", { providerId });
    await refreshOperations("full");
  }, [refreshOperations]);

  const setProviderStatus = useCallback(async (providerId: string, status: string) => {
    const desktopStorage = requireDesktopStorage();
    const existing = await desktopStorage.providerAccounts.get(providerId);
    if (!existing) {
      throw new Error("provider_not_found");
    }

    await desktopStorage.providerAccounts.update(providerId, {
      credentialStoreRef: existing.credentialStoreRef,
      status: status === "active" ? "active" : "inactive",
      availability: existing.availability,
      lastValidatedAt: existing.lastValidatedAt,
      healthReason: existing.healthReason,
      expiresAt: existing.expiresAt,
      name: existing.name,
      type: existing.type,
      baseUrl: existing.baseUrl
    });

    if (status === "active") {
      setPreferredProviderId(providerId);
    }
    setChannels([]);
    setProviders([]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
  }, [refreshOperations]);

  const assignMatch = useCallback(async (input: any) => {
    if (backendStatus !== "online") {
      throw new Error("backend_offline");
    }

    const selectedChannel = selectedChannelRef.current;
    if (!selectedChannel) {
      throw new Error("selected_channel_required");
    }

    let matchId: string;
    try {
      matchId = await resolveOrCreatePublicationMatchId(input ?? {}, (fixture) => apiClient.createFixture(fixture, accessToken));
    } catch (error) {
      throw new PublicationWorkflowError("fixture_creation", error);
    }
    const providerName = providers.find((provider) => provider.id === selectedChannel.providerId)?.name;
    const providerType = providers.find((provider) => provider.id === selectedChannel.providerId)?.type;
    let resolvedDelivery: { deliveryUrl: string; playbackMode: "DIRECT_SAFE" | "DIRECT_XTREAM" };
    try {
      resolvedDelivery = resolvePublicationDeliveryUrl(selectedChannel.url, providerType);
    } catch (error) {
      throw new PublicationWorkflowError("creation", error);
    }

    const { deliveryUrl, playbackMode } = resolvedDelivery;

    const publicationPackage = buildSafePublicationPackage({
      matchId,
      localSource: {
        providerId: selectedChannel.providerId,
        channelId: selectedChannel.id,
        channelName: selectedChannel.name,
        ...(providerName ? { providerName } : {}),
        url: selectedChannel.url,
        streamUrl: selectedChannel.url
      }
    });

    let createdPublication: Awaited<ReturnType<typeof apiClient.submitPublicationArtifact>>;
    try {
      createdPublication = await apiClient.submitPublicationArtifact(publicationPackage);
    } catch (error) {
      throw new PublicationWorkflowError("creation", error);
    }
    try {
      await apiClient.setPublicationDelivery(createdPublication.publicationId, {
        deliveryReference: `delivery_${createdPublication.publicationId}`,
        playbackUrl: deliveryUrl,
        playbackMode,
        ...(selectedChannel.playbackHeaders ? { playbackHeaders: selectedChannel.playbackHeaders } : {})
      }, accessToken);
    } catch (error) {
      throw new PublicationWorkflowError("creation", error);
    }
    try {
      await apiClient.bindPublicationArtifact(createdPublication.publicationId, matchId, accessToken);
    } catch (error) {
      throw new PublicationWorkflowError("bind", error);
    }
    const publicationSource = await window.gito?.desktopStorage?.publicationSources.upsert?.({
      publicationId: createdPublication.publicationId,
      sourceReference: createdPublication.sourceReference,
      providerAccountId: selectedChannel.providerId,
      channelId: selectedChannel.id
    });

    const nextAssignment: DesktopPublicationContext = {
      publication: createdPublication,
      match: {
        id: matchId,
        competitionId: input?.competitionId,
        homeTeamId: input?.homeTeamId,
        awayTeamId: input?.awayTeamId,
        startsAt: input?.startsAt,
        status: "assigned",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        homeTeamName: input?.homeTeamName,
        awayTeamName: input?.awayTeamName,
        competitionName: input?.competitionName,
        sportName: input?.sportName
      },
      source: {
        publicationId: createdPublication.publicationId,
        sourceReference: createdPublication.sourceReference,
        providerAccountId: publicationSource?.providerAccountId ?? selectedChannel.providerId ?? null,
        channelId: publicationSource?.channelId ?? selectedChannel.id ?? null,
        provider: providers.find((provider) => provider.id === selectedChannel.providerId)
          ? {
              id: selectedChannel.providerId,
              name: providers.find((provider) => provider.id === selectedChannel.providerId)?.name ?? selectedChannel.providerId,
              type: providers.find((provider) => provider.id === selectedChannel.providerId)?.type ?? "manual",
              status: providers.find((provider) => provider.id === selectedChannel.providerId)?.status ?? "active",
              availability: providers.find((provider) => provider.id === selectedChannel.providerId)?.availabilityStatus ?? "online"
            }
          : null,
        channel: {
          id: selectedChannel.id,
          name: selectedChannel.name,
          providerAccountId: selectedChannel.providerId,
          contentType: selectedChannel.contentType ?? "live",
          status: selectedChannel.status,
          groupName: selectedChannel.groupName ?? null
        },
        hasLocalMapping: true,
        isResolved: true
      }
    };

    setAssignment(nextAssignment);
    setActiveScreen("approvals");
    return nextAssignment;
  }, [accessToken, backendStatus, providers]);

  const approveStream = useCallback(async (publicationId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    setAssignment((current) =>
      current && current.publication.publicationId === publicationId
        ? {
            ...current,
            publication: {
              ...current.publication,
              publicationStatus: "approved",
              updatedAt: new Date().toISOString()
            }
          }
        : current
    );

    try {
      const publication = await apiClient.approvePublicationArtifact(publicationId, accessToken);
      setAssignment((current) => (current && current.publication.publicationId === publicationId ? { ...current, publication } : current));
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw new PublicationWorkflowError("approval", error);
    }
  }, [accessToken, backendStatus]);

  const publishStream = useCallback(async (publicationId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    setAssignment((current) =>
      current && current.publication.publicationId === publicationId
        ? {
            ...current,
            publication: {
              ...current.publication,
              publicationStatus: "published",
              publishedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          }
        : current
    );

    try {
      const publication = await apiClient.publishPublicationArtifact(publicationId, accessToken);
      setAssignment((current) => (current && current.publication.publicationId === publicationId ? { ...current, publication } : current));
      await refreshOperations(liveModeRef.current ? "live" : "full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw new PublicationWorkflowError("publish", error);
    }
  }, [accessToken, backendStatus, refreshOperations]);

  const reassignStream = useCallback(async (publicationId: string, channelId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    try {
      const existingPublication = liveMatches.find((entry) => entry.publication.publicationId === publicationId) ?? previousAssignment;
      if (!existingPublication) {
        throw new Error("publication_assignment_missing");
      }

      const selectedChannel = channels.find((channel) => channel.id === channelId);
      if (!selectedChannel) {
        throw new Error("selected_channel_required");
      }

      const providerName = providers.find((provider) => provider.id === selectedChannel.providerId)?.name;
      const providerType = providers.find((provider) => provider.id === selectedChannel.providerId)?.type;
      const resolvedDelivery = resolvePublicationDeliveryUrl(selectedChannel.url, providerType);
      const { deliveryUrl, playbackMode } = resolvedDelivery;
      await apiClient.revokePublicationArtifact(publicationId, accessToken);
      const replacementPackage = buildSafePublicationPackage({
        matchId: existingPublication.match.id,
        localSource: {
          providerId: selectedChannel.providerId,
          channelId: selectedChannel.id,
          channelName: selectedChannel.name,
          ...(providerName ? { providerName } : {}),
          url: selectedChannel.url,
          streamUrl: selectedChannel.url
        }
      });

      const replacementPublication = await apiClient.submitPublicationArtifact(replacementPackage);
      await apiClient.bindPublicationArtifact(replacementPublication.publicationId, existingPublication.match.id, accessToken);
      await apiClient.setPublicationDelivery(replacementPublication.publicationId, {
        deliveryReference: `delivery_${replacementPublication.publicationId}`,
        playbackUrl: deliveryUrl,
        playbackMode,
        ...(selectedChannel.playbackHeaders ? { playbackHeaders: selectedChannel.playbackHeaders } : {})
      }, accessToken);
      await window.gito?.desktopStorage?.publicationSources.upsert?.({
        publicationId: replacementPublication.publicationId,
        sourceReference: replacementPublication.sourceReference,
        providerAccountId: selectedChannel.providerId,
        channelId: selectedChannel.id
      });
      await apiClient.approvePublicationArtifact(replacementPublication.publicationId, accessToken);
      await apiClient.publishPublicationArtifact(replacementPublication.publicationId, accessToken);

      await refreshOperations("full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [accessToken, backendStatus, channels, liveMatches, providers, refreshOperations]);

  const deleteStream = useCallback(async (publicationId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    try {
      await apiClient.revokePublicationArtifact(publicationId, accessToken);
      setAssignment((current) => (current && current.publication.publicationId === publicationId ? undefined : current));
      await refreshOperations("full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [accessToken, backendStatus, refreshOperations]);

  const reportStreamHealth = useCallback((status: Stream["healthStatus"], reason?: string) => {
    const currentAssignment = assignmentRef.current;
    const currentSelectedChannel = selectedChannelRef.current;

    if (
      !currentAssignment ||
      !currentSelectedChannel ||
      currentAssignment.source.channelId !== currentSelectedChannel.id ||
      backendStatusRef.current !== "online"
    ) {
      return;
    }

    const nextAvailability = status === "failed" ? "offline" : status === "degraded" ? "degraded" : "ready";

    setAssignment((current) =>
      current && current.publication.publicationId === currentAssignment.publication.publicationId
        ? {
            ...current,
            publication: {
              ...current.publication,
              availability: nextAvailability,
              updatedAt: new Date().toISOString()
            }
          }
        : current
    );

    const lastReport = lastHealthReportRef.current;
    const now = Date.now();

    if (
      lastReport &&
      lastReport.status === status &&
      lastReport.reason === reason &&
      now - lastReport.sentAt < 15000
    ) {
      return;
    }

    lastHealthReportRef.current = { status, sentAt: now, ...(reason ? { reason } : {}) };
    void apiClient
      .updatePublicationAvailability(currentAssignment.publication.publicationId, nextAvailability, accessToken ?? undefined)
      .then((publication) => {
        setAssignment((current) => (current && current.publication.publicationId === publication.publicationId ? { ...current, publication } : current));
        void refreshOperations(liveModeRef.current ? "live" : "full");
      })
      .catch(() => setBackendStatus("reconnecting"));
  }, [accessToken, refreshOperations]);

  const selectChannel = useCallback((channel: Channel) => {
    if (
      (selectedIptvProviderId && channel.providerId !== selectedIptvProviderId) ||
      (matchAssignmentCatalogueContext.providerId && channel.providerId !== matchAssignmentCatalogueContext.providerId)
    ) {
      selectionTrace("SELECT_CHANNEL_REJECTED", {
        next: selectionSnapshot(channel),
        selectedIptvProviderId,
        catalogueProviderId: matchAssignmentCatalogueContext.providerId,
        reason: "provider_context_mismatch"
      });
      clearPreviewState();
      return;
    }

    setSelectedChannel((previous) => {
      selectionTrace("SELECTED_CHANNEL_MUTATION", {
        source: "selectChannel",
        previous: selectionSnapshot(previous),
        next: selectionSnapshot(channel),
        sameObjectReference: previous === channel,
        reason: "catalogue_selection"
      });
      return channel;
    });
    setSelectedPlaybackEntity(undefined);
    setPreferredProviderId(channel.providerId);
    setPreviewedChannelId(undefined);
    setAssignment((current) => (current && current.source.channelId !== channel.id ? undefined : current));
  }, [clearPreviewState, matchAssignmentCatalogueContext.providerId, selectedIptvProviderId]);

  const selectPlaybackEntity = useCallback((entity: { entityType: "movie" | "episode"; entityId: string }) => {
    setSelectedChannel(undefined);
    setSelectedPlaybackEntity(entity);
    setPreviewedChannelId(undefined);
    setAssignment((current) => current ? undefined : current);
  }, []);

  const testProvider = useCallback(async (input: Parameters<typeof apiClient.testProvider>[0]) => {
    const runtime = requireDesktopIptvRuntime();
    const request: Parameters<typeof runtime.validateProvider>[0] = {
      baseUrl: input.baseUrl,
      ...(input.type ? { type: input.type } : {}),
      ...(input.username ? { username: input.username } : {}),
      ...(input.password ? { password: input.password } : {})
    };
    return runtime.validateProvider(request);
  }, []);

  const testProviderById = useCallback(async (providerId: string) => {
    const result = await requireDesktopIptvRuntime().validateProviderById(providerId);
    await refreshOperations("full");
    return result;
  }, [refreshOperations]);

    const clearAssignment = useCallback(() => {
    setAssignment(undefined);
  }, []);

    const loadChannelPage = useCallback(async (options: { page: number; q?: string; category?: string; providerId?: string }) => {
      try {
        const localChannels = await window.gito?.desktopStorage?.channels.list?.(options.providerId) ?? [];
        if (!window.gito?.desktopStorage?.channels.list) {
          throw new Error("desktop_iptv_storage_unavailable");
        }
        const nextPage = buildChannelPage(localChannels.map(mapDesktopChannel), options);
        setChannelPage(nextPage);
        setChannels(nextPage.items);
      } catch (error) {
        setChannelPage({ items: [], page: options.page, pageSize: 50, total: 0, totalPages: 1 });
        setChannels([]);
        throw new Error("desktop_iptv_channel_storage_unavailable", { cause: error });
      }
    }, []);

  const startIptvOperation = useCallback(async (
    type: Parameters<typeof apiClient.startIptvOperation>[0],
    input: Parameters<typeof apiClient.startIptvOperation>[1] = {}
  ) => {
    const runtime = requireDesktopIptvRuntime();
    const safeInput: Parameters<typeof runtime.startOperation>[1] = {
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.playlist ? { playlist: input.playlist } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {})
    };
    return runtime.startOperation(type, safeInput);
  }, []);

  const getIptvOperation = useCallback(async (operationId: string) => {
    const operation = await requireDesktopIptvRuntime().getOperation(operationId);
    if (!operation) {
      throw new Error("operation_not_found");
    }
    return operation;
  }, []);

  const cancelIptvOperation = useCallback(async (operationId: string) => {
    const operation = await requireDesktopIptvRuntime().cancelOperation(operationId);
    if (!operation) {
      throw new Error("operation_not_found");
    }
    return operation;
  }, []);

  const actions = useMemo(
      () => ({
        approveStream,
        assignMatch,
        clearAssignment,
        createProvider,
        updateProvider,
        deleteProvider,
        ingestM3u,
        setProviderStatus,
        markPreviewReady: setPreviewedChannelId,
        publishStream,
        reassignStream,
        deleteStream,
        reportStreamHealth,
        setLiveMode,
        setMatchAssignmentCatalogueContext,
        setCataloguePreviewMetadata,
        selectIptvProvider,
        selectChannel,
        selectPlaybackEntity,
        setChannelSearch,
        setChannelCategory,
        setChannelProviderFilter,
        setChannelContentType,
        openMatch: (matchId?: string) => {
          setSelectedMatchId(matchId);
          setActiveScreen("matches");
        },
        syncXtream,
        testProvider,
        testProviderById,
        startIptvOperation,
        getIptvOperation,
        cancelIptvOperation,
        refreshIptv: () => refreshOperations("full"),
        loadChannelPage
      }),
      [
        approveStream,
        assignMatch,
        createProvider,
        updateProvider,
        deleteProvider,
        ingestM3u,
        publishStream,
        reassignStream,
        deleteStream,
        reportStreamHealth,
        setLiveMode,
        setMatchAssignmentCatalogueContext,
        setCataloguePreviewMetadata,
        selectIptvProvider,
        selectChannel,
        selectPlaybackEntity,
        setChannelSearch,
        setChannelCategory,
        setChannelProviderFilter,
        setChannelContentType,
        setSelectedMatchId,
        syncXtream,
        setProviderStatus,
        testProvider,
        testProviderById,
        startIptvOperation,
        getIptvOperation,
        cancelIptvOperation,
        loadChannelPage,
        refreshOperations
      ]
  );

  const screenState = useMemo(
    () => ({
      accessToken,
      assignment,
      backendStatus,
      channels,
      channelPage,
      liveMatches,
      previewedChannelId,
      providers,
      providerDiagnostics,
      selectedChannel,
      selectedPlaybackEntity,
      selectedIptvProviderId,
      preferredProviderId,
      cataloguePreviewMetadata,
      liveMode,
      channelSearch,
      channelCategory,
      channelProviderFilter,
      channelContentType,
      matchAssignmentCatalogueContext
    }),
    [
      accessToken,
      assignment,
      backendStatus,
      channels,
      channelPage,
      liveMatches,
      previewedChannelId,
      providers,
      providerDiagnostics,
      selectedChannel,
      selectedPlaybackEntity,
      selectedIptvProviderId,
      liveMode,
      channelSearch,
      channelCategory,
      channelProviderFilter,
      channelContentType,
      matchAssignmentCatalogueContext
    ]
  );

  // === RENDER CONDITIONAL CONTENT BASED ON AUTH STATE ===
  // All hooks are initialized above, so this conditional is safe
  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLogin} />;
  }

  // User is authenticated - render the full application
  return (
    <AuthenticatedLayout 
      activeKey={activeScreen} 
      liveMode={liveMode} 
      onNavigate={setActiveScreen}
      activeProvider={selectedChannel ? providers.find((p) => p.id === selectedChannel.providerId) : undefined}
      currentEmail={currentEmail}
      apiBaseUrl={API_BASE_URL}
      onLogout={handleLogout}
    >
      {renderScreen(
        activeScreen,
        screenState,
        actions
      )}
    </AuthenticatedLayout>
  );
}
