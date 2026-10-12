import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";

type Player = { id: string; name: string; teamId: string; teamName: string; jerseyNumber: number | null };
type EventRow = { id: string; minute: number; description: string; eventType: string; homeScore: number; awayScore: number };

export function ManualScoreEventsPanel({ matchId, version, finalResultConfirmed, homeTeam, awayTeam, accessToken, onScoreChanged }: {
  matchId: string; version: number; finalResultConfirmed: boolean; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string };
  accessToken: string; onScoreChanged: () => void;
}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [teamId, setTeamId] = useState(homeTeam.id);
  const [playerId, setPlayerId] = useState("");
  const [relatedPlayerId, setRelatedPlayerId] = useState("");
  const [eventType, setEventType] = useState("goal");
  const [minute, setMinute] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editedMinute, setEditedMinute] = useState(0);
  const [correctionReason, setCorrectionReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const teamPlayers = useMemo(() => players.filter((player) => player.teamId === teamId), [players, teamId]);

  const reload = async () => {
    const rows = await apiClient.listManualScoreEvents(matchId, accessToken);
    setEvents(rows);
  };
  useEffect(() => {
    let active = true;
    Promise.all([apiClient.listManualScoreEvents(matchId, accessToken), apiClient.listManualScorePlayers(matchId, accessToken)])
      .then(([rows, roster]) => { if (active) { setEvents(rows); setPlayers(roster); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load match events."); });
    return () => { active = false; };
  }, [accessToken, matchId]);

  const record = async () => {
    if (!playerId || (eventType === "substitution" && !relatedPlayerId)) return;
    setPending(true); setError(null); setNotice(null);
    try {
      await apiClient.recordManualScoreEvent(matchId, {
        version, minute, eventType, teamId, playerId,
        ...(relatedPlayerId ? { relatedPlayerId } : {})
      }, accessToken);
      await reload(); onScoreChanged(); setPlayerId(""); setRelatedPlayerId("");
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
      <label>Event<select value={eventType} disabled={pending} onChange={(event) => setEventType(event.target.value)}>
        <option value="goal">Goal</option><option value="yellow_card">Yellow card</option><option value="red_card">Red card</option>
        <option value="penalty_scored">Penalty scored</option><option value="penalty_missed">Penalty missed</option><option value="var_goal_disallowed">Goal disallowed by VAR</option>
        <option value="injury">Injury</option><option value="substitution">Substitution</option>
      </select></label>
      <label>Team<select value={teamId} disabled={pending} onChange={(event) => { setTeamId(event.target.value); setPlayerId(""); setRelatedPlayerId(""); }}>
        <option value={homeTeam.id}>{homeTeam.name}</option><option value={awayTeam.id}>{awayTeam.name}</option>
      </select></label>
      <label>{eventType === "substitution" ? "Player going off" : "Player"}<select value={playerId} disabled={pending} onChange={(event) => setPlayerId(event.target.value)}>
        <option value="">Choose player</option>{teamPlayers.map((player) => <option key={player.id} value={player.id}>{player.jerseyNumber ? `#${player.jerseyNumber} ` : ""}{player.name}</option>)}
      </select></label>
      {eventType === "goal" || eventType === "penalty_scored" || eventType === "substitution" ? <label>{eventType === "substitution" ? "Player coming on" : "Assist (optional)"}<select value={relatedPlayerId} disabled={pending} onChange={(event) => setRelatedPlayerId(event.target.value)}>
        <option value="">{eventType === "substitution" ? "Choose player" : "No assist"}</option>{teamPlayers.filter((player) => player.id !== playerId).map((player) => <option key={player.id} value={player.id}>{player.jerseyNumber ? `#${player.jerseyNumber} ` : ""}{player.name}</option>)}
      </select></label> : null}
      <label>Match minute<input type="number" min="0" max="150" value={minute} disabled={pending} onChange={(event) => setMinute(Number(event.target.value))} /></label>
      <button className="button-primary" type="button" disabled={pending || !playerId || (eventType === "substitution" && !relatedPlayerId)} onClick={() => void record()}>{pending ? "Saving…" : "Add event"}</button>
    </div>}
    {!finalResultConfirmed && players.length === 0 ? <p className="field-note">No eligible squad players were found for this fixture.</p> : null}
    {events.length ? <ol className="score-fixture-list">{events.map((event) => <li className="score-fixture-row" key={event.id}>
      {editing === event.id ? <><strong>{event.description}</strong><label>Correct minute<input aria-label="Correct event minute" type="number" min="0" max="150" value={editedMinute} disabled={pending} onChange={(input) => setEditedMinute(Number(input.target.value))} /></label>{finalResultConfirmed ? <label>Reason for event-time correction<textarea aria-label="Reason for event-time correction" value={correctionReason} maxLength={500} disabled={pending} onChange={(input) => setCorrectionReason(input.target.value)} /></label> : null}<button className="button-primary" type="button" disabled={pending || !Number.isInteger(editedMinute) || editedMinute < 0 || editedMinute > 150 || (finalResultConfirmed && !correctionReason.trim())} onClick={() => void saveMinute(event)}>Save time</button><button className="button-secondary" type="button" disabled={pending} onClick={() => { setEditing(null); setCorrectionReason(""); }}>Cancel</button></> : <><strong>{event.minute}′ · {event.description}</strong><span>{event.homeScore}–{event.awayScore}</span><button className="button-secondary" type="button" disabled={pending} onClick={() => { setEditing(event.id); setEditedMinute(event.minute); setCorrectionReason(""); }}>Edit time</button></>}
    </li>)}</ol> : <p className="field-note">Recorded events will appear here and in the mobile match details.</p>}
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}
