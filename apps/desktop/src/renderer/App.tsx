import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveEventState } from "@gito/shared";
import type { Channel, MatchAssignmentRequest, MatchAssignmentResult, PublishedLiveMatch, Sport, Country, Competition, Team, Stream, ProviderChannelDiagnostics } from "@gito/shared";
import { useRealtimeSync } from "@gito/shared";

import { LiveMatchApprovalScreen } from "./features/approvals/LiveMatchApprovalScreen";
import { BroadcastConsoleScreen } from "./features/broadcast/BroadcastConsoleScreen";
import { DashboardShell } from "./features/dashboard/DashboardShell";
import { MatchSchedulerScreen } from "./features/matches/MatchSchedulerScreen";
import { IptvManagementScreen } from "./features/iptv/IptvManagementScreen";
import { IptvCatalogueScreen } from "./features/iptv/IptvCatalogueScreen";
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
import { apiClient, API_BASE_URL } from "./services/api-client";
import type { NavigationKey } from "./types/navigation";

type ProviderList = Awaited<ReturnType<typeof apiClient.listProviders>>;
type ChannelPage = Awaited<ReturnType<typeof apiClient.listChannelPage>>;
type BackendStatus = "online" | "offline" | "reconnecting";

const AUTH_STORAGE_KEY = "gito-live-sports-auth";

function isSelectedChannelStillValid(
  selectedChannel: Channel | undefined,
  channels: Channel[],
  providers: ProviderList
) {
  if (!selectedChannel) {
    return true;
  }

  return (
    channels.some((channel) => channel.id === selectedChannel.id) &&
    providers.some((provider) => provider.id === selectedChannel.providerId)
  );
}

