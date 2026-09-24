import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from "react";
import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";
export function StreamingAnalyticsScreen() {
    const { summary, loading, error } = useAnalyticsSummary(useCallback(() => analyticsApi.getStreams(), []));
    if (loading) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Streaming Analytics" }), _jsx("h2", { children: "Stream performance" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/streams." })] }), _jsx("div", { className: "console-panel", children: _jsx("p", { children: "Loading stream analytics\u2026" }) })] }));
    }
    if (error || !summary) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Streaming Analytics" }), _jsx("h2", { children: "Stream performance" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/streams." })] }), _jsx("div", { className: "console-panel", children: _jsxs("p", { children: ["Unable to load stream analytics: ", error ?? "Unknown error"] }) })] }));
    }
    const cards = [
        {
            label: "Current viewers",
            value: String(summary.activeUsers),
            detail: "Active viewers during stream events."
        },
        {
            label: "Watch time",
            value: formatWatchTime(summary.watchTime),
            detail: "Total watched duration from stream analytics."
        },
        {
            label: "Streams started",
            value: String(summary.streams.started),
            detail: "Number of stream start events received."
        },
        {
            label: "Streams ended",
            value: String(summary.streams.ended),
            detail: "Number of stream end events received."
        },
        {
            label: "Buffer starts",
            value: String(summary.quality.bufferStarts),
            detail: "Mobile buffering events recorded."
        },
        {
            label: "Stream errors",
            value: String(summary.quality.streamErrors),
            detail: "Detected mobile playback failures."
        }
    ];
    const streamBars = [
        { label: "Started", value: summary.streams.started, color: "#55d790" },
        { label: "Ended", value: summary.streams.ended, color: "#ff8a47" }
    ];
    const tableRows = [
        { label: "Active viewers", value: String(summary.activeUsers) },
        { label: "Total watch time", value: formatWatchTime(summary.watchTime) },
        { label: "Active stream events", value: String(summary.streams.total) },
        { label: "Stream starts", value: String(summary.streams.started) },
        { label: "Stream ends", value: String(summary.streams.ended) },
        { label: "Average duration", value: formatWatchTime(summary.streams.averageDuration) },
        { label: "Avg buffer duration", value: formatWatchTime(summary.quality.averageBufferDuration) },
        { label: "Quality changes", value: String(summary.quality.qualityChanges) }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Streaming Analytics" }), _jsx("h2", { children: "Stream performance" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/streams." })] }), _jsx(AnalyticsMetricGrid, { cards: cards }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsLineChart, { title: "Viewers per hour", points: summary.viewersPerHour }), _jsx(AnalyticsLineChart, { title: "Average watch duration", points: summary.averageWatchDurationOverTime })] }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsBarChart, { title: "Stream lifecycle", bars: streamBars }), _jsx(AnalyticsSummaryTable, { title: "Stream statistics", rows: tableRows })] })] }));
}
