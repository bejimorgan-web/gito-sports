interface DashboardShellProps {
  failedStreamCount: number;
  liveMatchCount: number;
  pendingApprovalCount: number;
  channelCount: number;
  providerCount: number;
}

export function DashboardShell({
  failedStreamCount,
  liveMatchCount,
  pendingApprovalCount,
  channelCount,
  providerCount
}: DashboardShellProps) {
  const metrics = [
    { label: "Live Matches", value: String(liveMatchCount) },
    { label: "Pending Approvals", value: String(pendingApprovalCount) },
    { label: "Unassigned Streams", value: String(channelCount) },
    { label: "Failed Streams", value: String(failedStreamCount) },
    { label: "Provider Status", value: providerCount > 0 ? "Ready" : "Idle" }
  ];

  return (
    <section className="screen-stack">
      <header className="screen-header">
        <p className="eyebrow">Operations Center</p>
        <h2>Broadcast Dashboard</h2>
        <span>Critical broadcast state only: live, pending, unassigned, failed, provider readiness.</span>
      </header>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className="metric-panel" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <section className="console-panel">
        <h3>Today&apos;s Live Queue</h3>
        <p>
          {liveMatchCount > 0
            ? "Published live matches are available to mobile clients."
            : "No live matches are published yet."}
        </p>
      </section>
    </section>
  );
}
