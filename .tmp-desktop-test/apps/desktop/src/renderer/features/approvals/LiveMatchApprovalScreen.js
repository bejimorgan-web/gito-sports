import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { resolveAssetUrl } from "../../components/asset-url";
export function LiveMatchApprovalScreen({ assignment, liveMatches, channels, onApprove, onPublish, onReassign, onDelete, onOpenMatch }) {
    const FALLBACK_LOGO = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="%23081018"/></svg>';
    const [reassignChannel, setReassignChannel] = useState({});
    const [deletingPublicationId, setDeletingPublicationId] = useState(null);
    const selectableChannels = channels;
    const canApprove = assignment?.publication.publicationStatus === "draft";
    const canPublish = assignment?.publication.publicationStatus === "approved";
    const [competitions, setCompetitions] = useState([]);
    const [teams, setTeams] = useState([]);
    const [sports, setSports] = useState([]);
    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const [c, t, s] = await Promise.all([apiClient.listCompetitions(), apiClient.listTeams(), apiClient.listSports()]);
                if (!active)
                    return;
                setCompetitions(c);
                setTeams(t);
                setSports(s);
            }
            catch {
                // ignore
            }
        })();
        return () => {
            active = false;
        };
    }, []);
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Approvals" }), _jsx("h2", { children: "Publication Control" }), _jsx("span", { children: "Approve publication drafts and publish live feed entries." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Publication Queue" }), _jsx("span", { children: assignment ? `${assignment.publication.publicationStatus} / ${assignment.publication.availability}` : "No pending publication" })] }), assignment ? (_jsxs("div", { className: "approval-item", children: [_jsxs("div", { children: [_jsx("strong", { children: assignment.source.channel?.name ?? "Selected source" }), _jsxs("span", { children: ["Publication ID: ", assignment.publication.publicationId] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", disabled: !canApprove, onClick: () => void onApprove(assignment.publication.publicationId), children: "Approve Publication" }), _jsx("button", { type: "button", disabled: !canPublish, onClick: () => void onPublish(assignment.publication.publicationId), children: "Publish Live Feed" })] })] })) : (_jsxs("div", { className: "approval-empty", children: [_jsx("strong", { children: "No publications pending review." }), _jsx("span", { children: "Draft publications will appear here before they are published." })] }))] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Published Feed" }), _jsxs("span", { children: [liveMatches.length, " live publications"] })] }), _jsxs("div", { className: "channel-list", children: [liveMatches.map((liveMatch) => {
                                const publicationId = liveMatch.publication.publicationId;
                                const selectedChannelId = reassignChannel[publicationId] ?? selectableChannels.find((channel) => channel.id === liveMatch.source.channelId)?.id ?? selectableChannels[0]?.id ?? liveMatch.source.channel?.id ?? "";
                                const canReassign = Boolean(selectedChannelId && liveMatch.source.channelId && selectedChannelId !== liveMatch.source.channelId && selectableChannels.length > 0);
                                const match = liveMatch.match;
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
                                return (_jsxs("div", { className: "feed-row", children: [_jsxs("div", { className: "feed-row-main", children: [_jsxs("div", { className: "match-summary", onClick: () => onOpenMatch?.(match?.id), style: { cursor: onOpenMatch ? "pointer" : "default" }, children: [_jsxs("div", { className: "teams", children: [homeTeamLogo ? _jsx("img", { src: resolveAssetUrl(homeTeamLogo), alt: homeTeamLabel, className: "match-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "match-logo" }), _jsx("strong", { className: "team-name", children: homeTeamLabel }), _jsx("span", { className: "vs", children: "vs" }), awayTeamLogo ? _jsx("img", { src: resolveAssetUrl(awayTeamLogo), alt: awayTeamLabel, className: "match-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "match-logo" }), _jsx("strong", { className: "team-name", children: awayTeamLabel })] }), _jsxs("div", { className: "competition", children: [competitionLogo ? _jsx("img", { src: resolveAssetUrl(competitionLogo), alt: competitionName, className: "competition-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : _jsx("img", { src: FALLBACK_LOGO, alt: "placeholder", className: "competition-logo" }), _jsx("span", { className: "competition-name", children: competitionName }), sport?.logoUrl ? _jsx("img", { src: resolveAssetUrl(sport.logoUrl), alt: sport.name, className: "competition-logo", onError: (e) => { e.currentTarget.src = FALLBACK_LOGO; } }) : null] })] }), _jsxs("div", { className: "feed-channel", children: [_jsx("strong", { children: liveMatch.source.channel?.name ?? "Unavailable source" }), _jsx("span", { children: liveMatch.source.provider?.name ?? "Local mapping unresolved" })] })] }), _jsxs("div", { className: "feed-row-actions", children: [_jsxs("label", { children: ["Reassign Station", _jsx("select", { value: selectedChannelId, onChange: (event) => setReassignChannel((current) => ({
                                                                ...current,
                                                                [publicationId]: event.target.value
                                                            })), children: selectableChannels.map((channel) => (_jsxs("option", { value: channel.id, children: [channel.name, " (", channel.status, ")"] }, channel.id))) })] }), _jsx("button", { type: "button", disabled: !canReassign, onClick: () => void onReassign(publicationId, selectedChannelId), children: "Edit Station" }), _jsx("button", { type: "button", className: "secondary", disabled: deletingPublicationId !== null, onClick: () => {
                                                        if (window.confirm(`Remove published feed item for "${liveMatch.source.channel?.name ?? "this source"}"?`)) {
                                                            if (deletingPublicationId)
                                                                return;
                                                            setDeletingPublicationId(publicationId);
                                                            void onDelete(publicationId).finally(() => setDeletingPublicationId(null));
                                                        }
                                                    }, children: deletingPublicationId === publicationId ? "Deleting…" : "Remove" })] })] }, publicationId));
                            }), liveMatches.length === 0 ? _jsx("div", { className: "empty-row", children: "No live matches published." }) : null] })] })] }));
}
