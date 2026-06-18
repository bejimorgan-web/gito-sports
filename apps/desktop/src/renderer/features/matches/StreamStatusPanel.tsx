import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";

interface Props {
  matchId: string | undefined;
}

export function StreamStatusPanel({ matchId }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    void recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  async function recompute() {
    if (!matchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getStreamStatus(matchId);
      setStatus(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="console-panel">
      <div className="panel-heading">
        <h3>Active Stream Status</h3>
        <span className="status-pill">{matchId ?? "No match selected"}</span>
      </div>

      <div style={{ padding: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <button disabled={!matchId || loading} onClick={recompute}>
            {loading ? "Recomputing..." : "Recompute Active Stream"}
          </button>
        </div>

        {error ? (
          <div className="error">{error}</div>
        ) : status ? (
          <div>
            <section style={{ marginBottom: 8 }}>
              <strong>Active</strong>
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(status.data?.active ?? status.active ?? null, null, 2)}</pre>
            </section>

            <section style={{ marginBottom: 8 }}>
              <strong>Fallback Chain</strong>
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(status.data?.fallback ?? status.fallback ?? [], null, 2)}</pre>
            </section>

            <section>
              <strong>Invalid</strong>
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(status.data?.invalid ?? status.invalid ?? [], null, 2)}</pre>
            </section>
          </div>
        ) : (
          <div className="muted">No stream status available. Select a match and click Recompute.</div>
        )}
      </div>
    </div>
  );
}

export default StreamStatusPanel;
