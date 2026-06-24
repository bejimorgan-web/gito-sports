import { useCallback } from "react";

import { analyticsApi } from "../../services/analyticsApi";
import { AnalyticsBarChart, AnalyticsLineChart, AnalyticsMetricGrid, AnalyticsSummaryTable, useAnalyticsSummary, formatWatchTime } from "./AnalyticsCommon";

export function AdsAnalyticsScreen() {
  const { summary, loading, error } = useAnalyticsSummary(
    useCallback(() => analyticsApi.getAds(), [])
  );

  if (loading) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Ads Analytics</p>
          <h2>Ad delivery metrics</h2>
          <span>Refreshes every 30 seconds from /analytics/ads.</span>
        </header>
        <div className="console-panel">
          <p>Loading ad analytics…</p>
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="screen-stack">
        <header className="screen-header">
          <p className="eyebrow">Ads Analytics</p>
          <h2>Ad delivery metrics</h2>
          <span>Refreshes every 30 seconds from /analytics/ads.</span>
        </header>
        <div className="console-panel">
          <p>Unable to load ad analytics: {error ?? "Unknown error"}</p>
        </div>
      </section>
    );
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

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Ads Analytics</p>
        <h2>Ad delivery metrics</h2>
        <span>Refreshes every 30 seconds from /analytics/ads.</span>
      </header>

      <AnalyticsMetricGrid cards={cards} />
      <div className="analytics-layout">
        <AnalyticsLineChart title="Impressions over time" points={summary.ads.impressionsOverTime} />
        <AnalyticsLineChart title="Clicks over time" points={summary.ads.clicksOverTime} />
        <AnalyticsLineChart title="Estimated revenue trend" points={summary.ads.estimatedRevenueTrend} />
      </div>
      <div className="analytics-layout">
        <AnalyticsBarChart title="Ad performance" bars={adBars} />
        <AnalyticsSummaryTable title="Ad summary" rows={tableRows} />
      </div>
    </section>
  );
}
