import { useEffect, useState } from "react";
import type { Channel } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";
import type { DesktopPublicationContext } from "../../services/publication-artifact";

interface LiveMatchApprovalScreenProps {
  assignment: DesktopPublicationContext | undefined;
  liveMatches: DesktopPublicationContext[];
  channels: Channel[];
  onApprove: (publicationId: string) => Promise<void>;
  onPublish: (publicationId: string) => Promise<void>;
  onReassign: (publicationId: string, channelId: string) => Promise<void>;
  onDelete: (publicationId: string) => Promise<void>;
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
  const [deletingPublicationId, setDeletingPublicationId] = useState<string | null>(null);
  const selectableChannels = channels;
  const canApprove = assignment?.publication.publicationStatus === "draft";
  const canPublish = assignment?.publication.publicationStatus === "approved";
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
        <h2>Publication Control</h2>
        <span>Approve publication drafts and publish live feed entries.</span>
      </header>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Publication Queue</h3>
          <span>{assignment ? `${assignment.publication.publicationStatus} / ${assignment.publication.availability}` : "No pending publication"}</span>
        </div>
        {assignment ? (
          <div className="approval-item">
            <div>
              <strong>{assignment.source.channel?.name ?? "Selected source"}</strong>
              <span>Publication ID: {assignment.publication.publicationId}</span>
            </div>
            <div className="button-row">
              <button type="button" disabled={!canApprove} onClick={() => void onApprove(assignment.publication.publicationId)}>
                Approve Publication
              </button>
              <button type="button" disabled={!canPublish} onClick={() => void onPublish(assignment.publication.publicationId)}>
                Publish Live Feed
              </button>
            </div>
          </div>
        ) : (
          <div className="approval-empty">
            <strong>No publications pending review.</strong>
            <span>Draft publications will appear here before they are published.</span>
          </div>
        )}
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h3>Published Feed</h3>
          <span>{liveMatches.length} live publications</span>
        </div>
        <div className="channel-list">
          {liveMatches.map((liveMatch) => {
            const publicationId = liveMatch.publication.publicationId;
            const selectedChannelId =
              reassignChannel[publicationId] ?? selectableChannels.find((channel) => channel.id === liveMatch.source.channelId)?.id ?? selectableChannels[0]?.id ?? liveMatch.source.channel?.id ?? "";
            const canReassign = Boolean(selectedChannelId && liveMatch.source.channelId && selectedChannelId !== liveMatch.source.channelId && selectableChannels.length > 0);

            const match: any = liveMatch.match as any;
            const competition = competitions.find((c) => c.id === match.competitionId);
            const homeTeam = teams.find((t) => t.id === match.homeTeamId);
            const awayTeam = teams.find((t) => t.id === match.awayTeamId);
            const sport = competition ? sports.find((s) => s.id === competition.sportId) : undefined;
            const homeTeamLogo = homeTeam?.logoUrl ?? match.homeTeamLogoUrl ?? null;
            const awayTeamLogo = awayTeam?.logoUrl ?? match.awayTeamLogoUrl ?? null;
            const competitionLogo = competition?.logoUrl ?? match.competitionLogoUrl ?? null;
            const competitionName = competition?.name ?? match.competitionName ?? "";
            const homeTeamLabel = homeTeam?.name ?? match.homeTeamName ?? match.homeTeamId;
            const awayTeamLabel = awayTeam?.name ?? match.awayTeamName ?? match.awayTeamId;

            return (
              <div className="feed-row" key={publicationId}>
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
                    <strong>{liveMatch.source.channel?.name ?? "Unavailable source"}</strong>
                    <span>{liveMatch.source.provider?.name ?? "Local mapping unresolved"}</span>
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
                          [publicationId]: event.target.value
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
                  <button type="button" disabled={!canReassign} onClick={() => void onReassign(publicationId, selectedChannelId)}>
                    Edit Station
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={deletingPublicationId !== null}
                    onClick={() => {
                      if (window.confirm(`Remove published feed item for "${liveMatch.source.channel?.name ?? "this source"}"?`)) {
                        if (deletingPublicationId) return;
                        setDeletingPublicationId(publicationId);
                        void onDelete(publicationId).finally(() => setDeletingPublicationId(null));
                      }
                    }}
                  >
                    {deletingPublicationId === publicationId ? "Deleting…" : "Remove"}
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
