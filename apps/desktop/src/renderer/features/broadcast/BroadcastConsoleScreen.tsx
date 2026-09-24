import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  Channel,
  Competition,
  Host,
  IPTVProvider,
  ProviderChannelDiagnostics,
  Sport,
  Stream,
  Team
} from "@gito/shared";

import type { DesktopPublicationContext } from "../../services/publication-artifact";
import type { CataloguePreviewMetadata } from "../iptv/IptvCatalogueScreen";

import { StreamPreviewPanel } from "../preview/StreamPreviewPanel";
import { IptvHeroCards } from "./IptvHeroCards";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";
import { localDateTimeToUtc, utcToOperatorKickoff } from "../clubs/fixture-time";
import { CanonicalFixtureRequiredError } from "../../services/publication-artifact";

const FALLBACK_LOGO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="%23081018"/></svg>';

interface BroadcastConsoleScreenProps {
  assignment: DesktopPublicationContext | undefined;
  channels: Channel[];
  backendStatus: "online" | "offline" | "reconnecting";
  liveMatches: DesktopPublicationContext[];
  liveMode: boolean;
  previewedChannelId: string | undefined;
  providers: IPTVProvider[];
  selectedChannel: Channel | undefined;
  preferredProviderId?: string | undefined;
  onApprove: (publicationId: string) => Promise<void>;
  onAssignMatch: (input: PublicationControlAssignment) => Promise<DesktopPublicationContext>;
  onPreviewReady: (channelId: string) => void;
  onPublish: (publicationId: string) => Promise<void>;
  onReportHealth: (status: Stream["healthStatus"], reason?: string) => void;
  onSelectChannel: (channel: Channel) => void;
  onClearAssignment: () => void;
  onSetLiveMode: (enabled: boolean) => void;
  onOpenMatch?: (matchId?: string) => void;
  onCatalogueContextChange?: (context: { providerId: string; contentType: ContentTypeOption; favoriteChannelIds: string[] }) => void;
  catalogueBrowser?: ReactNode;
    cataloguePreviewMetadata?: CataloguePreviewMetadata;
  onCataloguePreviewMetadataChange?: (metadata: CataloguePreviewMetadata) => void;
  showLegacyChannelBrowser?: boolean;
}

export type PublicationControlAssignment = {
  canonicalFixtureId?: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  sportName: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  startsAt: string;
  channelId: string;
};

export function filterPublicationHosts(hosts: Host[], sportId: string) {
  return hosts.filter((host) => !sportId || host.sportId === sportId);
}

export function filterPublicationCompetitions(competitions: Competition[], sportId: string, hostId: string) {
  return competitions.filter((competition) =>
    (!sportId || competition.sportId === sportId) && (!hostId || competition.hostId === hostId)
  );
}

export function isPublicationFixtureValid(
  fixture: any,
  context: { sportId: string; hostId: string; competitionId: string; competitionTeams: Team[] }
) {
  return fixture.sport?.id === context.sportId &&
    (!context.hostId || fixture.homeTeam?.hostId === context.hostId || fixture.awayTeam?.hostId === context.hostId) &&
    fixture.competitionId === context.competitionId &&
    context.competitionTeams.some((team) => team.id === fixture.homeTeamId) &&
    context.competitionTeams.some((team) => team.id === fixture.awayTeamId);
}

function getNextAction({
  assignment,
  previewConfirmed,
  selectedChannel,
  matchDetailsComplete
}: {
  assignment: DesktopPublicationContext | undefined;
  previewConfirmed: boolean;
  selectedChannel: Channel | undefined;
  matchDetailsComplete: boolean;
}) {
  if (!selectedChannel) {
    return {
      label: "Select source",
      detail: "Choose an IPTV channel from the source list."
    };
  }

  if (!previewConfirmed) {
    return {
      label: "Preview source",
      detail: "Confirm playback before creating a publication draft."
    };
  }

  if (!assignment) {
    if (!matchDetailsComplete) {
      return {
        label: "Complete match context",
        detail: "Fill sport, competition, and teams before binding the source."
      };
    }

    return {
      label: "Create publication draft",
      detail: "Add match metadata and bind the previewed source."
    };
  }

  if (assignment.publication.publicationStatus === "draft") {
    return {
      label: "Approve publication",
      detail: "Operator approval is required before the publication can be published."
    };
  }

  if (assignment.publication.publicationStatus === "approved") {
    return {
      label: "Publish live feed",
      detail: "This publication is ready to go live."
    };
  }

  if (assignment.publication.publicationStatus === "published") {
    return {
      label: "Published",
      detail: "The live publication is now available in the feed."
    };
  }

  return {
    label: "Check state",
    detail: "The backend lifecycle is blocking the next action."
  };
}

