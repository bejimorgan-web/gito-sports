import { useEffect, useMemo, useRef, useState } from "react";

import type {
  Competition,
  CompetitionParticipantType,
  CompetitionScope,
  CompetitionType,
  Country,
  CreateHostRequest,
  CreateCompetitionRequest,
  CreateSportRequest,
  CreateTeamRequest,
  Sport,
  Team,
  TeamType,
  Host,
  HostType
} from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
import { Modal } from "../../components/Modal";
import { Toast } from "../../components/Toast";
import { SeasonMembershipPanel } from "./SeasonMembershipPanel";

const competitionScopes: CompetitionScope[] = ["domestic", "continental", "international", "global", "regional", "friendly", "custom"];
const competitionTypes: CompetitionType[] = ["league", "cup", "tournament", "championship", "friendly", "custom"];
const competitionParticipantTypes: { value: CompetitionParticipantType; label: string }[] = [
  { value: "clubs", label: "Clubs" },
  { value: "nationalTeams", label: "National Teams" }
];
const teamTypes: { value: TeamType; label: string }[] = [
  { value: "club", label: "Club" },
  { value: "national", label: "National Team" },
  { value: "custom", label: "Custom" }
];
const hostTypes: { value: HostType; label: string }[] = [
  { value: "country", label: "Country" },
  { value: "organization", label: "Organization" },
  { value: "federation", label: "Federation" },
  { value: "association", label: "Association" },
  { value: "regional", label: "Regional" },
  { value: "international", label: "International" },
  { value: "other", label: "Other" }
];

type WorkspaceModalKind = "sport" | "host" | "competition" | "team";

type WorkspaceModal = {
  kind: WorkspaceModalKind;
  action: "create" | "edit";
};

type DeleteContext = {
  kind: WorkspaceModalKind;
  id: string;
  label: string;
};

