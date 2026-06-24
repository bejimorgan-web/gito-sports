import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface AnalyticsTimeSeriesPoint {
  label: string;
  value: number;
}

export interface AnalyticsSummary {
  activeUsers: number;
  totalViews: number;
  watchTime: number;
  activeUsersOverTime: AnalyticsTimeSeriesPoint[];
  streamsOverTime: AnalyticsTimeSeriesPoint[];
  watchMinutesOverTime: AnalyticsTimeSeriesPoint[];
  viewersPerHour: AnalyticsTimeSeriesPoint[];
  averageWatchDurationOverTime: AnalyticsTimeSeriesPoint[];
  streams: {
    total: number;
    started: number;
    ended: number;
    averageDuration: number;
  };
  ads: {
    impressions: number;
    clicks: number;
    total: number;
    rewards: number;
    impressionsOverTime: AnalyticsTimeSeriesPoint[];
    clicksOverTime: AnalyticsTimeSeriesPoint[];
    estimatedRevenueTrend: AnalyticsTimeSeriesPoint[];
  };
  users: {
    sessions: number;
    newUsers: number;
    returningUsers: number;
  };
  funnel: {
    entering: number;
    playbackRequested: number;
    playbackStarted: number;
    streamsCompleted: number;
    matchToPlaybackRate: number;
    playbackSuccessRate: number;
    averageSessionDuration: number;
  };
  quality: {
    bufferStarts: number;
    bufferEnds: number;
    averageBufferDuration: number;
    streamErrors: number;
    qualityChanges: number;
  };
  matches: {
    topViewed: Array<{ matchId: string; views: number; watchTime: number }>;
    watchTimeByMatch: Array<{ matchId: string; watchTime: number }>;
  };
}

export interface AnalyticsMetricItem {
  label: string;
  value: string;
  detail: string;
}

export interface AnalyticsBarDatum {
  label: string;
  value: number;
  color?: string;
}

export function useAnalyticsSummary(fetcher: () => Promise<AnalyticsSummary>) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      setSummary(result);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
    } finally {
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

export function formatWatchTime(seconds: number) {
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

export function AnalyticsMetricGrid({ cards }: { cards: AnalyticsMetricItem[] }) {
  return (
    <div className="metric-grid">
      {cards.map((card) => (
        <article className="metric-panel" key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <small>{card.detail}</small>
        </article>
      ))}
    </div>
  );
}

export function AnalyticsBarChart({
  title,
  bars
}: {
  title: string;
  bars: AnalyticsBarDatum[];
}) {
  const maxValue = useMemo(() => Math.max(...bars.map((bar) => bar.value), 1), [bars]);

  return (
    <section className="console-panel analytics-chart">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="analytics-chart__bars">
        {bars.map((bar) => (
          <div className="analytics-chart__bar" key={bar.label}>
            <span>{bar.label}</span>
            <div className="analytics-chart__bar-track">
              <div
                className="analytics-chart__bar-fill"
                style={{
                  width: `${Math.round((bar.value / maxValue) * 100)}%`,
                  background: bar.color ?? "linear-gradient(90deg, #55d790, #7cc0ff)"
                }}
              />
            </div>
            <strong>{bar.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function smoothPoints(points: AnalyticsTimeSeriesPoint[], windowSize = 3) {
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

export function AnalyticsLineChart({
  title,
  points
}: {
  title: string;
  points: AnalyticsTimeSeriesPoint[];
}) {
  const smoothedPoints = useMemo(() => smoothPoints(points, 3), [points]);
  const maxValue = useMemo(
    () => Math.max(...smoothedPoints.map((point) => point.value), 1),
    [smoothedPoints]
  );

  return (
    <section className="console-panel analytics-line-chart">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="analytics-line-chart__axis">
        {smoothedPoints.length === 0 ? (
          <div className="analytics-empty-state">No data to display</div>
        ) : (
          <div className="analytics-line-chart__points">
            {smoothedPoints.map((point, index) => {
              const width = `${Math.round((point.value / maxValue) * 100)}%`;
              return (
                <div className="analytics-line-chart__point" key={`${point.label}-${index}`}>
                  <span className="analytics-line-chart__label">{point.label}</span>
                  <div className="analytics-line-chart__track">
                    <div
                      className="analytics-line-chart__fill"
                      style={{ width }}
                    />
                  </div>
                  <strong>{point.value}</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function AnalyticsSummaryTable({
  title,
  rows
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="console-panel analytics-table">
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="data-table">
        <div className="table-row table-head" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <span>Metric</span>
          <span>Value</span>
        </div>
        {rows.map((row) => (
          <div className="table-row" key={row.label} style={{ gridTemplateColumns: "2fr 1fr" }}>
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnalyticsSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">{title}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </header>
      {children}
    </section>
  );
}
