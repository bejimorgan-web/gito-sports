import { useEffect, useMemo, useRef, useState } from "react";

import type {
  Competition,
  CompetitionParticipantType,
  CompetitionScope,
  CompetitionType,
  Country,
  CreateCompetitionRequest,
  CreateCountryRequest,
  CreateSportRequest,
  CreateTeamRequest,
  Sport,
  Team,
  TeamType
} from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
import { Modal } from "../../components/Modal";
import { Toast } from "../../components/Toast";

const competitionScopes: CompetitionScope[] = ["domestic", "continental", "international", "friendly", "custom"];
const competitionTypes: CompetitionType[] = ["league", "cup", "tournament", "friendly", "custom"];
const competitionParticipantTypes: { value: CompetitionParticipantType; label: string }[] = [
  { value: "clubs", label: "Clubs" },
  { value: "nationalTeams", label: "National Teams" }
];
const teamTypes: { value: TeamType; label: string }[] = [
  { value: "club", label: "Club" },
  { value: "national", label: "National Team" },
  { value: "custom", label: "Custom" }
];

type WorkspaceModalKind = "sport" | "country" | "competition" | "team";

type WorkspaceModal = {
  kind: WorkspaceModalKind;
  action: "create" | "edit";
};

type DeleteContext = {
  kind: WorkspaceModalKind;
  id: string;
  label: string;
};

function generateCountryIsoCodes(name: string) {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const iso2 = tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(2, "X")
    .slice(0, 2);
  const iso3 = tokens
    .slice(0, 3)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("")
    .padEnd(3, "X")
    .slice(0, 3);

  return { iso2Code: iso2, iso3Code: iso3 };
}

