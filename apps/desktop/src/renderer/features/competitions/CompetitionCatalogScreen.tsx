import { useEffect, useState } from "react";

import type { Competition, CreateCompetitionRequest, Host, Sport } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";

const availableScopes: Competition["scope"][] = ["domestic", "continental", "international", "global", "regional", "friendly", "custom"];
const availableTypes: Competition["type"][] = ["league", "cup", "tournament", "championship", "friendly", "custom"];
const availableParticipantTypes: { value: Competition["participantType"]; label: string }[] = [
  { value: "clubs", label: "Clubs" },
  { value: "nationalTeams", label: "National Teams" }
];

export function CompetitionCatalogScreen({ accessToken }: { accessToken: string }) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedCompetition, setSelectedCompetition] = useState<Competition | null>(null);
  const [sportId, setSportId] = useState("");
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Competition["scope"]>("domestic");
  const [type, setType] = useState<Competition["type"]>("league");
  const [participantType, setParticipantType] = useState<Competition["participantType"]>("clubs");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedSport = sports.find((sport) => sport.id === sportId);
  const filteredHosts = selectedSport ? hosts.filter((host) => host.sportId === selectedSport.id) : [];

  const loadData = async () => {
    try {
      const [competitionData, sportsData, hostData] = await Promise.all([
        apiClient.listCompetitions(),
        apiClient.listSports(),
        apiClient.listHosts()
      ]);
      setCompetitions(competitionData);
      setSports(sportsData);
      setHosts(hostData);
    } catch {
      setStatus("Unable to load competition metadata.");
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const resetForm = () => {
    setSelectedCompetition(null);
    setSportId("");
    setHostId("");
    setName("");
    setScope("domestic");
    setType("league");
    setParticipantType("clubs");
    setLogoUrl("");
    setStatus("Ready");
  };

  const selectCompetition = (competition: Competition) => {
    setSelectedCompetition(competition);
    setSportId(competition.sportId);
    setHostId(competition.hostId ?? "");
    setName(competition.name);
    setScope(competition.scope);
    setType(competition.type);
    setParticipantType(competition.participantType);
    setLogoUrl(competition.logoUrl ?? "");
    setStatus("Editing competition");
  };

  const saveCompetition = async () => {
    if (!sportId || !hostId || !name.trim() || !type || !participantType) {
      setStatus(!hostId ? "Sport, host, competition name, type, and participant type are required." : "Sport, competition name, type, and participant type are required.");
      return;
    }

    if (!isValidLogoSource(logoUrl)) {
      setStatus("Invalid logo. Upload an image file or use a valid http:// or https:// URL.");
      return;
    }

    try {
      if (selectedCompetition) {
        const updatePayload: Partial<CreateCompetitionRequest> = {
          sportId,
          name,
          scope,
          type,
          participantType,
          ...(hostId ? { hostId } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.updateCompetition(selectedCompetition.id, updatePayload, accessToken);
        setStatus("Competition updated.");
      } else {
        const input: CreateCompetitionRequest = {
          sportId,
          name,
          scope,
          type,
          participantType,
          ...(hostId ? { hostId } : {}),
          ...(logoUrl ? { logoUrl } : {})
        };
        await apiClient.createCompetition(input, accessToken);
        setStatus("Competition created.");
      }

      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const deleteSelectedCompetition = async () => {
    if (!selectedCompetition || deletingId) {
      return;
    }

    setDeletingId(selectedCompetition.id);
    setStatus("Deleting…");
    try {
      await apiClient.deleteCompetition(selectedCompetition.id, accessToken);
      setStatus("Competition deleted.");
      await loadData();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteCompetitionRow = async (competition: Competition) => {
    if (deletingId || !window.confirm(`Delete competition "${competition.name}"?`)) {
      return;
    }

    setDeletingId(competition.id);
    setStatus("Deleting…");
    try {
      await apiClient.deleteCompetition(competition.id, accessToken);
      setStatus("Competition deleted.");
      await loadData();
      if (selectedCompetition?.id === competition.id) {
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
        <p className="eyebrow">Competitions</p>
        <h2>Competition Management</h2>
        <span>Manage reusable competition entities for sports workflows.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{selectedCompetition ? "Edit Competition" : "Create Competition"}</h3>
          <span className="status-pill">{status}</span>
        </div>

        <div className="form-grid two-column">
          <label>
            Competition Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
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
            Host
            <select value={hostId} onChange={(event) => setHostId(event.target.value)}>
              <option value="">None</option>
              {filteredHosts.map((host) => (
                <option key={host.id} value={host.id}>{host.name} ({host.type})</option>
              ))}
            </select>
            {selectedSport ? <small>{filteredHosts.length} host{filteredHosts.length === 1 ? "" : "s"} for {selectedSport.name}</small> : null}
          </label>
          <label>
            Competition Type
            <select value={type} onChange={(event) => setType(event.target.value as Competition["type"])}>
              {availableTypes.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Participant Type
            <select value={participantType} onChange={(event) => setParticipantType(event.target.value as Competition["participantType"])}>
              {availableParticipantTypes.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value as Competition["scope"])}>
              {availableScopes.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <LogoUrlField label="Upload Logo" value={logoUrl} onChange={setLogoUrl} onUploadStateChange={setIsLogoUploading} />
        </div>

        <div className="button-row">
          <button type="button" onClick={saveCompetition} disabled={isLogoUploading}>{selectedCompetition ? "Update Competition" : "Create Competition"}</button>
          {selectedCompetition ? (
            <button type="button" className="secondary" onClick={deleteSelectedCompetition} disabled={Boolean(deletingId)}>
              {deletingId ? "Deleting…" : "Delete Competition"}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={resetForm}>
            Clear
          </button>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Competitions</h3>
          <span>{competitions.length} competitions</span>
        </div>
        <div className="entity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Sport</th>
                <th>Host</th>
                <th>Type</th>
                <th>Participants</th>
                <th>Scope</th>
                <th>Logo</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {competitions.map((competition) => (
                <tr key={competition.id}>
                  <td>{competition.name}</td>
                  <td>{sports.find((sport) => sport.id === competition.sportId)?.name ?? competition.sportId}</td>
                  <td>{hosts.find((host) => host.id === competition.hostId)?.name ?? competition.countryId ?? "—"}</td>
                  <td>{competition.type}</td>
                  <td>{competition.participantType === "clubs" ? "Clubs" : "National Teams"}</td>
                  <td>{competition.scope}</td>
                  <td>{competition.logoUrl ? <img src={resolveAssetUrl(competition.logoUrl)} alt={competition.name} className="small-logo" /> : "—"}</td>
                  <td>
                    <button type="button" onClick={() => selectCompetition(competition)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => deleteCompetitionRow(competition)} disabled={Boolean(deletingId)}>
                      {deletingId === competition.id ? "Deleting…" : "Delete"}
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
