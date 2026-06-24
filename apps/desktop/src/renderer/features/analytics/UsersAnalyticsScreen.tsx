import { useCallback } from "react";

import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";

export function UsersAnalyticsScreen() {
  const { summary, loading, error } = useAnalyticsSummary(
    useCallback(() => analyticsApi.getUsers(), [])
  );

  if (loading) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Users Analytics</p>
          <h2>User engagement</h2>
          <span>Refreshes every 30 seconds from /analytics/users.</span>
        </header>
        <div className="console-panel">
          <p>Loading user analytics…</p>
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Users Analytics</p>
          <h2>User engagement</h2>
          <span>Refreshes every 30 seconds from /analytics/users.</span>
        </header>
        <div className="console-panel">
          <p>Unable to load user analytics: {error ?? "Unknown error"}</p>
        </div>
      </section>
    );
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

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Users Analytics</p>
        <h2>User engagement</h2>
        <span>Refreshes every 30 seconds from /analytics/users.</span>
      </header>

      <AnalyticsMetricGrid cards={cards} />
      <div className="analytics-layout">
        <AnalyticsBarChart title="User activity" bars={userBars} />
        <AnalyticsSummaryTable title="User metrics" rows={tableRows} />
      </div>
    </section>
  );
}
