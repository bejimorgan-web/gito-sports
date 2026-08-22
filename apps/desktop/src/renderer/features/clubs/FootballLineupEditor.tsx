import React, { useEffect, useMemo, useState } from "react";
import type { FixtureLineup, FormationTemplate, Player, SeasonSquad } from "@gito/shared";
import { apiClient } from "../../services/api-client";

type Props = { fixture: any; accessToken: string };
type Side = "home" | "away";

function Pitch({ formation, players, assignments, onSlotClick, onDropPlayer, logoUrl }: { formation: FormationTemplate; players: Player[]; assignments: Record<number, string>; onSlotClick: (index: number) => void; onDropPlayer: (index: number, playerId: string) => void; logoUrl?: string }) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return <svg className="football-pitch pitch-editor" viewBox="0 0 100 150" role="img" aria-label={`${formation.name} football pitch`}>
    <rect x="1" y="1" width="98" height="148" rx="1" />
    <path d="M1 75h98 M1 1h98v28H1z M1 121h98v28H1z M1 1h98 M1 149h98" />
    <circle cx="50" cy="75" r="12" /><circle cx="50" cy="75" r="1" />
    <path d="M35 1v12h30V1 M35 149v-12h30v12 M42 1v6h16V1 M42 149v-6h16v6" />
    <circle cx="50" cy="18" r="1" /><circle cx="50" cy="132" r="1" />
    <path d="M42 29a12 12 0 0 0 16 0 M42 121a12 12 0 0 1 16 0" />
    {logoUrl ? <image href={logoUrl} x="25" y="62" width="50" height="26" opacity=".10" preserveAspectRatio="xMidYMid meet" /> : null}
    {formation.positions.map((slot, index) => { const player = byId.get(assignments[index] ?? ""); return <g className={`pitch-position ${player ? "filled" : "empty"}`} key={`${index}-${slot.label ?? "slot"}`} transform={`translate(${slot.x} ${1 + slot.y * 1.48})`} onClick={() => onSlotClick(index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const playerId = event.dataTransfer.getData("text/player-id"); if (playerId) onDropPlayer(index, playerId); }} role="button" tabIndex={0}><circle r="6" /><text y="1.5" textAnchor="middle">{player ? `${player.jerseyNumber ?? "-"}` : slot.label ?? "+"}</text><text className="pitch-player-name" y="10" textAnchor="middle">{player?.displayName?.split(" ").slice(-1)[0] ?? slot.label ?? "Select"}</text></g>; })}
  </svg>;
}

