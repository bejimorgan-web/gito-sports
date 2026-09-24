import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from "react";
import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";
export function UsersAnalyticsScreen() {
    const { summary, loading, error } = useAnalyticsSummary(useCallback(() => analyticsApi.getUsers(), []));
    if (loading) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Users Analytics" }), _jsx("h2", { children: "User engagement" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/users." })] }), _jsx("div", { className: "console-panel", children: _jsx("p", { children: "Loading user analytics\u2026" }) })] }));
    }
    if (error || !summary) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Users Analytics" }), _jsx("h2", { children: "User engagement" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/users." })] }), _jsx("div", { className: "console-panel", children: _jsxs("p", { children: ["Unable to load user analytics: ", error ?? "Unknown error"] }) })] }));
    }
    const cards = [
        {
            label: "Current viewers",
            value: String(summary.activeUsers),
            detail: "Tracked active sessions in the analytics stream."
        },
        {
            label: "Total views",
            value: String(summary.totalViews),
            detail: "All view-related analytics events recorded."
        },
        {
            label: "Watch time",
            value: formatWatchTime(summary.watchTime),
            detail: "Total watched duration across user sessions."
        },
        {
            label: "Total ad events",
            value: String(summary.ads.total),
            detail: "Ads events included in user sessions."
        }
    ];
    const userBars = [
        { label: "Active viewers", value: summary.activeUsers, color: "#55d790" },
        { label: "Total views", value: summary.totalViews, color: "#4cb8ff" }
    ];
    const tableRows = [
        { label: "Active viewers", value: String(summary.activeUsers) },
        { label: "Total views", value: String(summary.totalViews) },
        { label: "Watch time", value: formatWatchTime(summary.watchTime) },
        { label: "Ad impressions", value: String(summary.ads.impressions) },
        { label: "Ad clicks", value: String(summary.ads.clicks) }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Users Analytics" }), _jsx("h2", { children: "User engagement" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/users." })] }), _jsx(AnalyticsMetricGrid, { cards: cards }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsBarChart, { title: "User activity", bars: userBars }), _jsx(AnalyticsSummaryTable, { title: "User metrics", rows: tableRows })] })] }));
}