function EntityAvatar({ src, fallback }: { src?: string | undefined; fallback: string }) {
  const resolvedSrc = resolveAssetUrl(src);

  return (
    <div className="entity-avatar">
      {resolvedSrc ? <img src={resolvedSrc} alt={fallback} /> : <span>{fallback.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

export function SportsWorkspaceScreen({ accessToken }: { accessToken: string }) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"legacy" | "catalog">("legacy");
  const [modalContext, setModalContext] = useState<WorkspaceModal | null>(null);
  const [deleteContext, setDeleteContext] = useState<DeleteContext | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

  const [hostName, setHostName] = useState("");
  const [hostType, setHostType] = useState<HostType>("country");
  const [hostCountryId, setHostCountryId] = useState("");
  const [hostLogoUrl, setHostLogoUrl] = useState("");
  const [editingHostId, setEditingHostId] = useState<string | null>(null);

  const [competitionName, setCompetitionName] = useState("");
  const [competitionLogoUrl, setCompetitionLogoUrl] = useState("");
  const [competitionHostId, setCompetitionHostId] = useState("");
  const [competitionScope, setCompetitionScope] = useState<CompetitionScope>("domestic");
  const [competitionType, setCompetitionType] = useState<CompetitionType>("league");
  const [competitionParticipantType, setCompetitionParticipantType] = useState<CompetitionParticipantType>("clubs");
  const [editingCompetitionId, setEditingCompetitionId] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [teamSlug, setTeamSlug] = useState("");
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

  const sportHosts = useMemo(
    () => (selectedSport ? hosts.filter((host) => host.sportId === selectedSport.id) : []),
    [hosts, selectedSport]
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
      const [sportsData, countriesData, hostsData, competitionData, teamData] = await Promise.all([
        apiClient.listSports(),
        apiClient.listCountries(viewMode),
        apiClient.listHosts(),
        apiClient.listCompetitions(viewMode),
        apiClient.listTeams(viewMode)
      ]);

      setSports(sportsData);
      setCountries(countriesData);
      setHosts(hostsData);
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
    setHostName("");
    setHostType("country");
    setHostCountryId("");
    setHostLogoUrl("");
    setEditingHostId(null);
    setCompetitionName("");
    setCompetitionLogoUrl("");
    setCompetitionHostId("");
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

  const openHostEditor = (host?: Host) => {
    if (!selectedSport) {
      return;
    }

    if (host) {
      setHostName(host.name);
      setHostType(host.type);
      setHostCountryId(host.countryId ?? "");
      setHostLogoUrl(host.logoUrl ?? "");
      setEditingHostId(host.id);
      openModal({ kind: "host", action: "edit" });
    } else {
      setHostName("");
      setHostType("country");
      setHostCountryId("");
      setHostLogoUrl("");
      setEditingHostId(null);
      openModal({ kind: "host", action: "create" });
    }
  };

  const openCompetitionEditor = (competition?: Competition) => {
    if (!selectedSport) {
      return;
    }

    if (competition) {
      setCompetitionName(competition.name);
      setCompetitionLogoUrl(competition.logoUrl ?? "");
      setCompetitionHostId(competition.hostId ?? "");
      setCompetitionScope(competition.scope);
      setCompetitionType(competition.type);
      setCompetitionParticipantType(competition.participantType);
      setEditingCompetitionId(competition.id);
      openModal({ kind: "competition", action: "edit" });
    } else {
      setCompetitionName("");
      setCompetitionLogoUrl("");
      setCompetitionHostId("");
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
      setTeamSlug(team.slug ?? "");
      setTeamLogoUrl(team.logoUrl ?? "");
      setTeamType(team.type);
      setTeamCountryId(team.countryId ?? "");
      setEditingTeamId(team.id);
      openModal({ kind: "team", action: "edit" });
    } else {
      setTeamName("");
      setTeamShortName("");
      setTeamSlug("");
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
    if (!deleteContext || isDeleting) {
      return;
    }

    setIsDeleting(true);
    setStatus("Deleting…");
    try {
      switch (deleteContext.kind) {
        case "sport":
          await apiClient.deleteSport(deleteContext.id, accessToken);
          setSelectedSport((current) => (current?.id === deleteContext.id ? null : current));
          break;
        case "host":
          await apiClient.deleteHost(deleteContext.id, accessToken);
          break;
        case "competition":
          await apiClient.deleteCompetition(deleteContext.id, accessToken);
          break;
        case "team":
          await apiClient.deleteTeam(deleteContext.id, accessToken);
          break;
      }

      setStatus(`${deleteContext.label} deleted.`);
      setDeleteContext(null);
      await loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setIsDeleting(false);
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
        await apiClient.updateSport(selectedSport.id, payload, accessToken);
        setStatus("Sport updated.");
        pushToast("Sport updated.", "success");
      } else {
        const created = await apiClient.createSport(payload, accessToken);
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

  const saveHost = async () => {
    if (!selectedSport) {
      return;
    }

    if (!hostName.trim()) {
      setStatus("Host name is required.");
      return;
    }

    if (hostType === "country" && !hostCountryId) {
      setStatus("Country is required for a country host.");
      return;
    }

    if (hostType !== "country" && hostCountryId) {
      setStatus("Only country hosts can reference a country.");
      return;
    }

    if (isLogoUploading) {
      setStatus("Please wait for the logo upload to finish before saving.");
      return;
    }

    if (hostLogoUrl && !isValidLogoSource(hostLogoUrl)) {
      setStatus("Invalid host logo URL.");
      return;
    }

    const payload: CreateHostRequest = {
      sportId: selectedSport.id,
      name: hostName,
      type: hostType,
      ...(hostCountryId ? { countryId: hostCountryId } : {}),
      ...(hostLogoUrl ? { logoUrl: hostLogoUrl } : {})
    };

    setIsSaving(true);
    try {
      if (editingHostId) {
        await apiClient.updateHost(editingHostId, payload, accessToken);
        setStatus("Host updated.");
        pushToast("Host updated.", "success");
      } else {
        await apiClient.createHost(payload, accessToken);
        setStatus("Host created.");
        pushToast("Host created.", "success");
      }

      await loadData();
      closeModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Save failed.";
      const friendlyMessage = msg === "host_duplicate" ? `${hostName} already exists.` : msg;
      setStatus(friendlyMessage);
      pushToast(friendlyMessage, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const saveCompetition = async () => {
    if (!selectedSport) {
      return;
    }

    if (!competitionName.trim() || !competitionHostId) {
      setStatus(!competitionName.trim() ? "Competition name is required." : "Competition host is required.");
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
      ...(competitionHostId ? { hostId: competitionHostId } : {}),
      ...(competitionLogoUrl ? { logoUrl: competitionLogoUrl } : {})
    };
    setIsSaving(true);
    try {
      if (editingCompetitionId) {
        await apiClient.updateCompetition(editingCompetitionId, payload, accessToken);
        setStatus("Competition updated.");
        pushToast("Competition updated.", "success");
      } else {
        await apiClient.createCompetition(payload, accessToken);
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
      ...(teamSlug ? { slug: teamSlug } : {}),
      ...(teamCountryId ? { countryId: teamCountryId } : {}),
      ...(teamLogoUrl ? { logoUrl: teamLogoUrl } : {})
    };
    setIsSaving(true);
    try {
      if (editingTeamId) {
        await apiClient.updateTeam(editingTeamId, payload, accessToken);
        setStatus("Team updated.");
        pushToast("Team updated.", "success");
      } else {
        await apiClient.createTeam(payload, accessToken);
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
                <h3>Hosts</h3>
                <button type="button" onClick={() => openHostEditor()} disabled={isCatalogView}>
                  Add Host
                </button>
              </div>
              <div className="entity-list">
                {sportHosts.length > 0 ? (
                  sportHosts.map((host) => (
                    <article className="entity-list-item" key={host.id}>
                      <div className="entity-row">
                        <EntityAvatar src={host.logoUrl} fallback={host.name} />
                        <div>
                          <strong>{host.name}</strong>
                          <small>{host.type}{host.countryId ? ` · ${countries.find((country) => country.id === host.countryId)?.name ?? ""}` : ""}</small>
                        </div>
                      </div>
                      <div className="entity-row-actions">
                        <button type="button" onClick={() => openHostEditor(host)} disabled={isCatalogView}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => queueDelete("host", host.id, host.name)} disabled={isCatalogView}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="field-note">No hosts are linked to this sport yet.</p>
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

          <SeasonMembershipPanel teams={teams} competitions={competitions} selectedSportId={selectedSport.id} accessToken={accessToken} />

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
          title={`${modalContext.action === "create" ? "Create" : "Edit"} ${modalContext.kind === "sport" ? "Sport" : modalContext.kind === "host" ? "Host" : modalContext.kind === "competition" ? "Competition" : "Team"}`}
          onClose={closeModal}
          footer={
            <div className="button-row">
              <button
                type="button"
                disabled={isSaving || isLogoUploading}
                onClick={
                  modalContext.kind === "sport"
                    ? saveSport
                    : modalContext.kind === "host"
                    ? saveHost
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
          ) : modalContext.kind === "host" ? (
            <div className="form-grid two-column">
              <label>
                Host Name
                <input value={hostName} onChange={(event) => setHostName(event.target.value)} />
              </label>
              <label>
                Host Type
                <select
                  value={hostType}
                  onChange={(event) => {
                    const nextType = event.target.value as HostType;
                    setHostType(nextType);
                    if (nextType !== "country") setHostCountryId("");
                  }}
                >
                  {hostTypes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {hostType === "country" ? (
                <label>
                  Country
                  <select value={hostCountryId} onChange={(event) => setHostCountryId(event.target.value)}>
                    <option value="">Select country</option>
                    {countries.map((country) => <option key={country.id} value={country.id}>{country.name}</option>)}
                  </select>
                </label>
              ) : null}
              <LogoUrlField label="Upload Logo / Flag" value={hostLogoUrl} onChange={setHostLogoUrl} />
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
                Host
                <select value={competitionHostId} onChange={(event) => setCompetitionHostId(event.target.value)}>
                  <option value="">None</option>
                  {sportHosts.map((host) => (
                    <option key={host.id} value={host.id}>{host.name} ({host.type})</option>
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
                Slug
                <input value={teamSlug} onChange={(event) => setTeamSlug(event.target.value)} placeholder="club-slug" />
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
          title={`Delete ${deleteContext.kind === "sport" ? "Sport" : deleteContext.kind === "host" ? "Host" : deleteContext.kind === "competition" ? "Competition" : "Team"}`}
          onClose={() => setDeleteContext(null)}
          footer={
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setDeleteContext(null)}>
                Cancel
              </button>
              <button type="button" onClick={executeDelete} disabled={isDeleting}>
                {isDeleting ? "Deleting…" : "Delete"}
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
