import { useCallback } from "react";

import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";

export function StreamingAnalyticsScreen() {
  const { summary, loading, error } = useAnalyticsSummary(
    useCallback(() => analyticsApi.getStreams(), [])
  );

  if (loading) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Streaming Analytics</p>
          <h2>Stream performance</h2>
          <span>Refreshes every 30 seconds from /analytics/streams.</span>
        </header>
        <div className="console-panel">
          <p>Loading stream analytics…</p>
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Streaming Analytics</p>
          <h2>Stream performance</h2>
          <span>Refreshes every 30 seconds from /analytics/streams.</span>
        </header>
        <div className="console-panel">
          <p>Unable to load stream analytics: {error ?? "Unknown error"}</p>
        </div>
      </section>
    );
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

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Streaming Analytics</p>
        <h2>Stream performance</h2>
        <span>Refreshes every 30 seconds from /analytics/streams.</span>
      </header>

      <AnalyticsMetricGrid cards={cards} />
      <div className="analytics-layout">
        <AnalyticsLineChart title="Viewers per hour" points={summary.viewersPerHour} />
        <AnalyticsLineChart title="Average watch duration" points={summary.averageWatchDurationOverTime} />
      </div>
      <div className="analytics-layout">
        <AnalyticsBarChart title="Stream lifecycle" bars={streamBars} />
        <AnalyticsSummaryTable
          title="Stream statistics"
          rows={tableRows}
        />
      </div>
    </section>
  );
}
