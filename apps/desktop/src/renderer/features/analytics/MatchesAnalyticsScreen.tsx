import { useCallback } from "react";

import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";

export function MatchesAnalyticsScreen() {
  const { summary, loading, error } = useAnalyticsSummary(
    useCallback(() => analyticsApi.getMatches(), [])
  );

  if (loading) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Matches Analytics</p>
          <h2>Match activity</h2>
          <span>Refreshes every 30 seconds from /analytics/matches.</span>
        </header>
        <div className="console-panel">
          <p>Loading match analytics…</p>
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Matches Analytics</p>
          <h2>Match activity</h2>
          <span>Refreshes every 30 seconds from /analytics/matches.</span>
        </header>
        <div className="console-panel">
          <p>Unable to load match analytics: {error ?? "Unknown error"}</p>
        </div>
      </section>
    );
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

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Matches Analytics</p>
        <h2>Match activity</h2>
        <span>Refreshes every 30 seconds from /analytics/matches.</span>
      </header>

      <AnalyticsMetricGrid cards={cards} />
      <AnalyticsLineChart title="Top matches" points={summary.matches.topViewed.map((match) => ({ label: match.matchId, value: match.views }))} />
      <AnalyticsLineChart title="Watch time by match" points={summary.matches.watchTimeByMatch.map((match) => ({ label: match.matchId, value: match.watchTime }))} />
      <div className="analytics-layout">
        <AnalyticsBarChart title="Match stream status" bars={matchBars} />
        <AnalyticsSummaryTable title="Match metrics" rows={tableRows} />
      </div>
    </section>
  );
}
