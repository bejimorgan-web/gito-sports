import { useEffect, useState } from "react";

import type { Country, CreateCountryRequest } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";
import { countryNames, resolveCountryName } from "./country-catalog";

export function CountriesManagementScreen({ accessToken }: { accessToken: string }) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadCountries = async () => {
    try {
      setCountries(await apiClient.listCountries());
    } catch {
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

  const selectCountry = (country: Country) => {
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
        const updatePayload: Partial<CreateCountryRequest> = {
          name: resolvedCountry.name,
          iso2Code: resolvedCountry.iso2Code,
          iso3Code: resolvedCountry.iso3Code,
          ...(logoUrl ? { flagUrl: logoUrl } : {})
        };
        await apiClient.updateCountry(selectedCountry.id, updatePayload, accessToken);
        setStatus("Country updated.");
      } else {
        const input: CreateCountryRequest = {
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
    } catch (error) {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const deleteCountryRow = async (country: Country) => {
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
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Countries</p>
        <h2>Country Management</h2>
        <span>Add and manage Phase 1 country metadata.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{selectedCountry ? "Edit Country" : "Create Country"}</h3>
          <span className="status-pill">{status}</span>
        </div>

        <div className="form-grid two-column">
          <label>
            Country Name
            <input list="country-name-options" value={name} onChange={(event) => setName(event.target.value)} />
            <datalist id="country-name-options">
              {countryNames.map((countryName) => <option key={countryName} value={countryName} />)}
            </datalist>
          </label>
          <LogoUrlField label="Upload Flag / Logo" value={logoUrl} onChange={setLogoUrl} onUploadStateChange={setIsLogoUploading} />
        </div>

        <div className="button-row">
          <button type="button" onClick={saveCountry} disabled={isLogoUploading}>{selectedCountry ? "Update Country" : "Create Country"}</button>
          {selectedCountry ? (
            <button type="button" className="secondary" onClick={deleteSelectedCountry} disabled={Boolean(deletingId)}>
              {deletingId ? "Deleting…" : "Delete Country"}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={resetForm}>
            Clear
          </button>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Countries</h3>
          <span>{countries.length} countries</span>
        </div>
        <div className="entity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ISO2</th>
                <th>ISO3</th>
                <th>Logo</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((country) => (
                <tr key={country.id}>
                  <td>{country.name}</td>
                  <td>{country.iso2Code}</td>
                  <td>{country.iso3Code}</td>
                  <td>{country.flagUrl ? <img src={resolveAssetUrl(country.flagUrl)} alt={country.name} className="small-logo" /> : "—"}</td>
                  <td>
                    <button type="button" onClick={() => selectCountry(country)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => deleteCountryRow(country)} disabled={Boolean(deletingId)}>
                      {deletingId === country.id ? "Deleting…" : "Delete"}
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
