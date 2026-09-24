import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
function elapsed(startedAt, completedAt) {
    const end = completedAt ? Date.parse(completedAt) : Date.now();
    const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
export function IptvOperationProgress({ operation, onCancel }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (operation.status !== "running" && operation.status !== "queued")
            return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [operation.status]);
    const percentage = operation.total && operation.total > 0
        ? Math.min(100, Math.round((operation.processed / operation.total) * 100))
        : undefined;
    const tone = operation.status === "failed" ? "error" : operation.status === "completed" ? "success" : operation.status === "cancelled" ? "warning" : "";
    return (_jsxs("section", { className: `console-panel iptv-operation-progress ${tone}`, children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("h3", { children: operation.type.replaceAll("_", " ") }), _jsx("span", { children: operation.currentStage })] }), _jsx("strong", { children: operation.status })] }), _jsx("p", { children: operation.currentMessage }), percentage !== undefined ? _jsx("progress", { value: percentage, max: 100 }) : _jsx("progress", {}), _jsxs("div", { className: "provider-summary-row", children: [_jsxs("span", { children: [operation.processed, operation.total !== undefined ? ` of ${operation.total}` : " processed"] }), _jsxs("span", { children: [operation.succeeded, " saved, ", operation.updated, " updated, ", operation.skipped, " skipped, ", operation.failed, " failed"] }), _jsx("span", { children: elapsed(operation.startedAt, operation.completedAt) })] }), (operation.status === "queued" || operation.status === "running") ? (_jsx("button", { type: "button", onClick: () => void onCancel(), children: "Cancel" })) : null, operation.error ? _jsx("div", { className: "status-line", children: _jsx("small", { children: operation.error }) }) : null] }));
}
