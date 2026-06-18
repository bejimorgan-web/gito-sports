import { useEffect, useState } from "react";

import type { Country, CreateSportRequest, Sport } from "@gito/shared";
import { apiClient } from "../../services/api-client";
import { isValidLogoSource, LogoUrlField } from "../../components/LogoUrlField";
import { resolveAssetUrl } from "../../components/asset-url";

interface SportsManagementScreenProps {}

export function SportsManagementScreen({}: SportsManagementScreenProps) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedSport, setSelectedSport] = useState<Sport | null>(null);
  const [selectedCountryIds, setSelectedCountryIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isLogoUploading, setIsLogoUploading] = useState(false);

  const loadSports = async () => {
    try {
      const [sportsData, countriesData] = await Promise.all([apiClient.listSports(), apiClient.listCountries()]);
      setSports(sportsData);
      setCountries(countriesData);
    } catch {
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

  const selectSport = (sport: Sport) => {
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

    const payload: Partial<CreateSportRequest> = {
      name,
      ...(logoUrl ? { logoUrl } : {}),
      countryIds: selectedCountryIds
    };

    try {
      if (selectedSport) {
        await apiClient.updateSport(selectedSport.id, payload);
        setStatus("Sport updated.");
      } else {
        await apiClient.createSport(payload as CreateSportRequest);
        setStatus("Sport created.");
      }

      await loadSports();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const deleteSelectedSport = async () => {
    if (!selectedSport) {
      return;
    }

    try {
      await apiClient.deleteSport(selectedSport.id);
      setStatus("Sport deleted.");
      await loadSports();
      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  const deleteSportRow = async (sport: Sport) => {
    if (!window.confirm(`Delete sport "${sport.name}"?`)) {
      return;
    }

    try {
      await apiClient.deleteSport(sport.id);
      setStatus("Sport deleted.");
      await loadSports();
      if (selectedSport?.id === sport.id) {
        resetForm();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    }
  };

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Sports</p>
        <h2>Sports Management</h2>
        <span>Create and manage sports entities for Phase 1.</span>
      </header>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{selectedSport ? "Edit Sport" : "Create Sport"}</h3>
          <span className="status-pill">{status}</span>
        </div>

        <div className="form-grid two-column">
          <label>
            Sport Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <LogoUrlField label="Upload Logo" value={logoUrl} onChange={setLogoUrl} onUploadStateChange={setIsLogoUploading} />
          <label className="full-width">
            Supported Countries
            <div className="country-selection-grid">
              {countries.length > 0 ? (
                countries.map((country) => (
                  <label key={country.id} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={selectedCountryIds.includes(country.id)}
                      onChange={() => {
                        setSelectedCountryIds((current) =>
                          current.includes(country.id)
                            ? current.filter((id) => id !== country.id)
                            : [...current, country.id]
                        );
                      }}
                    />
                    <span>{country.name}</span>
                  </label>
                ))
              ) : (
                <span className="field-note">No countries loaded.</span>
              )}
            </div>
          </label>
        </div>

        <div className="button-row">
          <button type="button" onClick={saveSport}>
            {selectedSport ? "Update Sport" : "Create Sport"}
          </button>
          {selectedSport ? (
            <button type="button" className="secondary" onClick={deleteSelectedSport}>
              Delete Sport
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={resetForm}>
            Clear
          </button>
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Sports List</h3>
          <span>{sports.length} sports</span>
        </div>
        <div className="entity-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Countries</th>
                <th>Logo</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sports.map((sport) => (
                <tr key={sport.id}>
                  <td>{sport.name}</td>
                  <td>{sport.countryIds?.length ?? 0}</td>
                  <td>{sport.logoUrl ? <img src={resolveAssetUrl(sport.logoUrl)} alt={sport.name} className="small-logo" /> : "—"}</td>
                  <td>{sport.status}</td>
                  <td>
                    <button type="button" onClick={() => selectSport(sport)}>
                      Edit
                    </button>
                    <button type="button" className="secondary" onClick={() => deleteSportRow(sport)}>
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
