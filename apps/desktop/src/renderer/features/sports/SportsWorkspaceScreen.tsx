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
  Season,
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
import { normalizeCsvName } from "../../services/csv-files";
import { downloadExcel, parseExcelFile } from "../../services/excel-files";

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

type ClubSeasonOption = Season & { competitionName: string };

function EntityAvatar({ src, fallback }: { src?: string | undefined; fallback: string }) {
  const resolvedSrc = resolveAssetUrl(src);

  return (
    <div className="entity-avatar">
      {resolvedSrc ? <img src={resolvedSrc} alt={fallback} /> : <span>{fallback.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}

function EntityHeroCard({
  name,
  logoUrl,
  detail,
  size,
  selected,
  onClick,
  onDoubleClick,
  onDelete,
  deleteDisabled
}: {
  name: string;
  logoUrl?: string | undefined;
  detail: string;
  size: "sport" | "host" | "competition" | "team";
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const resolvedLogoUrl = resolveAssetUrl(logoUrl);

  return (
    <article
      className={`entity-hero-card entity-hero-card-${size} ${selected ? "selected" : ""}`}
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onDoubleClick) onDoubleClick();
      }}
    >
      <div className="entity-hero-card-logo" aria-hidden="true">
        {resolvedLogoUrl ? <img src={resolvedLogoUrl} alt="" /> : <span>{name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <div className="entity-hero-card-overlay" />
      <div className="entity-hero-card-footer">
        <div className="entity-hero-card-copy">
          <strong>{name}</strong>
          <small>{detail}</small>
        </div>
        {onDelete ? (
          <button
            type="button"
            className="entity-hero-card-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            disabled={deleteDisabled}
          >
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function SportsWorkspaceScreen({ accessToken }: { accessToken: string }) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [clubSeasonOptions, setClubSeasonOptions] = useState<ClubSeasonOption[]>([]);
  const [selectedClubSeasonId, setSelectedClubSeasonId] = useState("all");
  const [selectedClubSeasonTeamIds, setSelectedClubSeasonTeamIds] = useState<string[] | null>(null);
  const [selectedClubHostId, setSelectedClubHostId] = useState("all");
  const [teamCategory, setTeamCategory] = useState<"club" | "national">("club");
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
  const hostRosterFileRef = useRef<HTMLInputElement>(null);
  const [isImportingHostRoster, setIsImportingHostRoster] = useState(false);
  const [updateExistingTeamDetails, setUpdateExistingTeamDetails] = useState(false);


  const pushToast = (message: string, type: "success" | "error" | "info" = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((t) => [...t, { id, message, type }]);
  };

  const [sportName, setSportName] = useState("");
  const [sportLogoUrl, setSportLogoUrl] = useState("");
  const [sportCountryIds, setSportCountryIds] = useState<string[]>([]);
  const [sportHostSearch, setSportHostSearch] = useState("");
  const [assignedSportHosts, setAssignedSportHosts] = useState<Host[]>([]);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [hostDialogSearch, setHostDialogSearch] = useState("");
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [hostActionId, setHostActionId] = useState<string | null>(null);

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
  const [teamHomeStadiumName, setTeamHomeStadiumName] = useState("");
  const [teamType, setTeamType] = useState<TeamType>("club");
  const [teamHostId, setTeamHostId] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

  const supportedCountries = useMemo(
    () =>
      selectedSport?.countryIds?.length
        ? countries.filter((country) => selectedSport.countryIds?.includes(country.id))
        : [],
    [countries, selectedSport]
  );

  const sportHosts = useMemo(
    () => assignedSportHosts,
    [assignedSportHosts]
  );
  const filteredSportHosts = useMemo(() => {
    const query = sportHostSearch.trim().toLowerCase();
    return query ? sportHosts.filter((host) => `${host.name} ${host.type}`.toLowerCase().includes(query)) : sportHosts;
  }, [sportHostSearch, sportHosts]);
  const availableHosts = useMemo(() => {
    const assignedIds = new Set(sportHosts.map((host) => host.id));
    const query = hostDialogSearch.trim().toLowerCase();
    return hosts.filter((host) => !assignedIds.has(host.id) && (!query || `${host.name} ${host.type} ${host.sportId}`.toLowerCase().includes(query)));
  }, [hostDialogSearch, hosts, sportHosts]);

  const sportCompetitions = useMemo(
    () => (selectedSport ? competitions.filter((competition) => competition.sportId === selectedSport.id) : []),
    [competitions, selectedSport]
  );

  const sportTeams = useMemo(
    () => (selectedSport ? teams.filter((team) => team.sportId === selectedSport.id) : []),
    [teams, selectedSport]
  );

  const clubs = sportTeams.filter((team) => team.type === "club");
  const visibleTeams = sportTeams.filter((team) => team.type === teamCategory
    && (!selectedClubSeasonTeamIds || selectedClubSeasonTeamIds.includes(team.id))
    && (selectedClubHostId === "all" || team.hostId === selectedClubHostId));
  const nationalTeams = sportTeams.filter((team) => team.type === "national");

  useEffect(() => {
    let cancelled = false;
    setSelectedClubSeasonId("all");
    setSelectedClubSeasonTeamIds(null);
    if (!selectedSport || sportCompetitions.length === 0) {
      setClubSeasonOptions([]);
      return;
    }

    void Promise.all(
      sportCompetitions
        .filter((competition) => competition.participantType === (teamCategory === "club" ? "clubs" : "nationalTeams"))
        .map(async (competition) => {
          const seasons = await apiClient.listSeasons(competition.id);
          return seasons.map((season) => ({ ...season, competitionName: competition.name }));
        })
    )
      .then((seasonGroups) => {
        if (!cancelled) setClubSeasonOptions(seasonGroups.flat());
      })
      .catch(() => {
        if (!cancelled) setClubSeasonOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSport?.id, sportCompetitions, teamCategory]);

  useEffect(() => {
    setSelectedClubHostId("all");
  }, [selectedSport?.id]);

  useEffect(() => {
    let cancelled = false;
    if (selectedClubSeasonId === "all") {
      setSelectedClubSeasonTeamIds(null);
      return;
    }

    const season = clubSeasonOptions.find((option) => option.id === selectedClubSeasonId);
    if (!season) {
      setSelectedClubSeasonTeamIds(null);
      return;
    }

    void apiClient.listSeasonTeams(season.competitionId, season.id)
      .then((members) => {
        if (!cancelled) setSelectedClubSeasonTeamIds(members.map((member) => member.teamId));
      })
      .catch(() => {
        if (!cancelled) setSelectedClubSeasonTeamIds([]);
      });

    return () => {
      cancelled = true;
    };
  }, [clubSeasonOptions, selectedClubSeasonId]);

  const loadData = async () => {
    try {
      const [sportsData, countriesData, hostsData, competitionData, teamData] = await Promise.all([
        apiClient.listSports(),
        apiClient.listCountries(),
        apiClient.listHosts(),
        apiClient.listCompetitions(viewMode),
        apiClient.listTeams(viewMode)
      ]);

      setSports(sportsData);
      setCountries(countriesData);
      setHosts(hostsData);
      if (selectedSport) setAssignedSportHosts(await apiClient.listHosts(selectedSport.id));
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

  const exportHostRoster = () => {
    const host = sportHosts.find((item) => item.id === selectedClubHostId);
    if (!host || !selectedSport) { setStatus("Select a sport and host before exporting its roster."); return; }
    const roster = teams.filter((team) => team.hostId === host.id && team.type === teamCategory);
    downloadExcel(`${host.name.replace(/[^a-z0-9-_]+/gi, "-")}-${teamCategory}-roster.xlsx`, "Teams", "Host team roster", ["Team ID", "Sport", "Host", "Team Name", "Team Type", "Short Name", "Slug", "Home Stadium Name", "Stadium Photo URL", "Logo URL"], roster.map((team) => ({
      "Team ID": team.id, Sport: selectedSport.name, Host: host.name, "Team Name": team.name,
      "Team Type": team.type === "club" ? "Club" : "National Team", "Short Name": team.shortName, Slug: team.slug,
      "Home Stadium Name": team.homeStadiumName, "Stadium Photo URL": team.homeStadiumPhotoUrl, "Logo URL": team.logoUrl
    })), "Keep Team ID, Sport, Host, Team Name and Team Type unchanged for existing teams. By default existing rows are skipped. If Update existing team details is enabled before upload, Short Name, Home Stadium Name, Stadium Photo URL and Logo URL can be updated; blank cells keep current values. Leave Team ID blank for a new team and fill Team Name and Team Type. Logo URL is optional.");
    setStatus(`Exported ${roster.length} teams for ${host.name}.`);
  };

  const importHostRoster = async (file?: File) => {
    const host = sportHosts.find((item) => item.id === selectedClubHostId);
    if (!file || !host) return;
    setIsImportingHostRoster(true);
    try {
      if (updateExistingTeamDetails) {
        try {
          const capabilities = await apiClient.getHostClubImportCapabilities(host.id, accessToken);
          if (!capabilities.updateExisting) throw new Error("unsupported");
        } catch {
          throw new Error("The connected backend has not been updated to support workbook corrections. No workbook rows were uploaded.");
        }
      }
      const rows = await parseExcelFile(file);
      const hasColumn = (row: Record<string, string>, ...aliases: string[]) => aliases.some((column) => column in row);
      const hasRequiredColumns = rows.every((row) => hasColumn(row, "team id", "team_id")
        && hasColumn(row, "sport", "sport_name", "sport_id")
        && hasColumn(row, "host", "host_name", "host_id")
        && hasColumn(row, "team name", "team_name")
        && hasColumn(row, "team type", "team_type"));
      if (!hasRequiredColumns) throw new Error("Roster workbook needs Team ID, Sport, Host, Team Name, and Team Type columns. Leave Team ID blank for new teams.");
      const read = (row: Record<string, string>, ...aliases: string[]) => aliases.map((key) => row[key]).find((value) => value !== undefined) ?? "";
      const normalizeTeamType = (value: string) => value.trim().toLowerCase() === "national team" ? "national" : value.trim().toLowerCase();
      for (const row of rows) {
        const teamId = read(row, "team id", "team_id");
        const teamName = read(row, "team name", "team_name");
        const isExistingTeam = teams.some((team) => team.hostId === host.id
          && ((teamId && team.id === teamId) || (teamName && normalizeCsvName(team.name) === normalizeCsvName(teamName))));
        if (isExistingTeam) continue;
        const rowSport = read(row, "sport", "sport_name");
        const rowHost = read(row, "host", "host_name");
        const legacySportId = read(row, "sport_id");
        const legacyHostId = read(row, "host_id");
        if ((rowSport && rowSport.toLocaleLowerCase() !== selectedSport?.name.toLocaleLowerCase()) || (legacySportId && legacySportId !== selectedSport?.id)) {
          throw new Error(`Sport on row ${teamName} does not match the selected sport.`);
        }
        if ((rowHost && rowHost.toLocaleLowerCase() !== host.name.toLocaleLowerCase()) || (legacyHostId && legacyHostId !== host.id)) {
          throw new Error(`Host on row ${teamName} does not match the selected host.`);
        }
        if (!teamId && normalizeTeamType(read(row, "team type", "team_type")) !== teamCategory) {
          throw new Error(`New rows in this view must have Team Type set to ${teamCategory === "club" ? "Club" : "National Team"}.`);
        }
      }
      const result = await apiClient.importHostClubs(host.id, rows.map((row) => ({
        teamId: read(row, "team id", "team_id"), sportId: read(row, "sport_id") || selectedSport?.id || "", hostId: read(row, "host_id") || host.id,
        teamName: read(row, "team name", "team_name"), teamType: normalizeTeamType(read(row, "team type", "team_type")),
        shortName: read(row, "short name", "short_name"), slug: read(row, "slug"), homeStadiumName: read(row, "home stadium name", "home_stadium_name"),
        homeStadiumPhotoUrl: read(row, "stadium photo url", "home stadium photo url", "home_stadium_photo_url"), logoUrl: read(row, "logo url", "logo_url")
      })), accessToken, { updateExisting: updateExistingTeamDetails });
      await loadData();
      setStatus(`Host roster imported: ${result.createdCount} added, ${result.updatedCount} updated, ${result.skippedCount} unchanged or skipped.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to import host roster."); }
    finally { setIsImportingHostRoster(false); if (hostRosterFileRef.current) hostRosterFileRef.current.value = ""; }
  };

  useEffect(() => {
    void loadData();
  }, [viewMode]);

  useEffect(() => {
    if (!selectedSport) {
      setAssignedSportHosts([]);
      return;
    }
    void apiClient.listHosts(selectedSport.id).then(setAssignedSportHosts).catch(() => setAssignedSportHosts([]));
  }, [selectedSport?.id]);

  const openModal = (modal: WorkspaceModal) => {
    setModalContext(modal);
  };

  const closeModal = () => {
    setModalContext(null);
    setDeleteContext(null);
    setSportName("");
    setSportLogoUrl("");
    setSportCountryIds([]);
    setSportHostSearch("");
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
    setTeamHomeStadiumName("");
    setTeamType("club");
    setTeamHostId("");
    setEditingTeamId(null);
  };

  const openSportEditor = (sport?: Sport) => {
    if (sport) {
      setSportName(sport.name);
      setSportLogoUrl(sport.logoUrl ?? "");
      setSportCountryIds(sport.countryIds ?? []);
      setSportHostSearch("");
      openModal({ kind: "sport", action: "edit" });
    } else {
      setSportName("");
      setSportLogoUrl("");
      setSportCountryIds([]);
      setSportHostSearch("");
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

  const openHostAssignment = () => {
    setHostDialogSearch("");
    setSelectedHostIds([]);
    setHostDialogOpen(true);
  };

  const refreshAssignedHosts = async () => {
    if (selectedSport) setAssignedSportHosts(await apiClient.listHosts(selectedSport.id));
  };

  const addSelectedHosts = async () => {
    if (!selectedSport || !selectedHostIds.length || hostActionId) return;
    setHostActionId("adding");
    setStatus("Adding...");
    try {
      await Promise.all(selectedHostIds.map((hostId) => apiClient.addHostToSport(hostId, selectedSport.id, accessToken)));
      await refreshAssignedHosts();
      setSelectedHostIds([]);
      setHostDialogOpen(false);
      setStatus("Hosts added.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to add Hosts.");
    } finally { setHostActionId(null); }
  };

  const removeAssignedHost = async (hostId: string) => {
    if (!selectedSport || hostActionId) return;
    setHostActionId(hostId);
    setStatus("Removing...");
    try {
      await apiClient.removeHostFromSport(hostId, selectedSport.id, accessToken);
      await refreshAssignedHosts();
      setStatus("Host removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to remove Host.");
    } finally { setHostActionId(null); }
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

  const openTeamEditor = (team?: Team, createType: "club" | "national" = teamCategory) => {
    if (!selectedSport) {
      return;
    }

    if (team) {
      setTeamName(team.name);
      setTeamShortName(team.shortName ?? "");
      setTeamSlug(team.slug ?? "");
      setTeamLogoUrl(team.logoUrl ?? "");
      setTeamHomeStadiumName(team.homeStadiumName ?? "");
      setTeamType(team.type);
      setTeamHostId(team.hostId ?? "");
      setEditingTeamId(team.id);
      openModal({ kind: "team", action: "edit" });
    } else {
      setTeamName("");
      setTeamShortName("");
      setTeamSlug("");
      setTeamLogoUrl("");
      setTeamHomeStadiumName("");
      setTeamType(createType);
      setTeamHostId("");
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
      ...(teamHostId ? { hostId: teamHostId } : {}),
      ...(teamShortName ? { shortName: teamShortName } : {}),
      ...(teamSlug ? { slug: teamSlug } : {}),
      ...(teamHomeStadiumName.trim() ? { homeStadiumName: teamHomeStadiumName.trim() } : {}),
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
        <span>Hosts</span>
        <strong>{sportHosts.length}</strong>
        <small>Assigned to {selectedSport.name}</small>
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
            <EntityHeroCard
              key={sport.id}
              name={sport.name}
              logoUrl={sport.logoUrl}
              detail={`${hosts.filter((host) => host.sportId === sport.id).length} host${hosts.filter((host) => host.sportId === sport.id).length === 1 ? "" : "s"} assigned`}
              size="sport"
              selected={selectedSport?.id === sport.id}
              onClick={() => setSelectedSport(sport)}
              onDoubleClick={() => openSportEditor(sport)}
              onDelete={() => queueDelete("sport", sport.id, sport.name)}
              deleteDisabled={isCatalogView}
            />
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
                <button type="button" onClick={openHostAssignment} disabled={isCatalogView}>
                  + Add Host
                </button>
              </div>
              <div className="entity-list">
                {sportHosts.length > 0 ? (
                  sportHosts.map((host) => (
                    <EntityHeroCard
                      key={host.id}
                      name={host.name}
                      logoUrl={host.logoUrl}
                      detail={`${host.type}${host.countryId ? ` · ${countries.find((country) => country.id === host.countryId)?.name ?? ""}` : ""}`}
                      size="host"
                      onDoubleClick={() => openHostEditor(host)}
                      onDelete={() => queueDelete("host", host.id, host.name)}
                      deleteDisabled={isCatalogView || Boolean(hostActionId)}
                    />
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
              </div>
              <div className="entity-list">
                {sportCompetitions.length > 0 ? (
                  sportCompetitions.map((competition) => (
                    <EntityHeroCard
                      key={competition.id}
                      name={competition.name}
                      logoUrl={competition.logoUrl}
                      detail={`${competition.type} · ${competition.participantType === "clubs" ? "Clubs" : "National Teams"}`}
                      size="competition"
                      onDoubleClick={() => openCompetitionEditor(competition)}
                      onDelete={() => queueDelete("competition", competition.id, competition.name)}
                      deleteDisabled={isCatalogView}
                    />
                  ))
                ) : (
                  <p className="field-note">No competitions exist for this sport yet.</p>
                )}
              </div>
            </article>
          </section>

          <SeasonMembershipPanel teams={teams} hosts={sportHosts} competitions={competitions} selectedSportId={selectedSport.id} accessToken={accessToken} />

          <section className="console-panel sports-workspace-grid">
            <article className="entity-panel">
              <div className="panel-heading">
                <div className="view-mode-toggle" role="group" aria-label="Team category">
                  <button type="button" className={teamCategory === "club" ? "active" : ""} onClick={() => setTeamCategory("club")}>Clubs</button>
                  <button type="button" className={teamCategory === "national" ? "active" : ""} onClick={() => setTeamCategory("national")}>National Teams</button>
                </div>
                <label className="club-season-filter">
                  <span>Competition season</span>
                  <select value={selectedClubSeasonId} onChange={(event) => setSelectedClubSeasonId(event.target.value)}>
                    <option value="all">All</option>
                    {clubSeasonOptions.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.competitionName} · {season.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="club-season-filter">
                  <span>Host</span>
                  <select value={selectedClubHostId} onChange={(event) => setSelectedClubHostId(event.target.value)}>
                    <option value="all">All</option>
                    {sportHosts.map((host) => (
                      <option key={host.id} value={host.id}>{host.name}</option>
                    ))}
                  </select>
                </label>
                <div className="button-row">
                  <button type="button" className="secondary" onClick={exportHostRoster} disabled={isCatalogView || selectedClubHostId === "all"}>{`Export ${teamCategory === "club" ? "Club" : "National Team"} Roster Excel`}</button>
                  <button type="button" className="secondary" onClick={() => hostRosterFileRef.current?.click()} disabled={isCatalogView || selectedClubHostId === "all" || isImportingHostRoster}>{isImportingHostRoster ? "Importing…" : `Import ${teamCategory === "club" ? "Club" : "National Team"} Roster Excel`}</button>
                  <button type="button" onClick={() => openTeamEditor(undefined, teamCategory)} disabled={isCatalogView}>{teamCategory === "club" ? "Add Club" : "Add National Team"}</button>
                  <input ref={hostRosterFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void importHostRoster(event.target.files?.[0])} />
                </div>
              </div>
              <label className="field-note"><input type="checkbox" checked={updateExistingTeamDetails} onChange={(event) => setUpdateExistingTeamDetails(event.target.checked)} disabled={isCatalogView || isImportingHostRoster} /> Update details for existing teams matched by Team ID or exact name (blank cells keep current values)</label>
              <p className="field-note">Use the Excel workbook for roster export and import. It uses the same fields as Add {teamCategory === "club" ? "Club" : "National Team"}. Existing Team IDs and names stay associated with their registered records. Leave Team ID blank for a new row; GiTO creates the ID. Logo URL is optional.</p>
              <div className="entity-list">
                {visibleTeams.length > 0 ? (
                  visibleTeams.map((team) => (
                    <EntityHeroCard
                      key={team.id}
                      name={team.name}
                      logoUrl={team.logoUrl}
                      detail={teamCategory === "club"
                        ? team.homeStadiumName ? `${team.shortName ?? "Club"} · ${team.homeStadiumName}` : team.shortName ?? "Club"
                        : team.countryId ? countries.find((country) => country.id === team.countryId)?.name ?? "National Team" : "National Team"}
                      size="team"
                      onDoubleClick={() => openTeamEditor(team)}
                      onDelete={() => queueDelete("team", team.id, team.name)}
                      deleteDisabled={isCatalogView}
                    />
                  ))
                ) : (
                  <p className="field-note">
                    {selectedClubSeasonId !== "all" && selectedClubHostId !== "all"
                      ? `No ${teamCategory === "club" ? "clubs" : "national teams"} match this competition season and host.`
                      : selectedClubSeasonId !== "all"
                      ? `No ${teamCategory === "club" ? "clubs" : "national teams"} are assigned to this competition season.`
                      : selectedClubHostId !== "all"
                      ? `No ${teamCategory === "club" ? "clubs" : "national teams"} are assigned to this host.`
                      : `No ${teamCategory === "club" ? "clubs" : "national teams"} are defined for this sport yet.`}
                  </p>
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
              <LogoUrlField accessToken={accessToken} label="Upload Logo" value={sportLogoUrl} onChange={setSportLogoUrl} />
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
              <label className="full-width">
                Hosts for this Sport
                <input
                  value={sportHostSearch}
                  onChange={(event) => setSportHostSearch(event.target.value)}
                  placeholder="Search hosts"
                  disabled={!selectedSport}
                />
                <div className="entity-list">
                  {!selectedSport ? (
                    <span className="field-note">Create the sport first, then add Hosts from this workspace.</span>
                  ) : filteredSportHosts.length > 0 ? (
                    filteredSportHosts.map((host) => (
                      <div className="entity-list-item" key={host.id}>
                        <strong>{host.name}</strong>
                        <span>{host.type}</span>
                      </div>
                    ))
                  ) : (
                    <span className="field-note">No Hosts match this search.</span>
                  )}
                </div>
                <button type="button" className="secondary" onClick={() => {
                  setModalContext(null);
                  openHostEditor();
                }} disabled={!selectedSport || isCatalogView}>
                  Add Host
                </button>
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
                    setHostCountryId("");
                  }}
                >
                  {hostTypes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <LogoUrlField accessToken={accessToken} label="Upload Logo / Flag" value={hostLogoUrl} onChange={setHostLogoUrl} />
            </div>
          ) : modalContext.kind === "competition" ? (
            <div className="form-grid two-column">
              <label>
                Competition Name
                <input value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} />
              </label>
              <LogoUrlField accessToken={accessToken} label="Upload Logo" value={competitionLogoUrl} onChange={setCompetitionLogoUrl} />
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
              {teamType === "club" ? (
                <label>
                  Home Stadium Name
                  <input value={teamHomeStadiumName} onChange={(event) => setTeamHomeStadiumName(event.target.value)} placeholder="Enter home stadium name" />
                </label>
              ) : null}
              <label>
                Participating Host
                <select value={teamHostId} onChange={(event) => setTeamHostId(event.target.value)}>
                  <option value="">None</option>
                  {sportHosts.map((host) => <option key={host.id} value={host.id}>{host.name} ({host.type})</option>)}
                </select>
              </label>
              <LogoUrlField accessToken={accessToken} label="Upload Logo" value={teamLogoUrl} onChange={setTeamLogoUrl} onUploadStateChange={setIsLogoUploading} />
            </div>
          )}
        </Modal>
      ) : null}

      {hostDialogOpen && selectedSport ? (
        <Modal
          title={`Add Host to ${selectedSport.name}`}
          onClose={() => setHostDialogOpen(false)}
          footer={
            <div className="button-row">
              <button type="button" onClick={() => void addSelectedHosts()} disabled={!selectedHostIds.length || Boolean(hostActionId)}>
                {hostActionId === "adding" ? "Adding..." : "Add Selected Hosts"}
              </button>
              <button type="button" className="secondary" onClick={() => setHostDialogOpen(false)} disabled={Boolean(hostActionId)}>Cancel</button>
            </div>
          }
        >
          <label>
            Search Host
            <input value={hostDialogSearch} onChange={(event) => setHostDialogSearch(event.target.value)} placeholder="Search FIFA, Spain..." autoFocus />
          </label>
          <div className="entity-list">
            {availableHosts.length ? availableHosts.map((host) => (
              <label className="checkbox-option" key={host.id}>
                <input type="checkbox" checked={selectedHostIds.includes(host.id)} onChange={() => setSelectedHostIds((current) => current.includes(host.id) ? current.filter((id) => id !== host.id) : [...current, host.id])} />
                <span><strong>{host.name}</strong> · {host.type} · {host.sportId}</span>
              </label>
            )) : <p className="field-note">No available Hosts match this search.</p>}
          </div>
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
