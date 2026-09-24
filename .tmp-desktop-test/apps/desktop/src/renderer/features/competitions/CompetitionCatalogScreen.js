import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
const availableScopes = ["domestic", "continental", "international", "global", "regional", "friendly", "custom"];
const availableTypes = ["league", "cup", "tournament", "championship", "friendly", "custom"];
const availableParticipantTypes = [
    { value: "clubs", label: "Clubs" },
    { value: "nationalTeams", label: "National Teams" }
];
export function CompetitionCatalogScreen({ accessToken }) {
    const [competitions, setCompetitions] = useState([]);
    const [sports, setSports] = useState([]);
    const [hosts, setHosts] = useState([]);
    const [sportHosts, setSportHosts] = useState([]);
    const [selectedCompetition, setSelectedCompetition] = useState(null);
    const [sportId, setSportId] = useState("");
    const [hostId, setHostId] = useState("");
    const [name, setName] = useState("");
    const [scope, setScope] = useState("domestic");
    const [type, setType] = useState("league");
    const [participantType, setParticipantType] = useState("clubs");
    const [logoUrl, setLogoUrl] = useState("");
    const [status, setStatus] = useState("Ready");
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const selectedSport = sports.find((sport) => sport.id === sportId);
    const filteredHosts = selectedSport ? sportHosts : [];
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
        }
        catch {
            setStatus("Unable to load competition metadata.");
        }
    };
    useEffect(() => {
        void loadData();
    }, []);
    useEffect(() => {
        if (!sportId) {
            setSportHosts([]);
            return;
        }
        void apiClient.listHosts(sportId).then(setSportHosts).catch(() => setSportHosts([]));
    }, [sportId]);
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
    const selectCompetition = (competition) => {
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
                const updatePayload = {
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
            }
            else {
                const input = {
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
        }
        catch (error) {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    const deleteCompetitionRow = async (competition) => {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Competitions" }), _jsx("h2", { children: "Competition Management" }), _jsx("span", { children: "Manage reusable competition entities for sports workflows." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedCompetition ? "Edit Competition" : "Create Competition" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Competition Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { children: ["Sport", _jsxs("select", { value: sportId, onChange: (event) => setSportId(event.target.value), children: [_jsx("option", { value: "", children: "Select sport" }), sports.map((sport) => (_jsx("option", { value: sport.id, children: sport.name }, sport.id)))] })] }), _jsxs("label", { children: ["Host", _jsxs("select", { value: hostId, onChange: (event) => setHostId(event.target.value), children: [_jsx("option", { value: "", children: "None" }), filteredHosts.map((host) => (_jsxs("option", { value: host.id, children: [host.name, " (", host.type, ")"] }, host.id)))] }), selectedSport ? _jsxs("small", { children: [filteredHosts.length, " host", filteredHosts.length === 1 ? "" : "s", " for ", selectedSport.name] }) : null] }), _jsxs("label", { children: ["Competition Type", _jsx("select", { value: type, onChange: (event) => setType(event.target.value), children: availableTypes.map((value) => (_jsx("option", { value: value, children: value }, value))) })] }), _jsxs("label", { children: ["Participant Type", _jsx("select", { value: participantType, onChange: (event) => setParticipantType(event.target.value), children: availableParticipantTypes.map(({ value, label }) => (_jsx("option", { value: value, children: label }, value))) })] }), _jsxs("label", { children: ["Scope", _jsx("select", { value: scope, onChange: (event) => setScope(event.target.value), children: availableScopes.map((value) => (_jsx("option", { value: value, children: value }, value))) })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: logoUrl, onChange: setLogoUrl, onUploadStateChange: setIsLogoUploading })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: saveCompetition, disabled: isLogoUploading, children: selectedCompetition ? "Update Competition" : "Create Competition" }), selectedCompetition ? (_jsx("button", { type: "button", className: "secondary", onClick: deleteSelectedCompetition, disabled: Boolean(deletingId), children: deletingId ? "Deleting…" : "Delete Competition" })) : null, _jsx("button", { type: "button", className: "secondary", onClick: resetForm, children: "Clear" })] })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Competitions" }), _jsxs("span", { children: [competitions.length, " competitions"] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Sport" }), _jsx("th", { children: "Host" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Participants" }), _jsx("th", { children: "Scope" }), _jsx("th", { children: "Logo" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: competitions.map((competition) => (_jsxs("tr", { children: [_jsx("td", { children: competition.name }), _jsx("td", { children: sports.find((sport) => sport.id === competition.sportId)?.name ?? competition.sportId }), _jsx("td", { children: hosts.find((host) => host.id === competition.hostId)?.name ?? competition.countryId ?? "—" }), _jsx("td", { children: competition.type }), _jsx("td", { children: competition.participantType === "clubs" ? "Clubs" : "National Teams" }), _jsx("td", { children: competition.scope }), _jsx("td", { children: competition.logoUrl ? _jsx("img", { src: resolveAssetUrl(competition.logoUrl), alt: competition.name, className: "small-logo" }) : "—" }), _jsxs("td", { children: [_jsx("button", { type: "button", onClick: () => selectCompetition(competition), children: "Edit" }), _jsx("button", { type: "button", className: "secondary", onClick: () => deleteCompetitionRow(competition), disabled: Boolean(deletingId), children: deletingId === competition.id ? "Deleting…" : "Delete" })] })] }, competition.id))) })] }) })] })] }));
}
