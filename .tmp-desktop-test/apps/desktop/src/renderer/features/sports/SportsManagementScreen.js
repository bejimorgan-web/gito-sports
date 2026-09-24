import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
export function SportsManagementScreen({ accessToken }) {
    const [sports, setSports] = useState([]);
    const [countries, setCountries] = useState([]);
    const [selectedSport, setSelectedSport] = useState(null);
    const [selectedCountryIds, setSelectedCountryIds] = useState([]);
    const [name, setName] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [status, setStatus] = useState("Ready");
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const loadSports = async () => {
        try {
            const [sportsData, countriesData] = await Promise.all([apiClient.listSports(), apiClient.listCountries()]);
            setSports(sportsData);
            setCountries(countriesData);
        }
        catch {
            setStatus("Unable to load sports.");
        }
    };
    useEffect(() => {
        void loadSports();
    }, []);
    const resetForm = () => {
        setSelectedSport(null);
        setSelectedCountryIds([]);
        setName("");
        setLogoUrl("");
        setStatus("Ready");
    };
    const selectSport = (sport) => {
        setSelectedSport(sport);
        setName(sport.name);
        setLogoUrl(sport.logoUrl ?? "");
        setSelectedCountryIds(sport.countryIds ?? []);
        setStatus("Editing sport");
    };
    const saveSport = async () => {
        if (!name.trim()) {
            setStatus("Name is required.");
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
        const payload = {
            name,
            ...(logoUrl ? { logoUrl } : {}),
            countryIds: selectedCountryIds
        };
        try {
            if (selectedSport) {
                await apiClient.updateSport(selectedSport.id, payload, accessToken);
                setStatus("Sport updated.");
            }
            else {
                await apiClient.createSport(payload, accessToken);
                setStatus("Sport created.");
            }
            await loadSports();
            resetForm();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Save failed.");
        }
    };
    const deleteSelectedSport = async () => {
        if (!selectedSport || deletingId) {
            return;
        }
        setDeletingId(selectedSport.id);
        setStatus("Deleting…");
        try {
            await apiClient.deleteSport(selectedSport.id, accessToken);
            setStatus("Sport deleted.");
            await loadSports();
            resetForm();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    const deleteSportRow = async (sport) => {
        if (deletingId || !window.confirm(`Delete sport "${sport.name}"?`)) {
            return;
        }
        setDeletingId(sport.id);
        setStatus("Deleting…");
        try {
            await apiClient.deleteSport(sport.id, accessToken);
            setStatus("Sport deleted.");
            await loadSports();
            if (selectedSport?.id === sport.id) {
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
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Sports" }), _jsx("h2", { children: "Sports Management" }), _jsx("span", { children: "Create and manage sports entities for Phase 1." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedSport ? "Edit Sport" : "Create Sport" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Sport Name", _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsx(LogoUrlField, { label: "Upload Logo", value: logoUrl, onChange: setLogoUrl, onUploadStateChange: setIsLogoUploading }), _jsxs("label", { className: "full-width", children: ["Supported Countries", _jsx("div", { className: "country-selection-grid", children: countries.length > 0 ? (countries.map((country) => (_jsxs("label", { className: "checkbox-option", children: [_jsx("input", { type: "checkbox", checked: selectedCountryIds.includes(country.id), onChange: () => {
                                                        setSelectedCountryIds((current) => current.includes(country.id)
                                                            ? current.filter((id) => id !== country.id)
                                                            : [...current, country.id]);
                                                    } }), _jsx("span", { children: country.name })] }, country.id)))) : (_jsx("span", { className: "field-note", children: "No countries loaded." })) })] })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: saveSport, children: selectedSport ? "Update Sport" : "Create Sport" }), selectedSport ? (_jsx("button", { type: "button", className: "secondary", onClick: deleteSelectedSport, disabled: Boolean(deletingId), children: deletingId ? "Deleting…" : "Delete Sport" })) : null, _jsx("button", { type: "button", className: "secondary", onClick: resetForm, children: "Clear" })] })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Sports List" }), _jsxs("span", { children: [sports.length, " sports"] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Countries" }), _jsx("th", { children: "Logo" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: sports.map((sport) => (_jsxs("tr", { children: [_jsx("td", { children: sport.name }), _jsx("td", { children: sport.countryIds?.length ?? 0 }), _jsx("td", { children: sport.logoUrl ? _jsx("img", { src: resolveAssetUrl(sport.logoUrl), alt: sport.name, className: "small-logo" }) : "—" }), _jsx("td", { children: sport.status }), _jsxs("td", { children: [_jsx("button", { type: "button", onClick: () => selectSport(sport), children: "Edit" }), _jsx("button", { type: "button", className: "secondary", onClick: () => deleteSportRow(sport), disabled: Boolean(deletingId), children: deletingId === sport.id ? "Deleting…" : "Delete" })] })] }, sport.id))) })] }) })] })] }));
}
