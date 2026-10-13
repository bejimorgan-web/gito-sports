import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";

type Player = { id: string; name: string; teamId: string; teamName: string; jerseyNumber: number | null };
type EventRow = { id: string; minute: number; description: string; eventType: string; homeScore: number; awayScore: number };
type EventChoice = "goal" | "yellow_card" | "red_card" | "var_yellow_card" | "var_red_card" | "penalty" | "var_penalty" | "var_goal_disallowed" | "injury";

function PlayerSearchSelect({ label, players, value, disabled, onChange }: {
  label: string; players: Player[]; value: string; disabled: boolean; onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = players.find((player) => player.id === value);
  useEffect(() => { setQuery(selected ? `${selected.jerseyNumber ? `#${selected.jerseyNumber} ` : ""}${selected.name}` : ""); }, [selected?.id, selected?.name, selected?.jerseyNumber]);
  const filtered = players.filter((player) => !query.trim() || `${player.name} ${player.jerseyNumber ?? ""}`.toLocaleLowerCase().includes(query.trim().replace(/^#/, "").toLocaleLowerCase()));
  return <label className="score-player-search">
    {label}
    <span className="score-player-search-control">
      <input aria-label={label} role="combobox" aria-expanded={open} aria-autocomplete="list" value={query} disabled={disabled}
        placeholder="Type a player name" onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && filtered[0]) { event.preventDefault(); onChange(filtered[0].id); setQuery(`${filtered[0].jerseyNumber ? `#${filtered[0].jerseyNumber} ` : ""}${filtered[0].name}`); setOpen(false); }
        }} />
      {open && !disabled ? <span className="score-player-options" role="listbox">
        {filtered.length ? filtered.map((player) => <button type="button" role="option" aria-selected={player.id === value} key={player.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(player.id); setQuery(`${player.jerseyNumber ? `#${player.jerseyNumber} ` : ""}${player.name}`); setOpen(false); }}>
          <span>{player.name}</span><small>{player.jerseyNumber ? `#${player.jerseyNumber}` : player.teamName}</small>
        </button>) : <span className="score-player-no-results">No matching players</span>}
      </span> : null}
    </span>
  </label>;
}

export function ManualScoreEventsPanel({ matchId, version, finalResultConfirmed, homeTeam, awayTeam, accessToken, onScoreChanged }: {
  matchId: string; version: number; finalResultConfirmed: boolean; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string };
  accessToken: string; onScoreChanged: () => void;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [teamId, setTeamId] = useState(homeTeam.id);
  const [playerId, setPlayerId] = useState("");
  const [relatedPlayerId, setRelatedPlayerId] = useState("");
  const [eventType, setEventType] = useState<EventChoice>("goal");
  const [penaltyOutcome, setPenaltyOutcome] = useState<"goal" | "missed">("goal");
  const [minute, setMinute] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editedMinute, setEditedMinute] = useState(0);
  const [correctionReason, setCorrectionReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const teamPlayers = useMemo(() => players.filter((player) => player.teamId === teamId), [players, teamId]);
  const isPenalty = eventType === "penalty" || eventType === "var_penalty";
  const resolvedEventType = isPenalty ? `${eventType === "var_penalty" ? "var_" : ""}penalty_${penaltyOutcome === "goal" ? "scored" : "missed"}` : eventType;

  const reload = async () => { setEvents(await apiClient.listManualScoreEvents(matchId, accessToken)); };
  useEffect(() => {
    let active = true;
    Promise.all([apiClient.listManualScoreEvents(matchId, accessToken), apiClient.listManualScorePlayers(matchId, accessToken)])
      .then(([rows, roster]) => { if (active) { setEvents(rows); setPlayers(roster); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load match events."); });
    return () => { active = false; };
  }, [accessToken, matchId]);

  const record = async () => {
    if (!playerId) return;
    setPending(true); setError(null); setNotice(null);
    try {
      await apiClient.recordManualScoreEvent(matchId, {
        version, minute, eventType: resolvedEventType, teamId, playerId,
        ...(eventType === "goal" && relatedPlayerId ? { relatedPlayerId } : {})
      }, accessToken);
      await reload(); onScoreChanged(); setPlayerId(""); setRelatedPlayerId(""); setPenaltyOutcome("goal");
      setNotice("Event saved. The match clock continues independently.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save event."); }
    finally { setPending(false); }
  };

  const saveMinute = async (event: EventRow) => {
    if (!Number.isInteger(editedMinute) || editedMinute < 0 || editedMinute > 150) return;
    setPending(true); setError(null);
    try {
      await apiClient.updateManualScoreEventMinute(matchId, event.id, { version, minute: editedMinute, ...(finalResultConfirmed ? { reason: correctionReason.trim() } : {}) }, accessToken);
      await reload(); setEditing(null); setCorrectionReason(""); onScoreChanged(); setNotice("Event time corrected and audited. The score and full-time status were preserved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not correct event time."); }
    finally { setPending(false); }
  };

  return <section className="score-control-info" aria-label="Match events">
    <strong>Match events</strong><span>Record player actions at their match minute; event-time corrections never change the live clock or score.</span>
    {finalResultConfirmed ? <p className="field-note">This result is confirmed. Existing event times can be corrected with a reason. Reopen the result before adding a missing event that affects the score.</p> : <div className="score-filter-row">
      <label>Event<select value={eventType} disabled={pending} onChange={(event) => { setEventType(event.target.value as EventChoice); setRelatedPlayerId(""); setPenaltyOutcome("goal"); }}>
        <option value="goal">Goal</option><option value="yellow_card">Yellow card</option><option value="red_card">Red card</option>
        <option value="var_yellow_card">Yellow card after VAR review</option><option value="var_red_card">Red card after VAR review</option>
        <option value="penalty">Penalty</option><option value="var_penalty">Penalty awarded by VAR</option><option value="var_goal_disallowed">Goal disallowed by VAR</option><option value="injury">Injury</option>
      </select></label>
      {isPenalty ? <label>Penalty outcome<select value={penaltyOutcome} disabled={pending} onChange={(event) => setPenaltyOutcome(event.target.value as "goal" | "missed")}><option value="goal">Goal</option><option value="missed">Missed</option></select></label> : null}
      <label>Team<select value={teamId} disabled={pending} onChange={(event) => { setTeamId(event.target.value); setPlayerId(""); setRelatedPlayerId(""); }}>
        <option value={homeTeam.id}>{homeTeam.name}</option><option value={awayTeam.id}>{awayTeam.name}</option>
      </select></label>
      <PlayerSearchSelect label={isPenalty ? "Penalty taker" : eventType === "goal" ? "Goal scorer" : "Player"} players={teamPlayers} value={playerId} disabled={pending} onChange={setPlayerId} />
      {eventType === "goal" ? <PlayerSearchSelect label="Assist (optional)" players={teamPlayers.filter((player) => player.id !== playerId)} value={relatedPlayerId} disabled={pending} onChange={setRelatedPlayerId} /> : null}
      <label>Match minute<input type="number" min="0" max="150" value={minute} disabled={pending} onChange={(event) => setMinute(Number(event.target.value))} /></label>
      <button className="button-primary" type="button" disabled={pending || !playerId} onClick={() => void record()}>{pending ? "Saving…" : "Add event"}</button>
    </div>}
    {!finalResultConfirmed && players.length === 0 ? <p className="field-note">No eligible squad players were found for this fixture.</p> : null}
    {events.length ? <ol className="score-fixture-list">{events.map((event) => <li className="score-fixture-row" key={event.id}>
      {editing === event.id ? <><strong>{event.description}</strong><label>Correct minute<input aria-label="Correct event minute" type="number" min="0" max="150" value={editedMinute} disabled={pending} onChange={(input) => setEditedMinute(Number(input.target.value))} /></label>{finalResultConfirmed ? <label>Reason for event-time correction<textarea aria-label="Reason for event-time correction" value={correctionReason} maxLength={500} disabled={pending} onChange={(input) => setCorrectionReason(input.target.value)} /></label> : null}<button className="button-primary" type="button" disabled={pending || !Number.isInteger(editedMinute) || editedMinute < 0 || editedMinute > 150 || (finalResultConfirmed && !correctionReason.trim())} onClick={() => void saveMinute(event)}>Save time</button><button className="button-secondary" type="button" disabled={pending} onClick={() => { setEditing(null); setCorrectionReason(""); }}>Cancel</button></> : <><strong>{event.minute}′ · {event.description}</strong><span>{event.homeScore}–{event.awayScore}</span><button className="button-secondary" type="button" disabled={pending} onClick={() => { setEditing(event.id); setEditedMinute(event.minute); setCorrectionReason(""); }}>Edit time</button></>}
    </li>)}</ol> : <p className="field-note">Recorded events will appear here and in the mobile match details.</p>}
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}