function renderScreen(
  activeScreen: NavigationKey,
  state: {
    accessToken: string;
    assignment: MatchAssignmentResult | undefined;
    backendStatus: BackendStatus;
    channels: Channel[];
    channelPage: ChannelPage;
    liveMatches: PublishedLiveMatch[];
    previewedChannelId: string | undefined;
    selectedMatchId?: string | undefined;
    providers: ProviderList;
    providerDiagnostics: Record<string, ProviderChannelDiagnostics>;
    selectedChannel: Channel | undefined;
    preferredProviderId: string | undefined;
    liveMode: boolean;
    channelSearch: string;
    channelCategory: string;
    channelProviderFilter: string;
    channelContentType: "all" | "live" | "movies" | "series";
  },
  actions: {
    approveStream: (streamId: string) => Promise<void>;
    assignMatch: (input: MatchAssignmentRequest) => Promise<MatchAssignmentResult>;
    createProvider: Parameters<typeof IptvManagementScreen>[0]["onCreateProvider"];
    updateProvider: (providerId: string, input: Partial<Parameters<typeof apiClient.createProvider>[0]>) => Promise<void>;
    deleteProvider: (providerId: string) => Promise<void>;
    ingestM3u: Parameters<typeof IptvManagementScreen>[0]["onIngestM3u"];
    markPreviewReady: (channelId: string) => void;
    publishStream: (streamId: string) => Promise<void>;
    reportStreamHealth: (status: Stream["healthStatus"], reason?: string) => void;
    selectChannel: (channel: Channel) => void;
    clearAssignment: () => void;
    setLiveMode: (enabled: boolean) => void;
    reassignStream: (streamId: string, channelId: string) => Promise<void>;
    deleteStream: (streamId: string) => Promise<void>;
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
          />
          {state.preferredProviderId || state.providers.find((provider) => provider.status === "active")?.id ? (
            <IptvCatalogueScreen providerId={state.preferredProviderId ?? state.providers.find((provider) => provider.status === "active")!.id} onSelectChannel={actions.selectChannel} />
          ) : (
            <section className="console-panel">
              <h3>IPTV Content Browser</h3>
              <p className="field-note">Create or activate an IPTV provider in IPTV Management to browse its catalogue.</p>
            </section>
          )}
        </>
      );
    case "preview":
      return (
        <StreamPreviewPanel
          channel={state.selectedChannel}
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
          actionableAlertCount={(state.backendStatus !== "online" ? 1 : 0) + (state.assignment?.stream.status === "failed" ? 1 : 0) + (state.assignment && state.assignment.stream.status === "assigned" ? 1 : 0) + (state.providers.length === 0 ? 1 : 0)}
          backendStatus={state.backendStatus}
          failedStreamCount={state.assignment?.stream.status === "failed" ? 1 : 0}
          pendingApprovalCount={state.assignment && state.assignment.stream.status === "assigned" ? 1 : 0}
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
  const [assignment, setAssignment] = useState<MatchAssignmentResult>();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("reconnecting");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelPage, setChannelPage] = useState<ChannelPage>({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [liveMatches, setLiveMatches] = useState<PublishedLiveMatch[]>([]);
  const [providers, setProviders] = useState<ProviderList>([]);
  const [providerDiagnostics, setProviderDiagnostics] = useState<Record<string, ProviderChannelDiagnostics>>({});
  const [previewedChannelId, setPreviewedChannelId] = useState<string>();
  const [selectedChannel, setSelectedChannel] = useState<Channel>();
  const [preferredProviderId, setPreferredProviderId] = useState<string | undefined>(undefined);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(undefined);
  const [liveMode, setLiveMode] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [channelCategory, setChannelCategory] = useState("");
  const [channelProviderFilter, setChannelProviderFilter] = useState("");
  const [channelContentType, setChannelContentType] = useState<"all" | "live" | "movies" | "series">("all");
  const assignmentRef = useRef<MatchAssignmentResult>();
  const backendStatusRef = useRef<BackendStatus>("reconnecting");
  const lastHealthReportRef = useRef<{ status: Stream["healthStatus"]; reason?: string; sentAt: number }>();
  const liveModeRef = useRef(liveMode);
  const selectedChannelRef = useRef<Channel>();

  // Restore auth on mount
  useEffect(() => {
    // no local persistence for auth to keep backend source of truth and avoid client-only state.
  }, []);

  // Handle login
  const handleLogin = useCallback((email: string, accessToken: string) => {
    setCurrentEmail(email);
    setAccessToken(accessToken);
    setIsAuthenticated(true);
  }, []);

  // Handle logout
  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setCurrentEmail(null);
    setAccessToken("");
    setActiveScreen("dashboard");
    setAssignment(undefined);
    setChannels([]);
    setChannelPage({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
    setLiveMatches([]);
    setProviders([]);
    setPreviewedChannelId(undefined);
    setSelectedChannel(undefined);
    setSelectedMatchId(undefined);
  }, []);

  const clearPreviewState = useCallback(() => {
    setSelectedChannel(undefined);
  }, []);

  function applyResolvedState<T>(
    key: string,
    value: T,
    setter: (nextValue: T) => void,
    source: "api-refresh" | "cache"
  ) {
    const resolution = resolveEventState(key, value, source);
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
  }, [selectedChannel]);

  const refreshOperations = useCallback(async (scope: "full" | "live" = liveModeRef.current ? "live" : "full") => {
    try {
      if (scope === "live") {
        const liveData = await apiClient.listLiveMatches();

        setBackendStatus("online");
        applyResolvedState("live:matches", liveData, setLiveMatches, "api-refresh");
        return;
      }

      const [providerData, channelData, liveData] = await Promise.all([
        apiClient.listProviders(),
        apiClient.listChannelPage(undefined, { includeInactive: true, page: 1, pageSize: 50 }),
        apiClient.listLiveMatches()
      ]);

      setBackendStatus("online");
      const diagnosticsEntries = await Promise.all(providerData.map(async (provider) => {
        try {
          return [provider.id, await apiClient.getProviderDiagnostics(provider.id)] as const;
        } catch {
          return null;
        }
      }));
      setProviderDiagnostics(Object.fromEntries(diagnosticsEntries.filter((entry): entry is readonly [string, ProviderChannelDiagnostics] => entry !== null)));
      applyResolvedState("iptv:providers", providerData, setProviders, "api-refresh");
      const resolvedChannelPage = Array.isArray(channelData)
        ? { items: channelData, page: 1, pageSize: channelData.length, total: channelData.length, totalPages: 1 }
        : channelData;
      applyResolvedState("iptv:channels-page", resolvedChannelPage, setChannelPage, "api-refresh");
      applyResolvedState("iptv:channels", resolvedChannelPage.items, setChannels, "api-refresh");
      applyResolvedState("live:matches", liveData, setLiveMatches, "api-refresh");

      const currentSelectedChannel = selectedChannelRef.current;
      if (!isSelectedChannelStillValid(currentSelectedChannel, resolvedChannelPage.items, providerData)) {
        clearPreviewState();
      }
    } catch {
      setBackendStatus("offline");
    }
  }, [clearPreviewState]);

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
    if (backendStatus !== "online") {
      throw new Error("backend_offline");
    }
    const provider = await apiClient.createProvider(input);
    setPreferredProviderId(provider.id);
    setProviders([]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
    return provider;
  }, [backendStatus, refreshOperations]);

  const updateProvider = useCallback(async (providerId: string, input: Partial<Parameters<typeof apiClient.createProvider>[0]>) => {
    if (backendStatus !== "online") return;

    await apiClient.updateProvider(providerId, input);
    setPreferredProviderId(providerId);
    setChannels([]);
    setProviders([]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
  }, [backendStatus, refreshOperations]);

  const deleteProvider = useCallback(async (providerId: string) => {
    if (backendStatus !== "online") return;

    await apiClient.deleteProvider(providerId);

    const currentSelectedChannel = selectedChannelRef.current;
    if (currentSelectedChannel?.providerId === providerId) {
      clearPreviewState();
    }

    await refreshOperations("full");
  }, [backendStatus, refreshOperations, clearPreviewState]);

  const ingestM3u = useCallback(async (providerId: string, playlist: string) => {
    if (backendStatus !== "online") {
      return;
    }

    await apiClient.ingestM3u(providerId, playlist);
    await refreshOperations("full");
  }, [backendStatus, refreshOperations]);

  const syncXtream = useCallback(async (providerId: string) => {
    if (backendStatus !== "online") {
      return;
    }

    await apiClient.syncXtream(providerId);
    await refreshOperations("full");
  }, [backendStatus, refreshOperations]);

  const setProviderStatus = useCallback(async (providerId: string, status: string) => {
    if (backendStatus !== "online") return;

    await apiClient.setProviderStatus(providerId, status);
    if (status === "active") {
      setPreferredProviderId(providerId);
    }
    setChannels([]);
    setProviders([]);
    await refreshOperations("full");
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await refreshOperations("full");
  }, [backendStatus, refreshOperations]);

  const assignMatch = useCallback(async (input: MatchAssignmentRequest) => {
    if (backendStatus !== "online") {
      throw new Error("backend_offline");
    }

    const nextAssignment = await apiClient.assignStream(input);
    setAssignment(nextAssignment);
    setActiveScreen("approvals");
    return nextAssignment;
  }, [backendStatus]);

  const approveStream = useCallback(async (streamId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    setAssignment((current) =>
      current && current.stream.id === streamId
        ? {
            ...current,
            match: { ...current.match, status: "approved" },
            stream: {
              ...current.stream,
              status: "approved",
              approvalStatus: "approved",
              approvedAt: new Date().toISOString()
            }
          }
        : current
    );

    try {
      const stream = await apiClient.approveStream(streamId, accessToken);
      setAssignment((current) => (current ? { ...current, stream } : current));
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [accessToken, backendStatus]);

  const publishStream = useCallback(async (streamId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    setAssignment((current) =>
      current && current.stream.id === streamId
        ? {
            ...current,
            match: { ...current.match, status: "published" },
            stream: {
              ...current.stream,
              status: "active",
              approvalStatus: "active",
              healthStatus: current.stream.healthStatus === "unknown" ? "active" : current.stream.healthStatus,
              publishedAt: new Date().toISOString()
            }
          }
        : current
    );

    try {
      const stream = await apiClient.publishStream(streamId, accessToken);
      setAssignment((current) => (current ? { ...current, stream } : current));
      await refreshOperations(liveModeRef.current ? "live" : "full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [accessToken, backendStatus, refreshOperations]);

  const reassignStream = useCallback(async (streamId: string, channelId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    try {
      const stream = await apiClient.reassignStream(streamId, channelId, accessToken);

      setAssignment((current) =>
        current && current.stream.id === streamId
          ? {
              ...current,
              stream
            }
          : current
      );

      await refreshOperations("full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [backendStatus, refreshOperations]);

  const deleteStream = useCallback(async (streamId: string) => {
    if (!accessToken || backendStatus !== "online") {
      return;
    }

    const previousAssignment = assignmentRef.current;

    try {
      await apiClient.deleteStream(streamId, accessToken);
      setAssignment((current) => (current && current.stream.id === streamId ? undefined : current));
      await refreshOperations("full");
    } catch (error) {
      setAssignment(previousAssignment);
      setBackendStatus("reconnecting");
      throw error;
    }
  }, [backendStatus, refreshOperations]);

  const reportStreamHealth = useCallback((status: Stream["healthStatus"], reason?: string) => {
    const currentAssignment = assignmentRef.current;
    const currentSelectedChannel = selectedChannelRef.current;

    if (
      !currentAssignment ||
      !currentSelectedChannel ||
      currentAssignment.channel.id !== currentSelectedChannel.id ||
      backendStatusRef.current !== "online"
    ) {
      return;
    }

    setAssignment((current) =>
      current && current.stream.id === currentAssignment.stream.id
        ? {
            ...current,
            stream: {
              ...current.stream,
              healthStatus: status,
              ...(reason ? { healthReason: reason } : {})
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
      .reportStreamHealth(currentAssignment.stream.id, { status, ...(reason ? { reason } : {}) })
      .then((stream) => {
        setAssignment((current) => (current ? { ...current, stream } : current));
        void refreshOperations(liveModeRef.current ? "live" : "full");
      })
      .catch(() => setBackendStatus("reconnecting"));
  }, [refreshOperations]);

  const selectChannel = useCallback((channel: Channel) => {
    setSelectedChannel(channel);
    setPreferredProviderId(channel.providerId);
    setPreviewedChannelId(undefined);
    setAssignment((current) => (current && current.channel.id !== channel.id ? undefined : current));
  }, []);

  const testProviderById = useCallback(async (providerId: string) => {
    if (backendStatus !== "online") {
      throw new Error("backend_offline");
    }

    const result = await apiClient.testProviderById(providerId);
    await refreshOperations("full");
    return result;
  }, [backendStatus, refreshOperations]);

    const clearAssignment = useCallback(() => {
    setAssignment(undefined);
  }, []);

    const loadChannelPage = useCallback(async (options: { page: number; q?: string; category?: string; providerId?: string }) => {
      const nextPage = await apiClient.listChannelPage(undefined, {
        includeInactive: true,
        page: options.page,
        pageSize: 50,
        ...(options.q ? { q: options.q } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.providerId ? { providerId: options.providerId } : {})
      });
      setChannelPage(nextPage);
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
        selectChannel,
        setChannelSearch,
        setChannelCategory,
        setChannelProviderFilter,
        setChannelContentType,
        openMatch: (matchId?: string) => {
          setSelectedMatchId(matchId);
          setActiveScreen("matches");
        },
        syncXtream,
        testProvider: apiClient.testProvider,
        testProviderById,
        startIptvOperation: apiClient.startIptvOperation,
        getIptvOperation: apiClient.getIptvOperation,
        cancelIptvOperation: apiClient.cancelIptvOperation
        ,refreshIptv: () => refreshOperations("full")
        ,loadChannelPage
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
        selectChannel,
        setChannelSearch,
        setChannelCategory,
        setChannelProviderFilter,
        setChannelContentType,
        setSelectedMatchId,
        syncXtream,
        setProviderStatus,
        testProviderById,
        loadChannelPage
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
      preferredProviderId,
      liveMode,
      channelSearch,
      channelCategory,
      channelProviderFilter,
      channelContentType
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
      liveMode,
      channelSearch,
      channelCategory,
      channelProviderFilter,
      channelContentType
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
