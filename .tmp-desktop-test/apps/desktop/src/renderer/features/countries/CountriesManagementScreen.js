import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
import { countryNames, resolveCountryName } from "./country-catalog";
export function CountriesManagementScreen({ accessToken }) {
    const [countries, setCountries] = useState([]);
    const [selectedCountry, setSelectedCountry] = useState(null);
    const [name, setName] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [status, setStatus] = useState("Ready");
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const loadCountries = async () => {
        try {
            setCountries(await apiClient.listCountries());
        }
        catch {
            setStatus("Unable to load countries.");
        }
    };
    useEffect(() => {
        void loadCountries();
    }, []);
    const resetForm = () => {
        setSelectedCountry(null);
        setName("");
        setLogoUrl("");
        setStatus("Ready");
    };
    const selectCountry = (country) => {
        setSelectedCountry(country);
        setName(country.name);
        setLogoUrl(country.flagUrl ?? "");
        setStatus("Editing country");
    };
    const saveCountry = async () => {
        const resolvedCountry = resolveCountryName(name);
        if (!resolvedCountry) {
            setStatus("Country not recognized. Please select a valid country.");
            return;
        }
        if (isLogoUploading) {
            setStatus("Please wait for the flag upload to finish before saving.");
            return;
        }
        if (!isValidLogoSource(logoUrl)) {
            setStatus("Invalid flag/logo. Upload an image file or use a valid http:// or https:// URL.");
            return;
        }
        try {
            if (selectedCountry) {
                const updatePayload = {
                    name: resolvedCountry.name,
                    iso2Code: resolvedCountry.iso2Code,
                    iso3Code: resolvedCountry.iso3Code,
                    ...(logoUrl ? { flagUrl: logoUrl } : {})
                };
                await apiClient.updateCountry(selectedCountry.id, updatePayload, accessToken);
                setStatus("Country updated.");
            }
            else {
                const input = {
                    name: resolvedCountry.name,
                    iso2Code: resolvedCountry.iso2Code,
                    iso3Code: resolvedCountry.iso3Code,
                    ...(logoUrl ? { flagUrl: logoUrl } : {})
                };
                await apiClient.createCountry(input, accessToken);
                setStatus("Country created.");
            }
            await loadCountries();
            resetForm();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Save failed.";
            setStatus(message.replace(/ already exists for ISO[23] [A-Z]+\.$/i, " already exists."));
        }
    };
    const deleteSelectedCountry = async () => {
        if (!selectedCountry || deletingId) {
            return;
        }
        setDeletingId(selectedCountry.id);
        setStatus("Deleting…");
        try {
            await apiClient.deleteCountry(selectedCountry.id, accessToken);
            setStatus("Country deleted.");
            await loadCountries();
            resetForm();
        }
        catch (error) {
            setStatus(error instanceof Error ? error.message : "Delete failed.");
        }
        finally {
            setDeletingId(null);
        }
    };
    const deleteCountryRow = async (country) => {
        if (deletingId || !window.confirm(`Delete country "${country.name}"?`)) {
            return;
        }
        setDeletingId(country.id);
        setStatus("Deleting…");
        try {
            await apiClient.deleteCountry(country.id, accessToken);
            setStatus("Country deleted.");
            await loadCountries();
            if (selectedCountry?.id === country.id) {
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
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Countries" }), _jsx("h2", { children: "Country Management" }), _jsx("span", { children: "Add and manage Phase 1 country metadata." })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: selectedCountry ? "Edit Country" : "Create Country" }), _jsx("span", { className: "status-pill", children: status })] }), _jsxs("div", { className: "form-grid two-column", children: [_jsxs("label", { children: ["Country Name", _jsx("input", { list: "country-name-options", value: name, onChange: (event) => setName(event.target.value) }), _jsx("datalist", { id: "country-name-options", children: countryNames.map((countryName) => _jsx("option", { value: countryName }, countryName)) })] }), _jsx(LogoUrlField, { label: "Upload Flag / Logo", value: logoUrl, onChange: setLogoUrl, onUploadStateChange: setIsLogoUploading })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { type: "button", onClick: saveCountry, disabled: isLogoUploading, children: selectedCountry ? "Update Country" : "Create Country" }), selectedCountry ? (_jsx("button", { type: "button", className: "secondary", onClick: deleteSelectedCountry, disabled: Boolean(deletingId), children: deletingId ? "Deleting…" : "Delete Country" })) : null, _jsx("button", { type: "button", className: "secondary", onClick: resetForm, children: "Clear" })] })] }), _jsxs("section", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Countries" }), _jsxs("span", { children: [countries.length, " countries"] })] }), _jsx("div", { className: "entity-table", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "ISO2" }), _jsx("th", { children: "ISO3" }), _jsx("th", { children: "Logo" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: countries.map((country) => (_jsxs("tr", { children: [_jsx("td", { children: country.name }), _jsx("td", { children: country.iso2Code }), _jsx("td", { children: country.iso3Code }), _jsx("td", { children: country.flagUrl ? _jsx("img", { src: resolveAssetUrl(country.flagUrl), alt: country.name, className: "small-logo" }) : "—" }), _jsxs("td", { children: [_jsx("button", { type: "button", onClick: () => selectCountry(country), children: "Edit" }), _jsx("button", { type: "button", className: "secondary", onClick: () => deleteCountryRow(country), disabled: Boolean(deletingId), children: deletingId === country.id ? "Deleting…" : "Delete" })] })] }, country.id))) })] }) })] })] }));
}