export function FootballLineupEditor({ fixture, accessToken }: Props) {
  const [side, setSide] = useState<Side>("home");
  const [lineups, setLineups] = useState<FixtureLineup[]>([]);
  const [squads, setSquads] = useState<SeasonSquad[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [formations, setFormations] = useState<FormationTemplate[]>([]);
  const [squadId, setSquadId] = useState("");
  const [formationId, setFormationId] = useState("");
  const [status, setStatus] = useState<FixtureLineup["status"]>("not_available");
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [substitutes, setSubstitutes] = useState<string[]>([]);
  const [captain, setCaptain] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Ready");
  const [saving, setSaving] = useState(false);
  const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  const formation = formations.find((item) => item.id === formationId);
  const starterIds = new Set(Object.values(assignments));
  const visiblePlayers = useMemo(() => players.filter((player) => `${player.displayName} ${player.position ?? ""}`.toLowerCase().includes(search.toLowerCase())), [players, search]);

  const load = async () => {
    if (!team?.id) return;
    try {
      const [squadData, formationData, lineupData] = await Promise.all([apiClient.listSeasonSquads({ teamId: team.id, seasonId: fixture.seasonId ?? undefined }), apiClient.listFormationTemplates({ sportId: fixture.sport?.id }), apiClient.listFixtureLineups(fixture.id)]);
      setSquads(squadData); setFormations(formationData); setLineups(lineupData);
      const current = lineupData.find((item) => item.teamId === team.id);
      setSquadId(current?.seasonSquadId ?? squadData[0]?.id ?? ""); setFormationId(current?.formationId ?? formationData.find((item) => item.name === "4-3-3")?.id ?? formationData[0]?.id ?? ""); setStatus(current?.status ?? "not_available"); setCaptain(current?.captainPlayerId ?? "");
      setAssignments(Object.fromEntries((current?.players ?? []).filter((item) => item.role === "starter" && item.slotIndex !== undefined).map((item) => [item.slotIndex!, item.playerId]))); setSubstitutes((current?.players ?? []).filter((item) => item.role === "substitute").map((item) => item.playerId));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load lineup"); }
  };
  useEffect(() => { void load(); }, [fixture.id, side]);
  useEffect(() => { if (!squadId) return; setPlayers([]); void apiClient.listSquadPlayers(squadId).then((members) => Promise.all(members.filter((item) => item.status === "active").map((item) => apiClient.getPlayer(item.playerId)))).then(setPlayers).catch(() => setMessage("Unable to load squad players")); }, [squadId]);
  const assign = (slotIndex: number, playerId: string) => setAssignments((current) => { const next = { ...current }; Object.keys(next).forEach((key) => { if (next[Number(key)] === playerId) delete next[Number(key)]; }); if (playerId) next[slotIndex] = playerId; else delete next[slotIndex]; return next; });
  const save = async () => { if (!team?.id || !squadId || !formationId || saving) return; if (status === "confirmed" && Object.keys(assignments).length !== (formation?.positions.length ?? 0)) { setMessage("Complete the starting XI before confirming the lineup."); return; } const unavailable = players.find((player) => starterIds.has(player.id) && player.availability !== "available"); if (status === "confirmed" && unavailable) { setMessage(`Player is currently marked ${unavailable.availability} and cannot be confirmed in the starting lineup.`); return; } setSaving(true); setMessage("Saving..."); try { const result = await apiClient.saveFixtureLineup(fixture.id, { teamId: team.id, seasonSquadId: squadId, formationId, status, starters: Object.entries(assignments).map(([slotIndex, playerId]) => ({ slotIndex: Number(slotIndex), playerId })), substitutes: substitutes.filter((id) => !starterIds.has(id)), captainPlayerId: captain || null }, accessToken); setLineups((current) => [...current.filter((item) => item.teamId !== team.id), result]); setMessage("Saved"); } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); } finally { setSaving(false); } };
  const selectedSlotLabel = selectedSlot === null ? "Select a pitch position" : formation?.positions[selectedSlot]?.label ?? `Slot ${selectedSlot + 1}`;
  return <section className="console-panel football-lineup-editor"><div className="panel-heading"><h3>Lineups</h3><span className="status-pill">{message}</span></div><div className="lineup-tabs"><button type="button" className={side === "home" ? "selected" : "secondary"} onClick={() => setSide("home")}>{fixture.homeTeam?.name} Home</button><button type="button" className={side === "away" ? "selected" : "secondary"} onClick={() => setSide("away")}>{fixture.awayTeam?.name} Away</button></div><div className="form-grid three-column"><label>Season Squad<select value={squadId} onChange={(event) => setSquadId(event.target.value)}><option value="">Select squad</option>{squads.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Formation<select value={formationId} onChange={(event) => { setFormationId(event.target.value); setAssignments({}); }}><option value="">Select formation</option>{formations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Lineup Status<select value={status} onChange={(event) => setStatus(event.target.value as FixtureLineup["status"])}><option value="not_available">Not Available</option><option value="possible">Possible</option><option value="confirmed">Confirmed</option></select></label></div><div className="lineup-progress">Starting XI {Object.keys(assignments).length} / {formation?.positions.length ?? 0} {formation && Object.keys(assignments).length === formation.positions.length ? "Complete" : ""}</div><div className="lineup-editor-layout"><div><h4>Squad Players</h4><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search player" /><div className="squad-player-list">{visiblePlayers.map((player) => <button type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/player-id", player.id)} disabled={starterIds.has(player.id)} key={player.id} onClick={() => selectedSlot !== null && assign(selectedSlot, player.id)}><span className="player-avatar">{player.photoUrl ? <img src={player.photoUrl} alt="" /> : "?"}</span><strong>{player.displayName}</strong><small>{player.position ?? "Position unknown"} · #{player.jerseyNumber ?? "-"} · {player.availability}</small></button>)}</div></div>{formation ? <div><Pitch formation={formation} players={players} assignments={assignments} logoUrl={team.logoUrl} onSlotClick={setSelectedSlot} onDropPlayer={assign} /><div className="slot-picker"><strong>{selectedSlotLabel}</strong><select value={selectedSlot === null ? "" : assignments[selectedSlot] ?? ""} onChange={(event) => selectedSlot !== null && assign(selectedSlot, event.target.value)}><option value="">Empty position</option>{players.filter((player) => !starterIds.has(player.id) || assignments[selectedSlot ?? -1] === player.id).map((player) => <option key={player.id} value={player.id}>{player.jerseyNumber ?? "-"} {player.displayName}</option>)}</select></div></div> : <p>Select a football formation.</p>}</div><label>Captain<select value={captain} onChange={(event) => setCaptain(event.target.value)}><option value="">No captain</option>{players.filter((player) => starterIds.has(player.id)).map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label><label>Substitutes<select multiple value={substitutes.filter((id) => !starterIds.has(id))} onChange={(event) => setSubstitutes(Array.from(event.target.selectedOptions, (option) => option.value))}>{players.filter((player) => !starterIds.has(player.id)).map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label><div className="button-row"><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save lineup"}</button></div></section>;
}
