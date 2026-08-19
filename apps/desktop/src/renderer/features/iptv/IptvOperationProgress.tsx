import { useEffect, useState } from "react";
import type { IptvOperation } from "@gito/shared";

interface IptvOperationProgressProps {
  operation: IptvOperation;
  onCancel: () => Promise<void>;
}

function elapsed(startedAt: string, completedAt?: string) {
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function IptvOperationProgress({ operation, onCancel }: IptvOperationProgressProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (operation.status !== "running" && operation.status !== "queued") return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [operation.status]);

  const percentage = operation.total && operation.total > 0
    ? Math.min(100, Math.round((operation.processed / operation.total) * 100))
    : undefined;
  const tone = operation.status === "failed" ? "error" : operation.status === "completed" ? "success" : operation.status === "cancelled" ? "warning" : "";

  return (
    <section className={`console-panel iptv-operation-progress ${tone}`}>
      <div className="panel-heading">
        <div>
          <h3>{operation.type.replaceAll("_", " ")}</h3>
          <span>{operation.currentStage}</span>
        </div>
        <strong>{operation.status}</strong>
      </div>
      <p>{operation.currentMessage}</p>
      {percentage !== undefined ? <progress value={percentage} max={100} /> : <progress />}
      <div className="provider-summary-row">
        <span>{operation.processed}{operation.total !== undefined ? ` of ${operation.total}` : " processed"}</span>
        <span>{operation.succeeded} saved, {operation.updated} updated, {operation.skipped} skipped, {operation.failed} failed</span>
        <span>{elapsed(operation.startedAt, operation.completedAt)}</span>
      </div>
      {(operation.status === "queued" || operation.status === "running") ? (
        <button type="button" onClick={() => void onCancel()}>Cancel</button>
      ) : null}
      {operation.error ? <div className="status-line"><small>{operation.error}</small></div> : null}
    </section>
  );
}
