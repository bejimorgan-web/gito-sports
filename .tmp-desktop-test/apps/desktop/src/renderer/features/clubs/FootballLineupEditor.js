import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
function Pitch({ formation, players, assignments, onSlotClick, onDropPlayer, logoUrl }) {
    const byId = new Map(players.map((player) => [player.id, player]));
    return _jsxs("svg", { className: "football-pitch pitch-editor", viewBox: "0 0 100 150", role: "img", "aria-label": `${formation.name} football pitch`, children: [_jsx("rect", { x: "1", y: "1", width: "98", height: "148", rx: "1" }), _jsx("path", { d: "M1 75h98 M1 1h98v28H1z M1 121h98v28H1z M1 1h98 M1 149h98" }), _jsx("circle", { cx: "50", cy: "75", r: "12" }), _jsx("circle", { cx: "50", cy: "75", r: "1" }), _jsx("path", { d: "M35 1v12h30V1 M35 149v-12h30v12 M42 1v6h16V1 M42 149v-6h16v6" }), _jsx("circle", { cx: "50", cy: "18", r: "1" }), _jsx("circle", { cx: "50", cy: "132", r: "1" }), _jsx("path", { d: "M42 29a12 12 0 0 0 16 0 M42 121a12 12 0 0 1 16 0" }), logoUrl ? _jsx("image", { href: logoUrl, x: "25", y: "62", width: "50", height: "26", opacity: ".10", preserveAspectRatio: "xMidYMid meet" }) : null, formation.positions.map((slot, index) => { const player = byId.get(assignments[index] ?? ""); return _jsxs("g", { className: `pitch-position ${player ? "filled" : "empty"}`, transform: `translate(${slot.x} ${1 + slot.y * 1.48})`, onClick: () => onSlotClick(index), onDragOver: (event) => event.preventDefault(), onDrop: (event) => { event.preventDefault(); const playerId = event.dataTransfer.getData("text/player-id"); if (playerId)
                    onDropPlayer(index, playerId); }, role: "button", tabIndex: 0, children: [_jsx("circle", { r: "6" }), _jsx("text", { y: "1.5", textAnchor: "middle", children: player ? `${player.jerseyNumber ?? "-"}` : slot.label ?? "+" }), _jsx("text", { className: "pitch-player-name", y: "10", textAnchor: "middle", children: player?.displayName?.split(" ").slice(-1)[0] ?? slot.label ?? "Select" })] }, `${index}-${slot.label ?? "slot"}`); })] });
}
export function FootballLineupEditor({ fixture, accessToken }) {
    const [side, setSide] = useState("home");
    const [lineups, setLineups] = useState([]);
    const [squads, setSquads] = useState([]);
    const [players, setPlayers] = useState([]);
    const [formations, setFormations] = useState([]);
    const [squadId, setSquadId] = useState("");
    const [formationId, setFormationId] = useState("");
    const [status, setStatus] = useState("not_available");
    const [assignments, setAssignments] = useState({});
    const [substitutes, setSubstitutes] = useState([]);
    const [captain, setCaptain] = useState("");
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [search, setSearch] = useState("");
    const [message, setMessage] = useState("Ready");
    const [saving, setSaving] = useState(false);
    const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
    const formation = formations.find((item) => item.id === formationId);
    const starterIds = new Set(Object.values(assignments));
    const visiblePlayers = useMemo(() => players.filter((player) => `${player.displayName} ${player.position ?? ""}`.toLowerCase().includes(search.toLowerCase())), [players, search]);
    const load = async () => {
        if (!team?.id)
            return;
        try {
            const [squadData, formationData, lineupData] = await Promise.all([apiClient.listSeasonSquads({ teamId: team.id, seasonId: fixture.seasonId ?? undefined }), apiClient.listFormationTemplates({ sportId: fixture.sport?.id }), apiClient.listFixtureLineups(fixture.id)]);
            setSquads(squadData);
            setFormations(formationData);
            setLineups(lineupData);
            const current = lineupData.find((item) => item.teamId === team.id);
            setSquadId(current?.seasonSquadId ?? squadData[0]?.id ?? "");
            setFormationId(current?.formationId ?? formationData.find((item) => item.name === "4-3-3")?.id ?? formationData[0]?.id ?? "");
            setStatus(current?.status ?? "not_available");
            setCaptain(current?.captainPlayerId ?? "");
            setAssignments(Object.fromEntries((current?.players ?? []).filter((item) => item.role === "starter" && item.slotIndex !== undefined).map((item) => [item.slotIndex, item.playerId])));
            setSubstitutes((current?.players ?? []).filter((item) => item.role === "substitute").map((item) => item.playerId));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Unable to load lineup");
        }
    };
    useEffect(() => { void load(); }, [fixture.id, side]);
    useEffect(() => { if (!squadId)
        return; setPlayers([]); void apiClient.listSquadPlayers(squadId).then((members) => Promise.all(members.filter((item) => item.status === "active").map((item) => apiClient.getPlayer(item.playerId)))).then(setPlayers).catch(() => setMessage("Unable to load squad players")); }, [squadId]);
    const assign = (slotIndex, playerId) => setAssignments((current) => { const next = { ...current }; Object.keys(next).forEach((key) => { if (next[Number(key)] === playerId)
        delete next[Number(key)]; }); if (playerId)
        next[slotIndex] = playerId;
    else
        delete next[slotIndex]; return next; });
    const save = async () => { if (!team?.id || !squadId || !formationId || saving)
        return; if (status === "confirmed" && Object.keys(assignments).length !== (formation?.positions.length ?? 0)) {
        setMessage("Complete the starting XI before confirming the lineup.");
        return;
    } const unavailable = players.find((player) => starterIds.has(player.id) && player.availability !== "available"); if (status === "confirmed" && unavailable) {
        setMessage(`Player is currently marked ${unavailable.availability} and cannot be confirmed in the starting lineup.`);
        return;
    } setSaving(true); setMessage("Saving..."); try {
        const result = await apiClient.saveFixtureLineup(fixture.id, { teamId: team.id, seasonSquadId: squadId, formationId, status, starters: Object.entries(assignments).map(([slotIndex, playerId]) => ({ slotIndex: Number(slotIndex), playerId })), substitutes: substitutes.filter((id) => !starterIds.has(id)), captainPlayerId: captain || null }, accessToken);
        setLineups((current) => [...current.filter((item) => item.teamId !== team.id), result]);
        setMessage("Saved");
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Save failed");
    }
    finally {
        setSaving(false);
    } };
    const selectedSlotLabel = selectedSlot === null ? "Select a pitch position" : formation?.positions[selectedSlot]?.label ?? `Slot ${selectedSlot + 1}`;
    return _jsxs("section", { className: "console-panel football-lineup-editor", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Lineups" }), _jsx("span", { className: "status-pill", children: message })] }), _jsxs("div", { className: "lineup-tabs", children: [_jsxs("button", { type: "button", className: side === "home" ? "selected" : "secondary", onClick: () => setSide("home"), children: [fixture.homeTeam?.name, " Home"] }), _jsxs("button", { type: "button", className: side === "away" ? "selected" : "secondary", onClick: () => setSide("away"), children: [fixture.awayTeam?.name, " Away"] })] }), _jsxs("div", { className: "form-grid three-column", children: [_jsxs("label", { children: ["Season Squad", _jsxs("select", { value: squadId, onChange: (event) => setSquadId(event.target.value), children: [_jsx("option", { value: "", children: "Select squad" }), squads.map((item) => _jsx("option", { value: item.id, children: item.name }, item.id))] })] }), _jsxs("label", { children: ["Formation", _jsxs("select", { value: formationId, onChange: (event) => { setFormationId(event.target.value); setAssignments({}); }, children: [_jsx("option", { value: "", children: "Select formation" }), formations.map((item) => _jsx("option", { value: item.id, children: item.name }, item.id))] })] }), _jsxs("label", { children: ["Lineup Status", _jsxs("select", { value: status, onChange: (event) => setStatus(event.target.value), children: [_jsx("option", { value: "not_available", children: "Not Available" }), _jsx("option", { value: "possible", children: "Possible" }), _jsx("option", { value: "confirmed", children: "Confirmed" })] })] })] }), _jsxs("div", { className: "lineup-progress", children: ["Starting XI ", Object.keys(assignments).length, " / ", formation?.positions.length ?? 0, " ", formation && Object.keys(assignments).length === formation.positions.length ? "Complete" : ""] }), _jsxs("div", { className: "lineup-editor-layout", children: [_jsxs("div", { children: [_jsx("h4", { children: "Squad Players" }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "Search player" }), _jsx("div", { className: "squad-player-list", children: visiblePlayers.map((player) => _jsxs("button", { type: "button", draggable: true, onDragStart: (event) => event.dataTransfer.setData("text/player-id", player.id), disabled: starterIds.has(player.id), onClick: () => selectedSlot !== null && assign(selectedSlot, player.id), children: [_jsx("span", { className: "player-avatar", children: player.photoUrl ? _jsx("img", { src: player.photoUrl, alt: "" }) : "?" }), _jsx("strong", { children: player.displayName }), _jsxs("small", { children: [player.position ?? "Position unknown", " \u00B7 #", player.jerseyNumber ?? "-", " \u00B7 ", player.availability] })] }, player.id)) })] }), formation ? _jsxs("div", { children: [_jsx(Pitch, { formation: formation, players: players, assignments: assignments, logoUrl: team.logoUrl, onSlotClick: setSelectedSlot, onDropPlayer: assign }), _jsxs("div", { className: "slot-picker", children: [_jsx("strong", { children: selectedSlotLabel }), _jsxs("select", { value: selectedSlot === null ? "" : assignments[selectedSlot] ?? "", onChange: (event) => selectedSlot !== null && assign(selectedSlot, event.target.value), children: [_jsx("option", { value: "", children: "Empty position" }), players.filter((player) => !starterIds.has(player.id) || assignments[selectedSlot ?? -1] === player.id).map((player) => _jsxs("option", { value: player.id, children: [player.jerseyNumber ?? "-", " ", player.displayName] }, player.id))] })] })] }) : _jsx("p", { children: "Select a football formation." })] }), _jsxs("label", { children: ["Captain", _jsxs("select", { value: captain, onChange: (event) => setCaptain(event.target.value), children: [_jsx("option", { value: "", children: "No captain" }), players.filter((player) => starterIds.has(player.id)).map((player) => _jsx("option", { value: player.id, children: player.displayName }, player.id))] })] }), _jsxs("label", { children: ["Substitutes", _jsx("select", { multiple: true, value: substitutes.filter((id) => !starterIds.has(id)), onChange: (event) => setSubstitutes(Array.from(event.target.selectedOptions, (option) => option.value)), children: players.filter((player) => !starterIds.has(player.id)).map((player) => _jsx("option", { value: player.id, children: player.displayName }, player.id)) })] }), _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: () => void save(), disabled: saving, children: saving ? "Saving..." : "Save lineup" }) })] });
}
