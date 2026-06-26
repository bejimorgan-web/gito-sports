import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
import { Toast } from "../../components/Toast";

type MobileFeatureKey = "navigation.liveScores" | "navigation.sports" | "navigation.live";

type MobileFeatureState = {
  key: MobileFeatureKey;
  label: string;
  enabled: boolean;
  message: string | null;
  isSaving: boolean;
  error: string | null;
};

const featureLabels: Record<MobileFeatureKey, string> = {
  "navigation.liveScores": "Live Scores",
  "navigation.sports": "Sports",
  "navigation.live": "Live"
};

interface MobileFeatureControlScreenProps {
  accessToken: string;
}

export function MobileFeatureControlScreen({ accessToken }: MobileFeatureControlScreenProps) {
  const [features, setFeatures] = useState<MobileFeatureState[]>([]);
  const [originalFeatures, setOriginalFeatures] = useState<MobileFeatureState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "success" | "error" | "info" }[]>([]);

  const pushToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const loadFeatures = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getMobileFeatures();
      console.log("[DESKTOP MOBILE FEATURES]", response);
      const navigation = response?.data?.navigation;

      const safeResponse = {
        navigation: {
          liveScores: {
            enabled: navigation?.liveScores?.enabled ?? true,
            message: navigation?.liveScores?.message ?? null
          },
          sports: {
            enabled: navigation?.sports?.enabled ?? true,
            message: navigation?.sports?.message ?? null
          },
          live: {
            enabled: navigation?.live?.enabled ?? true,
            message: navigation?.live?.message ?? null
          }
        }
      };

      const loadedFeatures: MobileFeatureState[] = [
        {
          key: "navigation.liveScores",
          label: featureLabels["navigation.liveScores"],
          enabled: safeResponse.navigation.liveScores.enabled,
          message: safeResponse.navigation.liveScores.message,
          isSaving: false,
          error: null
        },
        {
          key: "navigation.sports",
          label: featureLabels["navigation.sports"],
          enabled: safeResponse.navigation.sports.enabled,
          message: safeResponse.navigation.sports.message,
          isSaving: false,
          error: null
        },
        {
          key: "navigation.live",
          label: featureLabels["navigation.live"],
          enabled: safeResponse.navigation.live.enabled,
          message: safeResponse.navigation.live.message,
          isSaving: false,
          error: null
        }
      ];

      setFeatures(loadedFeatures);
      setOriginalFeatures(loadedFeatures);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setError(`Unable to load mobile navigation feature flags: ${message}`);
      pushToast("Failed to load mobile navigation configuration.", "error");
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadFeatures();
  }, [loadFeatures]);

  const updateFeature = useCallback((featureKey: MobileFeatureKey, enabled: boolean) => {
    setFeatures((current) =>
      current.map((feature) =>
        feature.key === featureKey ? { ...feature, enabled, error: null } : feature
      )
    );
  }, []);

  const saveChanges = useCallback(async () => {
    setIsSaving(true);

    try {
      const navigationUpdate = {
        liveScores: features.find((f) => f.key === "navigation.liveScores")?.enabled ?? true,
        sports: features.find((f) => f.key === "navigation.sports")?.enabled ?? true,
        live: features.find((f) => f.key === "navigation.live")?.enabled ?? true
      };

      const response = await apiClient.updateMobileFeatures(navigationUpdate);
      console.log("[DESKTOP MOBILE FEATURES SAVED]", response);

      pushToast("Mobile navigation feature flags saved successfully.", "success");

      // Reload features to ensure we have the latest state from backend
      await loadFeatures();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      console.error("[DESKTOP MOBILE FEATURES SAVE ERROR]", message);
      pushToast(`Failed to save mobile navigation flags: ${message}`, "error");
    } finally {
      setIsSaving(false);
    }
  }, [features, pushToast, loadFeatures]);

  const hasChanges = useMemo(() => {
    if (features.length !== originalFeatures.length) {
      return true;
    }

    return features.some((feature, index) => feature.enabled !== originalFeatures[index]?.enabled);
  }, [features, originalFeatures]);

  const featureRows = useMemo(
    () =>
      features.map((feature) => (
        <div className="feature-row" key={feature.key}>
          <div className="feature-details">
            <div>
              <h3>{feature.label}</h3>
              <p>{feature.message ?? "No message configured."}</p>
            </div>
            <div className="feature-control">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={feature.enabled}
                  disabled={isSaving}
                  onChange={(event) => void updateFeature(feature.key, event.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
          {feature.error ? <p className="feature-error">{feature.error}</p> : null}
        </div>
      )),
    [features, isSaving, updateFeature]
  );

  return (
    <section className="screen-stack mobile-feature-screen">
      <header className="screen-header">
        <p className="eyebrow">Mobile Navigation</p>
        <h2>Remote feature control</h2>
        <span>Enable or disable mobile navigation tabs for viewers in real time.</span>
      </header>

      <div className="console-panel">
        {loading ? (
          <p>Loading mobile navigation settings…</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : (
          <div className="feature-list">
            {featureRows}
          </div>
        )}
      </div>

      {!loading && !error && (
        <div className="button-group" style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
          <button
            onClick={() => void saveChanges()}
            disabled={isSaving || loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isSaving ? "not-allowed" : "pointer",
              opacity: isSaving ? 0.6 : 1,
              fontSize: "1rem",
              fontWeight: "500"
            }}
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}

      <div className="toasts-container">
        {toasts.map((toast) => (
          <Toast key={toast.id} id={toast.id} message={toast.message} type={toast.type} onClose={removeToast} />
        ))}
      </div>
    </section>
  );
}
