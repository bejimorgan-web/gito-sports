import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";
export function StreamStatusPanel({ matchId }) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!matchId)
            return;
        void recompute();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchId]);
    async function recompute() {
        if (!matchId)
            return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiClient.getStreamStatus(matchId);
            setStatus(res);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setStatus(null);
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "console-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h3", { children: "Active Stream Status" }), _jsx("span", { className: "status-pill", children: matchId ?? "No match selected" })] }), _jsxs("div", { style: { padding: 12 }, children: [_jsx("div", { style: { marginBottom: 8 }, children: _jsx("button", { disabled: !matchId || loading, onClick: recompute, children: loading ? "Recomputing..." : "Recompute Active Stream" }) }), error ? (_jsx("div", { className: "error", children: error })) : status ? (_jsxs("div", { children: [_jsxs("section", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: "Active" }), _jsx("pre", { style: { whiteSpace: "pre-wrap" }, children: JSON.stringify(status.data?.active ?? status.active ?? null, null, 2) })] }), _jsxs("section", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: "Fallback Chain" }), _jsx("pre", { style: { whiteSpace: "pre-wrap" }, children: JSON.stringify(status.data?.fallback ?? status.fallback ?? [], null, 2) })] }), _jsxs("section", { children: [_jsx("strong", { children: "Invalid" }), _jsx("pre", { style: { whiteSpace: "pre-wrap" }, children: JSON.stringify(status.data?.invalid ?? status.invalid ?? [], null, 2) })] })] })) : (_jsx("div", { className: "muted", children: "No stream status available. Select a match and click Recompute." }))] })] }));
}
export default StreamStatusPanel;
