import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveEventState } from "@gito/shared";
import type { Channel, MatchAssignmentRequest, MatchAssignmentResult, PublishedLiveMatch, Sport, Country, Competition, Team, Stream } from "@gito/shared";
import { useRealtimeSync } from "@gito/shared";

import { LiveMatchApprovalScreen } from "./features/approvals/LiveMatchApprovalScreen";
import { BroadcastConsoleScreen } from "./features/broadcast/BroadcastConsoleScreen";
import { MatchSchedulerScreen } from "./features/matches/MatchSchedulerScreen";
import { IptvManagementScreen } from "./features/iptv/IptvManagementScreen";
import { SportsWorkspaceScreen } from "./features/sports/SportsWorkspaceScreen";
import { StreamPreviewPanel } from "./features/preview/StreamPreviewPanel";
import { AuthenticatedLayout } from "./layouts/AuthenticatedLayout";
import { apiClient, API_BASE_URL } from "./services/api-client";
import type { NavigationKey } from "./types/navigation";

type ProviderList = Awaited<ReturnType<typeof apiClient.listProviders>>;
type BackendStatus = "online" | "offline" | "reconnecting";

const SESSION_STORAGE_KEY = "gito-live-sports-operator-state";

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
    liveMatches: PublishedLiveMatch[];
    previewedChannelId: string | undefined;
    selectedMatchId?: string | undefined;
    providers: ProviderList;
    selectedChannel: Channel | undefined;
    liveMode: boolean;
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
    openMatch: (matchId?: string) => void;
  }
) {
  switch (activeScreen) {
    case "iptv":
      return (
        <IptvManagementScreen
          channels={state.channels}
          providers={state.providers}
          selectedChannelId={state.selectedChannel?.id}
          onCreateProvider={actions.createProvider}
          onUpdateProvider={actions.updateProvider}
          onDeleteProvider={actions.deleteProvider}
          onIngestM3u={actions.ingestM3u}
          onSelectChannel={actions.selectChannel}
          onSyncXtream={actions.syncXtream}
          onTestProvider={actions.testProvider}
          onTestProviderById={actions.testProviderById}
          onSetProviderStatus={actions.setProviderStatus}
        />
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
      return <SportsWorkspaceScreen />;
    case "matches":
      return <MatchSchedulerScreen selectedMatchId={state.selectedMatchId} />;
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
    case "dashboard":
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
  const [activeScreen, setActiveScreen] = useState<NavigationKey>("dashboard");
  const [accessToken, setAccessToken] = useState("");
  const [assignment, setAssignment] = useState<MatchAssignmentResult>();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("reconnecting");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [liveMatches, setLiveMatches] = useState<PublishedLiveMatch[]>([]);
  const [providers, setProviders] = useState<ProviderList>([]);
  const [previewedChannelId, setPreviewedChannelId] = useState<string>();
  const [selectedChannel, setSelectedChannel] = useState<Channel>();
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(undefined);
  const [liveMode, setLiveMode] = useState(false);
  const assignmentRef = useRef<MatchAssignmentResult>();
  const backendStatusRef = useRef<BackendStatus>("reconnecting");
  const lastHealthReportRef = useRef<{ status: Stream["healthStatus"]; reason?: string; sentAt: number }>();
  const liveModeRef = useRef(liveMode);
  const selectedChannelRef = useRef<Channel>();

  const clearPreviewState = useCallback(() => {
    setSelectedChannel(undefined);
    setPreviewedChannelId(undefined);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
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
        apiClient.listChannels(),
        apiClient.listLiveMatches()
      ]);

      setBackendStatus("online");
      applyResolvedState("iptv:providers", providerData, setProviders, "api-refresh");
      applyResolvedState("iptv:channels", channelData, setChannels, "api-refresh");
      applyResolvedState("live:matches", liveData, setLiveMatches, "api-refresh");

      const currentSelectedChannel = selectedChannelRef.current;
      if (!isSelectedChannelStillValid(currentSelectedChannel, channelData, providerData)) {
        clearPreviewState();
      }
    } catch {
      setBackendStatus("offline");
    }
  }, [clearPreviewState]);

  useEffect(() => {
    const storedState = window.localStorage.getItem(SESSION_STORAGE_KEY);

    if (storedState) {
      try {
        const parsed = JSON.parse(storedState) as {
          assignment?: MatchAssignmentResult;
          channels?: Channel[];
          liveMatches?: PublishedLiveMatch[];
          providers?: ProviderList;
          previewedChannelId?: string;
          selectedChannel?: Channel;
          selectedMatchId?: string;
        };

        setAssignment(parsed.assignment);
        if (parsed.providers !== undefined) {
          applyResolvedState("iptv:providers", parsed.providers, setProviders, "cache");
        }
        if (parsed.channels !== undefined) {
          applyResolvedState("iptv:channels", parsed.channels, setChannels, "cache");
        }
        if (parsed.liveMatches !== undefined) {
          applyResolvedState("live:matches", parsed.liveMatches, setLiveMatches, "cache");
        }
        setPreviewedChannelId(parsed.previewedChannelId);
        setSelectedChannel(parsed.selectedChannel);
        setSelectedMatchId(parsed.selectedMatchId);
      } catch {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }

    void apiClient
      .login("operator@gito.local")
      .then((session) => setAccessToken(session.accessToken))
      .then(() => refreshOperations("full"))
      .catch(() => {
        setAccessToken("");
        setBackendStatus("offline");
      });
  }, [refreshOperations]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          assignment,
          channels,
          liveMatches,
          providers,
          previewedChannelId,
          selectedChannel,
          selectedMatchId
        })
      );
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [assignment, channels, liveMatches, previewedChannelId, providers, selectedChannel]);

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
      return;
    }

    const provider = await apiClient.createProvider(input);

    if (input.type === "m3u" || input.type === "xtream") {
      try {
        await apiClient.testProviderById(provider.id);
      } catch {
        // Let the provider remain pending/failed until the operator fixes credentials.
      }
    }

    await refreshOperations("full");
  }, [backendStatus, refreshOperations]);

  const updateProvider = useCallback(async (providerId: string, input: Partial<Parameters<typeof apiClient.createProvider>[0]>) => {
    if (backendStatus !== "online") return;

    await apiClient.updateProvider(providerId, input);

    if (input.type === "m3u" || input.type === "xtream") {
      try {
        await apiClient.testProviderById(providerId);
      } catch {
        // Keep the updated provider flow intact if test fails.
      }
    }

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
          openMatch: (matchId?: string) => {
            setSelectedMatchId(matchId);
            setActiveScreen("matches");
          },
        syncXtream,
        testProvider: apiClient.testProvider,
        testProviderById
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
          setSelectedMatchId,
        syncXtream,
        setProviderStatus,
        testProviderById
      ]
  );

  const screenState = useMemo(
    () => ({
      accessToken,
      assignment,
      backendStatus,
      channels,
      liveMatches,
      previewedChannelId,
      providers,
      selectedChannel,
      liveMode
    }),
    [
      accessToken,
      assignment,
      backendStatus,
      channels,
      liveMatches,
      previewedChannelId,
      providers,
      selectedChannel,
      liveMode
    ]
  );

  return (
    <AuthenticatedLayout 
      activeKey={activeScreen} 
      liveMode={liveMode} 
      onNavigate={setActiveScreen}
      activeProvider={selectedChannel ? providers.find((p) => p.id === selectedChannel.providerId) : undefined}
    >
      {renderScreen(
        activeScreen,
        screenState,
        actions
      )}
    </AuthenticatedLayout>
  );
}
