import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StreamPreviewPanel } from "../preview/StreamPreviewPanel";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";
import { localDateTimeToUtc, utcToOperatorKickoff } from "../clubs/fixture-time";
const FALLBACK_LOGO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="%23081018"/></svg>';
function getNextAction({ assignment, previewConfirmed, selectedChannel, matchDetailsComplete }) {
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
function getUnifiedStatus(input) {
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
function getOperatorMessage(input) {
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
function matchesContentType(channel, contentType) {
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
function getGuideMetadataCopy({ channel, provider, contentType, groupName, groupChannels, providerDiagnostics }) {
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
export const BroadcastConsoleScreen = memo(function BroadcastConsoleScreen({ assignment, backendStatus, channels, liveMatches, liveMode, previewedChannelId, providers, selectedChannel, preferredProviderId, onApprove, onAssignMatch, onPreviewReady, onPublish, onReportHealth, onSelectChannel, onClearAssignment, onSetLiveMode, onOpenMatch, onCatalogueContextChange, catalogueBrowser, cataloguePreviewMetadata, showLegacyChannelBrowser = true }) {
    const [selectedSportId, setSelectedSportId] = useState("");
    const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
    const [selectedHomeTeamId, setSelectedHomeTeamId] = useState("");
    const [selectedAwayTeamId, setSelectedAwayTeamId] = useState("");
    const [canonicalFixtures, setCanonicalFixtures] = useState([]);
    const [selectedCanonicalFixtureId, setSelectedCanonicalFixtureId] = useState("");
    const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
    const [status, setStatus] = useState("Console ready");
    const [sports, setSports] = useState([]);
    const [competitions, setCompetitions] = useState([]);
    const [teams, setTeams] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState("");
    const [groupSearchQuery, setGroupSearchQuery] = useState("");
    const [selectedContentType, setSelectedContentType] = useState("live");
    const [favoriteChannelIds, setFavoriteChannelIds] = useState(() => {
        if (typeof window === "undefined") {
            return [];
        }
        try {
            const raw = window.localStorage.getItem("gito-broadcast-favorite-channels");
            return raw ? JSON.parse(raw) : [];
        }
        catch {
            return [];
        }
    });
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [channelSearchQuery, setChannelSearchQuery] = useState("");
    const manualProviderSelectionRef = useRef(false);
    const [providerDiagnostics, setProviderDiagnostics] = useState(null);
    const [providerDiagnosticsError, setProviderDiagnosticsError] = useState(null);
    const [systemStatus, setSystemStatus] = useState(null);
    const [systemStatusError, setSystemStatusError] = useState(null);
    const previewConfirmed = Boolean(selectedChannel) && previewedChannelId === selectedChannel?.id;
    const visibleProviders = useMemo(() => providers.filter((provider) => provider.status === "active"), [providers]);
    useEffect(() => {
        if (selectedProviderId) {
            onCatalogueContextChange?.({ providerId: selectedProviderId, contentType: selectedContentType, favoriteChannelIds });
        }
    }, [favoriteChannelIds, onCatalogueContextChange, selectedContentType, selectedProviderId]);
    const favoriteChannelIdSet = useMemo(() => new Set(favoriteChannelIds), [favoriteChannelIds]);
    const visibleProviderIds = useMemo(() => new Set(visibleProviders.map((provider) => provider.id)), [visibleProviders]);
    const selectedCompetition = useMemo(() => competitions.find((item) => item.id === selectedCompetitionId), [competitions, selectedCompetitionId]);
    const selectedSport = useMemo(() => sports.find((item) => item.id === selectedSportId), [sports, selectedSportId]);
    const selectedHomeTeam = useMemo(() => teams.find((team) => team.id === selectedHomeTeamId), [teams, selectedHomeTeamId]);
    const selectedAwayTeam = useMemo(() => teams.find((team) => team.id === selectedAwayTeamId), [teams, selectedAwayTeamId]);
    const matchDetailsComplete = Boolean(selectedCompetition && selectedHomeTeam && selectedAwayTeam && selectedSportId);
    const canAssign = Boolean(selectedChannel && previewConfirmed && !assignment && matchDetailsComplete);
    const canApprove = Boolean(assignment && assignment.publication.publicationStatus === "draft");
    const canPublish = Boolean(assignment && assignment.publication.publicationStatus === "approved");
    const nextAction = useMemo(() => getNextAction({ assignment, previewConfirmed, selectedChannel, matchDetailsComplete }), [assignment, previewConfirmed, selectedChannel, matchDetailsComplete]);
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
        if (typeof window === "undefined") {
            return;
        }
        window.localStorage.setItem("gito-broadcast-favorite-channels", JSON.stringify(favoriteChannelIds));
    }, [favoriteChannelIds]);
    const toggleFavoriteChannel = useCallback((channelId) => {
        setFavoriteChannelIds((current) => {
            if (current.includes(channelId)) {
                return current.filter((id) => id !== channelId);
            }
            return [...current, channelId];
        });
    }, []);
    const selectedProvider = useMemo(() => visibleProviders.find((provider) => provider.id === selectedProviderId), [visibleProviders, selectedProviderId]);
    const activeProviderChannels = useMemo(() => {
        const visibleChannels = channels.filter((channel) => visibleProviderIds.has(channel.providerId));
        const providerChannels = selectedProvider
            ? visibleChannels.filter((channel) => channel.providerId === selectedProvider.id)
            : visibleChannels;
        if (selectedContentType === "favorites") {
            return providerChannels.filter((channel) => favoriteChannelIdSet.has(channel.id));
        }
        return providerChannels.filter((channel) => matchesContentType(channel, selectedContentType));
    }, [channels, favoriteChannelIdSet, selectedContentType, selectedProvider, visibleProviderIds]);
    const channelGroups = useMemo(() => {
        if (selectedContentType === "favorites") {
            return activeProviderChannels.length ? ["Favorites"] : [];
        }
        return [...new Set(activeProviderChannels.map((channel) => channel.groupName ?? "Ungrouped"))];
    }, [activeProviderChannels, selectedContentType]);
    const filteredChannelGroups = useMemo(() => groupSearchQuery.trim() === ""
        ? channelGroups
        : channelGroups.filter((group) => group.toLowerCase().includes(groupSearchQuery.toLowerCase())), [channelGroups, groupSearchQuery]);
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
    const selectedGroupChannels = useMemo(() => {
        if (selectedContentType === "favorites") {
            return activeProviderChannels;
        }
        return activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === selectedGroup);
    }, [activeProviderChannels, selectedContentType, selectedGroup]);
    const filteredSelectedGroupChannels = useMemo(() => channelSearchQuery.trim() === ""
        ? selectedGroupChannels
        : selectedGroupChannels.filter((channel) => channel.name.toLowerCase().includes(channelSearchQuery.toLowerCase())), [selectedGroupChannels, channelSearchQuery]);
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
    const selectedCanonicalFixture = useMemo(() => canonicalFixtures.find((fixture) => fixture.id === selectedCanonicalFixtureId), [canonicalFixtures, selectedCanonicalFixtureId]);
    useEffect(() => {
        if (!selectedCanonicalFixture)
            return;
        setSelectedHomeTeamId(selectedCanonicalFixture.homeTeamId);
        setSelectedAwayTeamId(selectedCanonicalFixture.awayTeamId);
        setStartsAt(utcToOperatorKickoff(selectedCanonicalFixture.startsAt));
    }, [selectedCanonicalFixture]);
    const filteredCompetitions = useMemo(() => (selectedSportId ? competitions.filter((competition) => competition.sportId === selectedSportId) : competitions), [competitions, selectedSportId]);
    const filteredTeams = useMemo(() => teams.filter((team) => {
        const matchesSport = selectedSportId ? team.sportId === selectedSportId : true;
        const matchesCompetitionCountry = selectedCompetition?.countryId ? team.countryId === selectedCompetition.countryId : true;
        return matchesSport && matchesCompetitionCountry;
    }), [teams, selectedSportId, selectedCompetition?.countryId]);
    const backendOffline = backendStatus !== "online";
    const providerRisk = selectedProvider?.availabilityStatus === "offline" || selectedProvider?.availabilityStatus === "degraded";
    const streamFailed = assignment?.publication.availability === "offline";
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
            }
            catch (error) {
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
        window.__GITO_CONTROL_DIAGNOSTIC__ = diagnostics;
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
    const unifiedStatus = useMemo(() => getUnifiedStatus({ assignment, backendOffline, providerRisk, selectedChannel }), [assignment, backendOffline, providerRisk, selectedChannel]);
    const operatorMessage = useMemo(() => getOperatorMessage({
        assignment,
        backendOffline,
        providerRisk,
        selectedProvider,
        streamFailed
    }), [assignment, backendOffline, providerRisk, selectedProvider, streamFailed]);
    const actionableAlerts = useMemo(() => [
        ...(backendOffline ? ["Backend offline"] : []),
        ...(streamFailed ? ["Stream failed"] : []),
        ...(providerRisk ? ["Provider unstable"] : []),
        ...(canApprove ? ["Approval required"] : []),
        ...(canPublish ? ["Ready to publish"] : [])
    ], [backendOffline, canApprove, canPublish, providerRisk, streamFailed]);
    const dashboardMetrics = useMemo(() => [
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
    ], [liveMatches.length, actionableAlerts, selectedChannel, backendStatus, systemStatus, systemStatusError]);
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
            }
            catch {
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
            }
            catch (error) {
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
            setStatus(!selectedChannel ? "Select a source first." : "Preview confirmation is required.");
            return;
        }
        if (!selectedCompetition || !selectedHomeTeam || !selectedAwayTeam || !selectedSport) {
            setStatus("Select sport, competition, home team, and away team before creating the publication draft.");
            return;
        }
        setStatus("Creating publication draft...");
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
            setStatus("Publication draft created. Approval is now available.");
        }
        catch {
            setStatus("Publication draft was not confirmed. Check backend connection and try again.");
        }
    }, [selectedChannel, canAssign, selectedCanonicalFixtureId, selectedCompetition, selectedHomeTeam, selectedAwayTeam, selectedSport, startsAt, onAssignMatch]);
    const handleApprove = useCallback(async (publicationId) => {
        setStatus("Approving publication...");
        try {
            await onApprove(publicationId);
            setStatus("Publication approved. It is now ready to publish.");
        }
        catch {
            setStatus("Approval was not confirmed. State was restored from the last valid value.");
        }
    }, [onApprove]);
    const handlePublish = useCallback(async (publicationId) => {
        setStatus("Publishing live feed...");
        try {
            await onPublish(publicationId);
            setStatus("Live publication published to the feed.");
        }
        catch {
            setStatus("Publishing was not confirmed. The publication remains in its last safe state.");
        }
    }, [onPublish]);
    return (_jsxs("section", { className: "control-room", children: [_jsxs("header", { className: "control-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Broadcast Control" }), _jsx("h2", { children: liveMode ? "LIVE MODE" : "Live Operations Console" })] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("button", { className: "live-mode-toggle", type: "button", onClick: () => onSetLiveMode(!liveMode), children: liveMode ? "Exit Live Mode" : "LIVE MODE" }), _jsx("button", { type: "button", onClick: async () => {
                                    setStatus('Creating backup...');
                                    try {
                                        const resp = await apiClient.createBackup();
                                        setStatus(`Backup created: ${resp.backup.filename}`);
                                    }
                                    catch (err) {
                                        setStatus(`Backup failed: ${err?.message ?? String(err)}`);
                                    }
                                }, children: "Create Backup" }), _jsx("button", { type: "button", onClick: async () => {
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
                                    }
                                    catch (err) {
                                        setStatus(`Restore failed: ${err?.message ?? String(err)}`);
                                    }
                                }, children: "Restore Latest" })] }), _jsxs("div", { className: "next-action", children: [_jsx("span", { children: "Next action" }), _jsx("strong", { children: nextAction.label }), _jsx("small", { children: nextAction.detail })] })] }), _jsxs("div", { className: liveMode ? "unified-status live-mode-status" : "unified-status", children: [_jsx("strong", { className: `unified-status-badge ${unifiedStatus.tone}`, children: unifiedStatus.label }), _jsx("span", { children: operatorMessage })] }), !liveMode ? (_jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsx("div", { className: "priority-strip simplified-priority-strip content-type-strip", children: [
                            { key: "live", label: "Live TV", icon: "📺" },
                            { key: "movies", label: "Movies", icon: "🎬" },
                            { key: "series", label: "Series", icon: "📺" },
                            { key: "favorites", label: "Favorites", icon: "⭐" }
                        ].map((option) => {
                            const selected = selectedContentType === option.key;
                            return (_jsxs("button", { type: "button", className: `priority-card ${selected ? "live" : ""}`, onClick: () => setSelectedContentType(option.key), style: {
                                    textAlign: "left",
                                    cursor: "pointer",
                                    border: selected ? "1px solid #4ad7ff" : "1px solid #243649",
                                    background: selected ? "rgba(74, 215, 255, 0.12)" : "rgba(8, 16, 24, 0.85)",
                                    boxShadow: selected && option.key === "favorites" ? "0 0 0 1px rgba(74, 215, 255, 0.2) inset" : undefined
                                }, children: [_jsx("span", { style: { fontSize: "1.1rem" }, children: option.icon }), _jsx("strong", { children: option.label }), _jsx("span", { style: { color: "#8fa1b3", fontSize: "0.8rem" }, children: option.key === "favorites"
                                            ? `${favoriteChannelIds.length} saved`
                                            : option.key === "live"
                                                ? `${providerDiagnostics?.contentTotals.live ?? 0} channels`
                                                : option.key === "movies"
                                                    ? `${providerDiagnostics?.contentTotals.movies ?? 0} movies`
                                                    : `${providerDiagnostics?.contentTotals.series ?? 0} series` })] }, option.key));
                        }) }), _jsx("div", { className: "console-panel", style: { padding: 12 }, children: _jsxs("label", { style: { display: "grid", gap: 6, color: "#8fa1b3" }, children: [_jsx("span", { children: "Active IPTV provider" }), _jsx("select", { value: selectedProviderId, onChange: (event) => {
                                        manualProviderSelectionRef.current = true;
                                        setSelectedProviderId(event.target.value);
                                        setSelectedGroup("");
                                        setChannelSearchQuery("");
                                    }, style: { padding: "8px 10px", borderRadius: 8, border: "1px solid #253647", background: "#0a1119", color: "#e7edf4" }, children: visibleProviders.map((provider) => (_jsxs("option", { value: provider.id, children: [provider.name, " (", provider.status, ")"] }, provider.id))) })] }) })] })) : null, liveMode ? (_jsxs("section", { className: "live-mode-board", children: [_jsxs("div", { className: "live-mode-main", children: [_jsx("h3", { children: "Live Matches" }), _jsxs("div", { className: "live-match-list", children: [liveMatches.map((liveMatch) => {
                                        const match = liveMatch.match;
                                        const competition = competitions.find((c) => c.id === match.competitionId);
                                        const homeTeam = teams.find((t) => t.id === match.homeTeamId);
                                        const awayTeam = teams.find((t) => t.id === match.awayTeamId);
                                        const sport = competition ? sports.find((s) => s.id === competition.sportId) : undefined;
                                        return (_jsxs("article", { onClick: () => onOpenMatch?.(match?.id), style: { cursor: onOpenMatch ? "pointer" : "default" }, children: [_jsxs("div", { className: "live-match-main", children: [_jsxs("div", { className: "live-match-teams", children: [homeTeam?.logoUrl ? _jsx("img", { src: resolveAssetUrl(homeTeam.logoUrl), alt: homeTeam.name, className: "match-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "match-logo" }), _jsx("strong", { children: homeTeam?.name ?? match.homeTeamId }), _jsx("span", { className: "vs", children: "vs" }), awayTeam?.logoUrl ? _jsx("img", { src: resolveAssetUrl(awayTeam.logoUrl), alt: awayTeam.name, className: "match-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "match-logo" }), _jsx("strong", { children: awayTeam?.name ?? match.awayTeamId })] }), _jsxs("div", { className: "live-match-meta", children: [competition?.logoUrl ? _jsx("img", { src: resolveAssetUrl(competition.logoUrl), alt: competition.name, className: "competition-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "competition-logo" }), _jsx("div", { className: "competition-name", children: competition?.name }), sport?.logoUrl ? _jsx("img", { src: resolveAssetUrl(sport.logoUrl), alt: sport.name, className: "competition-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : null] })] }), _jsx("span", { className: "unified-status-badge live", children: "LIVE - Stable" })] }, liveMatch.publication.publicationId));
                                    }), liveMatches.length === 0 ? _jsx("div", { className: "empty-row", children: "No live matches are currently published." }) : null] })] }), _jsxs("aside", { className: "live-mode-alerts", children: [_jsx("h3", { children: "Actionable Alerts" }), actionableAlerts.length > 0 ? (actionableAlerts.map((alert) => _jsx("span", { children: alert }, alert))) : (_jsx("span", { children: "No action required" }))] })] })) : null, !liveMode ? _jsx("div", { className: "broadcast-grid", children: _jsxs("section", { className: "preview-core", children: [_jsxs("div", { className: "provider-switch-surface", children: [_jsxs("div", { className: "preview-top-layout", children: [_jsx("div", { className: "preview-player-card", children: _jsx(StreamPreviewPanel, { channel: selectedChannel, providerType: selectedProvider?.type, onHealthChange: onReportHealth, onPreviewReady: onPreviewReady, compact: true }) }), _jsxs("aside", { className: "preview-meta-panel console-panel", children: [_jsxs("div", { className: "panel-heading panel-heading-accent", children: [_jsxs("div", { children: [_jsx("h3", { children: "Channel Guide" }), _jsx("span", { children: "Upcoming program metadata" })] }), _jsx("span", { className: "status-pill", children: selectedProvider?.name ?? "Provider feed" })] }), _jsxs("div", { className: "preview-meta-card", children: [_jsx("div", { className: "preview-meta-title", children: previewChannelMetadata.title }), _jsx("p", { children: previewChannelMetadata.description }), providerDiagnosticsError ? (_jsxs("div", { className: "preview-meta-section", children: [_jsx("span", { className: "preview-meta-label", children: "Diagnostics" }), _jsx("ul", { children: _jsx("li", { children: providerDiagnosticsError }) })] })) : null, _jsxs("div", { className: "preview-meta-section", children: [_jsx("span", { className: "preview-meta-label", children: "Upcoming" }), _jsx("ul", { children: previewChannelMetadata.upcoming.map((item) => (_jsx("li", { children: item }, item))) })] }), _jsxs("div", { className: "preview-meta-footer", children: [_jsx("span", { children: selectedChannel?.groupName ?? "Channel group" }), _jsx("span", { children: selectedChannel?.name ?? "No channel selected" })] })] })] })] }), showLegacyChannelBrowser ? _jsxs("div", { className: "channel-group-layout", children: [_jsxs("aside", { className: "group-column console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h4", { children: "Channel Groups" }), _jsx("span", { children: selectedContentType === "favorites" ? "Pinned favorites" : selectedProvider?.name ?? "Active provider" })] }), _jsx("input", { type: "text", placeholder: "Search groups...", value: groupSearchQuery, onChange: (e) => setGroupSearchQuery(e.target.value), style: {
                                                        width: "100%",
                                                        padding: "8px 10px",
                                                        marginBottom: "8px",
                                                        border: "1px solid #253647",
                                                        borderRadius: "6px",
                                                        background: "#0a1119",
                                                        color: "#e7edf4",
                                                        fontSize: "0.9rem",
                                                        boxSizing: "border-box"
                                                    } }), _jsxs("div", { className: "compact-channel-list group-list", children: [filteredChannelGroups.map((groupName) => (_jsxs("button", { className: groupName === selectedGroup ? "selected" : "", type: "button", onClick: () => setSelectedGroup(groupName), children: [_jsx("strong", { children: groupName }), _jsx("span", { children: selectedContentType === "favorites" ? `${activeProviderChannels.length} favorites` : `${activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === groupName).length} channels` })] }, groupName))), filteredChannelGroups.length === 0 ? _jsx("div", { className: "empty-row", children: groupSearchQuery.trim() !== "" ? "No matching groups found." : selectedContentType === "favorites" ? "No favorite channels saved yet." : "No groups available for this provider." }) : null] })] }), _jsxs("aside", { className: "channel-column console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h4", { children: "Channels" }), _jsx("span", { children: selectedContentType === "favorites" ? `${favoriteChannelIds.length} saved` : selectedGroup || "Group not selected" })] }), _jsx("input", { type: "text", placeholder: "Search channels...", value: channelSearchQuery, onChange: (e) => setChannelSearchQuery(e.target.value), style: {
                                                        width: "100%",
                                                        padding: "8px 10px",
                                                        marginBottom: "8px",
                                                        border: "1px solid #253647",
                                                        borderRadius: "6px",
                                                        background: "#0a1119",
                                                        color: "#e7edf4",
                                                        fontSize: "0.9rem",
                                                        boxSizing: "border-box"
                                                    } }), selectedContentType === "favorites" ? (_jsxs("div", { style: { marginBottom: 8, padding: "10px 11px", borderRadius: 8, border: "1px solid rgba(74, 215, 255, 0.2)", background: "rgba(74, 215, 255, 0.1)", color: "#9bdcff" }, children: [_jsx("div", { style: { fontWeight: 600 }, children: "Favorites queue" }), _jsx("div", { style: { fontSize: "0.85rem", color: "#8fa1b3", marginTop: 2 }, children: "Your pinned channels are collected here for fast, premium browsing." })] })) : null, _jsxs("div", { className: "compact-channel-list", children: [filteredSelectedGroupChannels.map((channel) => {
                                                            const isFavorite = favoriteChannelIdSet.has(channel.id);
                                                            return (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, width: "100%" }, children: [_jsxs("button", { className: channel.id === selectedChannel?.id ? "selected" : "", type: "button", onClick: () => {
                                                                            manualProviderSelectionRef.current = true;
                                                                            setSelectedProviderId(channel.providerId);
                                                                            onSelectChannel(channel);
                                                                        }, style: { flex: 1, textAlign: "left" }, children: [_jsx("strong", { children: channel.name }), _jsx("span", { children: channel.groupName ?? "Uncategorized" })] }), _jsx("button", { type: "button", onClick: (event) => {
                                                                            event.stopPropagation();
                                                                            toggleFavoriteChannel(channel.id);
                                                                        }, style: { border: "1px solid #253647", borderRadius: 999, background: isFavorite ? "rgba(74, 215, 255, 0.18)" : "transparent", color: isFavorite ? "#4ad7ff" : "#8fa1b3", width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer" }, "aria-label": isFavorite ? "Remove favorite" : "Add favorite", children: isFavorite ? "★" : "☆" })] }, channel.id));
                                                        }), filteredSelectedGroupChannels.length === 0 ? _jsx("div", { className: "empty-row", children: channelSearchQuery.trim() !== "" ? "No matching channels found." : selectedContentType === "favorites" ? "No favorite channels saved yet." : "No channels in this group." }) : null] })] })] }) : null] }, `provider-${selectedProviderId || "none"}`), catalogueBrowser, _jsxs("div", { className: "match-control-layout", children: [_jsxs("section", { className: "match-control-panel console-panel", children: [_jsxs("div", { className: "panel-heading panel-heading-accent", children: [_jsxs("div", { children: [_jsx("h3", { children: "Publication Control" }), _jsx("span", { children: "Bind the previewed source to a live match publication" })] }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "match-control-grid", children: [_jsxs("div", { className: "match-control-column", children: [_jsxs("label", { className: "dropdown-label", children: [_jsx("span", { children: "Competition" }), _jsxs("select", { value: selectedCompetitionId, onChange: (e) => setSelectedCompetitionId(e.target.value), children: [_jsx("option", { value: "", children: "-- Select competition --" }), filteredCompetitions.map((competition) => (_jsx("option", { value: competition.id, children: competition.name }, competition.id)))] }), selectedSport ? (_jsxs("small", { children: [filteredCompetitions.length, " competition", filteredCompetitions.length === 1 ? "" : "s", " for ", selectedSport.name] })) : null] }), _jsxs("label", { className: "dropdown-label", children: [_jsx("span", { children: "Canonical Season Fixture (optional)" }), _jsxs("select", { value: selectedCanonicalFixtureId, onChange: (e) => setSelectedCanonicalFixtureId(e.target.value), disabled: !selectedCompetitionId, children: [_jsx("option", { value: "", children: "No canonical fixture" }), canonicalFixtures.map((fixture) => (_jsxs("option", { value: fixture.id, children: [fixture.homeTeam?.name, " vs ", fixture.awayTeam?.name, " \u00B7 ", new Date(fixture.startsAt).toLocaleString(), " \u00B7 ", fixture.season?.name ?? "Season unavailable", " \u00B7 ", fixture.status] }, fixture.id)))] }), !selectedCompetitionId ? _jsx("small", { children: "Select a competition to load canonical fixtures." }) : null, selectedCanonicalFixtureId ? _jsx("button", { type: "button", className: "secondary", onClick: () => setSelectedCanonicalFixtureId(""), children: "Clear fixture" }) : null] }), _jsxs("label", { className: "dropdown-label", children: [_jsx("span", { children: "Home Team" }), _jsxs("select", { value: selectedHomeTeamId, onChange: (e) => setSelectedHomeTeamId(e.target.value), children: [_jsx("option", { value: "", children: "-- Select home team --" }), filteredTeams.map((team) => (_jsx("option", { value: team.id, children: team.name }, team.id)))] }), selectedSport ? (_jsxs("small", { children: [filteredTeams.length, " team", filteredTeams.length === 1 ? "" : "s", " for ", selectedSport.name] })) : null] })] }), _jsxs("div", { className: "match-control-column", children: [_jsxs("label", { className: "dropdown-label", children: [_jsx("span", { children: "Away Team" }), _jsxs("select", { value: selectedAwayTeamId, onChange: (e) => setSelectedAwayTeamId(e.target.value), children: [_jsx("option", { value: "", children: "-- Select away team --" }), filteredTeams.map((team) => (_jsx("option", { value: team.id, children: team.name }, team.id)))] }), selectedSport ? (_jsxs("small", { children: [filteredTeams.length, " team", filteredTeams.length === 1 ? "" : "s", " for ", selectedSport.name] })) : null] }), _jsxs("label", { className: "dropdown-label", children: [_jsx("span", { children: "Sport" }), _jsxs("select", { value: selectedSportId, onChange: (e) => setSelectedSportId(e.target.value), children: [_jsx("option", { value: "", children: "-- Select sport --" }), sports.map((sport) => (_jsx("option", { value: sport.id, children: sport.name }, sport.id)))] })] }), _jsxs("label", { className: "kickoff-label", children: [_jsx("span", { children: "Kickoff" }), _jsx("input", { type: "datetime-local", value: startsAt, onChange: (event) => setStartsAt(event.target.value) })] })] })] }), _jsxs("div", { className: "blocked-reason", children: [!selectedChannel && "Blocked: select an IPTV channel source.", selectedChannel && !previewConfirmed && "Blocked: preview must be confirmed before creating the publication draft.", !selectedCompetition && "Select a competition.", !selectedSportId && "Select a sport.", !selectedHomeTeam && "Select a home team.", !selectedAwayTeam && "Select an away team.", selectedChannel && previewConfirmed && !matchDetailsComplete && "Complete match details before creating the publication draft.", backendOffline && "Waiting for backend reconnection.", assignment?.publication.availability === "degraded" && "Signal unstable. Keep previewing before publishing.", assignment?.publication.availability === "offline" && "Publication source failed. Choose another source.", !backendOffline && assignment && !canApprove && !canPublish && `Current publication state: ${assignment.publication.publicationStatus} / ${assignment.publication.availability}.`] }), _jsxs("div", { className: "action-stack", children: [_jsx("button", { type: "button", disabled: !canAssign || backendOffline || streamFailed, onClick: handleAssign, children: "Create Publication Draft" }), _jsx("button", { type: "button", disabled: !assignment || !canApprove || backendOffline || streamFailed, onClick: () => assignment && void handleApprove(assignment.publication.publicationId), children: "Approve Publication" }), _jsx("button", { className: "publish-button", type: "button", disabled: !assignment || !canPublish || backendOffline || streamFailed, onClick: () => assignment && void handlePublish(assignment.publication.publicationId), children: "Publish Live Feed" })] })] }), _jsxs("section", { className: "match-control-panel console-panel", children: [_jsxs("div", { className: "panel-heading panel-heading-accent", children: [_jsxs("div", { children: [_jsx("h3", { children: "Active Work Item" }), _jsx("span", { children: "Current publication summary" })] }), _jsx("span", { className: "status-pill", children: unifiedStatus.label })] }), _jsxs("div", { className: "work-item-grid", children: [_jsxs("div", { className: "work-item-card", children: [_jsx("div", { className: "work-item-label", children: "Channel" }), _jsx("div", { className: "work-item-value", children: selectedChannel?.name ?? "None selected" })] }), _jsxs("div", { className: "work-item-card", children: [_jsx("div", { className: "work-item-label", children: "Sport" }), _jsxs("div", { className: "work-item-value entity-inline", children: [selectedSport?.logoUrl ? (_jsx("img", { className: "entity-logo", src: selectedSport.logoUrl, alt: selectedSport.name })) : null, _jsx("span", { children: selectedSport?.name ?? "None selected" })] })] }), _jsxs("div", { className: "work-item-card", children: [_jsx("div", { className: "work-item-label", children: "Competition" }), _jsxs("div", { className: "work-item-value entity-inline", children: [selectedCompetition?.logoUrl ? (_jsx("img", { className: "entity-logo", src: selectedCompetition.logoUrl, alt: selectedCompetition.name })) : null, _jsx("span", { children: selectedCompetition?.name ?? "None selected" })] })] }), _jsxs("div", { className: "work-item-card", children: [_jsx("div", { className: "work-item-label", children: "Status" }), _jsx("div", { className: "work-item-value", children: unifiedStatus.label })] }), _jsxs("div", { className: "work-item-card wide", children: [_jsx("div", { className: "work-item-label", children: "Teams" }), _jsxs("div", { className: "work-item-value team-inline", children: [_jsxs("div", { className: "team-pair", children: [selectedHomeTeam?.logoUrl ? (_jsx("img", { className: "entity-logo", src: selectedHomeTeam.logoUrl, alt: selectedHomeTeam.name })) : null, _jsx("span", { children: selectedHomeTeam?.name ?? "None selected" })] }), _jsx("strong", { className: "vs-label", children: "vs" }), _jsxs("div", { className: "team-pair", children: [selectedAwayTeam?.logoUrl ? (_jsx("img", { className: "entity-logo", src: selectedAwayTeam.logoUrl, alt: selectedAwayTeam.name })) : null, _jsx("span", { children: selectedAwayTeam?.name ?? "None selected" })] })] })] })] })] })] }), _jsxs("div", { className: "single-state-row", children: [_jsx("span", { className: `unified-status-badge ${unifiedStatus.tone}`, children: unifiedStatus.label }), _jsx("small", { children: unifiedStatus.detail })] })] }) }) : null] }));
});
