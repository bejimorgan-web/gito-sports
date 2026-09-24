import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
export function SeasonMembershipPanel({ teams, competitions, selectedSportId, accessToken }) {
    const clubs = teams.filter((team) => team.sportId === selectedSportId && team.type === "club");
    const sportCompetitions = competitions.filter((competition) => competition.sportId === selectedSportId && competition.participantType === "clubs");
    const [teamId, setTeamId] = useState("");
    const [competitionId, setCompetitionId] = useState("");
    const [seasonId, setSeasonId] = useState("");
    const [seasonName, setSeasonName] = useState("");
    const [seasonStartsAt, setSeasonStartsAt] = useState("");
    const [seasonEndsAt, setSeasonEndsAt] = useState("");
    const [seasons, setSeasons] = useState([]);
    const [members, setMembers] = useState([]);
    const [competitionMembers, setCompetitionMembers] = useState([]);
    const [status, setStatus] = useState("Ready");
    const [isSavingSeason, setIsSavingSeason] = useState(false);
    useEffect(() => {
        setTeamId("");
        setCompetitionId("");
        setSeasonId("");
        setSeasons([]);
        setMembers([]);
        setCompetitionMembers([]);
    }, [selectedSportId]);
    useEffect(() => {
        if (!competitionId) {
            setSeasons([]);
            setCompetitionMembers([]);
            return;
        }
        void Promise.all([apiClient.listSeasons(competitionId), apiClient.listCompetitionTeams(competitionId)])
            .then(([seasonData, memberData]) => {
            setSeasons(seasonData);
            setCompetitionMembers(memberData);
        })
            .catch(() => setStatus("Unable to load competition memberships."));
    }, [competitionId]);
    useEffect(() => {
        if (!competitionId || !seasonId) {
            setMembers([]);
            return;
        }
        void apiClient.listSeasonTeams(competitionId, seasonId).then(setMembers).catch(() => setStatus("Unable to load season memberships."));
    }, [competitionId, seasonId]);
    const addCompetitionMembership = async () => {
        if (!competitionId || !teamId)
            return;
        try {
            await apiClient.addTeamToCompetition(competitionId, teamId, accessToken);
            setCompetitionMembers(await apiClient.listCompetitionTeams(competitionId));
            setStatus("Competition membership added.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to add membership.");
        }
    };
    const createSeason = async () => {
        if (!competitionId || !seasonName.trim())
            return;
        try {
            setIsSavingSeason(true);
            setStatus("Saving…");
            const season = await apiClient.createSeason(competitionId, {
                name: seasonName.trim(),
                startsAt: seasonStartsAt ? new Date(`${seasonStartsAt}T00:00:00.000Z`).toISOString() : null,
                endsAt: seasonEndsAt ? new Date(`${seasonEndsAt}T00:00:00.000Z`).toISOString() : null
            }, accessToken);
            setSeasons(await apiClient.listSeasons(competitionId));
            setSeasonId(season.id);
            setSeasonName("");
            setSeasonStartsAt("");
            setSeasonEndsAt("");
            setStatus("Season created.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to create season.");
        }
        finally {
            setIsSavingSeason(false);
        }
    };
    const addSeasonMembership = async () => {
        if (!competitionId || !seasonId || !teamId)
            return;
        try {
            await apiClient.addSeasonTeam(competitionId, seasonId, teamId, accessToken);
            setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
            setStatus("Season membership added.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to add season membership.");
        }
    };
    const removeSeasonMembership = async (memberTeamId) => {
        if (!competitionId || !seasonId)
            return;
        try {
            await apiClient.removeSeasonTeam(competitionId, seasonId, memberTeamId, accessToken);
            setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
            setStatus("Season membership removed.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to remove season membership.");
        }
    };
    return (_jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Competition & Season Membership" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Club", _jsxs("select", { value: teamId, onChange: (event) => setTeamId(event.target.value), children: [_jsx("option", { value: "", children: "Select club" }), clubs.map((team) => _jsx("option", { value: team.id, children: team.name }, team.id))] })] }), _jsxs("label", { children: ["Competition", _jsxs("select", { value: competitionId, onChange: (event) => { setCompetitionId(event.target.value); setSeasonId(""); }, children: [_jsx("option", { value: "", children: "Select competition" }), sportCompetitions.map((competition) => _jsx("option", { value: competition.id, children: competition.name }, competition.id))] })] }), _jsxs("label", { children: ["Season", _jsxs("select", { value: seasonId, onChange: (event) => setSeasonId(event.target.value), disabled: !competitionId, children: [_jsx("option", { value: "", children: "Select season" }), seasons.map((season) => _jsx("option", { value: season.id, children: season.name }, season.id))] })] }), _jsxs("label", { children: ["New season", _jsxs("div", { className: "button-row", children: [_jsx("input", { value: seasonName, onChange: (event) => setSeasonName(event.target.value), placeholder: "2026/27" }), _jsx("input", { type: "date", value: seasonStartsAt, onChange: (event) => setSeasonStartsAt(event.target.value), "aria-label": "Season start" }), _jsx("input", { type: "date", value: seasonEndsAt, onChange: (event) => setSeasonEndsAt(event.target.value), "aria-label": "Season end" }), _jsx("button", { type: "button", onClick: () => void createSeason(), disabled: isSavingSeason || !competitionId || !seasonName.trim(), children: isSavingSeason ? "Saving…" : "Create" })] })] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: () => void addCompetitionMembership(), disabled: !teamId || !competitionId || competitionMembers.some((team) => team.id === teamId), children: "Add competition membership" }), _jsx("button", { type: "button", onClick: () => void addSeasonMembership(), disabled: !teamId || !competitionId || !seasonId || members.some((member) => member.teamId === teamId), children: "Add season membership" })] }), seasonId ? (_jsx("div", { className: "entity-list", children: members.map((member) => (_jsxs("div", { className: "entity-list-item", children: [_jsx("span", { children: member.team?.name ?? member.teamId }), _jsx("button", { type: "button", className: "secondary", onClick: () => void removeSeasonMembership(member.teamId), children: "Remove" })] }, member.teamId))) })) : null] }));
}
