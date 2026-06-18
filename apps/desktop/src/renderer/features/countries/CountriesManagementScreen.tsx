import { useEffect, useState } from "react";

import type { Country, CreateCountryRequest } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";

export function CountriesManagementScreen() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
  const [name, setName] = useState("");
  const [iso2Code, setIso2Code] = useState("");
  const [iso3Code, setIso3Code] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);

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
    setIso2Code("");
    setIso3Code("");
    setLogoUrl("");
    setStatus("Ready");
  };

  const selectCountry = (country: Country) => {
    setSelectedCountry(country);
    setName(country.name);
    setIso2Code(country.iso2Code);
    setIso3Code(country.iso3Code);
    setLogoUrl(country.flagUrl ?? "");
    setStatus("Editing country");
  };

  const saveCountry = async () => {
    if (!name.trim() || !iso2Code.trim() || !iso3Code.trim()) {
      setStatus("Name and ISO codes are required.");
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
          name,
          iso2Code,
          iso3Code,
          ...(logoUrl ? { flagUrl: logoUrl } : {})
        };
        await apiClient.updateCountry(selectedCountry.id, updatePayload);
        setStatus("Country updated.");
      } else {
        const input: CreateCountryRequest = {
          name,
          iso2Code,
          iso3Code,
          ...(logoUrl ? { flagUrl: logoUrl } : {})
        };
        await apiClient.createCountry(input);
        setStatus("Country created.");
      }

      await loadCountries();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const deleteSelectedCountry = async () => {
    if (!selectedCountry) {
      return;
    }

    try {
      await apiClient.deleteCountry(selectedCountry.id);
      setStatus("Country deleted.");
      await loadCountries();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const deleteCountryRow = async (country: Country) => {
    if (!window.confirm(`Delete country "${country.name}"?`)) {
      return;
    }

    try {
      await apiClient.deleteCountry(country.id);
      setStatus("Country deleted.");
      await loadCountries();
      if (selectedCountry?.id === country.id) {
        resetForm();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
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
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            ISO2 Code
            <input value={iso2Code} onChange={(event) => setIso2Code(event.target.value.toUpperCase())} />
          </label>
          <label>
            ISO3 Code
            <input value={iso3Code} onChange={(event) => setIso3Code(event.target.value.toUpperCase())} />
          </label>
          <LogoUrlField label="Upload Flag / Logo" value={logoUrl} onChange={setLogoUrl} onUploadStateChange={setIsLogoUploading} />
        </div>

        <div className="button-row">
          <button type="button" onClick={saveCountry} disabled={isLogoUploading}>{selectedCountry ? "Update Country" : "Create Country"}</button>
          {selectedCountry ? (
            <button type="button" className="secondary" onClick={deleteSelectedCountry}>
              Delete Country
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
                    <button type="button" className="secondary" onClick={() => deleteCountryRow(country)}>
                      Delete
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