function getUnifiedStatus(input: {
  assignment: DesktopPublicationContext | undefined;
  backendOffline: boolean;
  providerRisk: boolean;
  selectedChannel: Channel | undefined;
}) {
  const { assignment, backendOffline, providerRisk, selectedChannel } = input;

  if (backendOffline) {
    return { label: "AT RISK", tone: "risk", detail: "Backend unavailable. Work is read-only." };
  }

  if (assignment?.publication.availability === "offline") {
    return { label: "FAILED", tone: "failed", detail: "Publication source failed. Remove it from active delivery." };
  }

  if (assignment?.publication.publicationStatus === "published") {
    if (assignment.publication.availability === "degraded" || providerRisk) {
      return { label: "LIVE - Degraded", tone: "risk", detail: "Published feed needs attention." };
    }

    return { label: "LIVE - Stable", tone: "live", detail: "Published feed is healthy." };
  }

  if (providerRisk || assignment?.publication.availability === "degraded") {
    return { label: "AT RISK", tone: "risk", detail: "Check provider or preview stability before publishing." };
  }

  if (assignment?.publication.publicationStatus === "approved") {
    return { label: "READY", tone: "ready", detail: "Approved and ready to publish." };
  }

  if (assignment) {
    return { label: "READY", tone: "ready", detail: "Selected source is waiting for publication approval." };
  }

  if (selectedChannel) {
    return { label: "READY", tone: "ready", detail: "Source selected. Preview before creating a publication draft." };
  }

  return { label: "IDLE", tone: "idle", detail: "Select a source to begin." };
}

