import { useEffect, useState } from "react";
import type { Channel, MatchAssignmentResult, PublishedLiveMatch, Stream } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";

interface LiveMatchApprovalScreenProps {
  assignment: MatchAssignmentResult | undefined;
  liveMatches: PublishedLiveMatch[];
  channels: Channel[];
  onApprove: (streamId: string) => Promise<void>;
  onPublish: (streamId: string) => Promise<void>;
  onReassign: (streamId: string, channelId: string) => Promise<void>;
  onDelete: (streamId: string) => Promise<void>;
  onOpenMatch?: (matchId?: string) => void;
}

export function LiveMatchApprovalScreen({
  assignment,
  liveMatches,
  channels,
  onApprove,
  onPublish,
  onReassign,
  onDelete
  , onOpenMatch
}: LiveMatchApprovalScreenProps) {
  const FALLBACK_LOGO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="%23081018"/></svg>';
  const [reassignChannel, setReassignChannel] = useState<Record<string, string>>({});
  const selectableChannels = channels;
  const canApprove = assignment?.stream.status === "assigned" || assignment?.stream.status === "testing";
  const canPublish = assignment?.match.status === "approved" && assignment.stream.status === "approved";
  const [competitions, setCompetitions] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [sports, setSports] = useState<any[]>([]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [c, t, s] = await Promise.all([apiClient.listCompetitions(), apiClient.listTeams(), apiClient.listSports()]);
        if (!active) return;
        setCompetitions(c);
        setTeams(t);
        setSports(s);
      } catch {
        // ignore
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Approvals</p>
        <h2>Live Match Control</h2>
        <span>Approve assigned streams and publish live matches to delivery endpoints.</span>
      </header>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Approval Queue</h3>
          <span>{assignment ? `${assignment.match.status} / ${assignment.stream.status}` : "No pending stream"}</span>
        </div>
        {assignment ? (
          <div className="approval-item">
            <div>
              <strong>{assignment.channel.name}</strong>
              <span>Stream ID: {assignment.stream.id}</span>
            </div>
            <div className="button-row">
              <button type="button" disabled={!canApprove} onClick={() => void onApprove(assignment.stream.id)}>
                Approve Stream
              </button>
              <button type="button" disabled={!canPublish} onClick={() => void onPublish(assignment.stream.id)}>
                Publish Live
              </button>
            </div>
          </div>
        ) : (
          <div className="approval-empty">
            <strong>No streams pending review.</strong>
            <span>Assigned match streams will appear here before mobile publication.</span>
          </div>
        )}
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Published Feed</h3>
          <span>{liveMatches.length} live</span>
        </div>
        <div className="channel-list">
          {liveMatches.map((liveMatch) => {
            const selectedChannelId =
              reassignChannel[liveMatch.stream.id] ?? selectableChannels[0]?.id ?? liveMatch.channel.id;
            const canReassign = selectedChannelId !== liveMatch.channel.id && selectableChannels.length > 0;

            const match: any = liveMatch.match as any;
            const competition = competitions.find((c) => c.id === match.competitionId);
            const homeTeam = teams.find((t) => t.id === match.homeTeamId);
            const awayTeam = teams.find((t) => t.id === match.awayTeamId);
            const sport = competition ? sports.find((s) => s.id === competition.sportId) : undefined;
            const homeTeamLogo = homeTeam?.logoUrl ?? liveMatch.homeTeamLogoUrl;
            const awayTeamLogo = awayTeam?.logoUrl ?? liveMatch.awayTeamLogoUrl;
            const competitionLogo = competition?.logoUrl ?? liveMatch.competitionLogoUrl;
            const competitionName = competition?.name ?? liveMatch.competitionName ?? "";
            const homeTeamLabel = homeTeam?.name ?? liveMatch.homeTeamName ?? match.homeTeamId;
            const awayTeamLabel = awayTeam?.name ?? liveMatch.awayTeamName ?? match.awayTeamId;

            return (
              <div className="feed-row" key={liveMatch.stream.id}>
                <div className="feed-row-main">
                  <div className="match-summary" onClick={() => onOpenMatch?.(match?.id)} style={{ cursor: onOpenMatch ? "pointer" : "default" }}>
                    <div className="teams">
                      {homeTeamLogo ? <img src={resolveAssetUrl(homeTeamLogo)} alt={homeTeamLabel} className="match-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="match-logo" />}
                      <strong className="team-name">{homeTeamLabel}</strong>
                      <span className="vs">vs</span>
                      {awayTeamLogo ? <img src={resolveAssetUrl(awayTeamLogo)} alt={awayTeamLabel} className="match-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="match-logo" />}
                      <strong className="team-name">{awayTeamLabel}</strong>
                    </div>
                    <div className="competition">
                      {competitionLogo ? <img src={resolveAssetUrl(competitionLogo)} alt={competitionName} className="competition-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : <img src={FALLBACK_LOGO} alt="placeholder" className="competition-logo" />}
                      <span className="competition-name">{competitionName}</span>
                      {sport?.logoUrl ? <img src={resolveAssetUrl(sport.logoUrl)} alt={sport.name} className="competition-logo" onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_LOGO; }} /> : null}
                    </div>
                  </div>
                  <div className="feed-channel">
                    <strong>{liveMatch.channel.name}</strong>
                    <span>{liveMatch.provider.name}</span>
                  </div>
                </div>
                <div className="feed-row-actions">
                  <label>
                    Reassign Station
                    <select
                      value={selectedChannelId}
                      onChange={(event) =>
                        setReassignChannel((current) => ({
                          ...current,
                          [liveMatch.stream.id]: event.target.value
                        }))
                      }
                    >
                      {selectableChannels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name} ({channel.status})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={!canReassign} onClick={() => void onReassign(liveMatch.stream.id, selectedChannelId)}>
                    Edit Station
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (window.confirm(`Remove published stream from feed for "${liveMatch.channel.name}"?`)) {
                        void onDelete(liveMatch.stream.id);
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {liveMatches.length === 0 ? <div className="empty-row">No live matches published.</div> : null}
        </div>
      </section>
    </section>
  );
}
