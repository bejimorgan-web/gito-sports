import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
export function useAnalyticsSummary(fetcher) {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetcher();
            setSummary(result);
        }
        catch (error_) {
            setError(error_ instanceof Error ? error_.message : String(error_));
        }
        finally {
            setLoading(false);
        }
    }, [fetcher]);
    useEffect(() => {
        void refresh();
        const intervalId = window.setInterval(() => {
            void refresh();
        }, 30000);
        return () => window.clearInterval(intervalId);
    }, [refresh]);
    return { summary, loading, error, refresh };
}
export function formatWatchTime(seconds) {
    if (seconds < 60) {
        return `${seconds} sec`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
        return `${minutes} min ${remainingSeconds.toString().padStart(2, "0")} sec`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}
export function AnalyticsMetricGrid({ cards }) {
    return (_jsx("div", { className: "metric-grid", children: cards.map((card) => (_jsxs("article", { className: "metric-panel", children: [_jsx("span", { children: card.label }), _jsx("strong", { children: card.value }), _jsx("small", { children: card.detail })] }, card.label))) }));
}
export function AnalyticsBarChart({ title, bars }) {
    const maxValue = useMemo(() => Math.max(...bars.map((bar) => bar.value), 1), [bars]);
    return (_jsxs("section", { className: "console-panel analytics-chart", children: [_jsx("div", { className: "panel-heading", children: _jsx("div", { children: _jsx("h3", { children: title }) }) }), _jsx("div", { className: "analytics-chart__bars", children: bars.map((bar) => (_jsxs("div", { className: "analytics-chart__bar", children: [_jsx("span", { children: bar.label }), _jsx("div", { className: "analytics-chart__bar-track", children: _jsx("div", { className: "analytics-chart__bar-fill", style: {
                                    width: `${Math.round((bar.value / maxValue) * 100)}%`,
                                    background: bar.color ?? "linear-gradient(90deg, #55d790, #7cc0ff)"
                                } }) }), _jsx("strong", { children: bar.value })] }, bar.label))) })] }));
}
function smoothPoints(points, windowSize = 3) {
    if (points.length < windowSize) {
        return points;
    }
    return points.map((point, index) => {
        const half = Math.floor(windowSize / 2);
        const windowStart = Math.max(0, index - half);
        const windowEnd = Math.min(points.length, index + half + 1);
        const windowPoints = points.slice(windowStart, windowEnd);
        const average = windowPoints.reduce((sum, item) => sum + item.value, 0) / windowPoints.length;
        return {
            label: point.label,
            value: Math.round(average),
        };
    });
}
export function AnalyticsLineChart({ title, points }) {
    const smoothedPoints = useMemo(() => smoothPoints(points, 3), [points]);
    const maxValue = useMemo(() => Math.max(...smoothedPoints.map((point) => point.value), 1), [smoothedPoints]);
    return (_jsxs("section", { className: "console-panel analytics-line-chart", children: [_jsx("div", { className: "panel-heading", children: _jsx("div", { children: _jsx("h3", { children: title }) }) }), _jsx("div", { className: "analytics-line-chart__axis", children: smoothedPoints.length === 0 ? (_jsx("div", { className: "analytics-empty-state", children: "No data to display" })) : (_jsx("div", { className: "analytics-line-chart__points", children: smoothedPoints.map((point, index) => {
                        const width = `${Math.round((point.value / maxValue) * 100)}%`;
                        return (_jsxs("div", { className: "analytics-line-chart__point", children: [_jsx("span", { className: "analytics-line-chart__label", children: point.label }), _jsx("div", { className: "analytics-line-chart__track", children: _jsx("div", { className: "analytics-line-chart__fill", style: { width } }) }), _jsx("strong", { children: point.value })] }, `${point.label}-${index}`));
                    }) })) })] }));
}
export function AnalyticsSummaryTable({ title, rows }) {
    return (_jsxs("section", { className: "console-panel analytics-table", children: [_jsx("div", { className: "panel-heading", children: _jsx("div", { children: _jsx("h3", { children: title }) }) }), _jsxs("div", { className: "data-table", children: [_jsxs("div", { className: "table-row table-head", style: { gridTemplateColumns: "2fr 1fr" }, children: [_jsx("span", { children: "Metric" }), _jsx("span", { children: "Value" })] }), rows.map((row) => (_jsxs("div", { className: "table-row", style: { gridTemplateColumns: "2fr 1fr" }, children: [_jsx("span", { children: row.label }), _jsx("span", { children: row.value })] }, row.label)))] })] }));
}
export function AnalyticsSection({ title, description, children }) {
    return (_jsxs("section", { className: "screen-stack", children: [_jsxs("header", { className: "screen-header", children: [_jsx("p", { className: "eyebrow", children: title }), _jsx("h2", { children: title }), _jsx("span", { children: description })] }), children] }));
}
