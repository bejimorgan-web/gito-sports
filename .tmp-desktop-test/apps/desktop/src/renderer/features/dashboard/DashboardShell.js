import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function DashboardShell({ actionableAlertCount, backendStatus, failedStreamCount, liveMatchCount, pendingApprovalCount, channelCount, providerCount, systemStatusDetail, systemStatusLabel }) {
    const metrics = [
        { label: "Live Matches", value: String(liveMatchCount) },
        { label: "Actionable Alerts", value: String(actionableAlertCount) },
        { label: "System Status", value: systemStatusLabel, detail: systemStatusDetail },
        { label: "Backend Status", value: backendStatus === "online" ? "Online" : backendStatus === "reconnecting" ? "Reconnecting" : "Offline" },
        { label: "Pending Approvals", value: String(pendingApprovalCount) },
        { label: "Unassigned Streams", value: String(channelCount) },
        { label: "Failed Streams", value: String(failedStreamCount) },
        { label: "Provider Status", value: providerCount > 0 ? "Ready" : "Idle" }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Operations Center" }), _jsx("h2", { children: "Broadcast Dashboard" }), _jsx("span", { children: "Critical broadcast state only: live, pending, unassigned, failed, provider readiness." })] }), _jsx("div", { className: "metric-grid", children: metrics.map((metric) => (_jsxs("article", { className: "metric-panel", children: [_jsx("span", { children: metric.label }), _jsx("strong", { children: metric.value }), metric.detail ? _jsx("small", { children: metric.detail }) : null] }, metric.label))) }), _jsxs("section", { className: "console-panel", children: [_jsx("h3", { children: "Today's Live Queue" }), _jsx("p", { children: liveMatchCount > 0
                            ? "Published live matches are available to mobile clients."
                            : "No live matches are published yet." })] })] }));
}
