import { memo, useCallback, useEffect, useMemo, useState } from "react";

import type {
  Channel,
  Competition,
  MatchAssignmentRequest,
  MatchAssignmentResult,
  PublishedLiveMatch,
  IPTVProvider,
  Sport,
  Stream,
  Team
} from "@gito/shared";

import { StreamPreviewPanel } from "../preview/StreamPreviewPanel";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";

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
  onApprove: (streamId: string) => Promise<void>;
  onAssignMatch: (input: MatchAssignmentRequest) => Promise<MatchAssignmentResult>;
  onPreviewReady: (channelId: string) => void;
  onPublish: (streamId: string) => Promise<void>;
  onReportHealth: (status: Stream["healthStatus"], reason?: string) => void;
  onSelectChannel: (channel: Channel) => void;
  onClearAssignment: () => void;
  onSetLiveMode: (enabled: boolean) => void;
  onOpenMatch?: (matchId?: string) => void;
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

export const BroadcastConsoleScreen = memo(function BroadcastConsoleScreen({
  assignment,
  backendStatus,
  channels,
  liveMatches,
  liveMode,
  previewedChannelId,
  providers,
  selectedChannel,
  onApprove,
  onAssignMatch,
  onPreviewReady,
  onPublish,
  onReportHealth,
  onSelectChannel,
  onClearAssignment,
  onSetLiveMode
  , onOpenMatch
}: BroadcastConsoleScreenProps) {
  const [selectedSportId, setSelectedSportId] = useState<string>("");
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>("");
  const [selectedHomeTeamId, setSelectedHomeTeamId] = useState<string>("");
  const [selectedAwayTeamId, setSelectedAwayTeamId] = useState<string>("");
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
  const [status, setStatus] = useState("Console ready");
  const [sports, setSports] = useState<Sport[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [channelSearchQuery, setChannelSearchQuery] = useState("");

  const previewConfirmed = Boolean(selectedChannel) && previewedChannelId === selectedChannel?.id;
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
  const selectedProvider = useMemo(
    () =>
      selectedChannel
        ? providers.find((provider) => provider.id === selectedChannel.providerId)
        : undefined,
    [providers, selectedChannel]
  );
  const activeProviderChannels = useMemo(
    () =>
      selectedProvider
        ? channels.filter((channel) => channel.providerId === selectedProvider.id)
        : channels,
    [channels, selectedProvider]
  );
  const channelGroups = useMemo(
    () => [...new Set(activeProviderChannels.map((channel) => channel.groupName ?? "Ungrouped"))],
    [activeProviderChannels]
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
    if (!selectedGroup || !filteredChannelGroups.includes(selectedGroup)) {
      setSelectedGroup(filteredChannelGroups[0] ?? "");
    }
  }, [filteredChannelGroups, selectedGroup]);
  const selectedGroupChannels = useMemo(
    () =>
      activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === selectedGroup),
    [activeProviderChannels, selectedGroup]
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
        label: "Backend status",
        value: backendStatus === "online" ? "Online" : backendStatus === "reconnecting" ? "Reconnecting" : "Offline",
        detail: backendStatus === "online" ? "Operations active" : "Service unavailable"
      }
    ],
    [liveMatches.length, actionableAlerts, selectedChannel, backendStatus]
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
        sportName: selectedSport?.name ?? "Unknown",
        competitionName: selectedCompetition.name,
        homeTeamName: selectedHomeTeam.name,
        awayTeamName: selectedAwayTeam.name,
        startsAt: new Date(startsAt).toISOString(),
        channelId: selectedChannel.id
      });
      setStatus("Stream assigned. Approval is now available.");
    } catch {
      setStatus("Assignment was not confirmed. Check backend connection and try again.");
    }
  }, [selectedChannel, canAssign, selectedCompetition, selectedHomeTeam, selectedAwayTeam, selectedSport, startsAt, onAssignMatch]);

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
        <button className="live-mode-toggle" type="button" onClick={() => onSetLiveMode(!liveMode)}>
          {liveMode ? "Exit Live Mode" : "LIVE MODE"}
        </button>
        <div className="next-action">
          <span>Next action</span>
          <strong>{nextAction.label}</strong>
          <small>{nextAction.detail}</small>
        </div>
      </header>

      <div className="dashboard-summary-grid">
        {dashboardMetrics.map((metric) => (
          <article className="dashboard-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </div>

      <div className={liveMode ? "unified-status live-mode-status" : "unified-status"}>
        <strong className={`unified-status-badge ${unifiedStatus.tone}`}>{unifiedStatus.label}</strong>
        <span>{operatorMessage}</span>
      </div>

      {!liveMode ? (
        <div className="priority-strip simplified-priority-strip">
          <article className="priority-card live">
            <span>Live</span>
            <strong>{liveMatches.length}</strong>
          </article>
          <article className="priority-card">
            <span>Alerts</span>
            <strong>{actionableAlerts.length}</strong>
          </article>
          <article className="priority-card">
            <span>Selected Source</span>
            <strong>{selectedChannel ? "Ready" : "None"}</strong>
          </article>
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
          <StreamPreviewPanel
            channel={selectedChannel}
            onHealthChange={onReportHealth}
            onPreviewReady={onPreviewReady}
            compact
          />

          <div className="channel-group-layout">
            <aside className="group-column console-panel">
              <div className="panel-heading">
                <h4>Channel Groups</h4>
                <span>{selectedProvider?.name ?? "Active provider"}</span>
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
                    <span>{activeProviderChannels.filter((channel) => (channel.groupName ?? "Ungrouped") === groupName).length} channels</span>
                  </button>
                ))}
                {filteredChannelGroups.length === 0 ? <div className="empty-row">{groupSearchQuery.trim() !== "" ? "No matching groups found." : "No groups available for this provider."}</div> : null}
              </div>
            </aside>

            <aside className="channel-column console-panel">
              <div className="panel-heading">
                <h4>Channels</h4>
                <span>{selectedGroup || "Group not selected"}</span>
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
              <div className="compact-channel-list">
                {filteredSelectedGroupChannels.map((channel) => (
                  <button
                    className={channel.id === selectedChannel?.id ? "selected" : ""}
                    key={channel.id}
                    type="button"
                    onClick={() => onSelectChannel(channel)}
                  >
                    <strong>{channel.name}</strong>
                    <span>{channel.groupName ?? "Uncategorized"}</span>
                  </button>
                ))}
                {filteredSelectedGroupChannels.length === 0 ? <div className="empty-row">{channelSearchQuery.trim() !== "" ? "No matching channels found." : "No channels in this group."}</div> : null}
              </div>
            </aside>
          </div>

          <div className="single-state-row">
            <span className={`unified-status-badge ${unifiedStatus.tone}`}>{unifiedStatus.label}</span>
            <small>{unifiedStatus.detail}</small>
          </div>
        </section>

        <aside className="action-rail console-panel">
          <div className="panel-heading">
            <h3>Match Control</h3>
            <span className="status-pill">{status}</span>
          </div>

          <div className="match-control-selectors">
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

          {terminalAssignment ? (
            <div className="terminal-action">
              <button type="button" className="secondary" onClick={onClearAssignment}>
                Reset active work item
              </button>
            </div>
          ) : null}

          <section className="current-assignment">
            <h4>Active Work Item</h4>
            <dl>
              <dt>Channel</dt>
              <dd>{selectedChannel?.name ?? "None selected"}</dd>
              <dt>Competition</dt>
              <dd className="selected-entity-row">
                {selectedCompetition?.logoUrl ? (
                  <img className="entity-logo" src={selectedCompetition.logoUrl} alt={selectedCompetition.name} />
                ) : null}
                <span>{selectedCompetition?.name ?? "None selected"}</span>
              </dd>
              <dt>Sport</dt>
              <dd className="selected-entity-row">
                {selectedSport?.logoUrl ? (
                  <img className="entity-logo" src={selectedSport.logoUrl} alt={selectedSport.name} />
                ) : null}
                <span>{selectedSport?.name ?? "None selected"}</span>
              </dd>
              <dt>Match</dt>
              <dd className="selected-entity-row">
                {selectedHomeTeam?.logoUrl ? (
                  <img className="entity-logo" src={selectedHomeTeam.logoUrl} alt={selectedHomeTeam.name} />
                ) : null}
                <span>{selectedHomeTeam?.name ?? "None selected"}</span>
                <strong className="vs-label">vs</strong>
                {selectedAwayTeam?.logoUrl ? (
                  <img className="entity-logo" src={selectedAwayTeam.logoUrl} alt={selectedAwayTeam.name} />
                ) : null}
                <span>{selectedAwayTeam?.name ?? "None selected"}</span>
              </dd>
              <dt>Status</dt>
              <dd>{unifiedStatus.label}</dd>
            </dl>
          </section>
        </aside>
      </div> : null}
    </section>
  );
});
