import { useEffect, useState } from "react";

import type { Competition, Country, Sport, Team } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import StreamStatusPanel from "./StreamStatusPanel";

interface MatchSchedulerScreenProps {
  selectedMatchId?: string | undefined;
}

export function MatchSchedulerScreen({ selectedMatchId: externalSelectedMatchId }: MatchSchedulerScreenProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedSport, setSelectedSport] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCompetition, setSelectedCompetition] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [kickoff, setKickoff] = useState("");
  const [matches, setMatches] = useState<any[]>([]);
  const [status, setStatus] = useState("Ready");
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(externalSelectedMatchId);

  const load = async () => {
    try {
      const [competitionData, sportData, countryData, matchData] = await Promise.all([
        apiClient.listCompetitions(),
        apiClient.listSports(),
        apiClient.listCountries(),
        apiClient.listMatches()
      ]);

      setCompetitions(competitionData);
      setSports(sportData);
      setCountries(countryData);
      setMatches(matchData);
    } catch {
      setStatus("Unable to load data");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedCompetitionObject = competitions.find((competition) => competition.id === selectedCompetition);
  const filteredCompetitions = competitions.filter((competition) => {
    if (selectedSport && competition.sportId !== selectedSport) {
      return false;
    }

    if (selectedCountry && competition.countryId !== selectedCountry) {
      return false;
    }

    return true;
  });

  const teamOptions = selectedCompetitionObject
    ? teams.filter((team) =>
        selectedCompetitionObject.participantType === "nationalTeams"
          ? team.type === "national"
          : team.type === "club"
      )
    : teams;

  useEffect(() => {
    if (!selectedCompetition) {
      setTeams([]);
      return;
    }

    void apiClient.listCompetitionTeams(selectedCompetition).then(setTeams).catch(() => setTeams([]));
  }, [selectedCompetition]);

  useEffect(() => {
    if (externalSelectedMatchId) {
      setSelectedMatchId(externalSelectedMatchId);
    }
  }, [externalSelectedMatchId]);

  const createMatch = async () => {
    if (!selectedCompetition || !homeTeam || !awayTeam || !kickoff) {
      setStatus("All fields are required");
      return;
    }

    if (homeTeam === awayTeam) {
      setStatus("Home and away must differ");
      return;
    }

    try {
      await apiClient.createMatch({ competitionId: selectedCompetition, homeTeamId: homeTeam, awayTeamId: awayTeam, kickoffTime: kickoff });
      setStatus("Match created");
      void load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Create failed");
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Matches</p>
        <h2>Match Scheduler</h2>
        <span>Schedule matches using existing competitions and teams.</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16 }}>
        <div>
          <section className="console-panel">
            <div className="panel-heading">
              <h3>Create Match</h3>
              <span className="status-pill">{status}</span>
            </div>

            <div className="hierarchy-steps">
              <span>Sport</span>
              <span>Country</span>
              <span>Competition</span>
              <span>Participants</span>
            </div>

            <div className="form-grid two-column">
              <label>
                Sport
                <select value={selectedSport} onChange={(e) => {
                  setSelectedSport(e.target.value);
                  setSelectedCompetition("");
                  setHomeTeam("");
                  setAwayTeam("");
                }}>
                  <option value="">All sports</option>
                  {sports.map((sport) => (
                    <option key={sport.id} value={sport.id}>{sport.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Country
                <select value={selectedCountry} onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setSelectedCompetition("");
                  setHomeTeam("");
                  setAwayTeam("");
                }}>
                  <option value="">All countries</option>
                  {countries.map((country) => (
                    <option key={country.id} value={country.id}>{country.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Competition
                <select value={selectedCompetition} onChange={(e) => {
                  setSelectedCompetition(e.target.value);
                  setHomeTeam("");
                  setAwayTeam("");
                }}>
                  <option value="">Select competition</option>
                  {filteredCompetitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.participantType === "clubs" ? "Clubs" : "National Teams"})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Home Team
                <select value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)}>
                  <option value="">Select home team</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Away Team
                <select value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)}>
                  <option value="">Select away team</option>
                  {teamOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Kickoff (ISO)
                <input value={kickoff} onChange={(e) => setKickoff(e.target.value)} placeholder="2026-05-30T15:00:00Z" />
              </label>
            </div>

            <div className="button-row">
              <button type="button" onClick={createMatch}>Create Match</button>
            </div>
          </section>

          <section className="console-panel" style={{ marginTop: 16 }}>
            <div className="panel-heading">
              <h3>Matches</h3>
              <span>{matches.length} matches</span>
            </div>

            <div className="entity-table">
              <table>
                <thead>
                  <tr>
                    <th>Competition</th>
                    <th>Home</th>
                    <th>Away</th>
                    <th>Kickoff</th>
                    <th>Status</th>
                    <th>Stream</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.id}>
                      <td>{m.competition?.name ?? m.competitionId}</td>
                      <td>{m.homeTeam?.name ?? m.homeTeamId}</td>
                      <td>{m.awayTeam?.name ?? m.awayTeamId}</td>
                      <td>{m.startsAt ?? m.kickoffTime}</td>
                      <td>{m.status}</td>
                      <td>
                        <button onClick={async () => {
                          setSelectedMatchId(m.id);
                        }}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div>
          <StreamStatusPanel matchId={selectedMatchId} />
        </div>
      </div>
    </section>
  );
}
