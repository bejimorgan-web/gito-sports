import React, { useEffect, useMemo, useState } from "react";
import type { Player, PlayerAvailability, PlayerPosition, Season, SeasonSquad, Sport, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";

const positions: PlayerPosition[] = ["goalkeeper", "defender", "midfielder", "forward", "winger", "striker", "fullback", "center-back", "attacking-midfielder", "defensive-midfielder", "custom"];
const availabilities: PlayerAvailability[] = ["available", "injured", "suspended", "unavailable"];

export function SquadManagementScreen({ accessToken }: { accessToken: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [squads, setSquads] = useState<SeasonSquad[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamId, setTeamId] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [squadId, setSquadId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [name, setName] = useState("");
  const [shirtNumber, setShirtNumber] = useState("");
  const [playerPosition, setPlayerPosition] = useState<PlayerPosition>("forward");
  const [photoUrl, setPhotoUrl] = useState("");
  const [playerStatus, setPlayerStatus] = useState<"active" | "inactive" | "archived">("active");
  const [availability, setAvailability] = useState<PlayerAvailability>("available");
  const [injuryType, setInjuryType] = useState("");
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [injuryNotes, setInjuryNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");

  const selectedTeam = teams.find((team) => team.id === teamId);
  const selectedSport = sports.find((sport) => sport.id === selectedTeam?.sportId);
  const selectedSquad = squads.find((squad) => squad.id === squadId);
  const selectedSeason = seasons.find((season) => season.id === seasonId);
  const visibleTeams = teams.filter((team) => team.name.toLowerCase().includes(teamSearch.trim().toLowerCase()));

  const loadPlayers = async (nextSquadId = squadId) => {
    if (!nextSquadId) { setPlayers([]); return; }
    setIsLoading(true);
    try {
      const memberships = await apiClient.listSquadPlayers(nextSquadId);
      const result = await Promise.all(memberships.filter((membership) => membership.status === "active").map((membership) => apiClient.getPlayer(membership.playerId)));
      setPlayers(result.filter(Boolean) as Player[]);
      setMessage("Loaded");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to load players"); }
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    setMessage("Loading teams...");
    void Promise.all([apiClient.listTeams(), apiClient.listSports()]).then(([teamData, sportData]) => { setTeams(teamData); setSports(sportData); setMessage("Select a team"); }).catch(() => setMessage("Failed to load teams"));
  }, []);
  useEffect(() => {
    setSeasonId(""); setSquadId(""); setSeasons([]); setSquads([]); setPlayers([]);
    if (!teamId) return;
    setMessage("Loading seasons...");
    void apiClient.listCompetitions().then(async (competitions) => {
      const contexts = (await Promise.all(competitions.map(async (competition) => {
        const competitionSeasons = await apiClient.listSeasons(competition.id);
        const validSeasons = (await Promise.all(competitionSeasons.map(async (season) => {
          const members = await apiClient.listSeasonTeams(competition.id, season.id);
          return members.some((member) => member.teamId === teamId) ? season : null;
        }))).filter((season): season is Season => Boolean(season));
        return validSeasons;
      }))).flat();
      const uniqueSeasons = [...new Map(contexts.map((season) => [season.id, season])).values()];
      setSeasons(uniqueSeasons); setSeasonId(uniqueSeasons[0]?.id ?? ""); setMessage(uniqueSeasons.length ? "Select a season" : "No seasons available for this team");
    }).catch(() => setMessage("Failed to load seasons"));
  }, [teamId]);
  useEffect(() => {
    setSquadId(""); setSquads([]); setPlayers([]);
    if (!teamId || !seasonId) return;
    setMessage("Loading squad...");
    void apiClient.listSeasonSquads({ teamId, seasonId }).then((data) => { setSquads(data); setSquadId(data[0]?.id ?? ""); if (!data.length) setMessage("No squad exists for this season"); }).catch(() => setMessage("Failed to load season squad"));
  }, [seasonId, teamId]);
  useEffect(() => { void loadPlayers(); }, [squadId]);

  const createSquad = async () => {
    if (!teamId || !seasonId || !selectedSeason || isSaving) return;
    setIsSaving(true); setMessage("Saving...");
    try { const created = await apiClient.createSeasonSquad({ teamId, seasonId, competitionId: selectedSeason.competitionId, name: `${selectedTeam?.name ?? "Team"} ${selectedSeason.name} Squad` }, accessToken); setSquads([created]); setSquadId(created.id); setMessage("Squad created"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Squad creation failed"); }
    finally { setIsSaving(false); }
  };

  const visiblePlayers = useMemo(() => players.filter((player) =>
    (!search || `${player.displayName} ${player.firstName} ${player.lastName}`.toLowerCase().includes(search.toLowerCase())) &&
    (!position || player.position === position) && (!statusFilter || player.status === statusFilter) && (!availabilityFilter || player.availability === availabilityFilter)
  ), [availabilityFilter, players, position, search, statusFilter]);

  const clearEditor = () => { setEditing(null); setName(""); setShirtNumber(""); setPlayerPosition("forward"); setPhotoUrl(""); setPlayerStatus("active"); setAvailability("available"); setInjuryType(""); setExpectedReturnDate(""); setInjuryNotes(""); };
  const editPlayer = (player: Player) => { setEditing(player); setName(player.displayName); setShirtNumber(player.jerseyNumber?.toString() ?? ""); setPlayerPosition(player.position ?? "forward"); setPhotoUrl(player.photoUrl ?? ""); setPlayerStatus(player.status as typeof playerStatus); setAvailability(player.availability); setInjuryType(player.injuryType ?? ""); setExpectedReturnDate(player.expectedReturnDate ?? ""); setInjuryNotes(player.injuryNotes ?? ""); };

  const savePlayer = async () => {
    if (!teamId || !squadId || !name.trim() || isSaving) { setMessage("Team, season squad, and player name are required"); return; }
    setIsSaving(true); setMessage("Saving...");
    try {
      const parts = name.trim().split(/\s+/); const firstName = parts.shift() ?? name.trim(); const lastName = parts.join(" ") || firstName;
      const payload = { teamId, firstName, lastName, displayName: name.trim(), position: playerPosition, ...(shirtNumber ? { jerseyNumber: Number(shirtNumber) } : {}), ...(photoUrl ? { photoUrl } : {}), status: playerStatus, availability, ...(availability === "injured" ? { ...(injuryType ? { injuryType } : {}), ...(expectedReturnDate ? { expectedReturnDate } : {}), ...(injuryNotes ? { injuryNotes } : {}) } : {}) };
      const saved = editing ? await apiClient.updatePlayer(editing.id, payload, accessToken) : await apiClient.createPlayer(payload, accessToken);
      if (!editing) await apiClient.createSquadPlayer(squadId, { playerId: saved.id, role: "starter", position: playerPosition, ...(shirtNumber ? { jerseyNumber: Number(shirtNumber) } : {}) }, accessToken);
      await loadPlayers(); clearEditor(); setMessage(editing ? "Saved" : "Player created");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setIsSaving(false); }
  };

  const removePlayer = async (player: Player) => {
    if (removingId || !squadId) return;
    const membership = (await apiClient.listSquadPlayers(squadId)).find((item) => item.playerId === player.id);
    if (!membership) return;
    setRemovingId(player.id); setMessage("Removing...");
    try { await apiClient.removeSquadPlayer(membership.id, accessToken); await loadPlayers(); setMessage("Removed"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Remove failed"); }
    finally { setRemovingId(null); }
  };

  return <section className="screen-stack">
    <header className="screen-header"><p className="eyebrow">Teams / Squad</p><h2>Season Squad & Players</h2><span>Manage players in one selected team and season squad.</span></header>
    <section className="console-panel">
      <div className="panel-heading"><h3>Squad context</h3><span className="status-pill">{message}</span></div>
      <div className="form-grid two-column">
        <label>Team Search<input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search teams" /></label>
        <label>Team<select value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">Select team</option>{visibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Season<select value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={!teamId}><option value="">Select season</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
        <label>Season Squad<select value={squadId} onChange={(event) => setSquadId(event.target.value)} disabled={!seasonId}><option value="">Select season squad</option>{squads.map((squad) => <option key={squad.id} value={squad.id}>{squad.name}</option>)}</select></label>
      </div>
      <small>{selectedSport?.name ?? "Sport unavailable"} {selectedSeason ? `· ${selectedSeason.name}` : ""} {selectedSquad ? `· ${selectedSquad.name}` : ""}</small>
      {teamId && seasonId && !squads.length ? <div className="button-row"><button type="button" onClick={() => void createSquad()} disabled={isSaving}>{isSaving ? "Saving..." : "Create squad"}</button></div> : null}
    </section>
    <section className="console-panel">
      <div className="panel-heading"><h3>{editing ? "Edit Player" : "Add Player"}</h3><button type="button" onClick={clearEditor} className="secondary">Clear</button></div>
      <div className="form-grid two-column">
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Player name" /></label>
        <label>Shirt Number<input inputMode="numeric" value={shirtNumber} onChange={(event) => setShirtNumber(event.target.value)} /></label>
        <label>Position<select value={playerPosition} onChange={(event) => setPlayerPosition(event.target.value as PlayerPosition)}>{positions.map((item) => <option key={item} value={item}>{item.replaceAll("-", " ")}</option>)}</select></label>
        <label>Photo URL<input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="https://..." /></label>
        <label>Status<select value={playerStatus} onChange={(event) => setPlayerStatus(event.target.value as typeof playerStatus)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
        <label>Availability<select value={availability} onChange={(event) => setAvailability(event.target.value as PlayerAvailability)}>{availabilities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {availability === "injured" ? <><label>Injury<input value={injuryType} onChange={(event) => setInjuryType(event.target.value)} /></label><label>Expected Return<input type="date" value={expectedReturnDate} onChange={(event) => setExpectedReturnDate(event.target.value)} /></label><label>Notes<textarea value={injuryNotes} onChange={(event) => setInjuryNotes(event.target.value)} /></label></> : null}
      </div>
      <div className="button-row"><button type="button" onClick={savePlayer} disabled={isSaving}>{isSaving ? "Saving..." : editing ? "Save Player" : "Save Player"}</button></div>
    </section>
    <section className="console-panel">
      <div className="panel-heading"><h3>{selectedTeam?.name ?? "Players"}</h3><span>{isLoading ? "Loading..." : `${visiblePlayers.length} players`}</span></div>
      <div className="form-grid four-column"><label>Search player<input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="">All positions</option>{positions.map((item) => <option key={item} value={item}>{item.replaceAll("-", " ")}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label><label>Availability<select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="">All availability</option>{availabilities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
      <div className="entity-table"><table><thead><tr><th>Number</th><th>Player</th><th>Position</th><th>Status</th><th>Availability</th><th>Actions</th></tr></thead><tbody>{visiblePlayers.map((player) => <tr key={player.id}><td>{player.jerseyNumber ?? "-"}</td><td>{player.displayName}</td><td>{player.position?.replaceAll("-", " ") ?? "-"}</td><td>{player.status}</td><td><span className={`availability-indicator availability-${player.availability}`}>{player.availability}</span></td><td><button type="button" onClick={() => editPlayer(player)}>Edit</button><button type="button" className="secondary" onClick={() => void removePlayer(player)} disabled={Boolean(removingId)}>{removingId === player.id ? "Removing..." : "Remove from Squad"}</button></td></tr>)}</tbody></table></div>
    </section>
  </section>;
}
