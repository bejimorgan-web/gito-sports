import { useEffect, useState } from "react";

import type { Country, CreateTeamRequest, Sport, Team, TeamType } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";

const teamTypes: TeamType[] = ["club", "national", "custom"];

export function TeamsManagementScreen() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sportId, setSportId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [type, setType] = useState<TeamType>("club");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);

  const selectedSport = sports.find((sport) => sport.id === sportId);
  const filteredCountries = selectedSport?.countryIds?.length
    ? countries.filter((country) => selectedSport.countryIds?.includes(country.id))
    : countries;

  const loadData = async () => {
    try {
      const [teamData, sportsData, countryData] = await Promise.all([
        apiClient.listTeams(),
        apiClient.listSports(),
        apiClient.listCountries()
      ]);
      setTeams(teamData);
      setSports(sportsData);
      setCountries(countryData);
    } catch {
      setStatus("Unable to load teams.");
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const resetForm = () => {
    setSelectedTeam(null);
    setSportId("");
    setCountryId("");
    setName("");
    setShortName("");
    setType("club");
    setLogoUrl("");
    setStatus("Ready");
  };

  const selectTeam = (team: Team) => {
    setSelectedTeam(team);
    setSportId(team.sportId);
    setCountryId(team.countryId ?? "");
    setName(team.name);
    setShortName(team.shortName ?? "");
    setType(team.type);
    setLogoUrl(team.logoUrl ?? "");
    setStatus("Editing team");
  };

  const saveTeam = async () => {
    if (!sportId || !name.trim()) {
      setStatus("Sport and team name are required.");
      return;
    }

    if (isLogoUploading) {
      setStatus("Please wait for the logo upload to finish before saving.");
      return;
    }

    if (!isValidLogoSource(logoUrl)) {
      setStatus("Invalid logo. Upload an image file or use a valid http:// or https:// URL.");
      return;
    }

    try {
      if (selectedTeam) {
        const updatePayload: Partial<CreateTeamRequest> = {
          sportId,
          name,
          type,
          ...(countryId ? { countryId } : {}),
          ...(shortName ? { shortName } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.updateTeam(selectedTeam.id, updatePayload);
        setStatus("Team updated.");
      } else {
        const input: CreateTeamRequest = {
          sportId,
          name,
          type,
          ...(countryId ? { countryId } : {}),
          ...(shortName ? { shortName } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.createTeam(input);
        setStatus("Team created.");
      }

      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const deleteSelectedTeam = async () => {
    if (!selectedTeam) {
      return;
    }

    try {
      await apiClient.deleteTeam(selectedTeam.id);
      setStatus("Team deleted.");
      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const deleteTeamRow = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"?`)) {
      return;
    }

    try {
      await apiClient.deleteTeam(team.id);
      setStatus("Team deleted.");
      await loadData();
      if (selectedTeam?.id === team.id) {
        resetForm();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Clubs</p>
        <h2>Club & National Team Management</h2>
        <span>Create and manage clubs and national teams.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{selectedTeam ? "Edit Club / National Team" : "Create Club / National Team"}</h3>
          <span className="status-pill">{status}</span>
        </div>

        <div className="form-grid two-column">
          <label>
            Club / National Team Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Short Name
            <input value={shortName} onChange={(event) => setShortName(event.target.value)} />
          </label>
          <label>
            Sport
            <select value={sportId} onChange={(event) => setSportId(event.target.value)}>
              <option value="">Select sport</option>
              {sports.map((sport) => (
                <option key={sport.id} value={sport.id}>{sport.name}</option>
              ))}
            </select>
          </label>
          <label>
            Country
            <select value={countryId} onChange={(event) => setCountryId(event.target.value)}>
              <option value="">None</option>
              {filteredCountries.map((country) => (
                <option key={country.id} value={country.id}>{country.name}</option>
              ))}
            </select>
            {selectedSport?.countryIds?.length ? (
              <small>{filteredCountries.length} supported country{filteredCountries.length === 1 ? "" : "ies"} for {selectedSport.name}</small>
            ) : null}
          </label>
          <label>
            Team Type
            <select value={type} onChange={(event) => setType(event.target.value as TeamType)}>
              {teamTypes.map((teamType) => (
                <option key={teamType} value={teamType}>{teamType}</option>
              ))}
            </select>
          </label>
          <LogoUrlField label="Upload Logo" value={logoUrl} onChange={setLogoUrl} onUploadStateChange={setIsLogoUploading} />
        </div>

        <div className="button-row">
          <button type="button" onClick={saveTeam} disabled={isLogoUploading}>{selectedTeam ? "Update Team" : "Create Team"}</button>
          {selectedTeam ? (
            <button type="button" className="secondary" onClick={deleteSelectedTeam}>
              Delete Team
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={resetForm}>
            Clear
          </button>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Clubs & National Teams</h3>
          <span>{teams.length} entities</span>
        </div>
        <div className="entity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sport</th>
                <th>Country</th>
                <th>Type</th>
                <th>Logo</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td>{team.name}</td>
                  <td>{sports.find((sport) => sport.id === team.sportId)?.name ?? team.sportId}</td>
                  <td>{countries.find((country) => country.id === team.countryId)?.name ?? team.countryId ?? "—"}</td>
                  <td>{team.type}</td>
                  <td>{team.logoUrl ? <img src={resolveAssetUrl(team.logoUrl)} alt={team.name} className="small-logo" /> : "—"}</td>
                  <td>
                    <button type="button" onClick={() => selectTeam(team)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => deleteTeamRow(team)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
