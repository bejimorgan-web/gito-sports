import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  Channel,
  Competition,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  PublishedLiveMatch,
  IPTVProvider,
  ProviderChannelDiagnostics,
  Sport,
  Stream,
  Team
} from "@gito/shared";

import { StreamPreviewPanel } from "../preview/StreamPreviewPanel";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";
import { localDateTimeToUtc, utcToOperatorKickoff } from "../clubs/fixture-time";

const FALLBACK_LOGO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="%23081018"/></svg>';

interface BroadcastConsoleScreenProps {
  assignment: MatchAssignmentResult | undefined;
  channels: Channel[];
  backendStatus: "online" | "offline" | "reconnecting";
  liveMatches: PublishedLiveMatch[];
  liveMode: boolean;
  previewedChannelId: string | undefined;
  providers: IPTVProvider[];
  selectedChannel: Channel | undefined;
  preferredProviderId?: string | undefined;
  onApprove: (streamId: string) => Promise<void>;
  onAssignMatch: (input: MatchAssignmentRequest) => Promise<MatchAssignmentResult>;
  onPreviewReady: (channelId: string) => void;
  onPublish: (streamId: string) => Promise<void>;
  onReportHealth: (status: Stream["healthStatus"], reason?: string) => void;
  onSelectChannel: (channel: Channel) => void;
  onClearAssignment: () => void;
  onSetLiveMode: (enabled: boolean) => void;
  onOpenMatch?: (matchId?: string) => void;
  onCatalogueContextChange?: (context: { providerId: string; contentType: ContentTypeOption; favoriteChannelIds: string[] }) => void;
  catalogueBrowser?: ReactNode;
  showLegacyChannelBrowser?: boolean;
}

function getNextAction({
  assignment,
  previewConfirmed,
  selectedChannel,
  matchDetailsComplete
}: {
  assignment: MatchAssignmentResult | undefined;
  previewConfirmed: boolean;
  selectedChannel: Channel | undefined;
  matchDetailsComplete: boolean;
}) {
  if (!selectedChannel) {
    return {
      label: "Select channel",
      detail: "Choose an IPTV channel from the source list."
    };
  }

  if (!previewConfirmed) {
    return {
      label: "Preview channel",
      detail: "Confirm playback before creating a match assignment."
    };
  }

  if (!assignment) {
    if (!matchDetailsComplete) {
      return {
        label: "Complete match details",
        detail: "Fill sport, competition, and teams before assignment."
      };
    }

    return {
      label: "Assign match",
      detail: "Add match metadata and attach the previewed channel."
    };
  }

  if (assignment.stream.status === "assigned" || assignment.stream.status === "testing") {
    return {
      label: "Approve stream",
      detail: "Operator approval is required before publication."
    };
  }

  if (assignment.match.status === "approved" && assignment.stream.status === "approved") {
    return {
      label: "Publish live",
      detail: "This match is ready for mobile delivery."
    };
  }

  if (assignment.match.status === "published" && assignment.stream.status === "active") {
    return {
      label: "Published",
      detail: "The live feed is available to mobile clients."
    };
  }

  return {
    label: "Check state",
    detail: "The backend lifecycle is blocking the next action."
  };
}

function getUnifiedStatus(input: {
  assignment: MatchAssignmentResult | undefined;
  backendOffline: boolean;
  providerRisk: boolean;
  selectedChannel: Channel | undefined;
}) {
  const { assignment, backendOffline, providerRisk, selectedChannel } = input;

  if (backendOffline) {
    return { label: "AT RISK", tone: "risk", detail: "Backend unavailable. Work is read-only." };
  }

  if (assignment?.stream.healthStatus === "failed" || assignment?.stream.status === "failed") {
    return { label: "FAILED", tone: "failed", detail: "Stream failed. Remove from live operations." };
  }

  if (assignment?.match.status === "published" && assignment.stream.status === "active") {
    if (assignment.stream.healthStatus === "degraded" || providerRisk) {
      return { label: "LIVE - Degraded", tone: "risk", detail: "Live signal needs attention." };
    }

    return { label: "LIVE - Stable", tone: "live", detail: "Live feed is healthy." };
  }

  if (providerRisk || assignment?.stream.healthStatus === "degraded") {
    return { label: "AT RISK", tone: "risk", detail: "Check provider or preview stability." };
  }

  if (assignment?.match.status === "approved" && assignment.stream.status === "approved") {
    return { label: "READY", tone: "ready", detail: "Approved and ready to publish." };
  }

  if (assignment) {
    return { label: "READY", tone: "ready", detail: "Assigned stream is waiting for approval." };
  }

  if (selectedChannel) {
    return { label: "READY", tone: "ready", detail: "Channel selected. Preview before assignment." };
  }

  return { label: "IDLE", tone: "idle", detail: "Select a channel to begin." };
}

function getOperatorMessage(input: {
  assignment: MatchAssignmentResult | undefined;
  backendOffline: boolean;
  providerRisk: boolean;
  selectedProvider: IPTVProvider | undefined;
  streamFailed: boolean;
}) {
  if (input.backendOffline) {
    return "Connection lost. Keep monitoring; publishing will unlock when the backend returns.";
  }

  if (input.streamFailed) {
    return "Stream failed. It has been removed from live delivery.";
  }

  if (input.providerRisk) {
    return `${input.selectedProvider?.name ?? "Provider"} is unstable. Watch the preview before publishing.`;
  }

  if (input.assignment?.stream.healthStatus === "degraded") {
    return "Signal is unstable. Wait for recovery before publishing.";
  }

  return "No critical action required.";
}

export type ContentTypeOption = "live" | "movies" | "series" | "favorites";

