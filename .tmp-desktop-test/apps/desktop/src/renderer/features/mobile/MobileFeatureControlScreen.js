import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../../services/api-client";
import { Toast } from "../../components/Toast";
const featureLabels = {
    "navigation.liveScores": "Live Scores",
    "navigation.sports": "Sports",
    "navigation.live": "Live"
};
export function MobileFeatureControlScreen({ accessToken }) {
    const [features, setFeatures] = useState([]);
    const [originalFeatures, setOriginalFeatures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState("Ready");
    const [toasts, setToasts] = useState([]);
    const pushToast = useCallback((message, type = "success") => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((current) => [...current, { id, message, type }]);
    }, []);
    const removeToast = useCallback((id) => {
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
            const loadedFeatures = [
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
        }
        catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : String(loadError);
            setError(`Unable to load mobile navigation feature flags: ${message}`);
            pushToast("Failed to load mobile navigation configuration.", "error");
        }
        finally {
            setLoading(false);
        }
    }, [pushToast]);
    useEffect(() => {
        void loadFeatures();
    }, [loadFeatures]);
    const updateFeature = useCallback((featureKey, enabled) => {
        setFeatures((current) => current.map((feature) => feature.key === featureKey ? { ...feature, enabled, error: null } : feature));
    }, []);
    const saveChanges = useCallback(async () => {
        setIsSaving(true);
        setSaveStatus("Saving mobile configuration…");
        try {
            const navigationUpdate = {
                liveScores: features.find((f) => f.key === "navigation.liveScores")?.enabled ?? true,
                sports: features.find((f) => f.key === "navigation.sports")?.enabled ?? true,
                live: features.find((f) => f.key === "navigation.live")?.enabled ?? true
            };
            const response = await apiClient.updateMobileFeatures(navigationUpdate, accessToken);
            console.log("[DESKTOP MOBILE FEATURES SAVED]", response);
            pushToast("Mobile navigation feature flags saved successfully.", "success");
            setSaveStatus("Saved");
            // Reload features to ensure we have the latest state from backend
            await loadFeatures();
        }
        catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            console.error("[DESKTOP MOBILE FEATURES SAVE ERROR]", message);
            pushToast(`Failed to save mobile navigation flags: ${message}`, "error");
            setSaveStatus("Save failed");
        }
        finally {
            setIsSaving(false);
        }
    }, [accessToken, features, pushToast, loadFeatures]);
    const hasChanges = useMemo(() => {
        if (features.length !== originalFeatures.length) {
            return true;
        }
        return features.some((feature, index) => feature.enabled !== originalFeatures[index]?.enabled);
    }, [features, originalFeatures]);
    const featureRows = useMemo(() => features.map((feature) => (_jsxs("div", { className: "feature-row", children: [_jsxs("div", { className: "feature-details", children: [_jsxs("div", { children: [_jsx("h3", { children: feature.label }), _jsx("p", { children: feature.message ?? "No message configured." })] }), _jsx("div", { className: "feature-control", children: _jsxs("label", { className: "switch", children: [_jsx("input", { type: "checkbox", checked: feature.enabled, disabled: isSaving, onChange: (event) => void updateFeature(feature.key, event.target.checked) }), _jsx("span", { className: "slider" })] }) })] }), feature.error ? _jsx("p", { className: "feature-error", children: feature.error }) : null] }, feature.key))), [features, isSaving, updateFeature]);
    return (_jsxs("section", { className: "screen-stack mobile-feature-screen", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Mobile App" }), _jsx("h2", { children: "Mobile App Configuration" }), _jsx("span", { children: "Enable or disable mobile navigation sections for the installed app without rebuilding the APK." })] }), _jsx("div", { className: "console-panel", children: loading ? (_jsx("p", { children: "Loading mobile configuration\u2026" })) : error ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "error-text", children: error }), _jsx("button", { type: "button", onClick: () => void loadFeatures(), disabled: loading, children: "Retry" })] })) : (_jsx("div", { className: "feature-list", children: featureRows })) }), !loading && !error && (_jsxs("div", { className: "button-group", style: { marginTop: "1.5rem", display: "flex", gap: "1rem" }, children: [_jsx("button", { onClick: () => void saveChanges(), disabled: isSaving || loading, style: {
                            padding: "0.75rem 1.5rem",
                            backgroundColor: "#0066cc",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: isSaving ? "not-allowed" : "pointer",
                            opacity: isSaving ? 0.6 : 1,
                            fontSize: "1rem",
                            fontWeight: "500"
                        }, children: isSaving ? "Saving…" : "Save Changes" }), _jsx("span", { className: "status-line", children: _jsx("small", { children: saveStatus }) })] })), _jsx("div", { className: "toasts-container", children: toasts.map((toast) => (_jsx(Toast, { id: toast.id, message: toast.message, type: toast.type, onClose: removeToast }, toast.id))) })] }));
}
