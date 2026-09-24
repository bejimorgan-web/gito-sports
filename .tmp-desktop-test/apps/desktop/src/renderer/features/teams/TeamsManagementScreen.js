import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
const teamTypes = ["club", "national", "custom"];
export function TeamsManagementScreen({ accessToken }) {
    const [teams, setTeams] = useState([]);
    const [sports, setSports] = useState([]);
    const [countries, setCountries] = useState([]);
    const [hosts, setHosts] = useState([]);
    const [participatingHosts, setParticipatingHosts] = useState([]);
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [sportId, setSportId] = useState("");
    const [countryId, setCountryId] = useState("");
    const [hostId, setHostId] = useState("");
    const [name, setName] = useState("");
    const [shortName, setShortName] = useState("");
    const [slug, setSlug] = useState("");
    const [type, setType] = useState("club");
    const [logoUrl, setLogoUrl] = useState("");
    const [status, setStatus] = useState("Ready");
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [filterSportId, setFilterSportId] = useState("");
    const [filterHostId, setFilterHostId] = useState("");
    const [filterType, setFilterType] = useState("");
    const [filterCountryId, setFilterCountryId] = useState("");
    const selectedSport = sports.find((sport) => sport.id === sportId);
    useEffect(() => {
        if (!sportId) {
            setParticipatingHosts([]);
            return;
        }
        void apiClient.listHosts(sportId).then(setParticipatingHosts).catch(() => setParticipatingHosts([]));
    }, [sportId]);
    const filteredTeams = useMemo(() => teams.filter((team) => (!filterSportId || team.sportId === filterSportId) &&
        (!filterHostId || team.hostId === filterHostId) &&
        (!filterType || team.type === filterType) &&
        (!filterCountryId || team.countryId === filterCountryId)), [filterCountryId, filterHostId, filterSportId, filterType, teams]);
    const filterHosts = hosts.filter((host) => !filterSportId || host.sportId === filterSportId);
    const teamHosts = participatingHosts.filter((host) => type === "club" || type === "national" ? host.type === "country" : true);
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
        }
        catch {
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
    const selectTeam = (team) => {
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
                const updatePayload = {
                    sportId,
                    ...(hostId ? { hostId } : {}),
                    name,
                    type,
                    ...(slug ? { slug } : {}),
                    ...(type === "custom" && countryId ? { countryId } : {}),
                    ...(shortName ? { shortName } : {}),
                    ...(logoUrl ? { logoUrl } : {})
                };
                await apiClient.updateTeam(selectedTeam.id, updatePayload, accessToken);
                setStatus("Team updated.");
            }
            else {
                const input = {
                    sportId,
                    ...(hostId ? { hostId } : {}),
                    name,
                    type,
                    ...(slug ? { slug } : {}),
                    ...(type === "custom" && countryId ? { countryId } : {}),
                    ...(shortName ? { shortName } : {}),
                    ...(logoUrl ? { logoUrl } : {})
                };
                await apiClient.createTeam(input, accessToken);
                setStatus("Team created.");
            }
            await loadData();
            resetForm();
        }
        catch (error) {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    const deleteTeamRow = async (team) => {
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
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Clubs" }), _jsx("h2", { children: "Club & National Team Management" }), _jsx("span", { children: "Create and manage clubs and national teams." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedTeam ? "Edit Club / National Team" : "Create Club / National Team" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Club / National Team Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { children: ["Short Name", _jsx("input", { value: shortName, onChange: (event) => setShortName(event.target.value) })] }), _jsxs("label", { children: ["Slug", _jsx("input", { value: slug, onChange: (event) => setSlug(event.target.value), placeholder: "club-slug" })] }), _jsxs("label", { children: ["Sport", _jsxs("select", { value: sportId, onChange: (event) => { setSportId(event.target.value); setHostId(""); }, children: [_jsx("option", { value: "", children: "Select sport" }), sports.map((sport) => (_jsx("option", { value: sport.id, children: sport.name }, sport.id)))] })] }), _jsxs("label", { children: ["Participating Host / Country", _jsxs("select", { value: hostId, onChange: (event) => setHostId(event.target.value), disabled: !sportId, children: [_jsx("option", { value: "", children: "None" }), teamHosts.map((host) => _jsx("option", { value: host.id, children: host.name }, host.id))] }), sportId && teamHosts.length === 0 ? _jsx("small", { children: "No Country Hosts are assigned to this Sport yet." }) : null] }), _jsxs("label", { children: ["Team Type", _jsx("select", { value: type, onChange: (event) => setType(event.target.value), children: teamTypes.map((teamType) => (_jsx("option", { value: teamType, children: teamType }, teamType))) })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: logoUrl, onChange: setLogoUrl, onUploadStateChange: setIsLogoUploading })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: saveTeam, disabled: isLogoUploading, children: selectedTeam ? "Update Team" : "Create Team" }), selectedTeam ? (_jsx("button", { type: "button", className: "secondary", onClick: deleteSelectedTeam, disabled: Boolean(deletingId), children: deletingId ? "Deleting…" : "Delete Team" })) : null, _jsx("button", { type: "button", className: "secondary", onClick: resetForm, children: "Clear" })] })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Clubs & National Teams" }), _jsxs("span", { children: [filteredTeams.length, " of ", teams.length, " entities"] })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Sport", _jsxs("select", { value: filterSportId, onChange: (event) => { setFilterSportId(event.target.value); setFilterHostId(""); }, children: [_jsx("option", { value: "", children: "All sports" }), sports.map((sport) => _jsx("option", { value: sport.id, children: sport.name }, sport.id))] })] }), _jsxs("label", { children: ["Participating Host", _jsxs("select", { value: filterHostId, onChange: (event) => setFilterHostId(event.target.value), children: [_jsx("option", { value: "", children: "All Hosts" }), filterHosts.map((host) => _jsxs("option", { value: host.id, children: [host.name, " (", host.type, ")"] }, host.id))] })] }), _jsxs("label", { children: ["Team Type", _jsxs("select", { value: filterType, onChange: (event) => setFilterType(event.target.value), children: [_jsx("option", { value: "", children: "All types" }), teamTypes.map((teamType) => _jsx("option", { value: teamType, children: teamType }, teamType))] })] }), _jsxs("label", { children: ["Country", _jsxs("select", { value: filterCountryId, onChange: (event) => setFilterCountryId(event.target.value), children: [_jsx("option", { value: "", children: "All countries" }), countries.map((country) => _jsx("option", { value: country.id, children: country.name }, country.id))] })] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Sport" }), _jsx("th", { children: "Country" }), _jsx("th", { children: "Host" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Logo" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: filteredTeams.map((team) => (_jsxs("tr", { children: [_jsx("td", { children: team.name }), _jsx("td", { children: sports.find((sport) => sport.id === team.sportId)?.name ?? team.sportId }), _jsx("td", { children: countries.find((country) => country.id === team.countryId)?.name ?? team.countryId ?? "—" }), _jsx("td", { children: hosts.find((host) => host.id === team.hostId)?.name ?? team.hostId ?? "—" }), _jsx("td", { children: team.type }), _jsx("td", { children: team.logoUrl ? _jsx("img", { src: resolveAssetUrl(team.logoUrl), alt: team.name, className: "small-logo" }) : "—" }), _jsxs("td", { children: [_jsx("button", { type: "button", onClick: () => selectTeam(team), children: "Edit" }), _jsx("button", { type: "button", className: "secondary", onClick: () => deleteTeamRow(team), disabled: Boolean(deletingId), children: deletingId === team.id ? "Deleting…" : "Delete" })] })] }, team.id))) })] }) })] })] }));
}
