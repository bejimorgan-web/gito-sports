import { useEffect, useRef, useState } from "react";
import type { Competition, Host, Season, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { normalizeCsvName } from "../../services/csv-files";
import { downloadExcel, parseExcelFile } from "../../services/excel-files";

interface Props {
  teams: Team[];
  hosts: Host[];
  competitions: Competition[];
  selectedSportId: string;
  accessToken: string;
}

export function SeasonMembershipPanel({ teams, hosts, competitions, selectedSportId, accessToken }: Props) {
  const clubs = teams.filter((team) => team.sportId === selectedSportId && (team.type === "club" || team.type === "national"));
  const [hostId, setHostId] = useState("all");
  const sportCompetitions = competitions.filter((competition) => competition.sportId === selectedSportId && (competition.participantType === "clubs" || competition.participantType === "nationalTeams"));
  const [teamId, setTeamId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [seasonStartsAt, setSeasonStartsAt] = useState("");
  const [seasonEndsAt, setSeasonEndsAt] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [members, setMembers] = useState<Array<{ team?: Team; teamId: string }>>([]);
  const [competitionMembers, setCompetitionMembers] = useState<Team[]>([]);
  const [status, setStatus] = useState("Ready");
  const [isSavingSeason, setIsSavingSeason] = useState(false);
  const [hostTeams, setHostTeams] = useState<Team[]>([]);
  const [isImportingRoster, setIsImportingRoster] = useState(false);
  const seasonRosterFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTeamId("");
    setHostId("all");
    setCompetitionId("");
    setSeasonId("");
    setSeasons([]);
    setMembers([]);
    setCompetitionMembers([]);
  }, [selectedSportId]);

  const visibleClubs = hostId === "all" ? clubs : clubs.filter((team) => team.hostId === hostId);
  const selectedCompetition = sportCompetitions.find((competition) => competition.id === competitionId);

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
    if (!selectedCompetition?.hostId) { setHostTeams([]); return; }
    const type = selectedCompetition.participantType === "nationalTeams" ? "national" : "club";
    void apiClient.listTeams("legacy", { sportId: selectedSportId, hostId: selectedCompetition.hostId, type })
      .then(setHostTeams)
      .catch(() => { setHostTeams([]); setStatus("Unable to load the competition host roster."); });
  }, [selectedCompetition?.hostId, selectedCompetition?.participantType, selectedSportId]);

  useEffect(() => {
    if (!competitionId || !seasonId) {
      setMembers([]);
      return;
    }
    void apiClient.listSeasonTeams(competitionId, seasonId).then(setMembers).catch(() => setStatus("Unable to load season memberships."));
  }, [competitionId, seasonId]);

  const addCompetitionMembership = async () => {
    if (!competitionId || !teamId) return;
    try {
      await apiClient.addTeamToCompetition(competitionId, teamId, accessToken);
      setCompetitionMembers(await apiClient.listCompetitionTeams(competitionId));
      setStatus("Competition membership added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to add membership."); }
  };

  const createSeason = async () => {
    if (!competitionId || !seasonName.trim()) return;
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
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to create season."); }
    finally { setIsSavingSeason(false); }
  };

  const addSeasonMembership = async () => {
    if (!competitionId || !seasonId || !teamId) return;
    try {
      await apiClient.addSeasonTeam(competitionId, seasonId, teamId, accessToken);
      setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
      setStatus("Season membership added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to add season membership."); }
  };

  const removeSeasonMembership = async (memberTeamId: string) => {
    if (!competitionId || !seasonId) return;
    try {
      await apiClient.removeSeasonTeam(competitionId, seasonId, memberTeamId, accessToken);
      setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
      setStatus("Season membership removed.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to remove season membership."); }
  };

  const exportSeasonRoster = () => {
    if (!selectedCompetition?.hostId || !seasonId) { setStatus("Select a hosted competition and season first."); return; }
    const host = hosts.find((item) => item.id === selectedCompetition.hostId);
    const season = seasons.find((item) => item.id === seasonId);
    const safeName = `${host?.name ?? "host"}-${season?.name ?? "season"}`.replace(/[^a-z0-9-_]+/gi, "-");
    downloadExcel(`${safeName}-team-roster.xlsx`, "Teams", "Competition season team list", ["Team ID", "Team Name", "Team Type"], hostTeams.map((team) => ({ "Team ID": team.id, "Team Name": team.name, "Team Type": team.type })), "Keep the existing team names exactly as shown. Remove rows for teams that should not participate, or leave the team list as required. Uploading replaces this season's team list; teams must already be registered under the competition host.");
    setStatus(`Exported ${hostTeams.length} host teams. Importing this file sets the season's exact team list.`);
  };

  const importSeasonRoster = async (file?: File) => {
    if (!file || !selectedCompetition || !seasonId) return;
    setIsImportingRoster(true);
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) throw new Error("Add at least one team row before importing a season roster.");
      if (!rows.every((row) => "team name" in row || "team_name" in row)) throw new Error("Season roster workbook must include the Team Name column.");
      const names = new Set<string>();
      const ids = rows.map((row) => {
        const teamName = row["team name"] ?? row.team_name ?? "";
        const normalized = normalizeCsvName(teamName);
        if (!normalized) throw new Error("Every season roster row needs a team_name.");
        if (names.has(normalized)) throw new Error(`Duplicate team name in workbook: ${teamName}`);
        names.add(normalized);
        const team = hostTeams.find((candidate) => normalizeCsvName(candidate.name) === normalized);
        if (!team) throw new Error(`Team is not registered under this competition's host: ${teamName}`);
        return team.id;
      });
      if (!window.confirm(`Replace the ${seasons.find((season) => season.id === seasonId)?.name ?? "selected season"} team list with these ${ids.length} teams?`)) return;
      const result = await apiClient.replaceSeasonTeams(competitionId, seasonId, ids, accessToken);
      setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
      setCompetitionMembers(await apiClient.listCompetitionTeams(competitionId));
      setStatus(`Season roster set: ${result.count} teams assigned.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to import season roster."); }
    finally { setIsImportingRoster(false); if (seasonRosterFileRef.current) seasonRosterFileRef.current.value = ""; }
  };

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>Competition & Season Membership</h3>
        <span className="status-pill">{status}</span>
      </div>
      <div className="form-grid two-column">
        <label>
          Host
          <select value={hostId} onChange={(event) => { setHostId(event.target.value); setTeamId(""); }}>
            <option value="all">All hosts</option>
            {hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
          </select>
        </label>
        <label>
          {selectedCompetition?.participantType === "nationalTeams" ? "National team" : "Club"}
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Select club</option>
            {visibleClubs.filter((team) => !selectedCompetition || (selectedCompetition.participantType === "nationalTeams" ? team.type === "national" : team.type === "club")).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label>
          Competition
          <select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setSeasonId(""); }}>
            <option value="">Select competition</option>
            {sportCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
          </select>
        </label>
        <label>
          Season
          <select value={seasonId} onChange={(event) => setSeasonId(event.target.value)} disabled={!competitionId}>
            <option value="">Select season</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>
        <label>
          New season
          <div className="button-row">
            <input value={seasonName} onChange={(event) => setSeasonName(event.target.value)} placeholder="2026/27" />
            <input type="date" value={seasonStartsAt} onChange={(event) => setSeasonStartsAt(event.target.value)} aria-label="Season start" />
            <input type="date" value={seasonEndsAt} onChange={(event) => setSeasonEndsAt(event.target.value)} aria-label="Season end" />
            <button type="button" onClick={() => void createSeason()} disabled={isSavingSeason || !competitionId || !seasonName.trim()}>{isSavingSeason ? "Saving…" : "Create"}</button>
          </div>
        </label>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => void addCompetitionMembership()} disabled={!teamId || !competitionId || competitionMembers.some((team) => team.id === teamId)}>Add competition membership</button>
        <button type="button" onClick={() => void addSeasonMembership()} disabled={!teamId || !competitionId || !seasonId || members.some((member) => member.teamId === teamId)}>Add season membership</button>
      </div>
      {competitionId && seasonId ? <div className="button-row">
        <button type="button" className="secondary" onClick={exportSeasonRoster} disabled={!selectedCompetition?.hostId}>Export Host Roster Excel</button>
        <button type="button" className="secondary" onClick={() => seasonRosterFileRef.current?.click()} disabled={!selectedCompetition?.hostId || isImportingRoster}>{isImportingRoster ? "Importing…" : "Import Season Roster Excel"}</button>
        <input ref={seasonRosterFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void importSeasonRoster(event.target.files?.[0])} />
        <span className="field-note">The imported names replace this season’s team list; names must match the host roster.</span>
      </div> : null}
      {seasonId ? (
        <div className="entity-list">
          {members.map((member) => (
            <div className="entity-list-item" key={member.teamId}>
              <span>{member.team?.name ?? member.teamId}</span>
              <button type="button" className="secondary" onClick={() => void removeSeasonMembership(member.teamId)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