function EntityAvatar({ src, fallback }: { src?: string | undefined; fallback: string }) {
  const resolvedSrc = resolveAssetUrl(src);

  return (
    <div className="entity-avatar">
      {resolvedSrc ? <img src={resolvedSrc} alt={fallback} /> : <span>{fallback.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

export function SportsWorkspaceScreen() {
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"legacy" | "catalog">("legacy");
  const [modalContext, setModalContext] = useState<WorkspaceModal | null>(null);
  const [deleteContext, setDeleteContext] = useState<DeleteContext | null>(null);
  const isCatalogView = viewMode === "catalog";

  type ToastItem = { id: string; message: string; type?: "success" | "error" | "info" };
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isLogoUploading, setIsLogoUploading] = useState(false);

  const sportCardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const pushToast = (message: string, type: "success" | "error" | "info" = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((t) => [...t, { id, message, type }]);
  };

  const [sportName, setSportName] = useState("");
  const [sportLogoUrl, setSportLogoUrl] = useState("");
  const [sportCountryIds, setSportCountryIds] = useState<string[]>([]);

  const [countryName, setCountryName] = useState("");
  const [countryFlagUrl, setCountryFlagUrl] = useState("");
  const [countryIso2Code, setCountryIso2Code] = useState("");
  const [countryIso3Code, setCountryIso3Code] = useState("");
  const [editingCountryId, setEditingCountryId] = useState<string | null>(null);

  const [competitionName, setCompetitionName] = useState("");
  const [competitionLogoUrl, setCompetitionLogoUrl] = useState("");
  const [competitionCountryId, setCompetitionCountryId] = useState("");
  const [competitionScope, setCompetitionScope] = useState<CompetitionScope>("domestic");
  const [competitionType, setCompetitionType] = useState<CompetitionType>("league");
  const [competitionParticipantType, setCompetitionParticipantType] = useState<CompetitionParticipantType>("clubs");
  const [editingCompetitionId, setEditingCompetitionId] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [teamLogoUrl, setTeamLogoUrl] = useState("");
  const [teamType, setTeamType] = useState<TeamType>("club");
  const [teamCountryId, setTeamCountryId] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  const supportedCountries = useMemo(
    () =>
      selectedSport?.countryIds?.length
        ? countries.filter((country) => selectedSport.countryIds?.includes(country.id))
        : [],
    [countries, selectedSport]
  );

  const sportCompetitions = useMemo(
    () => (selectedSport ? competitions.filter((competition) => competition.sportId === selectedSport.id) : []),
    [competitions, selectedSport]
  );

  const sportTeams = useMemo(
    () => (selectedSport ? teams.filter((team) => team.sportId === selectedSport.id) : []),
    [teams, selectedSport]
  );

  const clubs = sportTeams.filter((team) => team.type === "club");
  const nationalTeams = sportTeams.filter((team) => team.type === "national");

  const loadData = async () => {
    try {
      const [sportsData, countriesData, competitionData, teamData] = await Promise.all([
        apiClient.listSports(),
        apiClient.listCountries(viewMode),
        apiClient.listCompetitions(viewMode),
        apiClient.listTeams(viewMode)
      ]);

      setSports(sportsData);
      setCountries(countriesData);
      setCompetitions(competitionData);
      setTeams(teamData);

      if (selectedSport) {
        const refreshed = sportsData.find((sport) => sport.id === selectedSport.id);
        setSelectedSport(refreshed ?? null);
      }
    } catch {
      setStatus("Unable to load sports workspace data.");
    }
  };

  useEffect(() => {
    void loadData();
  }, [viewMode]);

  const openModal = (modal: WorkspaceModal) => {
    setModalContext(modal);
  };

  const closeModal = () => {
    setModalContext(null);
    setDeleteContext(null);
    setSportName("");
    setSportLogoUrl("");
    setSportCountryIds([]);
    setCountryName("");
    setCountryFlagUrl("");
    setCountryIso2Code("");
    setCountryIso3Code("");
    setEditingCountryId(null);
    setCompetitionName("");
    setCompetitionLogoUrl("");
    setCompetitionCountryId("");
    setCompetitionScope("domestic");
    setCompetitionType("league");
    setCompetitionParticipantType("clubs");
    setEditingCompetitionId(null);
    setTeamName("");
    setTeamShortName("");
    setTeamLogoUrl("");
    setTeamType("club");
    setTeamCountryId("");
    setEditingTeamId(null);
  };

  const openSportEditor = (sport?: Sport) => {
    if (sport) {
      setSportName(sport.name);
      setSportLogoUrl(sport.logoUrl ?? "");
      setSportCountryIds(sport.countryIds ?? []);
      openModal({ kind: "sport", action: "edit" });
    } else {
      setSportName("");
      setSportLogoUrl("");
      setSportCountryIds([]);
      openModal({ kind: "sport", action: "create" });
    }
  };

  const openCountryEditor = (country?: Country) => {
    if (!selectedSport) {
      return;
    }

    if (country) {
      setCountryName(country.name);
      setCountryFlagUrl(country.flagUrl ?? "");
      setCountryIso2Code(country.iso2Code);
      setCountryIso3Code(country.iso3Code);
      setEditingCountryId(country.id);
      openModal({ kind: "country", action: "edit" });
    } else {
      setCountryName("");
      setCountryFlagUrl("");
      const generated = generateCountryIsoCodes("");
      setCountryIso2Code(generated.iso2Code);
      setCountryIso3Code(generated.iso3Code);
      setEditingCountryId(null);
      openModal({ kind: "country", action: "create" });
    }
  };

  const openCompetitionEditor = (competition?: Competition) => {
    if (!selectedSport) {
      return;
    }

    if (competition) {
      setCompetitionName(competition.name);
      setCompetitionLogoUrl(competition.logoUrl ?? "");
      setCompetitionCountryId(competition.countryId ?? "");
      setCompetitionScope(competition.scope);
      setCompetitionType(competition.type);
      setCompetitionParticipantType(competition.participantType);
      setEditingCompetitionId(competition.id);
      openModal({ kind: "competition", action: "edit" });
    } else {
      setCompetitionName("");
      setCompetitionLogoUrl("");
      setCompetitionCountryId("");
      setCompetitionScope("domestic");
      setCompetitionType("league");
      setCompetitionParticipantType("clubs");
      setEditingCompetitionId(null);
      openModal({ kind: "competition", action: "create" });
    }
  };

  const openTeamEditor = (team?: Team) => {
    if (!selectedSport) {
      return;
    }

    if (team) {
      setTeamName(team.name);
      setTeamShortName(team.shortName ?? "");
      setTeamLogoUrl(team.logoUrl ?? "");
      setTeamType(team.type);
      setTeamCountryId(team.countryId ?? "");
      setEditingTeamId(team.id);
      openModal({ kind: "team", action: "edit" });
    } else {
      setTeamName("");
      setTeamShortName("");
      setTeamLogoUrl("");
      setTeamType("club");
      setTeamCountryId("");
      setEditingTeamId(null);
      openModal({ kind: "team", action: "create" });
    }
  };

  const queueDelete = (kind: WorkspaceModalKind, id: string, label: string) => {
    setDeleteContext({ kind, id, label });
  };

  const executeDelete = async () => {
    if (!deleteContext) {
      return;
    }

    try {
      switch (deleteContext.kind) {
        case "sport":
          await apiClient.deleteSport(deleteContext.id);
          setSelectedSport((current) => (current?.id === deleteContext.id ? null : current));
          break;
        case "country":
          await apiClient.deleteCountry(deleteContext.id);
          break;
        case "competition":
          await apiClient.deleteCompetition(deleteContext.id);
          break;
        case "team":
          await apiClient.deleteTeam(deleteContext.id);
          break;
      }

      setStatus(`${deleteContext.label} deleted.`);
      setDeleteContext(null);
      await loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const saveSport = async () => {
    if (!sportName.trim()) {
      setStatus("Sport name is required.");
      return;
    }

    if (sportLogoUrl && !isValidLogoSource(sportLogoUrl)) {
      setStatus("Invalid logo URL.");
      return;
    }

    const payload: CreateSportRequest = {
      name: sportName,
      ...(sportLogoUrl ? { logoUrl: sportLogoUrl } : {}),
      countryIds: sportCountryIds
    };

    let createdId: string | undefined;
    setIsSaving(true);
    try {
      if (modalContext?.action === "edit" && selectedSport) {
        await apiClient.updateSport(selectedSport.id, payload);
        setStatus("Sport updated.");
        pushToast("Sport updated.", "success");
      } else {
        const created = await apiClient.createSport(payload);
        setStatus("Sport created.");
        setSelectedSport(created);
        createdId = created.id;
        pushToast("Sport created.", "success");
      }

      await loadData();
      closeModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed.";
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  // provide a way to remove individual toasts
  const removeToast = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));

  const saveCountry = async () => {
    if (!selectedSport) {
      return;
    }

    if (!countryName.trim()) {
      setStatus("Country name is required.");
      return;
    }

    const { iso2Code, iso3Code } =
      countryIso2Code && countryIso3Code
        ? { iso2Code: countryIso2Code, iso3Code: countryIso3Code }
        : generateCountryIsoCodes(countryName);

    if (isLogoUploading) {
      setStatus("Please wait for the flag upload to finish before saving.");
      return;
    }

    if (countryFlagUrl && !isValidLogoSource(countryFlagUrl)) {
      setStatus("Invalid flag URL.");
      return;
    }

    const payload: CreateCountryRequest = {
      name: countryName,
      iso2Code,
      iso3Code,
      ...(countryFlagUrl ? { flagUrl: countryFlagUrl } : {})
    };

    setIsSaving(true);
    try {
      if (editingCountryId) {
        await apiClient.updateCountry(editingCountryId, payload);
        setStatus("Country updated.");
        pushToast("Country updated.", "success");
      } else {
        await apiClient.createCountry(payload);
        setStatus("Country created.");
        pushToast("Country created.", "success");
      }

      await loadData();
      closeModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed.";
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const saveCompetition = async () => {
    if (!selectedSport) {
      return;
    }

    if (!competitionName.trim()) {
      setStatus("Competition name is required.");
      return;
    }

    if (isLogoUploading) {
      setStatus("Please wait for the logo upload to finish before saving.");
      return;
    }

    if (competitionLogoUrl && !isValidLogoSource(competitionLogoUrl)) {
      setStatus("Invalid logo URL.");
      return;
    }

    const payload: CreateCompetitionRequest = {
      sportId: selectedSport.id,
      name: competitionName,
      scope: competitionScope,
      type: competitionType,
      participantType: competitionParticipantType,
      ...(competitionCountryId ? { countryId: competitionCountryId } : {}),
      ...(competitionLogoUrl ? { logoUrl: competitionLogoUrl } : {})
    };
    setIsSaving(true);
    try {
      if (editingCompetitionId) {
        await apiClient.updateCompetition(editingCompetitionId, payload);
        setStatus("Competition updated.");
        pushToast("Competition updated.", "success");
      } else {
        await apiClient.createCompetition(payload);
        setStatus("Competition created.");
        pushToast("Competition created.", "success");
      }

      await loadData();
      closeModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed.";
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const saveTeam = async () => {
    if (!selectedSport) {
      return;
    }

    if (!teamName.trim()) {
      setStatus("Team name is required.");
      return;
    }

    if (isLogoUploading) {
      setStatus("Please wait for the logo upload to finish before saving.");
      return;
    }

    if (teamLogoUrl && !isValidLogoSource(teamLogoUrl)) {
      setStatus("Invalid logo URL.");
      return;
    }

    const payload: CreateTeamRequest = {
      sportId: selectedSport.id,
      name: teamName,
      type: teamType,
      ...(teamShortName ? { shortName: teamShortName } : {}),
      ...(teamCountryId ? { countryId: teamCountryId } : {}),
      ...(teamLogoUrl ? { logoUrl: teamLogoUrl } : {})
    };
    setIsSaving(true);
    try {
      if (editingTeamId) {
        await apiClient.updateTeam(editingTeamId, payload);
        setStatus("Team updated.");
        pushToast("Team updated.", "success");
      } else {
        await apiClient.createTeam(payload);
        setStatus("Team created.");
        pushToast("Team created.", "success");
      }

      await loadData();
      closeModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed.";
      setStatus(msg);
      pushToast(msg, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const sportSummary = selectedSport ? (
    <div className="dashboard-summary-grid">
      <article className="dashboard-metric-card">
        <span>{isCatalogView ? "Hosts" : "Countries"}</span>
        <strong>{supportedCountries.length}</strong>
        <small>Supported by {selectedSport.name}</small>
      </article>
      <article className="dashboard-metric-card">
        <span>Competitions</span>
        <strong>{sportCompetitions.length}</strong>
        <small>Competition entities</small>
      </article>
      <article className="dashboard-metric-card">
        <span>Clubs</span>
        <strong>{clubs.length}</strong>
        <small>Club entries</small>
      </article>
      <article className="dashboard-metric-card">
        <span>National Teams</span>
        <strong>{nationalTeams.length}</strong>
        <small>National team entries</small>
      </article>
    </div>
  ) : null;

  return (
    <section className="screen-stack sports-workspace-screen">
      <header className="screen-header">
        <p className="eyebrow">Sports</p>
        <h2>Sports Workspace</h2>
        <span>Open a sport to manage its countries, competitions, clubs, and national teams.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Sports</h3>
          <button type="button" onClick={() => openSportEditor()}>
            Add Sport
          </button>
        </div>
        <div className="sport-selection-grid">
          {sports.map((sport) => (
            <button
              key={sport.id}
              type="button"
              ref={(el) => (sportCardRefs.current[sport.id] = el)}
              className={`sport-card ${selectedSport?.id === sport.id ? "selected" : ""}`}
              onClick={() => setSelectedSport(sport)}
            >
              <div className="sport-card-top">
                <EntityAvatar src={sport.logoUrl} fallback={sport.name} />
                <span className={`entity-badge ${selectedSport?.id === sport.id ? "active" : ""}`}>{sport.status}</span>
              </div>
              <strong>{sport.name}</strong>
              <small>{sport.countryIds?.length ?? 0} supported country{sport.countryIds?.length === 1 ? "" : "ies"}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedSport ? (
        <>
          <section className="console-panel sports-workspace-header">
            <div>
              <p className="eyebrow">{selectedSport.name}</p>
              <h2>{selectedSport.name} management</h2>
              <span>Use the workspace to keep sport metadata aligned and operator-friendly.</span>
              {isCatalogView ? (
                <p className="field-note">Catalog View is read-only. Legacy operations are disabled while inspecting the shadow catalog layer.</p>
              ) : null}
            </div>
            <div className="sports-workspace-actions">
              <div className="view-mode-toggle">
                <button
                  type="button"
                  className={viewMode === "legacy" ? "active" : ""}
                  onClick={() => setViewMode("legacy")}
                >
                  Legacy View
                </button>
                <button
                  type="button"
                  className={viewMode === "catalog" ? "active" : ""}
                  onClick={() => setViewMode("catalog")}
                >
                  Catalog View
                </button>
              </div>
              <button type="button" onClick={() => openSportEditor(selectedSport)} disabled={isCatalogView}>
                Edit Sport
              </button>
              <button type="button" className="secondary" onClick={() => queueDelete("sport", selectedSport.id, selectedSport.name)} disabled={isCatalogView}>
                Delete Sport
              </button>
            </div>
          </section>

          {sportSummary}

          <section className="console-panel sports-workspace-grid">
            <article className="entity-panel">
              <div className="panel-heading">
                <h3>{isCatalogView ? "Hosts" : "Countries"}</h3>
                <button type="button" onClick={() => openCountryEditor()} disabled={isCatalogView}>
                  Add Country
                </button>
              </div>
              <div className="entity-list">
                {supportedCountries.length > 0 ? (
                  supportedCountries.map((country) => (
                    <article className="entity-list-item" key={country.id}>
                      <div className="entity-row">
                        <EntityAvatar src={country.flagUrl} fallback={country.name} />
                        <div>
                          <strong>{country.name}</strong>
                        </div>
                      </div>
                      <div className="entity-row-actions">
                        <button type="button" onClick={() => openCountryEditor(country)} disabled={isCatalogView}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => queueDelete("country", country.id, country.name)} disabled={isCatalogView}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-note">No {isCatalogView ? "hosts" : "countries"} are linked to this sport yet.</p>
                )}
              </div>
            </article>

            <article className="entity-panel">
              <div className="panel-heading">
                <h3>Competitions</h3>
                <button type="button" onClick={() => openCompetitionEditor()} disabled={isCatalogView}>
                  Add Competition
                </button>
                {sportCompetitions.length > 0 ? (
                  sportCompetitions.map((competition) => (
                    <article className="entity-list-item" key={competition.id}>
                      <div className="entity-row">
                        <EntityAvatar src={competition.logoUrl} fallback={competition.name} />
                        <div>
                          <strong>{competition.name}</strong>
                          <small>
                            {competition.type} · {competition.participantType === "clubs" ? "Clubs" : "National Teams"}
                          </small>
                        </div>
                      </div>
                      <div className="entity-row-actions">
                        <button type="button" onClick={() => openCompetitionEditor(competition)} disabled={isCatalogView}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => queueDelete("competition", competition.id, competition.name)} disabled={isCatalogView}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-note">No competitions exist for this sport yet.</p>
                )}
              </div>
            </article>
          </section>

          <section className="console-panel sports-workspace-grid">
            <article className="entity-panel">
              <div className="panel-heading">
                <h3>Clubs</h3>
                <button type="button" onClick={() => openTeamEditor()} disabled={isCatalogView}>
                  Add Club
                </button>
              </div>
              <div className="entity-list">
                {clubs.length > 0 ? (
                  clubs.map((team) => (
                    <article className="entity-list-item" key={team.id}>
                      <div className="entity-row">
                        <EntityAvatar src={team.logoUrl} fallback={team.name} />
                        <div>
                          <strong>{team.name}</strong>
                          <small>{team.shortName ?? "Club"}</small>
                        </div>
                      </div>
                      <div className="entity-row-actions">
                        <button type="button" onClick={() => openTeamEditor(team)} disabled={isCatalogView}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => queueDelete("team", team.id, team.name)} disabled={isCatalogView}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-note">No clubs are defined for this sport yet.</p>
                )}
              </div>
            </article>

            <article className="entity-panel">
              <div className="panel-heading">
                <h3>National Teams</h3>
                <button type="button" onClick={() => openTeamEditor()} disabled={isCatalogView}>
                  Add National Team
                </button>
              </div>
              <div className="entity-list">
                {nationalTeams.length > 0 ? (
                  nationalTeams.map((team) => (
                    <article className="entity-list-item" key={team.id}>
                      <div className="entity-row">
                        <EntityAvatar src={team.logoUrl} fallback={team.name} />
                        <div>
                          <strong>{team.name}</strong>
                          <small>{team.countryId ? countries.find((country) => country.id === team.countryId)?.name : "National Team"}</small>
                        </div>
                      </div>
                      <div className="entity-row-actions">
                        <button type="button" onClick={() => openTeamEditor(team)} disabled={isCatalogView}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => queueDelete("team", team.id, team.name)} disabled={isCatalogView}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-note">No national teams have been created yet.</p>
                )}
              </div>
            </article>
          </section>
        </>
      ) : (
        <section className="console-panel">
          <p className="field-note">Select a sport card to open its workspace and manage related entities.</p>
        </section>
      )}

      {modalContext ? (
        <Modal
          title={`${modalContext.action === "create" ? "Create" : "Edit"} ${modalContext.kind === "sport" ? "Sport" : modalContext.kind === "country" ? "Country" : modalContext.kind === "competition" ? "Competition" : "Team"}`}
          onClose={closeModal}
          footer={
            <div className="button-row">
              <button
                type="button"
                disabled={isSaving || isLogoUploading}
                onClick={
                  modalContext.kind === "sport"
                    ? saveSport
                    : modalContext.kind === "country"
                    ? saveCountry
                    : modalContext.kind === "competition"
                    ? saveCompetition
                    : saveTeam
                }
              >
                {isSaving ? "Saving..." : modalContext.action === "create" ? "Create" : "Save"}
              </button>
              <button type="button" className="secondary" onClick={closeModal}>
                Cancel
              </button>
            </div>
          }
        >
          {status ? <span className="status-pill">{status}</span> : null}
          {modalContext.kind === "sport" ? (
            <div className="form-grid two-column">
              <label>
                Sport Name
                <input value={sportName} onChange={(event) => setSportName(event.target.value)} />
              </label>
              <LogoUrlField label="Upload Logo" value={sportLogoUrl} onChange={setSportLogoUrl} />
              <label className="full-width">
                Supported Countries
                <div className="country-selection-grid">
                  {countries.map((country) => (
                    <label key={country.id} className="checkbox-option">
                      <input
                        type="checkbox"
                        checked={sportCountryIds.includes(country.id)}
                        onChange={() => {
                          setSportCountryIds((current) =>
                            current.includes(country.id) ? current.filter((id) => id !== country.id) : [...current, country.id]
                          );
                        }}
                      />
                      <span>{country.name}</span>
                    </label>
                  ))}
                </div>
              </label>
            </div>
          ) : modalContext.kind === "country" ? (
            <div className="form-grid two-column">
              <label>
                Country Name
                <input value={countryName} onChange={(event) => setCountryName(event.target.value)} />
              </label>
              <LogoUrlField label="Upload Flag" value={countryFlagUrl} onChange={setCountryFlagUrl} />
              <small className="field-note">ISO codes are stored internally and are not shown to operators.</small>
            </div>
          ) : modalContext.kind === "competition" ? (
            <div className="form-grid two-column">
              <label>
                Competition Name
                <input value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} />
              </label>
              <LogoUrlField label="Upload Logo" value={competitionLogoUrl} onChange={setCompetitionLogoUrl} />
              <label>
                Participant Type
                <select value={competitionParticipantType} onChange={(event) => setCompetitionParticipantType(event.target.value as CompetitionParticipantType)}>
                  {competitionParticipantTypes.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Scope
                <select value={competitionScope} onChange={(event) => setCompetitionScope(event.target.value as CompetitionScope)}>
                  {competitionScopes.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Competition Type
                <select value={competitionType} onChange={(event) => setCompetitionType(event.target.value as CompetitionType)}>
                  {competitionTypes.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Country
                <select value={competitionCountryId} onChange={(event) => setCompetitionCountryId(event.target.value)}>
                  <option value="">None</option>
                  {supportedCountries.map((country) => (
                    <option key={country.id} value={country.id}>{country.name}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="form-grid two-column">
              <label>
                Team Name
                <input value={teamName} onChange={(event) => setTeamName(event.target.value)} />
              </label>
              <label>
                Short Name
                <input value={teamShortName} onChange={(event) => setTeamShortName(event.target.value)} />
              </label>
              <label>
                Team Type
                <select value={teamType} onChange={(event) => setTeamType(event.target.value as TeamType)}>
                  {teamTypes.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Country
                <select value={teamCountryId} onChange={(event) => setTeamCountryId(event.target.value)}>
                  <option value="">None</option>
                  {supportedCountries.map((country) => (
                    <option key={country.id} value={country.id}>{country.name}</option>
                  ))}
                </select>
              </label>
              <LogoUrlField label="Upload Logo" value={teamLogoUrl} onChange={setTeamLogoUrl} onUploadStateChange={setIsLogoUploading} />
            </div>
          )}
        </Modal>
      ) : null}

      {deleteContext ? (
        <Modal
          title={`Delete ${deleteContext.kind === "sport" ? "Sport" : deleteContext.kind === "country" ? "Country" : deleteContext.kind === "competition" ? "Competition" : "Team"}`}
          onClose={() => setDeleteContext(null)}
          footer={
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setDeleteContext(null)}>
                Cancel
              </button>
              <button type="button" onClick={executeDelete}>
                Delete
              </button>
            </div>
          }
        >
          <p>Delete <strong>{deleteContext.label}</strong> permanently? This action cannot be undone.</p>
        </Modal>
      ) : null}
      <div className="toasts-container">
        {toasts.map((t) => (
          <Toast key={t.id} id={t.id} message={t.message} type={t.type ?? "info"} onClose={removeToast} />
        ))}
      </div>
    </section>
  );
}