function getOperatorMessage(input: {
  assignment: DesktopPublicationContext | undefined;
  backendOffline: boolean;
  providerRisk: boolean;
  selectedProvider: IPTVProvider | undefined;
  streamFailed: boolean;
}) {
  if (input.backendOffline) {
    return "Connection lost. Keep monitoring; publishing will unlock when the backend returns.";
  }

  if (input.streamFailed) {
    return "Publication source failed. It has been removed from active delivery.";
  }

  if (input.providerRisk) {
    return `${input.selectedProvider?.name ?? "Provider"} is unstable. Watch the preview before publishing.`;
  }

  if (input.assignment?.publication.availability === "degraded") {
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
    cataloguePreviewMetadata,
  onCataloguePreviewMetadataChange,
  showLegacyChannelBrowser = true
}: BroadcastConsoleScreenProps) {
  const [selectedSportId, setSelectedSportId] = useState<string>("");
  const [selectedHostId, setSelectedHostId] = useState<string>("");
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
  const [hosts, setHosts] = useState<Host[]>([]);
  const [competitionTeams, setCompetitionTeams] = useState<Team[]>([]);
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
  const sameTeamSelected = Boolean(selectedHomeTeamId && selectedHomeTeamId === selectedAwayTeamId);
  const canAssign = Boolean(selectedChannel && previewConfirmed && !assignment && matchDetailsComplete && selectedHostId && !sameTeamSelected);
  const canApprove = Boolean(assignment && assignment.publication.publicationStatus === "draft");
  const canPublish = Boolean(assignment && assignment.publication.publicationStatus === "approved");

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

    if (!selectedProviderId) {
      return;
    }

    const selectedProvider = visibleProviders.find((provider) => provider.id === selectedProviderId);
    if (selectedProvider?.status !== "active") {
      setSelectedProviderId("");
    }
  }, [selectedProviderId, visibleProviders]);

  useEffect(() => {
    setSelectedGroup("");
    setChannelSearchQuery("");
  }, [selectedProviderId, selectedContentType]);

  useEffect(() => {
    let cancelled = false;
    const reset = () => {
      if (!cancelled) {
        onCataloguePreviewMetadataChange?.({ ...(selectedChannel?.name ? { title: selectedChannel.name } : {}), guide: [] });
      }
    };
    if (!selectedChannel || selectedChannel.contentType !== "live") {
      reset();
      return () => { cancelled = true; };
    }

    const storage = window.gito?.desktopStorage;
    if (!storage?.epgChannels?.list || !storage.epgProgrammes?.list) {
      reset();
      return () => { cancelled = true; };
    }

    void storage.epgChannels.list(selectedChannel.providerId).then(async (epgChannels) => {
      const epgChannel = epgChannels.find((item) =>
        item.channelId === selectedChannel.id ||
        item.externalReference === selectedChannel.externalRef ||
        item.name === selectedChannel.name
      );
      if (!epgChannel) {
        reset();
        return;
      }
      const programmes = await storage.epgProgrammes.list(selectedChannel.providerId, epgChannel.id);
      if (cancelled) return;
      const now = Date.now();
      const guide = programmes
        .filter((programme) => programme.status === "active" && Date.parse(programme.endAt) > now)
        .slice(0, 8)
        .map((programme) => ({
          title: programme.title,
          description: programme.description,
          startAt: programme.startAt,
          endAt: programme.endAt,
          externalProgrammeId: programme.externalReference ?? programme.id
        }));
      const currentProgramme = guide.find((programme) => Date.parse(programme.startAt ?? "") <= now) ?? null;
      onCataloguePreviewMetadataChange?.({ title: selectedChannel.name, currentProgramme, guide });
    }).catch(() => reset());

    return () => { cancelled = true; };
  }, [onCataloguePreviewMetadataChange, selectedChannel]);

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
  const providerDiagnostics = useMemo<ProviderChannelDiagnostics | null>(() => {
    if (!selectedProvider) return null;

    const providerChannels = channels.filter((channel) => channel.providerId === selectedProvider.id);
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
      providerId: selectedProvider.id,
      status: selectedProvider.status,
      availabilityStatus: selectedProvider.availabilityStatus ?? "unknown",
      healthScore: selectedProvider.healthScore ?? 0,
      ...(selectedProvider.lastSuccessfulStreamLoadAt ? { lastSuccessfulStreamLoadAt: selectedProvider.lastSuccessfulStreamLoadAt } : {}),
      totalChannels: providerChannels.length,
      contentTotals: {
        live: providerChannels.filter((channel) => channel.contentType === "live").length,
        movies: providerChannels.filter((channel) => channel.contentType === "movie").length,
        series: providerChannels.filter((channel) => channel.contentType === "series").length
      },
      counts
    };
  }, [channels, selectedProvider]);
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
    const fallback = getGuideMetadataCopy({
      channel: selectedChannel,
      provider: selectedProvider,
      contentType: selectedContentType,
      groupName: selectedGroup || selectedChannel?.groupName || "Live lineup",
      groupChannels: selectedGroupChannels,
      providerDiagnostics
    });
    return {
      ...fallback,
      ...(cataloguePreviewMetadata?.title ? { title: cataloguePreviewMetadata.title } : {}),
      ...(cataloguePreviewMetadata?.description !== undefined ? { description: cataloguePreviewMetadata.description || fallback.description } : {}),
      ...(cataloguePreviewMetadata?.guide.length ? {
        upcoming: cataloguePreviewMetadata.guide.map((programme) => `${programme.title}${programme.startAt ? ` · ${new Date(programme.startAt).toLocaleString()}` : ""}`)
      } : {})
    };
  }, [cataloguePreviewMetadata, providerDiagnostics, selectedChannel, selectedContentType, selectedProvider, selectedGroup, selectedGroupChannels]);

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
    if (!selectedCompetitionId) {
      setCanonicalFixtures([]);
      setCompetitionTeams([]);
      return;
    }
    void Promise.all([
      apiClient.listFixtures({ sportId: selectedSportId, competitionId: selectedCompetitionId, limit: 100 }),
      apiClient.listCompetitionTeams(selectedCompetitionId)
    ]).then(([fixtures, teamsForCompetition]) => {
      setCanonicalFixtures(fixtures);
      setCompetitionTeams(teamsForCompetition);
    }).catch(() => {
      setCanonicalFixtures([]);
      setCompetitionTeams([]);
    });
  }, [selectedCompetitionId, selectedSportId]);

  const validCanonicalFixtures = useMemo(
    () => canonicalFixtures.filter((fixture) =>
      isPublicationFixtureValid(fixture, { sportId: selectedSportId, hostId: selectedHostId, competitionId: selectedCompetitionId, competitionTeams })
    ),
    [canonicalFixtures, competitionTeams, selectedCompetitionId, selectedHostId, selectedSportId]
  );
  const selectedCanonicalFixture = useMemo(
    () => validCanonicalFixtures.find((fixture) => fixture.id === selectedCanonicalFixtureId),
    [selectedCanonicalFixtureId, validCanonicalFixtures]
  );

  useEffect(() => {
    if (!selectedCanonicalFixture) {
      if (selectedCanonicalFixtureId) setSelectedCanonicalFixtureId("");
      return;
    }
    setSelectedHomeTeamId(selectedCanonicalFixture.homeTeamId);
    setSelectedAwayTeamId(selectedCanonicalFixture.awayTeamId);
    setStartsAt(utcToOperatorKickoff(selectedCanonicalFixture.startsAt));
  }, [selectedCanonicalFixture, selectedCanonicalFixtureId]);

  const filteredCompetitions = useMemo(
    () => filterPublicationCompetitions(competitions, selectedSportId, selectedHostId),
    [competitions, selectedHostId, selectedSportId]
  );

  const filteredTeams = useMemo(
    () => selectedCompetitionId ? competitionTeams : [],
    [competitionTeams, selectedCompetitionId]
  );
  const filteredHosts = useMemo(() => filterPublicationHosts(hosts, selectedSportId), [hosts, selectedSportId]);
  const backendOffline = backendStatus !== "online";
  const providerRisk = selectedProvider?.availabilityStatus === "offline" || selectedProvider?.availabilityStatus === "degraded";
  const streamFailed = assignment?.publication.availability === "offline";
  const terminalAssignment = Boolean(assignment && !canApprove && !canPublish);

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
        const [sportsData, competitionsData, teamsData, hostsData] = await Promise.all([
          apiClient.listSports(),
          apiClient.listCompetitions(),
          apiClient.listTeams(),
          apiClient.listHosts()
        ]);

        if (!active) {
          return;
        }

        setSports(sportsData);
        setCompetitions(competitionsData);
        setTeams(teamsData);
        setHosts(hostsData);
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
    if (!selectedChannel) {
      setStatus("Select a source first.");
      return;
    }

    if (!previewConfirmed) {
      setStatus("Preview confirmation is required.");
      return;
    }

    if (!selectedSport || !selectedHostId || !selectedCompetition || !selectedHomeTeam || !selectedAwayTeam) {
      setStatus("Select sport, host, competition, home team, and away team before creating the publication draft.");
      return;
    }

    if (sameTeamSelected) {
      setStatus("Home and away teams must be different.");
      return;
    }

    if (!canAssign) {
      setStatus("Complete match details before creating the publication draft.");
      return;
    }

    setStatus("Creating publication draft...");
    try {
      await onAssignMatch({
        ...(selectedCanonicalFixtureId ? { canonicalFixtureId: selectedCanonicalFixtureId } : {}),
        competitionId: selectedCompetition.id,
        homeTeamId: selectedHomeTeam.id,
        awayTeamId: selectedAwayTeam.id,
        sportName: selectedSport?.name ?? "Unknown",
        competitionName: selectedCompetition.name,
        homeTeamName: selectedHomeTeam.name,
        awayTeamName: selectedAwayTeam.name,
        startsAt: localDateTimeToUtc(startsAt) ?? "",
        channelId: selectedChannel.id
      });
      setStatus("Publication draft created. Approval is now available.");
    } catch (error) {
      setStatus(error instanceof CanonicalFixtureRequiredError
        ? error.message
        : error instanceof Error ? error.message : "Publication draft failed.");
    }
  }, [sameTeamSelected, selectedChannel, canAssign, selectedCanonicalFixtureId, selectedCompetition, selectedHomeTeam, selectedAwayTeam, selectedSport, startsAt, onAssignMatch]);

  const handleApprove = useCallback(async (publicationId: string) => {
    setStatus("Approving publication...");
    try {
      await onApprove(publicationId);
      setStatus("Publication approved. It is now ready to publish.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Publication approval failed. State was restored from the last valid value.");
    }
  }, [onApprove]);

  const handlePublish = useCallback(async (publicationId: string) => {
    setStatus("Publishing live feed...");
    try {
      await onPublish(publicationId);
      setStatus("Live publication published to the feed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Publication publish failed. The publication remains in its last safe state.");
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
          <IptvHeroCards
            providerId={selectedProviderId}
            selectedContentType={selectedContentType}
            favoriteCount={favoriteChannelIds.length}
            onSelectContentType={setSelectedContentType}
          />

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
                    <article key={liveMatch.publication.publicationId} onClick={() => onOpenMatch?.(match?.id)} style={{ cursor: onOpenMatch ? "pointer" : "default" }}>
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
                  providerType={selectedProvider?.type}
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

                <div className="preview-meta-section">
                    <span className="preview-meta-label">Current programme</span>
                    <strong>{cataloguePreviewMetadata?.currentProgramme?.title ?? "No programme currently airing"}</strong>
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
                  <h3>Publication Control</h3>
                  <span>Bind the previewed source to a live match publication</span>
                </div>
                <span className="status-pill">{status}</span>
              </div>

              <div className="match-control-grid">
                <div className="match-control-column">
                  <label className="dropdown-label">
                    <span>Sport</span>
                    <select value={selectedSportId} onChange={(e) => {
                      setSelectedSportId(e.target.value);
                      setSelectedHostId("");
                      setSelectedCompetitionId("");
                      setSelectedHomeTeamId("");
                      setSelectedAwayTeamId("");
                      setSelectedCanonicalFixtureId("");
                    }}>
                      <option value="">-- Select sport --</option>
                      {sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}
                    </select>
                  </label>

                  <label className="dropdown-label">
                    <span>Host</span>
                    <select value={selectedHostId} onChange={(e) => {
                      setSelectedHostId(e.target.value);
                      setSelectedCompetitionId("");
                      setSelectedHomeTeamId("");
                      setSelectedAwayTeamId("");
                      setSelectedCanonicalFixtureId("");
                    }} disabled={!selectedSportId}>
                      <option value="">-- Select host --</option>
                      {filteredHosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
                    </select>
                  </label>

                  <label className="dropdown-label">
                    <span>Competition</span>
                    <select value={selectedCompetitionId} onChange={(e) => {
                      setSelectedCompetitionId(e.target.value);
                      setSelectedHomeTeamId("");
                      setSelectedAwayTeamId("");
                      setSelectedCanonicalFixtureId("");
                    }} disabled={!selectedHostId}>
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
                      {validCanonicalFixtures.map((fixture) => (
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
                    <select value={selectedHomeTeamId} onChange={(e) => setSelectedHomeTeamId(e.target.value)} disabled={!selectedCompetitionId}>
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
                    <select value={selectedAwayTeamId} onChange={(e) => setSelectedAwayTeamId(e.target.value)} disabled={!selectedCompetitionId}>
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
                {!selectedChannel && "Blocked: select an IPTV channel source."}
                {selectedChannel && !previewConfirmed && "Blocked: preview must be confirmed before creating the publication draft."}
                {!selectedHostId && "Select a host."}
                {!selectedCompetition && "Select a competition."}
                {!selectedSportId && "Select a sport."}
                {!selectedHomeTeam && "Select a home team."}
                {!selectedAwayTeam && "Select an away team."}
                {sameTeamSelected && "Home and away teams must be different."}
                {selectedChannel && previewConfirmed && !matchDetailsComplete && "Complete match details before creating the publication draft."}
                {backendOffline && "Waiting for backend reconnection."}
                {assignment?.publication.availability === "degraded" && "Signal unstable. Keep previewing before publishing."}
                {assignment?.publication.availability === "offline" && "Publication source failed. Choose another source."}
                {!backendOffline && assignment && !canApprove && !canPublish && `Current publication state: ${assignment.publication.publicationStatus} / ${assignment.publication.availability}.`}
              </div>

              <div className="action-stack">
                <button type="button" disabled={!canAssign || backendOffline || streamFailed} onClick={handleAssign}>
                  Create Publication Draft
                </button>
                <button
                  type="button"
                  disabled={!assignment || !canApprove || backendOffline || streamFailed}
                  onClick={() => assignment && void handleApprove(assignment.publication.publicationId)}
                >
                  Approve Publication
                </button>
                <button
                  className="publish-button"
                  type="button"
                  disabled={!assignment || !canPublish || backendOffline || streamFailed}
                  onClick={() => assignment && void handlePublish(assignment.publication.publicationId)}
                >
                  Publish Live Feed
                </button>
              </div>
            </section>

            <section className="match-control-panel console-panel">
              <div className="panel-heading panel-heading-accent">
                <div>
                  <h3>Active Work Item</h3>
                  <span>Current publication summary</span>
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
