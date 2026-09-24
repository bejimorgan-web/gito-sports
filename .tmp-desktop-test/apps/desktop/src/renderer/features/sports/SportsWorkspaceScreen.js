import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
import { Modal } from "../../components/Modal";
import { Toast } from "../../components/Toast";
import { SeasonMembershipPanel } from "./SeasonMembershipPanel";
const competitionScopes = ["domestic", "continental", "international", "global", "regional", "friendly", "custom"];
const competitionTypes = ["league", "cup", "tournament", "championship", "friendly", "custom"];
const competitionParticipantTypes = [
    { value: "clubs", label: "Clubs" },
    { value: "nationalTeams", label: "National Teams" }
];
const teamTypes = [
    { value: "club", label: "Club" },
    { value: "national", label: "National Team" },
    { value: "custom", label: "Custom" }
];
const hostTypes = [
    { value: "country", label: "Country" },
    { value: "organization", label: "Organization" },
    { value: "federation", label: "Federation" },
    { value: "association", label: "Association" },
    { value: "regional", label: "Regional" },
    { value: "international", label: "International" },
    { value: "other", label: "Other" }
];
function EntityAvatar({ src, fallback }) {
    const resolvedSrc = resolveAssetUrl(src);
    return (_jsx("div", { className: "entity-avatar", children: resolvedSrc ? _jsx("img", { src: resolvedSrc, alt: fallback }) : _jsx("span", { children: fallback.slice(0, 2).toUpperCase() }) }));
}
function EntityHeroCard({ name, logoUrl, detail, size, selected, onClick, onDoubleClick, onDelete, deleteDisabled }) {
    const resolvedLogoUrl = resolveAssetUrl(logoUrl);
    return (_jsxs("article", { className: `entity-hero-card entity-hero-card-${size} ${selected ? "selected" : ""}`, tabIndex: 0, onClick: onClick, onDoubleClick: onDoubleClick, onKeyDown: (event) => {
            if (event.key === "Enter" && onDoubleClick)
                onDoubleClick();
        }, children: [_jsx("div", { className: "entity-hero-card-logo", "aria-hidden": "true", children: resolvedLogoUrl ? _jsx("img", { src: resolvedLogoUrl, alt: "" }) : _jsx("span", { children: name.slice(0, 2).toUpperCase() }) }), _jsx("div", { className: "entity-hero-card-overlay" }), _jsxs("div", { className: "entity-hero-card-footer", children: [_jsxs("div", { className: "entity-hero-card-copy", children: [_jsx("strong", { children: name }), _jsx("small", { children: detail })] }), onDelete ? (_jsx("button", { type: "button", className: "entity-hero-card-delete", onClick: (event) => {
                            event.stopPropagation();
                            onDelete();
                        }, disabled: deleteDisabled, children: "Delete" })) : null] })] }));
}
export function SportsWorkspaceScreen({ accessToken }) {
    const [sports, setSports] = useState([]);
    const [countries, setCountries] = useState([]);
    const [hosts, setHosts] = useState([]);
    const [competitions, setCompetitions] = useState([]);
    const [teams, setTeams] = useState([]);
    const [clubSeasonOptions, setClubSeasonOptions] = useState([]);
    const [selectedClubSeasonId, setSelectedClubSeasonId] = useState("all");
    const [selectedClubSeasonTeamIds, setSelectedClubSeasonTeamIds] = useState(null);
    const [selectedClubHostId, setSelectedClubHostId] = useState("all");
    const [selectedSport, setSelectedSport] = useState(null);
    const [status, setStatus] = useState("Ready");
    const [isSaving, setIsSaving] = useState(false);
    const [viewMode, setViewMode] = useState("legacy");
    const [modalContext, setModalContext] = useState(null);
    const [deleteContext, setDeleteContext] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const isCatalogView = viewMode === "catalog";
    const [toasts, setToasts] = useState([]);
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const pushToast = (message, type = "success") => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((t) => [...t, { id, message, type }]);
    };
    const [sportName, setSportName] = useState("");
    const [sportLogoUrl, setSportLogoUrl] = useState("");
    const [sportCountryIds, setSportCountryIds] = useState([]);
    const [sportHostSearch, setSportHostSearch] = useState("");
    const [assignedSportHosts, setAssignedSportHosts] = useState([]);
    const [hostDialogOpen, setHostDialogOpen] = useState(false);
    const [hostDialogSearch, setHostDialogSearch] = useState("");
    const [selectedHostIds, setSelectedHostIds] = useState([]);
    const [hostActionId, setHostActionId] = useState(null);
    const [hostName, setHostName] = useState("");
    const [hostType, setHostType] = useState("country");
    const [hostCountryId, setHostCountryId] = useState("");
    const [hostLogoUrl, setHostLogoUrl] = useState("");
    const [editingHostId, setEditingHostId] = useState(null);
    const [competitionName, setCompetitionName] = useState("");
    const [competitionLogoUrl, setCompetitionLogoUrl] = useState("");
    const [competitionHostId, setCompetitionHostId] = useState("");
    const [competitionScope, setCompetitionScope] = useState("domestic");
    const [competitionType, setCompetitionType] = useState("league");
    const [competitionParticipantType, setCompetitionParticipantType] = useState("clubs");
    const [editingCompetitionId, setEditingCompetitionId] = useState(null);
    const [teamName, setTeamName] = useState("");
    const [teamShortName, setTeamShortName] = useState("");
    const [teamSlug, setTeamSlug] = useState("");
    const [teamLogoUrl, setTeamLogoUrl] = useState("");
    const [teamType, setTeamType] = useState("club");
    const [teamCountryId, setTeamCountryId] = useState("");
    const [teamHostId, setTeamHostId] = useState("");
    const [editingTeamId, setEditingTeamId] = useState(null);
    const supportedCountries = useMemo(() => selectedSport?.countryIds?.length
        ? countries.filter((country) => selectedSport.countryIds?.includes(country.id))
        : [], [countries, selectedSport]);
    const sportHosts = useMemo(() => assignedSportHosts, [assignedSportHosts]);
    const filteredSportHosts = useMemo(() => {
        const query = sportHostSearch.trim().toLowerCase();
        return query ? sportHosts.filter((host) => `${host.name} ${host.type}`.toLowerCase().includes(query)) : sportHosts;
    }, [sportHostSearch, sportHosts]);
    const availableHosts = useMemo(() => {
        const assignedIds = new Set(sportHosts.map((host) => host.id));
        const query = hostDialogSearch.trim().toLowerCase();
        return hosts.filter((host) => !assignedIds.has(host.id) && (!query || `${host.name} ${host.type} ${host.sportId}`.toLowerCase().includes(query)));
    }, [hostDialogSearch, hosts, sportHosts]);
    const sportCompetitions = useMemo(() => (selectedSport ? competitions.filter((competition) => competition.sportId === selectedSport.id) : []), [competitions, selectedSport]);
    const sportTeams = useMemo(() => (selectedSport ? teams.filter((team) => team.sportId === selectedSport.id) : []), [teams, selectedSport]);
    const clubs = sportTeams.filter((team) => team.type === "club");
    const visibleClubs = selectedClubSeasonTeamIds
        ? clubs.filter((team) => selectedClubSeasonTeamIds.includes(team.id) && (selectedClubHostId === "all" || team.hostId === selectedClubHostId))
        : clubs.filter((team) => selectedClubHostId === "all" || team.hostId === selectedClubHostId);
    const nationalTeams = sportTeams.filter((team) => team.type === "national");
    useEffect(() => {
        let cancelled = false;
        setSelectedClubSeasonId("all");
        setSelectedClubSeasonTeamIds(null);
        setSelectedClubHostId("all");
        if (!selectedSport || sportCompetitions.length === 0) {
            setClubSeasonOptions([]);
            return;
        }
        void Promise.all(sportCompetitions
            .filter((competition) => competition.participantType === "clubs")
            .map(async (competition) => {
            const seasons = await apiClient.listSeasons(competition.id);
            return seasons.map((season) => ({ ...season, competitionName: competition.name }));
        }))
            .then((seasonGroups) => {
            if (!cancelled)
                setClubSeasonOptions(seasonGroups.flat());
        })
            .catch(() => {
            if (!cancelled)
                setClubSeasonOptions([]);
        });
        return () => {
            cancelled = true;
        };
    }, [selectedSport?.id, sportCompetitions]);
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
            if (!cancelled)
                setSelectedClubSeasonTeamIds(members.map((member) => member.teamId));
        })
            .catch(() => {
            if (!cancelled)
                setSelectedClubSeasonTeamIds([]);
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
            if (selectedSport)
                setAssignedSportHosts(await apiClient.listHosts(selectedSport.id));
            setCompetitions(competitionData);
            setTeams(teamData);
            if (selectedSport) {
                const refreshed = sportsData.find((sport) => sport.id === selectedSport.id);
                setSelectedSport(refreshed ?? null);
            }
        }
        catch {
            setStatus("Unable to load sports workspace data.");
        }
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
    const openModal = (modal) => {
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
        setTeamType("club");
        setTeamCountryId("");
        setTeamHostId("");
        setEditingTeamId(null);
    };
    const openSportEditor = (sport) => {
        if (sport) {
            setSportName(sport.name);
            setSportLogoUrl(sport.logoUrl ?? "");
            setSportCountryIds(sport.countryIds ?? []);
            setSportHostSearch("");
            openModal({ kind: "sport", action: "edit" });
        }
        else {
            setSportName("");
            setSportLogoUrl("");
            setSportCountryIds([]);
            setSportHostSearch("");
            openModal({ kind: "sport", action: "create" });
        }
    };
    const openHostEditor = (host) => {
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
        }
        else {
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
        if (selectedSport)
            setAssignedSportHosts(await apiClient.listHosts(selectedSport.id));
    };
    const addSelectedHosts = async () => {
        if (!selectedSport || !selectedHostIds.length || hostActionId)
            return;
        setHostActionId("adding");
        setStatus("Adding...");
        try {
            await Promise.all(selectedHostIds.map((hostId) => apiClient.addHostToSport(hostId, selectedSport.id, accessToken)));
            await refreshAssignedHosts();
            setSelectedHostIds([]);
            setHostDialogOpen(false);
            setStatus("Hosts added.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to add Hosts.");
        }
        finally {
            setHostActionId(null);
        }
    };
    const removeAssignedHost = async (hostId) => {
        if (!selectedSport || hostActionId)
            return;
        setHostActionId(hostId);
        setStatus("Removing...");
        try {
            await apiClient.removeHostFromSport(hostId, selectedSport.id, accessToken);
            await refreshAssignedHosts();
            setStatus("Host removed.");
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Unable to remove Host.");
        }
        finally {
            setHostActionId(null);
        }
    };
    const openCompetitionEditor = (competition) => {
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
        }
        else {
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
    const openTeamEditor = (team) => {
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
            setTeamHostId(team.hostId ?? "");
            setEditingTeamId(team.id);
            openModal({ kind: "team", action: "edit" });
        }
        else {
            setTeamName("");
            setTeamShortName("");
            setTeamSlug("");
            setTeamLogoUrl("");
            setTeamType("club");
            setTeamCountryId("");
            setTeamHostId("");
            setEditingTeamId(null);
            openModal({ kind: "team", action: "create" });
        }
    };
    const queueDelete = (kind, id, label) => {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
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
        const payload = {
            name: sportName,
            ...(sportLogoUrl ? { logoUrl: sportLogoUrl } : {}),
            countryIds: sportCountryIds
        };
        let createdId;
        setIsSaving(true);
        try {
            if (modalContext?.action === "edit" && selectedSport) {
                await apiClient.updateSport(selectedSport.id, payload, accessToken);
                setStatus("Sport updated.");
                pushToast("Sport updated.", "success");
            }
            else {
                const created = await apiClient.createSport(payload, accessToken);
                setStatus("Sport created.");
                setSelectedSport(created);
                createdId = created.id;
                pushToast("Sport created.", "success");
            }
            await loadData();
            closeModal();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Save failed.";
            setStatus(msg);
            pushToast(msg, "error");
        }
        finally {
            setIsSaving(false);
        }
    };
    // provide a way to remove individual toasts
    const removeToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));
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
        const payload = {
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
            }
            else {
                await apiClient.createHost(payload, accessToken);
                setStatus("Host created.");
                pushToast("Host created.", "success");
            }
            await loadData();
            closeModal();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Save failed.";
            const friendlyMessage = msg === "host_duplicate" ? `${hostName} already exists.` : msg;
            setStatus(friendlyMessage);
            pushToast(friendlyMessage, "error");
        }
        finally {
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
        const payload = {
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
            }
            else {
                await apiClient.createCompetition(payload, accessToken);
                setStatus("Competition created.");
                pushToast("Competition created.", "success");
            }
            await loadData();
            closeModal();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Save failed.";
            setStatus(msg);
            pushToast(msg, "error");
        }
        finally {
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
        const payload = {
            sportId: selectedSport.id,
            name: teamName,
            type: teamType,
            ...(teamHostId ? { hostId: teamHostId } : {}),
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
            }
            else {
                await apiClient.createTeam(payload, accessToken);
                setStatus("Team created.");
                pushToast("Team created.", "success");
            }
            await loadData();
            closeModal();
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Save failed.";
            setStatus(msg);
            pushToast(msg, "error");
        }
        finally {
            setIsSaving(false);
        }
    };
    const sportSummary = selectedSport ? (_jsxs("div", { className: "dashboard-summary-grid", children: [_jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Hosts" }), _jsx("strong", { children: sportHosts.length }), _jsxs("small", { children: ["Assigned to ", selectedSport.name] })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Competitions" }), _jsx("strong", { children: sportCompetitions.length }), _jsx("small", { children: "Competition entities" })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "Clubs" }), _jsx("strong", { children: clubs.length }), _jsx("small", { children: "Club entries" })] }), _jsxs("article", { className: "dashboard-metric-card", children: [_jsx("span", { children: "National Teams" }), _jsx("strong", { children: nationalTeams.length }), _jsx("small", { children: "National team entries" })] })] })) : null;
    return (_jsxs("section", { className: "screen-stack sports-workspace-screen", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Sports" }), _jsx("h2", { children: "Sports Workspace" }), _jsx("span", { children: "Open a sport to manage its countries, competitions, clubs, and national teams." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Sports" }), _jsx("button", { type: "button", onClick: () => openSportEditor(), children: "Add Sport" })] }), _jsx("div", { className: "sport-selection-grid", children: sports.map((sport) => (_jsx(EntityHeroCard, { name: sport.name, logoUrl: sport.logoUrl, detail: `${hosts.filter((host) => host.sportId === sport.id).length} host${hosts.filter((host) => host.sportId === sport.id).length === 1 ? "" : "s"} assigned`, size: "sport", selected: selectedSport?.id === sport.id, onClick: () => setSelectedSport(sport), onDoubleClick: () => openSportEditor(sport), onDelete: () => queueDelete("sport", sport.id, sport.name), deleteDisabled: isCatalogView }, sport.id))) })] }), selectedSport ? (_jsxs(_Fragment, { children: [_jsxs("section", { className: "console-panel sports-workspace-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: selectedSport.name }), _jsxs("h2", { children: [selectedSport.name, " management"] }), _jsx("span", { children: "Use the workspace to keep sport metadata aligned and operator-friendly." }), isCatalogView ? (_jsx("p", { className: "field-note", children: "Catalog View is read-only. Legacy operations are disabled while inspecting the shadow catalog layer." })) : null] }), _jsxs("div", { className: "sports-workspace-actions", children: [_jsxs("div", { className: "view-mode-toggle", children: [_jsx("button", { type: "button", className: viewMode === "legacy" ? "active" : "", onClick: () => setViewMode("legacy"), children: "Legacy View" }), _jsx("button", { type: "button", className: viewMode === "catalog" ? "active" : "", onClick: () => setViewMode("catalog"), children: "Catalog View" })] }), _jsx("button", { type: "button", onClick: () => openSportEditor(selectedSport), disabled: isCatalogView, children: "Edit Sport" }), _jsx("button", { type: "button", className: "secondary", onClick: () => queueDelete("sport", selectedSport.id, selectedSport.name), disabled: isCatalogView, children: "Delete Sport" })] })] }), sportSummary, _jsxs("section", { className: "console-panel sports-workspace-grid", children: [_jsxs("article", { className: "entity-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Hosts" }), _jsx("button", { type: "button", onClick: openHostAssignment, disabled: isCatalogView, children: "+ Add Host" })] }), _jsx("div", { className: "entity-list", children: sportHosts.length > 0 ? (sportHosts.map((host) => (_jsx(EntityHeroCard, { name: host.name, logoUrl: host.logoUrl, detail: `${host.type}${host.countryId ? ` · ${countries.find((country) => country.id === host.countryId)?.name ?? ""}` : ""}`, size: "host", onDoubleClick: () => openHostEditor(host), onDelete: () => queueDelete("host", host.id, host.name), deleteDisabled: isCatalogView || Boolean(hostActionId) }, host.id)))) : (_jsx("p", { className: "field-note", children: "No hosts are linked to this sport yet." })) })] }), _jsxs("article", { className: "entity-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Competitions" }), _jsx("button", { type: "button", onClick: () => openCompetitionEditor(), disabled: isCatalogView, children: "Add Competition" })] }), _jsx("div", { className: "entity-list", children: sportCompetitions.length > 0 ? (sportCompetitions.map((competition) => (_jsx(EntityHeroCard, { name: competition.name, logoUrl: competition.logoUrl, detail: `${competition.type} · ${competition.participantType === "clubs" ? "Clubs" : "National Teams"}`, size: "competition", onDoubleClick: () => openCompetitionEditor(competition), onDelete: () => queueDelete("competition", competition.id, competition.name), deleteDisabled: isCatalogView }, competition.id)))) : (_jsx("p", { className: "field-note", children: "No competitions exist for this sport yet." })) })] })] }), _jsx(SeasonMembershipPanel, { teams: teams, competitions: competitions, selectedSportId: selectedSport.id, accessToken: accessToken }), _jsxs("section", { className: "console-panel sports-workspace-grid", children: [_jsxs("article", { className: "entity-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Clubs" }), _jsxs("label", { className: "club-season-filter", children: [_jsx("span", { children: "Competition season" }), _jsxs("select", { value: selectedClubSeasonId, onChange: (event) => setSelectedClubSeasonId(event.target.value), children: [_jsx("option", { value: "all", children: "All" }), clubSeasonOptions.map((season) => (_jsxs("option", { value: season.id, children: [season.competitionName, " \u00B7 ", season.name] }, season.id)))] })] }), _jsxs("label", { className: "club-season-filter", children: [_jsx("span", { children: "Host" }), _jsxs("select", { value: selectedClubHostId, onChange: (event) => setSelectedClubHostId(event.target.value), children: [_jsx("option", { value: "all", children: "All" }), sportHosts.map((host) => (_jsx("option", { value: host.id, children: host.name }, host.id)))] })] }), _jsx("button", { type: "button", onClick: () => openTeamEditor(), disabled: isCatalogView, children: "Add Club" })] }), _jsx("div", { className: "entity-list", children: visibleClubs.length > 0 ? (visibleClubs.map((team) => (_jsx(EntityHeroCard, { name: team.name, logoUrl: team.logoUrl, detail: team.shortName ?? "Club", size: "team", onDoubleClick: () => openTeamEditor(team), onDelete: () => queueDelete("team", team.id, team.name), deleteDisabled: isCatalogView }, team.id)))) : (_jsx("p", { className: "field-note", children: selectedClubSeasonId !== "all" && selectedClubHostId !== "all"
                                                ? "No clubs match this competition season and host."
                                                : selectedClubSeasonId !== "all"
                                                    ? "No clubs are assigned to this competition season."
                                                    : selectedClubHostId !== "all"
                                                        ? "No clubs are assigned to this host."
                                                        : "No clubs are defined for this sport yet." })) })] }), _jsxs("article", { className: "entity-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "National Teams" }), _jsx("button", { type: "button", onClick: () => openTeamEditor(), disabled: isCatalogView, children: "Add National Team" })] }), _jsx("div", { className: "entity-list", children: nationalTeams.length > 0 ? (nationalTeams.map((team) => (_jsx(EntityHeroCard, { name: team.name, logoUrl: team.logoUrl, detail: team.countryId ? countries.find((country) => country.id === team.countryId)?.name ?? "National Team" : "National Team", size: "team", onDoubleClick: () => openTeamEditor(team), onDelete: () => queueDelete("team", team.id, team.name), deleteDisabled: isCatalogView }, team.id)))) : (_jsx("p", { className: "field-note", children: "No national teams have been created yet." })) })] })] })] })) : (_jsx("section", { className: "console-panel", children: _jsx("p", { className: "field-note", children: "Select a sport card to open its workspace and manage related entities." }) })), modalContext ? (_jsxs(Modal, { title: `${modalContext.action === "create" ? "Create" : "Edit"} ${modalContext.kind === "sport" ? "Sport" : modalContext.kind === "host" ? "Host" : modalContext.kind === "competition" ? "Competition" : "Team"}`, onClose: closeModal, footer: _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", disabled: isSaving || isLogoUploading, onClick: modalContext.kind === "sport"
                                ? saveSport
                                : modalContext.kind === "host"
                                    ? saveHost
                                    : modalContext.kind === "competition"
                                        ? saveCompetition
                                        : saveTeam, children: isSaving ? "Saving..." : modalContext.action === "create" ? "Create" : "Save" }), _jsx("button", { type: "button", className: "secondary", onClick: closeModal, children: "Cancel" })] }), children: [status ? _jsx("span", { className: "status-pill", children: status }) : null, modalContext.kind === "sport" ? (_jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Sport Name", _jsx("input", { value: sportName, onChange: (event) => setSportName(event.target.value) })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: sportLogoUrl, onChange: setSportLogoUrl }), _jsxs("label", { className: "full-width", children: ["Supported Countries", _jsx("div", { className: "country-selection-grid", children: countries.map((country) => (_jsxs("label", { className: "checkbox-option", children: [_jsx("input", { type: "checkbox", checked: sportCountryIds.includes(country.id), onChange: () => {
                                                        setSportCountryIds((current) => current.includes(country.id) ? current.filter((id) => id !== country.id) : [...current, country.id]);
                                                    } }), _jsx("span", { children: country.name })] }, country.id))) })] }), _jsxs("label", { className: "full-width", children: ["Hosts for this Sport", _jsx("input", { value: sportHostSearch, onChange: (event) => setSportHostSearch(event.target.value), placeholder: "Search hosts", disabled: !selectedSport }), _jsx("div", { className: "entity-list", children: !selectedSport ? (_jsx("span", { className: "field-note", children: "Create the sport first, then add Hosts from this workspace." })) : filteredSportHosts.length > 0 ? (filteredSportHosts.map((host) => (_jsxs("div", { className: "entity-list-item", children: [_jsx("strong", { children: host.name }), _jsx("span", { children: host.type })] }, host.id)))) : (_jsx("span", { className: "field-note", children: "No Hosts match this search." })) }), _jsx("button", { type: "button", className: "secondary", onClick: () => {
                                            setModalContext(null);
                                            openHostEditor();
                                        }, disabled: !selectedSport || isCatalogView, children: "Add Host" })] })] })) : modalContext.kind === "host" ? (_jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Host Name", _jsx("input", { value: hostName, onChange: (event) => setHostName(event.target.value) })] }), _jsxs("label", { children: ["Host Type", _jsx("select", { value: hostType, onChange: (event) => {
                                            const nextType = event.target.value;
                                            setHostType(nextType);
                                            setHostCountryId("");
                                        }, children: hostTypes.map(({ value, label }) => _jsx("option", { value: value, children: label }, value)) })] }), _jsx(LogoUrlField, { label: "Upload Logo / Flag", value: hostLogoUrl, onChange: setHostLogoUrl })] })) : modalContext.kind === "competition" ? (_jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Competition Name", _jsx("input", { value: competitionName, onChange: (event) => setCompetitionName(event.target.value) })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: competitionLogoUrl, onChange: setCompetitionLogoUrl }), _jsxs("label", { children: ["Participant Type", _jsx("select", { value: competitionParticipantType, onChange: (event) => setCompetitionParticipantType(event.target.value), children: competitionParticipantTypes.map(({ value, label }) => (_jsx("option", { value: value, children: label }, value))) })] }), _jsxs("label", { children: ["Scope", _jsx("select", { value: competitionScope, onChange: (event) => setCompetitionScope(event.target.value), children: competitionScopes.map((value) => (_jsx("option", { value: value, children: value }, value))) })] }), _jsxs("label", { children: ["Competition Type", _jsx("select", { value: competitionType, onChange: (event) => setCompetitionType(event.target.value), children: competitionTypes.map((value) => (_jsx("option", { value: value, children: value }, value))) })] }), _jsxs("label", { children: ["Host", _jsxs("select", { value: competitionHostId, onChange: (event) => setCompetitionHostId(event.target.value), children: [_jsx("option", { value: "", children: "None" }), sportHosts.map((host) => (_jsxs("option", { value: host.id, children: [host.name, " (", host.type, ")"] }, host.id)))] })] })] })) : (_jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Team Name", _jsx("input", { value: teamName, onChange: (event) => setTeamName(event.target.value) })] }), _jsxs("label", { children: ["Short Name", _jsx("input", { value: teamShortName, onChange: (event) => setTeamShortName(event.target.value) })] }), _jsxs("label", { children: ["Slug", _jsx("input", { value: teamSlug, onChange: (event) => setTeamSlug(event.target.value), placeholder: "club-slug" })] }), _jsxs("label", { children: ["Team Type", _jsx("select", { value: teamType, onChange: (event) => setTeamType(event.target.value), children: teamTypes.map(({ value, label }) => (_jsx("option", { value: value, children: label }, value))) })] }), _jsxs("label", { children: ["Country", _jsxs("select", { value: teamCountryId, onChange: (event) => setTeamCountryId(event.target.value), children: [_jsx("option", { value: "", children: "None" }), supportedCountries.map((country) => (_jsx("option", { value: country.id, children: country.name }, country.id)))] })] }), _jsxs("label", { children: ["Participating Host", _jsxs("select", { value: teamHostId, onChange: (event) => setTeamHostId(event.target.value), children: [_jsx("option", { value: "", children: "None" }), sportHosts.map((host) => _jsxs("option", { value: host.id, children: [host.name, " (", host.type, ")"] }, host.id))] })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: teamLogoUrl, onChange: setTeamLogoUrl, onUploadStateChange: setIsLogoUploading })] }))] })) : null, hostDialogOpen && selectedSport ? (_jsxs(Modal, { title: `Add Host to ${selectedSport.name}`, onClose: () => setHostDialogOpen(false), footer: _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: () => void addSelectedHosts(), disabled: !selectedHostIds.length || Boolean(hostActionId), children: hostActionId === "adding" ? "Adding..." : "Add Selected Hosts" }), _jsx("button", { type: "button", className: "secondary", onClick: () => setHostDialogOpen(false), disabled: Boolean(hostActionId), children: "Cancel" })] }), children: [_jsxs("label", { children: ["Search Host", _jsx("input", { value: hostDialogSearch, onChange: (event) => setHostDialogSearch(event.target.value), placeholder: "Search FIFA, Spain...", autoFocus: true })] }), _jsx("div", { className: "entity-list", children: availableHosts.length ? availableHosts.map((host) => (_jsxs("label", { className: "checkbox-option", children: [_jsx("input", { type: "checkbox", checked: selectedHostIds.includes(host.id), onChange: () => setSelectedHostIds((current) => current.includes(host.id) ? current.filter((id) => id !== host.id) : [...current, host.id]) }), _jsxs("span", { children: [_jsx("strong", { children: host.name }), " \u00B7 ", host.type, " \u00B7 ", host.sportId] })] }, host.id))) : _jsx("p", { className: "field-note", children: "No available Hosts match this search." }) })] })) : null, deleteContext ? (_jsx(Modal, { title: `Delete ${deleteContext.kind === "sport" ? "Sport" : deleteContext.kind === "host" ? "Host" : deleteContext.kind === "competition" ? "Competition" : "Team"}`, onClose: () => setDeleteContext(null), footer: _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", className: "secondary", onClick: () => setDeleteContext(null), children: "Cancel" }), _jsx("button", { type: "button", onClick: executeDelete, disabled: isDeleting, children: isDeleting ? "Deleting…" : "Delete" })] }), children: _jsxs("p", { children: ["Delete ", _jsx("strong", { children: deleteContext.label }), " permanently? This action cannot be undone."] }) })) : null, _jsx("div", { className: "toasts-container", children: toasts.map((t) => (_jsx(Toast, { id: t.id, message: t.message, type: t.type ?? "info", onClose: removeToast }, t.id))) })] }));
}