function matchesContentType(channel: Channel, contentType: ContentTypeOption) {
  const sourceText = [channel.groupName ?? "", channel.externalRef ?? "", channel.name ?? ""].join(" ").toLowerCase();

  const hasExplicitVodToken = /(^|[^a-z])(vod)([^a-z]|$)/.test(sourceText);
  const hasExplicitMovieToken = /(^|[^a-z])(movies?|films?)([^a-z]|$)/.test(sourceText);
  const hasExplicitSeriesToken = /(^|[^a-z])(series?|shows?|episodes?)([^a-z]|$)/.test(sourceText);

  const isMovieContent = hasExplicitVodToken && hasExplicitMovieToken;
  const isSeriesContent = hasExplicitVodToken && hasExplicitSeriesToken;

  if (contentType === "movies") {
    return isMovieContent;
  }

  if (contentType === "series") {
    return isSeriesContent;
  }

  return !isMovieContent && !isSeriesContent;
}

function getGuideMetadataCopy({
  channel,
  provider,
  contentType,
  groupName,
  groupChannels,
  providerDiagnostics
}: {
  channel: Channel | undefined;
  provider: IPTVProvider | undefined;
  contentType: ContentTypeOption;
  groupName: string;
  groupChannels: Channel[];
  providerDiagnostics: ProviderChannelDiagnostics | null;
}) {
  const channelName = channel?.name ?? "Selected channel";
  const providerName = provider?.name ?? "IPTV account";
  const resolvedGroupName = groupName || channel?.groupName || "Live lineup";
  const normalizedGroup = resolvedGroupName.toLowerCase();
  const contentTypeLabel = contentType === "movies" ? "Movie" : contentType === "series" ? "Series" : contentType === "favorites" ? "Favorite" : "Live";
  const diagnosticsSummary = providerDiagnostics
    ? {
        total: providerDiagnostics.totalChannels,
        active: providerDiagnostics.counts.active,
        health: providerDiagnostics.healthScore,
        availability: providerDiagnostics.availabilityStatus
      }
    : null;

  const genreKey = normalizedGroup.includes("movie")
    ? "movies"
    : normalizedGroup.includes("series")
    ? "series"
    : normalizedGroup.includes("sport")
    ? "sports"
    : normalizedGroup.includes("news")
    ? "news"
    : normalizedGroup.includes("kids")
    ? "kids"
    : normalizedGroup.includes("music")
    ? "music"
    : "live";

  const nowLabel = genreKey === "movies"
    ? "Now showing"
    : genreKey === "series"
    ? "Now airing"
    : genreKey === "sports"
    ? "Now live"
    : genreKey === "news"
    ? "Now on air"
    : "Now on channel";

  const nextLabel = genreKey === "movies"
    ? "Next screening"
    : genreKey === "series"
    ? "Next episode"
    : genreKey === "sports"
    ? "Up next: match window"
    : genreKey === "news"
    ? "Up next: bulletin"
    : "Next up";

  const continuityLabel = genreKey === "movies"
    ? "Channel continuity"
    : genreKey === "series"
    ? "Channel continuity"
    : "Channel continuity";

  const relatedChannels = groupChannels.filter((item) => item.id !== channel?.id).slice(0, 2);
  const description = diagnosticsSummary
    ? `${resolvedGroupName} is currently served by ${providerName} with ${diagnosticsSummary.active} active channels synced and ${diagnosticsSummary.health}% health.`
    : `${resolvedGroupName} is currently mapped from ${providerName} and is ready for preview in the ${contentTypeLabel.toLowerCase()} view.`;

  return {
    title: `${nowLabel}: ${channelName}`,
    description: `${description} ${contentTypeLabel} content is staged for preview.`,
    upcoming: [
      `${nextLabel}: ${resolvedGroupName}`,
      relatedChannels[0] ? `${relatedChannels[0].name} in this block` : `${resolvedGroupName} lineup continues`,
      continuityLabel
    ]
  };
}

