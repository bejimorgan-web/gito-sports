import { useEffect, useState } from "react";
import type { Competition, Season, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";

interface Props {
  teams: Team[];
  competitions: Competition[];
  selectedSportId: string;
}

export function SeasonMembershipPanel({ teams, competitions, selectedSportId }: Props) {
  const clubs = teams.filter((team) => team.sportId === selectedSportId && team.type === "club");
  const sportCompetitions = competitions.filter((competition) => competition.sportId === selectedSportId && competition.participantType === "clubs");
  const [teamId, setTeamId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [members, setMembers] = useState<Array<{ team?: Team; teamId: string }>>([]);
  const [competitionMembers, setCompetitionMembers] = useState<Team[]>([]);
  const [status, setStatus] = useState("Ready");

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
    if (!competitionId || !teamId) return;
    try {
      await apiClient.addTeamToCompetition(competitionId, teamId);
      setCompetitionMembers(await apiClient.listCompetitionTeams(competitionId));
      setStatus("Competition membership added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to add membership."); }
  };

  const createSeason = async () => {
    if (!competitionId || !seasonName.trim()) return;
    try {
      const season = await apiClient.createSeason(competitionId, { name: seasonName.trim() });
      setSeasons(await apiClient.listSeasons(competitionId));
      setSeasonId(season.id);
      setSeasonName("");
      setStatus("Season created.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to create season."); }
  };

  const addSeasonMembership = async () => {
    if (!competitionId || !seasonId || !teamId) return;
    try {
      await apiClient.addSeasonTeam(competitionId, seasonId, teamId);
      setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
      setStatus("Season membership added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to add season membership."); }
  };

  const removeSeasonMembership = async (memberTeamId: string) => {
    if (!competitionId || !seasonId) return;
    try {
      await apiClient.removeSeasonTeam(competitionId, seasonId, memberTeamId);
      setMembers(await apiClient.listSeasonTeams(competitionId, seasonId));
      setStatus("Season membership removed.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to remove season membership."); }
  };

  return (
    <section className="console-panel">
      <div className="panel-heading">
        <h3>Competition & Season Membership</h3>
        <span className="status-pill">{status}</span>
      </div>
      <div className="form-grid two-column">
        <label>
          Club
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Select club</option>
            {clubs.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
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
            <button type="button" onClick={() => void createSeason()} disabled={!competitionId || !seasonName.trim()}>Create</button>
          </div>
        </label>
      </div>
      <div className="button-row">
        <button type="button" onClick={() => void addCompetitionMembership()} disabled={!teamId || !competitionId || competitionMembers.some((team) => team.id === teamId)}>Add competition membership</button>
        <button type="button" onClick={() => void addSeasonMembership()} disabled={!teamId || !competitionId || !seasonId || members.some((member) => member.teamId === teamId)}>Add season membership</button>
      </div>
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
