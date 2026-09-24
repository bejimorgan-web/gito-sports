import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback } from "react";
import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";
export function MatchesAnalyticsScreen() {
    const { summary, loading, error } = useAnalyticsSummary(useCallback(() => analyticsApi.getMatches(), []));
    if (loading) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Matches Analytics" }), _jsx("h2", { children: "Match activity" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/matches." })] }), _jsx("div", { className: "console-panel", children: _jsx("p", { children: "Loading match analytics\u2026" }) })] }));
    }
    if (error || !summary) {
        return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Matches Analytics" }), _jsx("h2", { children: "Match activity" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/matches." })] }), _jsx("div", { className: "console-panel", children: _jsxs("p", { children: ["Unable to load match analytics: ", error ?? "Unknown error"] }) })] }));
    }
    const cards = [
        {
            label: "Active streams",
            value: String(summary.streams.total),
            detail: "Total stream events captured for matches."
        },
        {
            label: "Streams started",
            value: String(summary.streams.started),
            detail: "Matches with stream start activity."
        },
        {
            label: "Streams ended",
            value: String(summary.streams.ended),
            detail: "Matches with stream end activity."
        },
        {
            label: "Watch time",
            value: formatWatchTime(summary.watchTime),
            detail: "Total watch time from match streams."
        }
    ];
    const matchBars = [
        { label: "Started", value: summary.streams.started, color: "#55d790" },
        { label: "Ended", value: summary.streams.ended, color: "#ff8a47" },
        { label: "Active", value: Math.max(summary.streams.total - summary.streams.ended, 0), color: "#4cb8ff" }
    ];
    const tableRows = [
        { label: "Active streams", value: String(summary.streams.total) },
        { label: "Streams started", value: String(summary.streams.started) },
        { label: "Streams ended", value: String(summary.streams.ended) },
        { label: "Watch time", value: formatWatchTime(summary.watchTime) },
        { label: "Current viewers", value: String(summary.activeUsers) }
    ];
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: "Matches Analytics" }), _jsx("h2", { children: "Match activity" }), _jsx("span", { children: "Refreshes every 30 seconds from /analytics/matches." })] }), _jsx(AnalyticsMetricGrid, { cards: cards }), _jsx(AnalyticsLineChart, { title: "Top matches", points: summary.matches.topViewed.map((match) => ({ label: match.matchId, value: match.views })) }), _jsx(AnalyticsLineChart, { title: "Watch time by match", points: summary.matches.watchTimeByMatch.map((match) => ({ label: match.matchId, value: match.watchTime })) }), _jsxs("div", { className: "analytics-layout", children: [_jsx(AnalyticsBarChart, { title: "Match stream status", bars: matchBars }), _jsx(AnalyticsSummaryTable, { title: "Match metrics", rows: tableRows })] })] }));
}
