import React, { useEffect, useState } from "react";
import type { FixtureLineup, FormationTemplate, Player, SeasonSquad } from "@gito/shared";
import { apiClient } from "../../services/api-client";

type Props = { fixture: any; accessToken: string };
type Side = "home" | "away";

export function FixtureLineupEditor({ fixture, accessToken }: Props) {
  const [side, setSide] = useState<Side>("home");
  const [lineups, setLineups] = useState<FixtureLineup[]>([]);
  const [squads, setSquads] = useState<SeasonSquad[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [formations, setFormations] = useState<FormationTemplate[]>([]);
  const [squadId, setSquadId] = useState("");
  const [formationId, setFormationId] = useState("");
  const [status, setStatus] = useState<FixtureLineup["status"]>("not_available");
  const [starters, setStarters] = useState<Record<number, string>>({});
  const [substitutes, setSubstitutes] = useState<string[]>([]);
  const [captain, setCaptain] = useState("");
  const [message, setMessage] = useState("Ready");
  const [saving, setSaving] = useState(false);
  const team = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  const formation = formations.find((item) => item.id === formationId);
  const starterIds = new Set(Object.values(starters).filter(Boolean));

  const load = async () => {
    if (!team?.id) return;
    try {
      const [squadData, formationData, lineupData] = await Promise.all([
        apiClient.listSeasonSquads({ teamId: team.id, seasonId: fixture.seasonId ?? undefined }),
        apiClient.listFormationTemplates({ sportId: fixture.sport?.id }),
        apiClient.listFixtureLineups(fixture.id),
      ]);
      setSquads(squadData); setFormations(formationData); setLineups(lineupData);
      const current = lineupData.find((item) => item.teamId === team.id);
      setSquadId(current?.seasonSquadId ?? squadData[0]?.id ?? ""); setFormationId(current?.formationId ?? formationData[0]?.id ?? ""); setStatus(current?.status ?? "not_available"); setCaptain(current?.captainPlayerId ?? "");
      setStarters(Object.fromEntries((current?.players ?? []).filter((item) => item.role === "starter" && item.slotIndex !== undefined).map((item) => [item.slotIndex!, item.playerId])));
      setSubstitutes((current?.players ?? []).filter((item) => item.role === "substitute").map((item) => item.playerId));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load lineup"); }
  };
  useEffect(() => { void load(); }, [fixture.id, side]);
  useEffect(() => { if (!squadId) return; void apiClient.listSquadPlayers(squadId).then((members) => Promise.all(members.filter((item) => item.status === "active").map((item) => apiClient.getPlayer(item.playerId)))).then(setPlayers).catch(() => setMessage("Unable to load squad players")); }, [squadId]);
  const assignSlot = (index: number, playerId: string) => setStarters((current) => { const next = { ...current }; Object.keys(next).forEach((key) => { if (next[Number(key)] === playerId) delete next[Number(key)]; }); if (playerId) next[index] = playerId; else delete next[index]; return next; });
  const save = async () => { if (!team?.id || !squadId || !formationId || saving) return; if (status === "confirmed" && Object.keys(starters).length !== (formation?.positions.length ?? 0)) { setMessage("Complete the starting XI before confirming the lineup."); return; } setSaving(true); setMessage("Saving lineup..."); try { const result = await apiClient.saveFixtureLineup(fixture.id, { teamId: team.id, seasonSquadId: squadId, formationId, status, starters: Object.entries(starters).map(([slotIndex, playerId]) => ({ slotIndex: Number(slotIndex), playerId })), substitutes: substitutes.filter((id) => !starterIds.has(id)), captainPlayerId: captain || null }, accessToken); setLineups((items) => [...items.filter((item) => item.teamId !== team.id), result]); setMessage("Lineup saved"); } catch (error) { setMessage(error instanceof Error ? error.message : "Lineup save failed"); } finally { setSaving(false); } };
  return <section className="console-panel fixture-lineup-editor"><div className="panel-heading"><h3>Lineups</h3><span className="status-pill">{message}</span></div><div className="lineup-tabs"><button type="button" className={side === "home" ? "selected" : "secondary"} onClick={() => setSide("home")}>{fixture.homeTeam?.name} Lineup</button><button type="button" className={side === "away" ? "selected" : "secondary"} onClick={() => setSide("away")}>{fixture.awayTeam?.name} Lineup</button></div><div className="form-grid three-column"><label>Season Squad<select value={squadId} onChange={(event) => setSquadId(event.target.value)}><option value="">Select squad</option>{squads.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Formation<select value={formationId} onChange={(event) => setFormationId(event.target.value)}><option value="">Select formation</option>{formations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Lineup Status<select value={status} onChange={(event) => setStatus(event.target.value as FixtureLineup["status"])}><option value="not_available">Not Available</option><option value="possible">Possible</option><option value="confirmed">Confirmed</option></select></label></div>{formation ? <div className="lineup-pitch-grid">{formation.positions.map((slot, index) => <label className="lineup-slot" key={`${index}-${slot.label ?? "slot"}`}><span>{slot.label ?? `Slot ${index + 1}`}</span><select value={starters[index] ?? ""} onChange={(event) => assignSlot(index, event.target.value)}><option value="">Unassigned</option>{players.filter((player) => !starterIds.has(player.id) || starters[index] === player.id).map((player) => <option key={player.id} value={player.id}>{player.jerseyNumber ?? "-"} {player.displayName}</option>)}</select></label>)}</div> : <p>Select a formation to assign starters.</p>}<label>Captain<select value={captain} onChange={(event) => setCaptain(event.target.value)}><option value="">No captain</option>{players.filter((player) => starterIds.has(player.id)).map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label><label>Substitutes<select multiple value={substitutes.filter((id) => !starterIds.has(id))} onChange={(event) => setSubstitutes(Array.from(event.target.selectedOptions, (option) => option.value))}>{players.filter((player) => !starterIds.has(player.id)).map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label><div className="button-row"><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving lineup..." : "Save lineup"}</button></div></section>;
}
