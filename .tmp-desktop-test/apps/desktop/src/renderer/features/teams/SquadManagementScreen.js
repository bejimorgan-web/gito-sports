import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
const positions = ["goalkeeper", "defender", "midfielder", "forward", "winger", "striker", "fullback", "center-back", "attacking-midfielder", "defensive-midfielder", "custom"];
const availabilities = ["available", "injured", "suspended", "unavailable"];
export function SquadManagementScreen({ accessToken }) {
    const [teams, setTeams] = useState([]);
    const [sports, setSports] = useState([]);
    const [squads, setSquads] = useState([]);
    const [seasons, setSeasons] = useState([]);
    const [players, setPlayers] = useState([]);
    const [teamId, setTeamId] = useState("");
    const [teamSearch, setTeamSearch] = useState("");
    const [squadId, setSquadId] = useState("");
    const [seasonId, setSeasonId] = useState("");
    const [search, setSearch] = useState("");
    const [position, setPosition] = useState("");
    const [statusFilter, setStatusFilter] = useState("active");
    const [availabilityFilter, setAvailabilityFilter] = useState("");
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState("");
    const [shirtNumber, setShirtNumber] = useState("");
    const [playerPosition, setPlayerPosition] = useState("forward");
    const [photoUrl, setPhotoUrl] = useState("");
    const [playerStatus, setPlayerStatus] = useState("active");
    const [availability, setAvailability] = useState("available");
    const [injuryType, setInjuryType] = useState("");
    const [expectedReturnDate, setExpectedReturnDate] = useState("");
    const [injuryNotes, setInjuryNotes] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [removingId, setRemovingId] = useState(null);
    const [message, setMessage] = useState("Ready");
    const selectedTeam = teams.find((team) => team.id === teamId);
    const selectedSport = sports.find((sport) => sport.id === selectedTeam?.sportId);
    const selectedSquad = squads.find((squad) => squad.id === squadId);
    const selectedSeason = seasons.find((season) => season.id === seasonId);
    const visibleTeams = teams.filter((team) => team.name.toLowerCase().includes(teamSearch.trim().toLowerCase()));
    const loadPlayers = async (nextSquadId = squadId) => {
        if (!nextSquadId) {
            setPlayers([]);
            return;
        }
        setIsLoading(true);
        try {
            const memberships = await apiClient.listSquadPlayers(nextSquadId);
            const result = await Promise.all(memberships.filter((membership) => membership.status === "active").map((membership) => apiClient.getPlayer(membership.playerId)));
            setPlayers(result.filter(Boolean));
            setMessage("Loaded");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Failed to load players");
        }
        finally {
            setIsLoading(false);
        }
    };
    useEffect(() => {
        setMessage("Loading teams...");
        void Promise.all([apiClient.listTeams(), apiClient.listSports()]).then(([teamData, sportData]) => { setTeams(teamData); setSports(sportData); setMessage("Select a team"); }).catch(() => setMessage("Failed to load teams"));
    }, []);
    useEffect(() => {
        setSeasonId("");
        setSquadId("");
        setSeasons([]);
        setSquads([]);
        setPlayers([]);
        if (!teamId)
            return;
        setMessage("Loading seasons...");
        void apiClient.listCompetitions().then(async (competitions) => {
            const contexts = (await Promise.all(competitions.map(async (competition) => {
                const competitionSeasons = await apiClient.listSeasons(competition.id);
                const validSeasons = (await Promise.all(competitionSeasons.map(async (season) => {
                    const members = await apiClient.listSeasonTeams(competition.id, season.id);
                    return members.some((member) => member.teamId === teamId) ? season : null;
                }))).filter((season) => Boolean(season));
                return validSeasons;
            }))).flat();
            const uniqueSeasons = [...new Map(contexts.map((season) => [season.id, season])).values()];
            setSeasons(uniqueSeasons);
            setSeasonId(uniqueSeasons[0]?.id ?? "");
            setMessage(uniqueSeasons.length ? "Select a season" : "No seasons available for this team");
        }).catch(() => setMessage("Failed to load seasons"));
    }, [teamId]);
    useEffect(() => {
        setSquadId("");
        setSquads([]);
        setPlayers([]);
        if (!teamId || !seasonId)
            return;
        setMessage("Loading squad...");
        void apiClient.listSeasonSquads({ teamId, seasonId }).then((data) => { setSquads(data); setSquadId(data[0]?.id ?? ""); if (!data.length)
            setMessage("No squad exists for this season"); }).catch(() => setMessage("Failed to load season squad"));
    }, [seasonId, teamId]);
    useEffect(() => { void loadPlayers(); }, [squadId]);
    const createSquad = async () => {
        if (!teamId || !seasonId || !selectedSeason || isSaving)
            return;
        setIsSaving(true);
        setMessage("Saving...");
        try {
            const created = await apiClient.createSeasonSquad({ teamId, seasonId, competitionId: selectedSeason.competitionId, name: `${selectedTeam?.name ?? "Team"} ${selectedSeason.name} Squad` }, accessToken);
            setSquads([created]);
            setSquadId(created.id);
            setMessage("Squad created");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Squad creation failed");
        }
        finally {
            setIsSaving(false);
        }
    };
    const visiblePlayers = useMemo(() => players.filter((player) => (!search || `${player.displayName} ${player.firstName} ${player.lastName}`.toLowerCase().includes(search.toLowerCase())) &&
        (!position || player.position === position) && (!statusFilter || player.status === statusFilter) && (!availabilityFilter || player.availability === availabilityFilter)), [availabilityFilter, players, position, search, statusFilter]);
    const clearEditor = () => { setEditing(null); setName(""); setShirtNumber(""); setPlayerPosition("forward"); setPhotoUrl(""); setPlayerStatus("active"); setAvailability("available"); setInjuryType(""); setExpectedReturnDate(""); setInjuryNotes(""); };
    const editPlayer = (player) => { setEditing(player); setName(player.displayName); setShirtNumber(player.jerseyNumber?.toString() ?? ""); setPlayerPosition(player.position ?? "forward"); setPhotoUrl(player.photoUrl ?? ""); setPlayerStatus(player.status); setAvailability(player.availability); setInjuryType(player.injuryType ?? ""); setExpectedReturnDate(player.expectedReturnDate ?? ""); setInjuryNotes(player.injuryNotes ?? ""); };
    const savePlayer = async () => {
        if (!teamId || !squadId || !name.trim() || isSaving) {
            setMessage("Team, season squad, and player name are required");
            return;
        }
        setIsSaving(true);
        setMessage("Saving...");
        try {
            const parts = name.trim().split(/\s+/);
            const firstName = parts.shift() ?? name.trim();
            const lastName = parts.join(" ") || firstName;
            const payload = { teamId, firstName, lastName, displayName: name.trim(), position: playerPosition, ...(shirtNumber ? { jerseyNumber: Number(shirtNumber) } : {}), ...(photoUrl ? { photoUrl } : {}), status: playerStatus, availability, ...(availability === "injured" ? { ...(injuryType ? { injuryType } : {}), ...(expectedReturnDate ? { expectedReturnDate } : {}), ...(injuryNotes ? { injuryNotes } : {}) } : {}) };
            const saved = editing ? await apiClient.updatePlayer(editing.id, payload, accessToken) : await apiClient.createPlayer(payload, accessToken);
            if (!editing)
                await apiClient.createSquadPlayer(squadId, { playerId: saved.id, role: "starter", position: playerPosition, ...(shirtNumber ? { jerseyNumber: Number(shirtNumber) } : {}) }, accessToken);
            await loadPlayers();
            clearEditor();
            setMessage(editing ? "Saved" : "Player created");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Save failed");
        }
        finally {
            setIsSaving(false);
        }
    };
    const removePlayer = async (player) => {
        if (removingId || !squadId)
            return;
        const membership = (await apiClient.listSquadPlayers(squadId)).find((item) => item.playerId === player.id);
        if (!membership)
            return;
        setRemovingId(player.id);
        setMessage("Removing...");
        try {
            await apiClient.removeSquadPlayer(membership.id, accessToken);
            await loadPlayers();
            setMessage("Removed");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Remove failed");
        }
        finally {
            setRemovingId(null);
        }
    };
    return _jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Teams / Squad" }), _jsx("h2", { children: "Season Squad & Players" }), _jsx("span", { children: "Manage players in one selected team and season squad." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Squad context" }), _jsx("span", { className: "status-pill", children: message })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Team Search", _jsx("input", { value: teamSearch, onChange: (event) => setTeamSearch(event.target.value), placeholder: "Search teams" })] }), _jsxs("label", { children: ["Team", _jsxs("select", { value: teamId, onChange: (event) => setTeamId(event.target.value), children: [_jsx("option", { value: "", children: "Select team" }), visibleTeams.map((team) => _jsx("option", { value: team.id, children: team.name }, team.id))] })] }), _jsxs("label", { children: ["Season", _jsxs("select", { value: seasonId, onChange: (event) => setSeasonId(event.target.value), disabled: !teamId, children: [_jsx("option", { value: "", children: "Select season" }), seasons.map((season) => _jsx("option", { value: season.id, children: season.name }, season.id))] })] }), _jsxs("label", { children: ["Season Squad", _jsxs("select", { value: squadId, onChange: (event) => setSquadId(event.target.value), disabled: !seasonId, children: [_jsx("option", { value: "", children: "Select season squad" }), squads.map((squad) => _jsx("option", { value: squad.id, children: squad.name }, squad.id))] })] })] }), _jsxs("small", { children: [selectedSport?.name ?? "Sport unavailable", " ", selectedSeason ? `· ${selectedSeason.name}` : "", " ", selectedSquad ? `· ${selectedSquad.name}` : ""] }), teamId && seasonId && !squads.length ? _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: () => void createSquad(), disabled: isSaving, children: isSaving ? "Saving..." : "Create squad" }) }) : null] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: editing ? "Edit Player" : "Add Player" }), _jsx("button", { type: "button", onClick: clearEditor, className: "secondary", children: "Clear" })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value), placeholder: "Player name" })] }), _jsxs("label", { children: ["Shirt Number", _jsx("input", { inputMode: "numeric", value: shirtNumber, onChange: (event) => setShirtNumber(event.target.value) })] }), _jsxs("label", { children: ["Position", _jsx("select", { value: playerPosition, onChange: (event) => setPlayerPosition(event.target.value), children: positions.map((item) => _jsx("option", { value: item, children: item.replaceAll("-", " ") }, item)) })] }), _jsxs("label", { children: ["Photo URL", _jsx("input", { value: photoUrl, onChange: (event) => setPhotoUrl(event.target.value), placeholder: "https://..." })] }), _jsxs("label", { children: ["Status", _jsxs("select", { value: playerStatus, onChange: (event) => setPlayerStatus(event.target.value), children: [_jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "inactive", children: "Inactive" }), _jsx("option", { value: "archived", children: "Archived" })] })] }), _jsxs("label", { children: ["Availability", _jsx("select", { value: availability, onChange: (event) => setAvailability(event.target.value), children: availabilities.map((item) => _jsx("option", { value: item, children: item }, item)) })] }), availability === "injured" ? _jsxs(_Fragment, { children: [_jsxs("label", { children: ["Injury", _jsx("input", { value: injuryType, onChange: (event) => setInjuryType(event.target.value) })] }), _jsxs("label", { children: ["Expected Return", _jsx("input", { type: "date", value: expectedReturnDate, onChange: (event) => setExpectedReturnDate(event.target.value) })] }), _jsxs("label", { children: ["Notes", _jsx("textarea", { value: injuryNotes, onChange: (event) => setInjuryNotes(event.target.value) })] })] }) : null] }), _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: savePlayer, disabled: isSaving, children: isSaving ? "Saving..." : editing ? "Save Player" : "Save Player" }) })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedTeam?.name ?? "Players" }), _jsx("span", { children: isLoading ? "Loading..." : `${visiblePlayers.length} players` })] }), _jsxs("div", { className: "form-grid four-column", children: [_jsxs("label", { children: ["Search player", _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value) })] }), _jsxs("label", { children: ["Position", _jsxs("select", { value: position, onChange: (event) => setPosition(event.target.value), children: [_jsx("option", { value: "", children: "All positions" }), positions.map((item) => _jsx("option", { value: item, children: item.replaceAll("-", " ") }, item))] })] }), _jsxs("label", { children: ["Status", _jsxs("select", { value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), children: [_jsx("option", { value: "", children: "All statuses" }), _jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "inactive", children: "Inactive" }), _jsx("option", { value: "archived", children: "Archived" })] })] }), _jsxs("label", { children: ["Availability", _jsxs("select", { value: availabilityFilter, onChange: (event) => setAvailabilityFilter(event.target.value), children: [_jsx("option", { value: "", children: "All availability" }), availabilities.map((item) => _jsx("option", { value: item, children: item }, item))] })] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Number" }), _jsx("th", { children: "Player" }), _jsx("th", { children: "Position" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Availability" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: visiblePlayers.map((player) => _jsxs("tr", { children: [_jsx("td", { children: player.jerseyNumber ?? "-" }), _jsx("td", { children: player.displayName }), _jsx("td", { children: player.position?.replaceAll("-", " ") ?? "-" }), _jsx("td", { children: player.status }), _jsx("td", { children: _jsx("span", { className: `availability-indicator availability-${player.availability}`, children: player.availability }) }), _jsxs("td", { children: [_jsx("button", { type: "button", onClick: () => editPlayer(player), children: "Edit" }), _jsx("button", { type: "button", className: "secondary", onClick: () => void removePlayer(player), disabled: Boolean(removingId), children: removingId === player.id ? "Removing..." : "Remove from Squad" })] })] }, player.id)) })] }) })] })] });
}
