import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from "react";
import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";
export function AdsAnalyticsScreen() {
    const { summary, loading, error } = useAnalyticsSummary(useCallback(() => analyticsApi.getAds(), []));
    if (loading) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Ads Analytics" }), _jsx("h2", { children: "Ad delivery metrics" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/ads." })] }), _jsx("div", { className: "console-panel", children: _jsx("p", { children: "Loading ad analytics\u2026" }) })] }));
    }
    if (error || !summary) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Ads Analytics" }), _jsx("h2", { children: "Ad delivery metrics" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/ads." })] }), _jsx("div", { className: "console-panel", children: _jsxs("p", { children: ["Unable to load ad analytics: ", error ?? "Unknown error"] }) })] }));
    }
    const cards = [
        {
            label: "Impressions",
            value: String(summary.ads.impressions),
            detail: "Total ad impressions recorded."
        },
        {
            label: "Clicks",
            value: String(summary.ads.clicks),
            detail: "Total ad clicks recorded."
        },
        {
            label: "Rewards completed",
            value: String(summary.ads.rewards),
            detail: "Completed rewarded ad interactions."
        },
        {
            label: "Total ad events",
            value: String(summary.ads.total),
            detail: "All ad-related events recorded."
        }
    ];
    const adBars = [
        { label: "Impressions", value: summary.ads.impressions, color: "#f8c547" },
        { label: "Clicks", value: summary.ads.clicks, color: "#ff8a47" },
        { label: "Rewards", value: summary.ads.rewards, color: "#55d790" }
    ];
    const tableRows = [
        { label: "Ad impressions", value: String(summary.ads.impressions) },
        { label: "Ad clicks", value: String(summary.ads.clicks) },
        { label: "Rewards completed", value: String(summary.ads.rewards) },
        { label: "Total ad events", value: String(summary.ads.total) },
        { label: "Watch time", value: formatWatchTime(summary.watchTime) }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Ads Analytics" }), _jsx("h2", { children: "Ad delivery metrics" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/ads." })] }), _jsx(AnalyticsMetricGrid, { cards: cards }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsLineChart, { title: "Impressions over time", points: summary.ads.impressionsOverTime }), _jsx(AnalyticsLineChart, { title: "Clicks over time", points: summary.ads.clicksOverTime }), _jsx(AnalyticsLineChart, { title: "Estimated revenue trend", points: summary.ads.estimatedRevenueTrend })] }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsBarChart, { title: "Ad performance", bars: adBars }), _jsx(AnalyticsSummaryTable, { title: "Ad summary", rows: tableRows })] })] }));
}
