import { useEffect, useMemo, useState } from "react";

import type { Country, CreateTeamRequest, Host, Sport, Team, TeamType } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";

const teamTypes: TeamType[] = ["club", "national", "custom"];

export function TeamsManagementScreen({ accessToken }: { accessToken: string }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [participatingHosts, setParticipatingHosts] = useState<Host[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [sportId, setSportId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<TeamType>("club");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterSportId, setFilterSportId] = useState("");
  const [filterHostId, setFilterHostId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCountryId, setFilterCountryId] = useState("");

  const selectedSport = sports.find((sport) => sport.id === sportId);
  useEffect(() => {
    if (!sportId) { setParticipatingHosts([]); return; }
    void apiClient.listHosts(sportId).then(setParticipatingHosts).catch(() => setParticipatingHosts([]));
  }, [sportId]);
  const filteredTeams = useMemo(() => teams.filter((team) =>
    (!filterSportId || team.sportId === filterSportId) &&
    (!filterHostId || team.hostId === filterHostId) &&
    (!filterType || team.type === filterType) &&
    (!filterCountryId || team.countryId === filterCountryId)
  ), [filterCountryId, filterHostId, filterSportId, filterType, teams]);
  const filterHosts = hosts.filter((host) => !filterSportId || host.sportId === filterSportId);
  const filteredCountries = selectedSport?.countryIds?.length
    ? countries.filter((country) => selectedSport.countryIds?.includes(country.id))
    : countries;

  const loadData = async () => {
    try {
      const [teamData, sportsData, countryData, hostData] = await Promise.all([
        apiClient.listTeams(),
        apiClient.listSports(),
        apiClient.listCountries(),
        apiClient.listHosts()
      ]);
      setTeams(teamData);
      setSports(sportsData);
      setCountries(countryData);
      setHosts(hostData);
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
    setHostId("");
    setName("");
    setShortName("");
    setSlug("");
    setType("club");
    setLogoUrl("");
    setStatus("Ready");
  };

  const selectTeam = (team: Team) => {
    setSelectedTeam(team);
    setSportId(team.sportId);
    setCountryId(team.countryId ?? "");
    setHostId(team.hostId ?? "");
    setName(team.name);
    setShortName(team.shortName ?? "");
    setSlug(team.slug ?? "");
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
          ...(hostId ? { hostId } : {}),
          name,
          type,
          ...(slug ? { slug } : {}),
          ...(countryId ? { countryId } : {}),
          ...(shortName ? { shortName } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.updateTeam(selectedTeam.id, updatePayload, accessToken);
        setStatus("Team updated.");
      } else {
        const input: CreateTeamRequest = {
          sportId,
          ...(hostId ? { hostId } : {}),
          name,
          type,
          ...(slug ? { slug } : {}),
          ...(countryId ? { countryId } : {}),
          ...(shortName ? { shortName } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.createTeam(input, accessToken);
        setStatus("Team created.");
      }

      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const deleteSelectedTeam = async () => {
    if (!selectedTeam || deletingId) {
      return;
    }

    setDeletingId(selectedTeam.id);
    setStatus("Deleting…");
    try {
      await apiClient.deleteTeam(selectedTeam.id, accessToken);
      setStatus("Team deleted.");
      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteTeamRow = async (team: Team) => {
    if (deletingId || !window.confirm(`Delete team "${team.name}"?`)) {
      return;
    }

    setDeletingId(team.id);
    setStatus("Deleting…");
    try {
      await apiClient.deleteTeam(team.id, accessToken);
      setStatus("Team deleted.");
      await loadData();
      if (selectedTeam?.id === team.id) {
        resetForm();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
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
            Slug
            <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="club-slug" />
          </label>
          <label>
            Sport
            <select value={sportId} onChange={(event) => { setSportId(event.target.value); setHostId(""); }}>
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
            Participating Host
            <select value={hostId} onChange={(event) => setHostId(event.target.value)} disabled={!sportId}>
              <option value="">None</option>
              {participatingHosts.map((host) => <option key={host.id} value={host.id}>{host.name} ({host.type})</option>)}
            </select>
            {sportId && participatingHosts.length === 0 ? <small>No Hosts are assigned to this Sport yet.</small> : null}
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
            <button type="button" className="secondary" onClick={deleteSelectedTeam} disabled={Boolean(deletingId)}>
              {deletingId ? "Deleting…" : "Delete Team"}
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
          <span>{filteredTeams.length} of {teams.length} entities</span>
        </div>
        <div className="form-grid two-column">
          <label>Sport<select value={filterSportId} onChange={(event) => { setFilterSportId(event.target.value); setFilterHostId(""); }}><option value="">All sports</option>{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
          <label>Participating Host<select value={filterHostId} onChange={(event) => setFilterHostId(event.target.value)}><option value="">All Hosts</option>{filterHosts.map((host) => <option key={host.id} value={host.id}>{host.name} ({host.type})</option>)}</select></label>
          <label>Team Type<select value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="">All types</option>{teamTypes.map((teamType) => <option key={teamType} value={teamType}>{teamType}</option>)}</select></label>
          <label>Country<select value={filterCountryId} onChange={(event) => setFilterCountryId(event.target.value)}><option value="">All countries</option>{countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}</select></label>
        </div>
        <div className="entity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sport</th>
                <th>Country</th>
                <th>Host</th>
                <th>Type</th>
                <th>Logo</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTeams.map((team) => (
                <tr key={team.id}>
                  <td>{team.name}</td>
                  <td>{sports.find((sport) => sport.id === team.sportId)?.name ?? team.sportId}</td>
                  <td>{countries.find((country) => country.id === team.countryId)?.name ?? team.countryId ?? "—"}</td>
                  <td>{hosts.find((host) => host.id === team.hostId)?.name ?? team.hostId ?? "—"}</td>
                  <td>{team.type}</td>
                  <td>{team.logoUrl ? <img src={resolveAssetUrl(team.logoUrl)} alt={team.name} className="small-logo" /> : "—"}</td>
                  <td>
                    <button type="button" onClick={() => selectTeam(team)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => deleteTeamRow(team)} disabled={Boolean(deletingId)}>
                      {deletingId === team.id ? "Deleting…" : "Delete"}
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
