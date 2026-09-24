import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from "react";
import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";
export function AnalyticsOverviewScreen() {
    const { summary, loading, error } = useAnalyticsSummary(useCallback(() => analyticsApi.getOverview(), []));
    const topContent = summary?.streams.total
        ? `${summary.streams.total} total stream events recorded`
        : "No top content available";
    if (loading) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Analytics Overview" }), _jsx("h2", { children: "Real-time Analytics Dashboard" }), _jsx("span", { children: "Metrics refresh every 30 seconds from /analytics/overview." })] }), _jsx("div", { className: "console-panel", children: _jsx("p", { children: "Loading analytics overview\u2026" }) })] }));
    }
    if (error || !summary) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Analytics Overview" }), _jsx("h2", { children: "Real-time Analytics Dashboard" }), _jsx("span", { children: "Metrics refresh every 30 seconds from /analytics/overview." })] }), _jsx("div", { className: "console-panel", children: _jsxs("p", { children: ["Unable to load analytics data: ", error ?? "Unknown error"] }) })] }));
    }
    const cards = [
        {
            label: "Active Users",
            value: String(summary.activeUsers),
            detail: "Current active viewer sessions."
        },
        {
            label: "Total Views",
            value: String(summary.totalViews),
            detail: "All view-related analytics events."
        },
        {
            label: "Watch Time",
            value: formatWatchTime(summary.watchTime),
            detail: "Aggregate watch duration across sessions."
        },
        {
            label: "Active Streams",
            value: String(summary.streams.total),
            detail: "Total stream activity recorded."
        },
        {
            label: "Ad Impressions",
            value: String(summary.ads.impressions),
            detail: "Ad impression events recorded."
        },
        {
            label: "Ad Clicks",
            value: String(summary.ads.clicks),
            detail: "Ad click events recorded."
        },
        {
            label: "Buffer starts",
            value: String(summary.quality.bufferStarts),
            detail: "Playback buffering events from mobile clients."
        },
        {
            label: "Stream errors",
            value: String(summary.quality.streamErrors),
            detail: "Detected playback failures across mobile sessions."
        }
    ];
    const funnelCards = [
        {
            label: "Users entering",
            value: String(summary.funnel.entering),
            detail: "Sessions that opened the app or viewed a match."
        },
        {
            label: "Users starting playback",
            value: String(summary.funnel.playbackStarted),
            detail: "Sessions that began playback."
        },
        {
            label: "Users completing streams",
            value: String(summary.funnel.streamsCompleted),
            detail: "Sessions that reached stream completion."
        }
    ];
    const streamBars = [
        { label: "Streams started", value: summary.streams.started, color: "#55d790" },
        { label: "Streams ended", value: summary.streams.ended, color: "#7cc0ff" },
        { label: "Stream events", value: summary.streams.total, color: "#4cb8ff" }
    ];
    const adBars = [
        { label: "Impressions", value: summary.ads.impressions, color: "#f8c547" },
        { label: "Clicks", value: summary.ads.clicks, color: "#ff8a47" }
    ];
    const tableRows = [
        { label: "Current viewers", value: String(summary.activeUsers) },
        { label: "Watch time", value: formatWatchTime(summary.watchTime) },
        { label: "Streams started", value: String(summary.streams.started) },
        { label: "Streams ended", value: String(summary.streams.ended) },
        { label: "Ad clicks", value: String(summary.ads.clicks) },
        { label: "Total ads", value: String(summary.ads.total) },
        { label: "Match → playback rate", value: `${Math.round(summary.funnel.matchToPlaybackRate * 100)}%` },
        { label: "Playback success rate", value: `${Math.round(summary.funnel.playbackSuccessRate * 100)}%` },
        { label: "Average session duration", value: formatWatchTime(summary.funnel.averageSessionDuration) },
        { label: "Average buffer duration", value: formatWatchTime(summary.quality.averageBufferDuration) },
        { label: "Quality changes", value: String(summary.quality.qualityChanges) }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Analytics Overview" }), _jsx("h2", { children: "Real-time analytics" }), _jsx("span", { children: "High-level metrics for viewers, streams, ads, and watch time." })] }), _jsx(AnalyticsMetricGrid, { cards: cards }), _jsx(AnalyticsMetricGrid, { cards: funnelCards }), _jsxs("section", { className: "console-panel", children: [_jsx("div", { className: "panel-heading", children: _jsx("div", { children: _jsx("h3", { children: "Top content" }) }) }), _jsx("p", { children: topContent })] }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsLineChart, { title: "Active users over time", points: summary.activeUsersOverTime }), _jsx(AnalyticsLineChart, { title: "Streams over time", points: summary.streamsOverTime }), _jsx(AnalyticsLineChart, { title: "Watch minutes over time", points: summary.watchMinutesOverTime })] }), _jsx(AnalyticsSummaryTable, { title: "Overview metrics", rows: tableRows })] }));
}
