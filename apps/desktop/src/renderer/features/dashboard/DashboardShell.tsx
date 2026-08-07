interface DashboardShellProps {
  actionableAlertCount: number;
  backendStatus: "online" | "offline" | "reconnecting";
  failedStreamCount: number;
  liveMatchCount: number;
  pendingApprovalCount: number;
  channelCount: number;
  providerCount: number;
  systemStatusDetail: string;
  systemStatusLabel: string;
}

export function DashboardShell({
  actionableAlertCount,
  backendStatus,
  failedStreamCount,
  liveMatchCount,
  pendingApprovalCount,
  channelCount,
  providerCount,
  systemStatusDetail,
  systemStatusLabel
}: DashboardShellProps) {
  const metrics = [
    { label: "Live Matches", value: String(liveMatchCount) },
    { label: "Actionable Alerts", value: String(actionableAlertCount) },
    { label: "System Status", value: systemStatusLabel, detail: systemStatusDetail },
    { label: "Backend Status", value: backendStatus === "online" ? "Online" : backendStatus === "reconnecting" ? "Reconnecting" : "Offline" },
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
            {metric.detail ? <small>{metric.detail}</small> : null}
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