export const BroadcastConsoleScreen = memo(function BroadcastConsoleScreen({
  assignment,
  backendStatus,
  channels,
  liveMatches,
  liveMode,
  previewedChannelId,
  providers,
  selectedChannel,
  preferredProviderId,
  onApprove,
  onAssignMatch,
  onPreviewReady,
  onPublish,
  onReportHealth,
  onSelectChannel,
  onClearAssignment,
  onSetLiveMode,
  onOpenMatch,
  onCatalogueContextChange,
  catalogueBrowser,
  showLegacyChannelBrowser = true
}: BroadcastConsoleScreenProps) {
  const [selectedSportId, setSelectedSportId] = useState<string>("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>("");
  const [selectedHomeTeamId, setSelectedHomeTeamId] = useState<string>("");
  const [selectedAwayTeamId, setSelectedAwayTeamId] = useState<string>("");
  const [canonicalFixtures, setCanonicalFixtures] = useState<any[]>([]);
  const [selectedCanonicalFixtureId, setSelectedCanonicalFixtureId] = useState("");
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
  const [status, setStatus] = useState("Console ready");
  const [sports, setSports] = useState<Sport[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [selectedContentType, setSelectedContentType] = useState<ContentTypeOption>("live");
  const [favoriteChannelIds, setFavoriteChannelIds] = useState<string[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.localStorage.getItem("gito-broadcast-favorite-channels");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const manualProviderSelectionRef = useRef(false);
  const [providerDiagnostics, setProviderDiagnostics] = useState<ProviderChannelDiagnostics | null>(null);
  const [providerDiagnosticsError, setProviderDiagnosticsError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<{
    backend: string;
    database: string;
    footballApi: string;
    analytics: string;
    uptime: number;
    timestamp: string;
  } | null>(null);
  const [systemStatusError, setSystemStatusError] = useState<string | null>(null);

  const previewConfirmed = Boolean(selectedChannel) && previewedChannelId === selectedChannel?.id;
  const visibleProviders = useMemo(() => providers.filter((provider) => provider.status === "active"), [providers]);
  useEffect(() => {
    if (selectedProviderId) {
      onCatalogueContextChange?.({ providerId: selectedProviderId, contentType: selectedContentType, favoriteChannelIds });
    }
  }, [favoriteChannelIds, onCatalogueContextChange, selectedContentType, selectedProviderId]);
  const favoriteChannelIdSet = useMemo(() => new Set(favoriteChannelIds), [favoriteChannelIds]);
  const visibleProviderIds = useMemo(() => new Set(visibleProviders.map((provider) => provider.id)), [visibleProviders]);
  const selectedCompetition = useMemo(
    () => competitions.find((item) => item.id === selectedCompetitionId),
    [competitions, selectedCompetitionId]
  );
  const selectedSport = useMemo(
    () => sports.find((item) => item.id === selectedSportId),
    [sports, selectedSportId]
  );
  const selectedHomeTeam = useMemo(
    () => teams.find((team) => team.id === selectedHomeTeamId),
    [teams, selectedHomeTeamId]
  );
  const selectedAwayTeam = useMemo(
    () => teams.find((team) => team.id === selectedAwayTeamId),
    [teams, selectedAwayTeamId]
  );
  const matchDetailsComplete = Boolean(selectedCompetition && selectedHomeTeam && selectedAwayTeam && selectedSportId);
  const canAssign = Boolean(selectedChannel && previewConfirmed && !assignment && matchDetailsComplete);
  const canApprove = Boolean(assignment && (assignment.stream.status === "assigned" || assignment.stream.status === "testing"));
  const canPublish = Boolean(assignment && assignment.match.status === "approved" && assignment.stream.status === "approved");

  const nextAction = useMemo(
    () => getNextAction({ assignment, previewConfirmed, selectedChannel, matchDetailsComplete }),
    [assignment, previewConfirmed, selectedChannel, matchDetailsComplete]
  );
  useEffect(() => {
    if (!visibleProviders.length) {
      if (selectedProviderId) {
        setSelectedProviderId("");
      }
      manualProviderSelectionRef.current = false;
      return;
    }

    const selectedProvider = selectedProviderId
      ? visibleProviders.find((provider) => provider.id === selectedProviderId)
      : undefined;
    const selectedProviderIsUsable = Boolean(selectedProvider && selectedProvider.status === "active");

    if (manualProviderSelectionRef.current) {
      if (!selectedProviderIsUsable) {
        const fallbackProvider = preferredProviderId
          ? visibleProviders.find((provider) => provider.id === preferredProviderId && provider.status === "active")
          : visibleProviders.find((provider) => provider.status === "active");

        if (fallbackProvider) {
          setSelectedProviderId(fallbackProvider.id);
          manualProviderSelectionRef.current = false;
        }
      }
      return;
    }

    const requestedProvider = preferredProviderId
      ? visibleProviders.find((provider) => provider.id === preferredProviderId && provider.status === "active")
      : undefined;

    if (requestedProvider) {
      if (selectedProviderId !== requestedProvider.id) {
        setSelectedProviderId(requestedProvider.id);
      }
      return;
    }

    if (selectedProviderIsUsable) {
      return;
    }

    const preferredProvider = selectedChannel?.providerId
      ? visibleProviders.find((provider) => provider.id === selectedChannel.providerId && provider.status === "active")
      : visibleProviders.find((provider) => provider.status === "active");

    const fallbackProvider = preferredProvider ?? visibleProviders[0];

    if (fallbackProvider) {
      setSelectedProviderId(fallbackProvider.id);
    }
  }, [preferredProviderId, visibleProviders, selectedChannel?.providerId, selectedProviderId]);

  useEffect(() => {
    setSelectedGroup("");
    setChannelSearchQuery("");
  }, [selectedProviderId, selectedContentType]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("gito-broadcast-favorite-channels", JSON.stringify(favoriteChannelIds));
  }, [favoriteChannelIds]);

  const toggleFavoriteChannel = useCallback((channelId: string) => {
    setFavoriteChannelIds((current) => {
      if (current.includes(channelId)) {
        return current.filter((id) => id !== channelId);
      }

      return [...current, channelId];
    });
  }, []);

  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.id === selectedProviderId),
    [visibleProviders, selectedProviderId]
  );
  const activeProviderChannels = useMemo(
    () => {
      const visibleChannels = channels.filter((channel) => visibleProviderIds.has(channel.providerId));
      const providerChannels = selectedProvider
        ? visibleChannels.filter((channel) => channel.providerId === selectedProvider.id)
        : visibleChannels;

      if (selectedContentType === "favorites") {
        return providerChannels.filter((channel) => favoriteChannelIdSet.has(channel.id));
      }

      return providerChannels.filter((channel) => matchesContentType(channel, selectedContentType));
    },
    [channels, favoriteChannelIdSet, selectedContentType, selectedProvider, visibleProviderIds]
  );
  const channelGroups = useMemo(
    () => {
      if (selectedContentType === "favorites") {
        return activeProviderChannels.length ? ["Favorites"] : [];
      }

      return [...new Set(activeProviderChannels.map((channel) => channel.groupName ?? "Ungrouped"))];
    },
    [activeProviderChannels, selectedContentType]
  );
  const filteredChannelGroups = useMemo(
    () =>
      groupSearchQuery.trim() === ""
        ? channelGroups
        : channelGroups.filter((group) =>
            group.toLowerCase().includes(groupSearchQuery.toLowerCase())
          ),
    [channelGroups, groupSearchQuery]
  );
  useEffect(() => {
    if (selectedContentType === "favorites") {
      if (selectedGroup !== "Favorites") {
        setSelectedGroup("Favorites");
      }
      return;
    }

    if (!selectedGroup || !filteredChannelGroups.includes(selectedGroup)) {
      setSelectedGroup(filteredChannelGroups[0] ?? "");
    }
  }, [filteredChannelGroups, selectedContentType, selectedGroup]);
  const selectedGroupChannels = useMemo(
    () => {
      if (selectedContentType === "favorites") {
        return activeProviderChannels;
      }

      return activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === selectedGroup);
    },
    [activeProviderChannels, selectedContentType, selectedGroup]
  );
  const filteredSelectedGroupChannels = useMemo(
    () =>
      channelSearchQuery.trim() === ""
        ? selectedGroupChannels
        : selectedGroupChannels.filter((channel) =>
            channel.name.toLowerCase().includes(channelSearchQuery.toLowerCase())
          ),
    [selectedGroupChannels, channelSearchQuery]
  );

  const previewChannelMetadata = useMemo(() => {
    return getGuideMetadataCopy({
      channel: selectedChannel,
      provider: selectedProvider,
      contentType: selectedContentType,
      groupName: selectedGroup || selectedChannel?.groupName || "Live lineup",
      groupChannels: selectedGroupChannels,
      providerDiagnostics
    });
  }, [providerDiagnostics, selectedChannel, selectedContentType, selectedProvider, selectedGroup, selectedGroupChannels]);

  useEffect(() => {
    if (!showLegacyChannelBrowser) {
      return;
    }

    if (!filteredSelectedGroupChannels.length) {
      return;
    }

    const firstChannel = filteredSelectedGroupChannels[0];
    const selectedChannelIsVisible = Boolean(selectedChannel && filteredSelectedGroupChannels.some((channel) => channel.id === selectedChannel.id));
    const providerSelectionChanged = selectedProviderId && selectedChannel?.providerId !== selectedProviderId;

    if (!selectedChannel) {
      if (firstChannel) {
        onSelectChannel(firstChannel);
      }
      return;
    }

    if (!selectedChannelIsVisible || providerSelectionChanged) {
      if (firstChannel) {
        onSelectChannel(firstChannel);
      }
    }
  }, [filteredSelectedGroupChannels, onSelectChannel, selectedChannel, selectedProviderId, showLegacyChannelBrowser]);

  useEffect(() => {
    if (selectedCompetition && selectedSportId && selectedCompetition.sportId !== selectedSportId) {
      setSelectedCompetitionId("");
    }
  }, [selectedCompetition, selectedSportId]);

  useEffect(() => {
    if (selectedHomeTeam && selectedSportId && selectedHomeTeam.sportId !== selectedSportId) {
      setSelectedHomeTeamId("");
    }
  }, [selectedHomeTeam, selectedSportId]);

  useEffect(() => {
    if (selectedAwayTeam && selectedSportId && selectedAwayTeam.sportId !== selectedSportId) {
      setSelectedAwayTeamId("");
    }
  }, [selectedAwayTeam, selectedSportId]);

  useEffect(() => {
    if (!selectedCompetitionId) {
      setCanonicalFixtures([]);
      setSelectedCanonicalFixtureId("");
      return;
    }
    void apiClient.listFixtures({ competitionId: selectedCompetitionId, limit: 100 }).then(setCanonicalFixtures).catch(() => setCanonicalFixtures([]));
  }, [selectedCompetitionId]);

  const selectedCanonicalFixture = useMemo(
    () => canonicalFixtures.find((fixture) => fixture.id === selectedCanonicalFixtureId),
    [canonicalFixtures, selectedCanonicalFixtureId]
  );

  useEffect(() => {
    if (!selectedCanonicalFixture) return;
    setSelectedHomeTeamId(selectedCanonicalFixture.homeTeamId);
    setSelectedAwayTeamId(selectedCanonicalFixture.awayTeamId);
    setStartsAt(utcToOperatorKickoff(selectedCanonicalFixture.startsAt));
  }, [selectedCanonicalFixture]);

  const filteredCompetitions = useMemo(
    () => (selectedSportId ? competitions.filter((competition) => competition.sportId === selectedSportId) : competitions),
    [competitions, selectedSportId]
  );

  const filteredTeams = useMemo(
    () =>
      teams.filter((team) => {
        const matchesSport = selectedSportId ? team.sportId === selectedSportId : true;
        const matchesCompetitionCountry = selectedCompetition?.countryId ? team.countryId === selectedCompetition.countryId : true;
        return matchesSport && matchesCompetitionCountry;
      }),
    [teams, selectedSportId, selectedCompetition?.countryId]
  );
  const backendOffline = backendStatus !== "online";
  const providerRisk = selectedProvider?.availabilityStatus === "offline" || selectedProvider?.availabilityStatus === "degraded";
  const streamFailed = assignment?.stream.healthStatus === "failed" || assignment?.stream.status === "failed";
  const terminalAssignment = Boolean(assignment && !canApprove && !canPublish);

  useEffect(() => {
    if (!selectedProviderId) {
      setProviderDiagnostics(null);
      setProviderDiagnosticsError(null);
      return;
    }

    let active = true;

    const loadProviderDiagnostics = async () => {
      try {
        const diagnostics = await apiClient.getProviderDiagnostics(selectedProviderId);
        if (!active) {
          return;
        }
        setProviderDiagnostics(diagnostics);
        setProviderDiagnosticsError(null);
      } catch (error) {
        if (!active) {
          return;
        }
        setProviderDiagnostics(null);
        setProviderDiagnosticsError(error instanceof Error ? error.message : String(error));
      }
    };

    void loadProviderDiagnostics();

    return () => {
      active = false;
    };
  }, [selectedProviderId]);

  useEffect(() => {
    const diagnostics = {
      selectedCompetitionId,
      selectedSportId,
      selectedHomeTeamId,
      selectedAwayTeamId,
      selectedChannelId: selectedChannel?.id ?? null,
      previewConfirmed,
      matchDetailsComplete,
      assignment,
      backendOffline,
      streamFailed,
      canAssign,
      canApprove,
      canPublish,
      assignButtonDisabled: !canAssign || backendOffline || streamFailed,
      approveButtonDisabled: !assignment || !canApprove || backendOffline || streamFailed,
      publishButtonDisabled: !assignment || !canPublish || backendOffline || streamFailed
    };

    // eslint-disable-next-line no-console
    console.log("GITO_CONTROL_DIAGNOSTIC", diagnostics);
    // expose for runtime inspection from browser tooling
    (window as any).__GITO_CONTROL_DIAGNOSTIC__ = diagnostics;
  }, [
    selectedCompetitionId,
    selectedSportId,
    selectedHomeTeamId,
    selectedAwayTeamId,
    selectedChannel?.id,
    previewConfirmed,
    matchDetailsComplete,
    assignment,
    backendOffline,
    streamFailed,
    canAssign,
    canApprove,
    canPublish
  ]);

  const unifiedStatus = useMemo(
    () => getUnifiedStatus({ assignment, backendOffline, providerRisk, selectedChannel }),
    [assignment, backendOffline, providerRisk, selectedChannel]
  );
  const operatorMessage = useMemo(
    () =>
      getOperatorMessage({
        assignment,
        backendOffline,
        providerRisk,
        selectedProvider,
        streamFailed
      }),
    [assignment, backendOffline, providerRisk, selectedProvider, streamFailed]
  );

  const actionableAlerts = useMemo(
    () => [
      ...(backendOffline ? ["Backend offline"] : []),
      ...(streamFailed ? ["Stream failed"] : []),
      ...(providerRisk ? ["Provider unstable"] : []),
      ...(canApprove ? ["Approval required"] : []),
      ...(canPublish ? ["Ready to publish"] : [])
    ],
    [backendOffline, canApprove, canPublish, providerRisk, streamFailed]
  );

  const dashboardMetrics = useMemo(
    () => [
      {
        label: "Live matches",
        value: String(liveMatches.length),
        detail: liveMatches.length > 0 ? `${liveMatches.length} active stream${liveMatches.length === 1 ? "" : "s"}` : "No live feeds"
      },
      {
        label: "Actionable alerts",
        value: String(actionableAlerts.length),
        detail: actionableAlerts.length > 0 ? actionableAlerts.join(" · ") : "No current issues"
      },
      {
        label: "Selected source",
        value: selectedChannel ? "Ready" : "None",
        detail: selectedChannel?.name ?? "Select an IPTV channel"
      },
      {
        label: "System status",
        value: systemStatus?.backend === "online" ? "Online" : systemStatus?.backend ?? "Loading",
        detail: systemStatus
          ? `DB ${systemStatus.database} · Football API ${systemStatus.footballApi} · Analytics ${systemStatus.analytics}`
          : systemStatusError
          ? `Error: ${systemStatusError}`
          : "Refreshing system status..."
      },
      {
        label: "Backend status",
        value: backendStatus === "online" ? "Online" : backendStatus === "reconnecting" ? "Reconnecting" : "Offline",
        detail: backendStatus === "online" ? "Operations active" : "Service unavailable"
      }
    ],
    [liveMatches.length, actionableAlerts, selectedChannel, backendStatus, systemStatus, systemStatusError]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [sportsData, competitionsData, teamsData] = await Promise.all([
          apiClient.listSports(),
          apiClient.listCompetitions(),
          apiClient.listTeams()
        ]);

        if (!active) {
          return;
        }

        setSports(sportsData);
        setCompetitions(competitionsData);
        setTeams(teamsData);
      } catch {
        // Keep default assignment values if the desktop data load fails.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refreshSystemStatus = async () => {
      try {
        const status = await apiClient.systemStatus();
        if (!active) {
          return;
        }
        setSystemStatus(status);
        setSystemStatusError(null);
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        setSystemStatus(null);
        setSystemStatusError(error instanceof Error ? error.message : String(error));
      }
    };

    refreshSystemStatus();
    const interval = window.setInterval(refreshSystemStatus, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleAssign = useCallback(async () => {
    if (!selectedChannel || !canAssign) {
      setStatus(!selectedChannel ? "Select a channel first." : "Preview confirmation is required.");
      return;
    }

    if (!selectedCompetition || !selectedHomeTeam || !selectedAwayTeam || !selectedSport) {
      setStatus("Select sport, competition, home team, and away team before assigning.");
      return;
    }

    setStatus("Assigning match stream...");
    try {
      await onAssignMatch({
        ...(selectedCanonicalFixtureId ? { canonicalFixtureId: selectedCanonicalFixtureId } : {}),
        sportName: selectedSport?.name ?? "Unknown",
        competitionName: selectedCompetition.name,
        homeTeamName: selectedHomeTeam.name,
        awayTeamName: selectedAwayTeam.name,
        startsAt: localDateTimeToUtc(startsAt) ?? "",
        channelId: selectedChannel.id
      });
      setStatus("Stream assigned. Approval is now available.");
    } catch {
      setStatus("Assignment was not confirmed. Check backend connection and try again.");
    }
  }, [selectedChannel, canAssign, selectedCanonicalFixtureId, selectedCompetition, selectedHomeTeam, selectedAwayTeam, selectedSport, startsAt, onAssignMatch]);

  const handleApprove = useCallback(async (stream: Stream) => {
    setStatus("Approving stream...");
    try {
      await onApprove(stream.id);
      setStatus("Stream approved. Publication is now available.");
    } catch {
      setStatus("Approval was not confirmed. State was restored from the last valid value.");
    }
  }, [onApprove]);

  const handlePublish = useCallback(async (stream: Stream) => {
    setStatus("Publishing live match...");
    try {
      await onPublish(stream.id);
      setStatus("Published to live feed.");
    } catch {
      setStatus("Publishing was not confirmed. Match remains in its last safe state.");
    }
  }, [onPublish]);

  return (
    <section className="control-room">
      <header className="control-header">
        <div>
          <p className="eyebrow">Broadcast Control</p>
          <h2>{liveMode ? "LIVE MODE" : "Live Operations Console"}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="live-mode-toggle" type="button" onClick={() => onSetLiveMode(!liveMode)}>
            {liveMode ? "Exit Live Mode" : "LIVE MODE"}
          </button>
          <button type="button" onClick={async () => {
            setStatus('Creating backup...');
            try {
              const resp = await apiClient.createBackup();
              setStatus(`Backup created: ${resp.backup.filename}`);
            } catch (err: any) {
              setStatus(`Backup failed: ${err?.message ?? String(err)}`);
            }
          }}>
            Create Backup
          </button>
          <button type="button" onClick={async () => {
            setStatus('Restoring latest backup...');
            try {
              const list = await apiClient.listBackups();
              const latest = list.backups?.[0];
              if (!latest) {
                setStatus('No backups available');
                return;
              }
              await apiClient.restoreApply(latest.filename, true);
              setStatus('Restore applied. Restart required.');
            } catch (err: any) {
              setStatus(`Restore failed: ${err?.message ?? String(err)}`);
            }
          }}>
            Restore Latest
          </button>
        </div>
        <div className="next-action">
          <span>Next action</span>
          <strong>{nextAction.label}</strong>
          <small>{nextAction.detail}</small>
        </div>
      </header>

      <div className={liveMode ? "unified-status live-mode-status" : "unified-status"}>
        <strong className={`unified-status-badge ${unifiedStatus.tone}`}>{unifiedStatus.label}</strong>
        <span>{operatorMessage}</span>
      </div>

      {!liveMode ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="priority-strip simplified-priority-strip content-type-strip">
          {[
            { key: "live", label: "Live TV", icon: "📺" },
            { key: "movies", label: "Movies", icon: "🎬" },
            { key: "series", label: "Series", icon: "📺" },
            { key: "favorites", label: "Favorites", icon: "⭐" }
          ].map((option) => {
            const selected = selectedContentType === option.key;
            return (
              <button
                key={option.key}
                type="button"
                className={`priority-card ${selected ? "live" : ""}`}
                onClick={() => setSelectedContentType(option.key as ContentTypeOption)}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  border: selected ? "1px solid #4ad7ff" : "1px solid #243649",
                  background: selected ? "rgba(74, 215, 255, 0.12)" : "rgba(8, 16, 24, 0.85)",
                  boxShadow: selected && option.key === "favorites" ? "0 0 0 1px rgba(74, 215, 255, 0.2) inset" : undefined
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>{option.icon}</span>
                <strong>{option.label}</strong>
                <span style={{ color: "#8fa1b3", fontSize: "0.8rem" }}>
                  {option.key === "favorites"
                    ? `${favoriteChannelIds.length} saved`
                    : option.key === "live"
                    ? `${providerDiagnostics?.contentTotals.live ?? 0} channels`
                    : option.key === "movies"
                    ? `${providerDiagnostics?.contentTotals.movies ?? 0} movies`
                    : `${providerDiagnostics?.contentTotals.series ?? 0} series`}
                </span>
              </button>
            );
          })}
          </div>

          <div className="console-panel" style={{ padding: 12 }}>
            <label style={{ display: "grid", gap: 6, color: "#8fa1b3" }}>
              <span>Active IPTV provider</span>
              <select
                value={selectedProviderId}
                onChange={(event) => {
                  manualProviderSelectionRef.current = true;
                  setSelectedProviderId(event.target.value);
                  setSelectedGroup("");
                  setChannelSearchQuery("");
                }}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #253647", background: "#0a1119", color: "#e7edf4" }}
              >
                {visibleProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} ({provider.status})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {liveMode ? (
        <section className="live-mode-board">
          <div className="live-mode-main">
            <h3>Live Matches</h3>
            <div className="live-match-list">
              {liveMatches.map((liveMatch) => {
                  const match: any = liveMatch.match as any;
                  const competition = competitions.find((c) => c.id === match.competitionId);
                  const homeTeam = teams.find((t) => t.id === match.homeTeamId);
                  const awayTeam = teams.find((t) => t.id === match.awayTeamId);
                  const sport = competition ? sports.find((s) => s.id === competition.sportId) : undefined;

                  return (
                    <article key={liveMatch.stream.id} onClick={() => onOpenMatch?.(match?.id)} style={{ cursor: onOpenMatch ? "pointer" : "default" }}>
                      <div className="live-match-main">
                        <div className="live-match-teams">
                          {homeTeam?.logoUrl ? <img src={resolveAssetUrl(homeTeam.logoUrl)} alt={homeTeam.name} className="match-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="match-logo" />}
                          <strong>{homeTeam?.name ?? match.homeTeamId}</strong>
                          <span className="vs">vs</span>
                          {awayTeam?.logoUrl ? <img src={resolveAssetUrl(awayTeam.logoUrl)} alt={awayTeam.name} className="match-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="match-logo" />}
                          <strong>{awayTeam?.name ?? match.awayTeamId}</strong>
                        </div>
                        <div className="live-match-meta">
                          {competition?.logoUrl ? <img src={resolveAssetUrl(competition.logoUrl)} alt={competition.name} className="competition-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="competition-logo" />}
                          <div className="competition-name">{competition?.name}</div>
                          {sport?.logoUrl ? <img src={resolveAssetUrl(sport.logoUrl)} alt={sport.name} className="competition-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : null}
                        </div>
                      </div>
                      <span className="unified-status-badge live">LIVE - Stable</span>
                    </article>
                  );
                })}
              {liveMatches.length === 0 ? <div className="empty-row">No live matches are currently published.</div> : null}
            </div>
          </div>
          <aside className="live-mode-alerts">
            <h3>Actionable Alerts</h3>
            {actionableAlerts.length > 0 ? (
              actionableAlerts.map((alert) => <span key={alert}>{alert}</span>)
            ) : (
              <span>No action required</span>
            )}
          </aside>
        </section>
      ) : null}

      {!liveMode ? <div className="broadcast-grid">
        <section className="preview-core">
          <div key={`provider-${selectedProviderId || "none"}`} className="provider-switch-surface">
            <div className="preview-top-layout">
              <div className="preview-player-card">
                <StreamPreviewPanel
                  channel={selectedChannel}
                  onHealthChange={onReportHealth}
                  onPreviewReady={onPreviewReady}
                  compact
                />
              </div>

              <aside className="preview-meta-panel console-panel">
              <div className="panel-heading panel-heading-accent">
                <div>
                  <h3>Channel Guide</h3>
                  <span>Upcoming program metadata</span>
                </div>
                <span className="status-pill">{selectedProvider?.name ?? "Provider feed"}</span>
              </div>

              <div className="preview-meta-card">
                <div className="preview-meta-title">{previewChannelMetadata.title}</div>
                <p>{previewChannelMetadata.description}</p>

                {providerDiagnosticsError ? (
                  <div className="preview-meta-section">
                    <span className="preview-meta-label">Diagnostics</span>
                    <ul>
                      <li>{providerDiagnosticsError}</li>
                    </ul>
                  </div>
                ) : null}

                <div className="preview-meta-section">
                  <span className="preview-meta-label">Upcoming</span>
                  <ul>
                    {previewChannelMetadata.upcoming.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="preview-meta-footer">
                  <span>{selectedChannel?.groupName ?? "Channel group"}</span>
                  <span>{selectedChannel?.name ?? "No channel selected"}</span>
                </div>
              </div>
            </aside>
          </div>

            {showLegacyChannelBrowser ? <div className="channel-group-layout">
              <aside className="group-column console-panel">
                <div className="panel-heading">
                  <h4>Channel Groups</h4>
                  <span>{selectedContentType === "favorites" ? "Pinned favorites" : selectedProvider?.name ?? "Active provider"}</span>
                </div>
              <input
                type="text"
                placeholder="Search groups..."
                value={groupSearchQuery}
                onChange={(e) => setGroupSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  marginBottom: "8px",
                  border: "1px solid #253647",
                  borderRadius: "6px",
                  background: "#0a1119",
                  color: "#e7edf4",
                  fontSize: "0.9rem",
                  boxSizing: "border-box"
                }}
              />
              <div className="compact-channel-list group-list">
                {filteredChannelGroups.map((groupName) => (
                  <button
                    className={groupName === selectedGroup ? "selected" : ""}
                    key={groupName}
                    type="button"
                    onClick={() => setSelectedGroup(groupName)}
                  >
                    <strong>{groupName}</strong>
                    <span>{selectedContentType === "favorites" ? `${activeProviderChannels.length} favorites` : `${activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === groupName).length} channels`}</span>
                  </button>
                ))}
                {filteredChannelGroups.length === 0 ? <div className="empty-row">{groupSearchQuery.trim() !== "" ? "No matching groups found." : selectedContentType === "favorites" ? "No favorite channels saved yet." : "No groups available for this provider."}</div> : null}
              </div>
            </aside>

            <aside className="channel-column console-panel">
              <div className="panel-heading">
                <h4>Channels</h4>
                <span>{selectedContentType === "favorites" ? `${favoriteChannelIds.length} saved` : selectedGroup || "Group not selected"}</span>
              </div>
              <input
                type="text"
                placeholder="Search channels..."
                value={channelSearchQuery}
                onChange={(e) => setChannelSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  marginBottom: "8px",
                  border: "1px solid #253647",
                  borderRadius: "6px",
                  background: "#0a1119",
                  color: "#e7edf4",
                  fontSize: "0.9rem",
                  boxSizing: "border-box"
                }}
              />
                {selectedContentType === "favorites" ? (
                  <div style={{ marginBottom: 8, padding: "10px 11px", borderRadius: 8, border: "1px solid rgba(74, 215, 255, 0.2)", background: "rgba(74, 215, 255, 0.1)", color: "#9bdcff" }}>
                    <div style={{ fontWeight: 600 }}>Favorites queue</div>
                    <div style={{ fontSize: "0.85rem", color: "#8fa1b3", marginTop: 2 }}>Your pinned channels are collected here for fast, premium browsing.</div>
                  </div>
                ) : null}
                <div className="compact-channel-list">
                  {filteredSelectedGroupChannels.map((channel) => {
                    const isFavorite = favoriteChannelIdSet.has(channel.id);

                    return (
                      <div
                        key={channel.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}
                      >
                        <button
                          className={channel.id === selectedChannel?.id ? "selected" : ""}
                          type="button"
                          onClick={() => {
                            manualProviderSelectionRef.current = true;
                            setSelectedProviderId(channel.providerId);
                            onSelectChannel(channel);
                          }}
                          style={{ flex: 1, textAlign: "left" }}
                        >
                          <strong>{channel.name}</strong>
                          <span>{channel.groupName ?? "Uncategorized"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavoriteChannel(channel.id);
                          }}
                          style={{ border: "1px solid #253647", borderRadius: 999, background: isFavorite ? "rgba(74, 215, 255, 0.18)" : "transparent", color: isFavorite ? "#4ad7ff" : "#8fa1b3", width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }}
                          aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
                        >
                          {isFavorite ? "★" : "☆"}
                        </button>
                      </div>
                    );
                  })}
                  {filteredSelectedGroupChannels.length === 0 ? <div className="empty-row">{channelSearchQuery.trim() !== "" ? "No matching channels found." : selectedContentType === "favorites" ? "No favorite channels saved yet." : "No channels in this group."}</div> : null}
                </div>
              </aside>
            </div> : null}
          </div>

          {catalogueBrowser}

          <div className="match-control-layout">
            <section className="match-control-panel console-panel">
              <div className="panel-heading panel-heading-accent">
                <div>
                  <h3>Match Control</h3>
                  <span>Assign the previewed stream to a live match</span>
                </div>
                <span className="status-pill">{status}</span>
              </div>

              <div className="match-control-grid">
                <div className="match-control-column">
                  <label className="dropdown-label">
                    <span>Competition</span>
                    <select value={selectedCompetitionId} onChange={(e) => setSelectedCompetitionId(e.target.value)}>
                      <option value="">-- Select competition --</option>
                      {filteredCompetitions.map((competition) => (
                        <option key={competition.id} value={competition.id}>
                          {competition.name}
                        </option>
                      ))}
                    </select>
                    {selectedSport ? (
                      <small>{filteredCompetitions.length} competition{filteredCompetitions.length === 1 ? "" : "s"} for {selectedSport.name}</small>
                    ) : null}
                  </label>

                  <label className="dropdown-label">
                    <span>Canonical Season Fixture (optional)</span>
                    <select value={selectedCanonicalFixtureId} onChange={(e) => setSelectedCanonicalFixtureId(e.target.value)} disabled={!selectedCompetitionId}>
                      <option value="">No canonical fixture</option>
                      {canonicalFixtures.map((fixture) => (
                        <option key={fixture.id} value={fixture.id}>
                          {fixture.homeTeam?.name} vs {fixture.awayTeam?.name} · {new Date(fixture.startsAt).toLocaleString()} · {fixture.season?.name ?? "Season unavailable"} · {fixture.status}
                        </option>
                      ))}
                    </select>
                    {!selectedCompetitionId ? <small>Select a competition to load canonical fixtures.</small> : null}
                    {selectedCanonicalFixtureId ? <button type="button" className="secondary" onClick={() => setSelectedCanonicalFixtureId("")}>Clear fixture</button> : null}
                  </label>

                  <label className="dropdown-label">
                    <span>Home Team</span>
                    <select value={selectedHomeTeamId} onChange={(e) => setSelectedHomeTeamId(e.target.value)}>
                      <option value="">-- Select home team --</option>
                      {filteredTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    {selectedSport ? (
                      <small>{filteredTeams.length} team{filteredTeams.length === 1 ? "" : "s"} for {selectedSport.name}</small>
                    ) : null}
                  </label>
                </div>

                <div className="match-control-column">
                  <label className="dropdown-label">
                    <span>Away Team</span>
                    <select value={selectedAwayTeamId} onChange={(e) => setSelectedAwayTeamId(e.target.value)}>
                      <option value="">-- Select away team --</option>
                      {filteredTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    {selectedSport ? (
                      <small>{filteredTeams.length} team{filteredTeams.length === 1 ? "" : "s"} for {selectedSport.name}</small>
                    ) : null}
                  </label>

                  <label className="dropdown-label">
                    <span>Sport</span>
                    <select value={selectedSportId} onChange={(e) => setSelectedSportId(e.target.value)}>
                      <option value="">-- Select sport --</option>
                      {sports.map((sport) => (
                        <option key={sport.id} value={sport.id}>
                          {sport.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="kickoff-label">
                    <span>Kickoff</span>
                    <input
                      type="datetime-local"
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="blocked-reason">
                {!selectedChannel && "Blocked: select an IPTV channel."}
                {selectedChannel && !previewConfirmed && "Blocked: preview must be confirmed before assignment."}
                {!selectedCompetition && "Select a competition."}
                {!selectedSportId && "Select a sport."}
                {!selectedHomeTeam && "Select a home team."}
                {!selectedAwayTeam && "Select an away team."}
                {selectedChannel && previewConfirmed && !matchDetailsComplete && "Complete match details before assignment."}
                {backendOffline && "Waiting for backend reconnection."}
                {assignment?.stream.healthStatus === "degraded" && "Signal unstable. Keep previewing before publish."}
                {assignment?.stream.healthStatus === "failed" && "Stream failed. Choose another source."}
                {!backendOffline && assignment && !canApprove && !canPublish && `Current state: ${assignment.match.status} / ${assignment.stream.status}.`}
              </div>

              <div className="action-stack">
                <button type="button" disabled={!canAssign || backendOffline || streamFailed} onClick={handleAssign}>
                  Assign Previewed Stream
                </button>
                <button
                  type="button"
                  disabled={!assignment || !canApprove || backendOffline || streamFailed}
                  onClick={() => assignment && void handleApprove(assignment.stream)}
                >
                  Approve Stream
                </button>
                <button
                  className="publish-button"
                  type="button"
                  disabled={!assignment || !canPublish || backendOffline || streamFailed}
                  onClick={() => assignment && void handlePublish(assignment.stream)}
                >
                  Publish Live
                </button>
              </div>
            </section>

            <section className="match-control-panel console-panel">
              <div className="panel-heading panel-heading-accent">
                <div>
                  <h3>Active Work Item</h3>
                  <span>Current broadcast assignment summary</span>
                </div>
                <span className="status-pill">{unifiedStatus.label}</span>
              </div>

              <div className="work-item-grid">
                <div className="work-item-card">
                  <div className="work-item-label">Channel</div>
                  <div className="work-item-value">{selectedChannel?.name ?? "None selected"}</div>
                </div>

                <div className="work-item-card">
                  <div className="work-item-label">Sport</div>
                  <div className="work-item-value entity-inline">
                    {selectedSport?.logoUrl ? (
                      <img className="entity-logo" src={selectedSport.logoUrl} alt={selectedSport.name} />
                    ) : null}
                    <span>{selectedSport?.name ?? "None selected"}</span>
                  </div>
                </div>

                <div className="work-item-card">
                  <div className="work-item-label">Competition</div>
                  <div className="work-item-value entity-inline">
                    {selectedCompetition?.logoUrl ? (
                      <img className="entity-logo" src={selectedCompetition.logoUrl} alt={selectedCompetition.name} />
                    ) : null}
                    <span>{selectedCompetition?.name ?? "None selected"}</span>
                  </div>
                </div>

                <div className="work-item-card">
                  <div className="work-item-label">Status</div>
                  <div className="work-item-value">{unifiedStatus.label}</div>
                </div>

                <div className="work-item-card wide">
                  <div className="work-item-label">Teams</div>
                  <div className="work-item-value team-inline">
                    <div className="team-pair">
                      {selectedHomeTeam?.logoUrl ? (
                        <img className="entity-logo" src={selectedHomeTeam.logoUrl} alt={selectedHomeTeam.name} />
                      ) : null}
                      <span>{selectedHomeTeam?.name ?? "None selected"}</span>
                    </div>
                    <strong className="vs-label">vs</strong>
                    <div className="team-pair">
                      {selectedAwayTeam?.logoUrl ? (
                        <img className="entity-logo" src={selectedAwayTeam.logoUrl} alt={selectedAwayTeam.name} />
                      ) : null}
                      <span>{selectedAwayTeam?.name ?? "None selected"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="single-state-row">
            <span className={`unified-status-badge ${unifiedStatus.tone}`}>{unifiedStatus.label}</span>
            <small>{unifiedStatus.detail}</small>
          </div>
        </section>
      </div> : null}
    </section>
  );
});
