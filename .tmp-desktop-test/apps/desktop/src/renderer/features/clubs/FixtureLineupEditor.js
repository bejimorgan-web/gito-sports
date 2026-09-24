import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
export function FixtureLineupEditor({ fixture, accessToken }) {
    const [side, setSide] = useState("home");
    const [lineups, setLineups] = useState([]);
    const [squads, setSquads] = useState([]);
    const [players, setPlayers] = useState([]);
    const [formations, setFormations] = useState([]);
    const [squadId, setSquadId] = useState("");
    const [formationId, setFormationId] = useState("");
    const [status, setStatus] = useState("not_available");
    const [starters, setStarters] = useState({});
    const [substitutes, setSubstitutes] = useState([]);
    const [captain, setCaptain] = useState("");
    const [message, setMessage] = useState("Ready");
    const [saving, setSaving] = useState(false);
    const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
    const formation = formations.find((item) => item.id === formationId);
    const starterIds = new Set(Object.values(starters).filter(Boolean));
    const load = async () => {
        if (!team?.id)
            return;
        try {
            const [squadData, formationData, lineupData] = await Promise.all([
                apiClient.listSeasonSquads({ teamId: team.id, seasonId: fixture.seasonId ?? undefined }),
                apiClient.listFormationTemplates({ sportId: fixture.sport?.id }),
                apiClient.listFixtureLineups(fixture.id),
            ]);
            setSquads(squadData);
            setFormations(formationData);
            setLineups(lineupData);
            const current = lineupData.find((item) => item.teamId === team.id);
            setSquadId(current?.seasonSquadId ?? squadData[0]?.id ?? "");
            setFormationId(current?.formationId ?? formationData[0]?.id ?? "");
            setStatus(current?.status ?? "not_available");
            setCaptain(current?.captainPlayerId ?? "");
            setStarters(Object.fromEntries((current?.players ?? []).filter((item) => item.role === "starter" && item.slotIndex !== undefined).map((item) => [item.slotIndex, item.playerId])));
            setSubstitutes((current?.players ?? []).filter((item) => item.role === "substitute").map((item) => item.playerId));
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Unable to load lineup");
        }
    };
    useEffect(() => { void load(); }, [fixture.id, side]);
    useEffect(() => { if (!squadId)
        return; void apiClient.listSquadPlayers(squadId).then((members) => Promise.all(members.filter((item) => item.status === "active").map((item) => apiClient.getPlayer(item.playerId)))).then(setPlayers).catch(() => setMessage("Unable to load squad players")); }, [squadId]);
    const assignSlot = (index, playerId) => setStarters((current) => { const next = { ...current }; Object.keys(next).forEach((key) => { if (next[Number(key)] === playerId)
        delete next[Number(key)]; }); if (playerId)
        next[index] = playerId;
    else
        delete next[index]; return next; });
    const save = async () => { if (!team?.id || !squadId || !formationId || saving)
        return; if (status === "confirmed" && Object.keys(starters).length !== (formation?.positions.length ?? 0)) {
        setMessage("Complete the starting XI before confirming the lineup.");
        return;
    } setSaving(true); setMessage("Saving lineup..."); try {
        const result = await apiClient.saveFixtureLineup(fixture.id, { teamId: team.id, seasonSquadId: squadId, formationId, status, starters: Object.entries(starters).map(([slotIndex, playerId]) => ({ slotIndex: Number(slotIndex), playerId })), substitutes: substitutes.filter((id) => !starterIds.has(id)), captainPlayerId: captain || null }, accessToken);
        setLineups((items) => [...items.filter((item) => item.teamId !== team.id), result]);
        setMessage("Lineup saved");
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Lineup save failed");
    }
    finally {
        setSaving(false);
    } };
    return _jsxs("section", { className: "console-panel fixture-lineup-editor", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Lineups" }), _jsx("span", { className: "status-pill", children: message })] }), _jsxs("div", { className: "lineup-tabs", children: [_jsxs("button", { type: "button", className: side === "home" ? "selected" : "secondary", onClick: () => setSide("home"), children: [fixture.homeTeam?.name, " Lineup"] }), _jsxs("button", { type: "button", className: side === "away" ? "selected" : "secondary", onClick: () => setSide("away"), children: [fixture.awayTeam?.name, " Lineup"] })] }), _jsxs("div", { className: "form-grid three-column", children: [_jsxs("label", { children: ["Season Squad", _jsxs("select", { value: squadId, onChange: (event) => setSquadId(event.target.value), children: [_jsx("option", { value: "", children: "Select squad" }), squads.map((item) => _jsx("option", { value: item.id, children: item.name }, item.id))] })] }), _jsxs("label", { children: ["Formation", _jsxs("select", { value: formationId, onChange: (event) => setFormationId(event.target.value), children: [_jsx("option", { value: "", children: "Select formation" }), formations.map((item) => _jsx("option", { value: item.id, children: item.name }, item.id))] })] }), _jsxs("label", { children: ["Lineup Status", _jsxs("select", { value: status, onChange: (event) => setStatus(event.target.value), children: [_jsx("option", { value: "not_available", children: "Not Available" }), _jsx("option", { value: "possible", children: "Possible" }), _jsx("option", { value: "confirmed", children: "Confirmed" })] })] })] }), formation ? _jsx("div", { className: "lineup-pitch-grid", children: formation.positions.map((slot, index) => _jsxs("label", { className: "lineup-slot", children: [_jsx("span", { children: slot.label ?? `Slot ${index + 1}` }), _jsxs("select", { value: starters[index] ?? "", onChange: (event) => assignSlot(index, event.target.value), children: [_jsx("option", { value: "", children: "Unassigned" }), players.filter((player) => !starterIds.has(player.id) || starters[index] === player.id).map((player) => _jsxs("option", { value: player.id, children: [player.jerseyNumber ?? "-", " ", player.displayName] }, player.id))] })] }, `${index}-${slot.label ?? "slot"}`)) }) : _jsx("p", { children: "Select a formation to assign starters." }), _jsxs("label", { children: ["Captain", _jsxs("select", { value: captain, onChange: (event) => setCaptain(event.target.value), children: [_jsx("option", { value: "", children: "No captain" }), players.filter((player) => starterIds.has(player.id)).map((player) => _jsx("option", { value: player.id, children: player.displayName }, player.id))] })] }), _jsxs("label", { children: ["Substitutes", _jsx("select", { multiple: true, value: substitutes.filter((id) => !starterIds.has(id)), onChange: (event) => setSubstitutes(Array.from(event.target.selectedOptions, (option) => option.value)), children: players.filter((player) => !starterIds.has(player.id)).map((player) => _jsx("option", { value: player.id, children: player.displayName }, player.id)) })] }), _jsx("div", { className: "button-row", children: _jsx("button", { type: "button", onClick: () => void save(), disabled: saving, children: saving ? "Saving lineup..." : "Save lineup" }) })] });
}
