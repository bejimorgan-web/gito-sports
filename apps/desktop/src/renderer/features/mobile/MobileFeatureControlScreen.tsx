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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setFeatures([
        {
          key: "navigation.liveScores",
          label: featureLabels["navigation.liveScores"],
          enabled: response.navigation.liveScores.enabled,
          message: response.navigation.liveScores.message,
          isSaving: false,
          error: null
        },
        {
          key: "navigation.sports",
          label: featureLabels["navigation.sports"],
          enabled: response.navigation.sports.enabled,
          message: response.navigation.sports.message,
          isSaving: false,
          error: null
        },
        {
          key: "navigation.live",
          label: featureLabels["navigation.live"],
          enabled: response.navigation.live.enabled,
          message: response.navigation.live.message,
          isSaving: false,
          error: null
        }
      ]);
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

  const updateFeature = useCallback(async (featureKey: MobileFeatureKey, enabled: boolean) => {
    setFeatures((current) =>
      current.map((feature) =>
        feature.key === featureKey ? { ...feature, enabled, isSaving: true, error: null } : feature
      )
    );

    try {
      const response = await apiClient.updateMobileFeature(featureKey, enabled, null, accessToken);
      setFeatures((current) =>
        current.map((feature) =>
          feature.key === featureKey
            ? {
                ...feature,
                enabled: response.enabled,
                message: response.message,
                isSaving: false,
                error: null
              }
            : feature
        )
      );
      pushToast(`${featureLabels[featureKey]} has been ${enabled ? "enabled" : "disabled"}.`);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : String(updateError);
      setFeatures((current) =>
        current.map((feature) =>
          feature.key === featureKey ? { ...feature, isSaving: false, error: message } : feature
        )
      );
      pushToast(`Unable to update ${featureLabels[featureKey]}: ${message}`, "error");
    }
  }, [accessToken, pushToast]);

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
                  disabled={feature.isSaving}
                  onChange={(event) => void updateFeature(feature.key, event.target.checked)}
                />
                <span className="slider" />
              </label>
              {feature.isSaving ? <span className="feature-status">Saving…</span> : null}
            </div>
          </div>
          {feature.error ? <p className="feature-error">{feature.error}</p> : null}
        </div>
      )),
    [features, updateFeature]
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

      <div className="toasts-container">
        {toasts.map((toast) => (
          <Toast key={toast.id} id={toast.id} message={toast.message} type={toast.type} onClose={removeToast} />
        ))}
      </div>
    </section>
  );
}
