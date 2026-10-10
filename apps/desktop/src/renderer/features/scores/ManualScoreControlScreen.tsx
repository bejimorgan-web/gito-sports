import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ApiRequestError, apiClient } from "../../services/api-client";

type Sport = { id: string; name: string; slug?: string };
type Competition = { id: string; name: string; sportId: string };
type Fixture = {
  id: string;
  startsAt: string;
  status: string;
  sport?: { id: string; name: string } | null;
  competition: { id: string; name: string };
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
};
type ManualScoreState = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  version: number;
  finalResultConfirmed: boolean;
  updatedByOperatorId: string | null;
  updatedAt: string;
  createdAt: string;
  lastConfirmedAt: string | null;
};
type ScoreSourceMode = { mode: "manual" | "api"; apiConfigured: boolean; provider: string | null };

const pageSize = 100;
const startableFixtureStatuses = new Set(["scheduled", "approved", "published"]);

function describeScoreError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "Your session is no longer authorized. Sign in again before making score changes.";
    if (error.status === 403) return "Your account does not have administrator permission to change scores.";
    if (error.status === 409 && error.message === "stale_score_version") return "Another operator changed this score. The latest server state has been reloaded; review it before trying again.";
    if (error.status === 409) return `The server rejected this state transition: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The score request failed.";
}

function formatKickoff(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function ManualScoreControlScreen({ accessToken, isAdmin }: { accessToken: string; isAdmin: boolean }) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [sportId, setSportId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [fixtureId, setFixtureId] = useState("");
  const [scoreState, setScoreState] = useState<ManualScoreState | null>(null);
  const [sourceMode, setSourceMode] = useState<ScoreSourceMode>({ mode: "manual", apiConfigured: false, provider: null });
  const [sourceModeAvailable, setSourceModeAvailable] = useState(false);
  const [sourceModePending, setSourceModePending] = useState(false);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [nextStatus, setNextStatus] = useState("live");
  const [reason, setReason] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMoreFixtures, setHasMoreFixtures] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingScore, setLoadingScore] = useState(false);
  const [pending, setPending] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedSport = sports.find((sport) => sport.id === sportId);
  const selectedFixture = fixtures.find((fixture) => fixture.id === fixtureId);
  const supportedSport = selectedSport && ["football", "soccer"].includes((selectedSport.slug ?? selectedSport.name).trim().toLowerCase());
  const filteredCompetitions = useMemo(
    () => competitions.filter((competition) => competition.sportId === sportId),
    [competitions, sportId]
  );

  useEffect(() => {
    if (!isAdmin || !accessToken) return;
    let active = true;
    setLoadingCatalog(true);
    Promise.all([apiClient.listSports(), apiClient.listCompetitions("catalog")])
      .then(([sportRows, competitionRows]) => {
        if (!active) return;
        setSports(sportRows as Sport[]);
        setCompetitions(competitionRows as Competition[]);
      })
      .catch((loadError) => { if (active) setError(describeScoreError(loadError)); })
      .finally(() => { if (active) setLoadingCatalog(false); });
    apiClient.getScoreSourceMode(accessToken)
      .then((source) => { if (active) { setSourceMode(source); setSourceModeAvailable(true); } })
      .catch(() => { if (active) setSourceModeAvailable(false); });
    return () => { active = false; };
  }, [accessToken, isAdmin]);

  const changeSourceMode = useCallback(async (mode: "manual" | "api") => {
    if (!isAdmin || !accessToken || sourceModePending || mode === sourceMode.mode) return;
    setSourceModePending(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiClient.setScoreSourceMode(mode, accessToken);
      setSourceMode(updated);
      setNotice(mode === "manual"
        ? "Manual scoring is active. Live provider polling is paused."
        : `Live scores are now using ${updated.provider ?? "the configured provider"}.`);
    } catch (modeError) {
      setError(describeScoreError(modeError));
    } finally {
      setSourceModePending(false);
    }
  }, [accessToken, isAdmin, sourceMode.mode, sourceModePending]);

  const loadFixtures = useCallback(async (nextOffset: number, append: boolean) => {
    if (!sportId || !competitionId || !isAdmin) {
      setFixtures([]);
      setHasMoreFixtures(false);
      return;
    }
    setLoadingCatalog(true);
    setError(null);
    try {
      const rows = await apiClient.listFixtures({ sportId, competitionId, limit: pageSize, offset: nextOffset }) as Fixture[];
      setFixtures((current) => append ? [...current, ...rows] : rows);
      setOffset(nextOffset);
      setHasMoreFixtures(rows.length === pageSize);
    } catch (loadError) {
      setError(describeScoreError(loadError));
    } finally {
      setLoadingCatalog(false);
    }
  }, [competitionId, isAdmin, sportId]);

  useEffect(() => {
    setFixtureId("");
    setScoreState(null);
    if (sportId && competitionId) void loadFixtures(0, false);
    else setFixtures([]);
  }, [competitionId, loadFixtures, sportId]);

  const refreshScore = useCallback(async (id = fixtureId) => {
    if (!id || !accessToken) return null;
    setLoadingScore(true);
    try {
      const state = await apiClient.getManualScoreState(id, accessToken) as ManualScoreState;
      setAccessDenied(false);
      setScoreState(state);
      setHomeScore(state.homeScore);
      setAwayScore(state.awayScore);
      setNextStatus("live");
      return state;
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.status === 404) {
        setAccessDenied(false);
        setScoreState(null);
        setHomeScore(0);
        setAwayScore(0);
        setNextStatus("live");
        return null;
      }
      if (loadError instanceof ApiRequestError && [401, 403].includes(loadError.status)) setAccessDenied(true);
      setError(describeScoreError(loadError));
      return null;
    } finally {
      setLoadingScore(false);
    }
  }, [accessToken, fixtureId]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setReason("");
    if (fixtureId) void refreshScore(fixtureId);
    else setScoreState(null);
  }, [fixtureId, refreshScore]);

  const mutate = useCallback(async (operation: () => Promise<ManualScoreState>, successMessage: string) => {
    if (!isAdmin || accessDenied || !accessToken || !fixtureId || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const committed = await operation();
      setScoreState(committed);
      setHomeScore(committed.homeScore);
      setAwayScore(committed.awayScore);
      setNotice(successMessage);
      try {
        await refreshScore(fixtureId);
      } catch {
        // The mutation response remains the server-confirmed state if a follow-up read fails.
      }
    } catch (operationError) {
      if (operationError instanceof ApiRequestError && [401, 403].includes(operationError.status)) setAccessDenied(true);
      if (operationError instanceof ApiRequestError && operationError.status === 409 && operationError.message === "stale_score_version") {
        await refreshScore(fixtureId);
      }
      setError(describeScoreError(operationError));
    } finally {
      setPending(false);
    }
  }, [accessDenied, accessToken, fixtureId, isAdmin, pending, refreshScore]);

  if (!isAdmin) {
    return <section className="screen-stack score-control-screen"><div className="score-control-denied" role="alert"><h2>Administrator access required</h2><p>Manual score controls are available only to administrator accounts.</p></div></section>;
  }
  if (accessDenied) {
    return <section className="screen-stack score-control-screen"><div className="score-control-denied" role="alert"><h2>Administrator access required</h2><p>{error ?? "Your session cannot access manual score operations. Sign in again with an administrator account."}</p></div></section>;
  }

  const effectiveStatus = scoreState?.status ?? selectedFixture?.status ?? "scheduled";
  const canStart = Boolean(sourceMode.mode === "manual" && selectedFixture && !scoreState && startableFixtureStatuses.has(selectedFixture.status));
  const canUpdate = Boolean(sourceMode.mode === "manual" && scoreState && !scoreState.finalResultConfirmed && ["live", "paused"].includes(scoreState.status));
  const canConfirm = Boolean(sourceMode.mode === "manual" && scoreState && scoreState.status === "ended" && !scoreState.finalResultConfirmed);
  const canCorrectOrReopen = Boolean(sourceMode.mode === "manual" && scoreState?.finalResultConfirmed);
  const scoreValuesValid = Number.isSafeInteger(homeScore) && homeScore >= 0 && Number.isSafeInteger(awayScore) && awayScore >= 0;

  return (
    <section className="screen-stack score-control-screen">
      <header className="screen-header score-control-header">
        <div><p className="eyebrow">Match Operations</p><h2>Manual Score Control</h2><span>Administer canonical fixtures with versioned, audited score updates.</span></div>
        <button type="button" className="button-secondary" disabled={!fixtureId || loadingScore || pending} onClick={() => void refreshScore()}>Refresh state</button>
      </header>

      <section className="score-control-panel score-source-panel" aria-label="Live score source">
        <div className="score-panel-heading"><div><span className="card-label">Live feed source</span><h3>{sourceMode.mode === "manual" ? "Manual operation" : `Live API${sourceMode.provider ? ` · ${sourceMode.provider}` : ""}`}</h3></div><span className={`score-status-chip status-${sourceMode.mode}`}>{sourceMode.mode === "manual" ? "MANUAL" : "API"}</span></div>
        <p>{sourceMode.mode === "manual" ? "Manual scoring is active for the mobile live-score feed. Provider polling is paused." : "The configured provider supplies the live-score feed. Manual score changes are paused; existing manual records remain saved."}</p>
        <div className="score-update-actions">
          <button type="button" className={sourceMode.mode === "manual" ? "button-primary" : "button-secondary"} disabled={sourceModePending || sourceMode.mode === "manual"} onClick={() => void changeSourceMode("manual")}>{sourceModePending ? "Switching…" : "Use manual scores"}</button>
          <button type="button" className={sourceMode.mode === "api" ? "button-primary" : "button-secondary"} disabled={sourceModePending || !sourceModeAvailable || !sourceMode.apiConfigured || sourceMode.mode === "api"} onClick={() => void changeSourceMode("api")}>{sourceModePending ? "Switching…" : "Use live-score API"}</button>
        </div>
        {!sourceModeAvailable ? <p className="field-note">Source switching becomes available after the backend update; existing score controls remain usable.</p> : !sourceMode.apiConfigured ? <p className="field-note">API mode is unavailable until a live-score provider key is configured on the backend.</p> : null}
      </section>

      <div className="score-control-grid">
        <section className="score-control-panel score-fixture-panel">
          <div className="score-panel-heading"><div><span className="card-label">01 · Select fixture</span><h3>Canonical fixture</h3></div><span className="score-panel-mark">ID</span></div>
          <label>Sport<select value={sportId} onChange={(event) => { setSportId(event.target.value); setCompetitionId(""); }}><option value="">Choose a sport</option>{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
          <label>Competition<select value={competitionId} disabled={!sportId} onChange={(event) => setCompetitionId(event.target.value)}><option value="">Choose a competition</option>{filteredCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label>
          <label>Fixture<select value={fixtureId} disabled={!competitionId || loadingCatalog} onChange={(event) => setFixtureId(event.target.value)}><option value="">Choose a fixture</option>{fixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.homeTeam.name} vs {fixture.awayTeam.name} · {formatKickoff(fixture.startsAt)}</option>)}</select></label>
          {hasMoreFixtures ? <button className="button-quiet" type="button" disabled={loadingCatalog} onClick={() => void loadFixtures(offset + pageSize, true)}>{loadingCatalog ? "Loading…" : "Load more fixtures"}</button> : null}
          {selectedFixture ? <div className="score-fixture-meta"><span>Canonical ID</span><code>{selectedFixture.id}</code><span>Competition</span><strong>{selectedFixture.competition.name}</strong><span>Kickoff</span><strong>{formatKickoff(selectedFixture.startsAt)}</strong><span>Fixture status</span><strong>{selectedFixture.status}</strong></div> : <p className="field-note">Choose a sport and competition to find a fixture. Select by the canonical fixture record, never by a provider ID.</p>}
        </section>

        <section className="score-control-panel score-edit-panel">
          <div className="score-panel-heading"><div><span className="card-label">02 · Score desk</span><h3>{selectedFixture ? `${selectedFixture.homeTeam.name} vs ${selectedFixture.awayTeam.name}` : "Match score"}</h3></div><span className={`score-status-chip status-${effectiveStatus}`}>{effectiveStatus}{scoreState?.finalResultConfirmed ? " · CONFIRMED" : ""}</span></div>
          {sourceMode.mode === "api" ? <div className="score-control-info" role="status"><strong>API source is active</strong><span>Manual score controls are disabled until you switch the source back to Manual.</span></div> : !selectedFixture ? <p className="field-note">Select a canonical fixture to load its authoritative score state.</p> : !supportedSport ? <div className="score-control-info" role="status"><strong>Read only for this sport</strong><span>The existing manual score API currently validates football and soccer fixtures only. No score controls are shown for other sports.</span></div> : loadingScore ? <p role="status">Loading authoritative score state…</p> : <>
            <div className="score-board">
              <label><span>{selectedFixture.homeTeam.name}</span><input aria-label="Home score" type="number" min="0" step="1" value={homeScore} disabled={pending || (!canStart && !canUpdate && !canCorrectOrReopen)} onChange={(event) => setHomeScore(event.target.value === "" ? 0 : Number(event.target.value))} /></label>
              <b>—</b>
              <label><span>{selectedFixture.awayTeam.name}</span><input aria-label="Away score" type="number" min="0" step="1" value={awayScore} disabled={pending || (!canStart && !canUpdate && !canCorrectOrReopen)} onChange={(event) => setAwayScore(event.target.value === "" ? 0 : Number(event.target.value))} /></label>
            </div>
            <div className="score-state-meta"><span>Manual state</span><strong>{scoreState ? scoreState.status : "Not started"}</strong><span>Version</span><strong>{scoreState?.version ?? 0}</strong><span>Final result</span><strong>{scoreState?.finalResultConfirmed ? "Confirmed" : "Not confirmed"}</strong><span>Updated</span><strong>{scoreState?.updatedAt ? formatKickoff(scoreState.updatedAt) : "—"}</strong></div>
            {canStart ? <button className="button-primary" type="button" disabled={pending || !scoreValuesValid} onClick={() => void mutate(() => apiClient.startManualScore(fixtureId, { version: 0, homeScore, awayScore }, accessToken), "Fixture started. Server state refreshed.")}>{pending ? "Saving…" : "Start fixture"}</button> : null}
            {canUpdate ? <div className="score-update-actions"><label>Next status<select value={nextStatus} disabled={pending} onChange={(event) => setNextStatus(event.target.value)}><option value="live">Live / resume</option><option value="paused">Paused</option><option value="ended">Ended</option></select></label><button className="button-primary" type="button" disabled={pending || !scoreValuesValid} onClick={() => void mutate(() => apiClient.updateManualScore(fixtureId, { version: scoreState!.version, homeScore, awayScore, status: nextStatus }, accessToken), "Score updated. Server state refreshed.")}>{pending ? "Saving…" : "Save score and status"}</button></div> : null}
            {canConfirm ? <button className="button-primary" type="button" disabled={pending} onClick={() => { if (window.confirm("Confirm this final result? Ordinary score edits will be locked.")) void mutate(() => apiClient.confirmManualScore(fixtureId, { version: scoreState!.version }, accessToken), "Final result confirmed by the server."); }}>{pending ? "Saving…" : "Confirm final result"}</button> : null}
            {canCorrectOrReopen ? <div className="score-final-actions"><label>Reason<textarea value={reason} maxLength={500} disabled={pending} onChange={(event) => setReason(event.target.value)} placeholder="Required for correction or reopening" /></label><div><button type="button" className="button-secondary" disabled={pending || !scoreValuesValid || !reason.trim()} onClick={() => { if (window.confirm("Correct this confirmed result? The reason and previous score will be audited.")) void mutate(() => apiClient.correctManualScore(fixtureId, { version: scoreState!.version, homeScore, awayScore, reason: reason.trim() }, accessToken), "Confirmed result corrected and refreshed."); }}>{pending ? "Saving…" : "Correct result"}</button><button type="button" className="button-danger" disabled={pending || !reason.trim()} onClick={() => { if (window.confirm("Reopen this confirmed result? It will no longer be a confirmed final.")) void mutate(() => apiClient.reopenManualScore(fixtureId, { version: scoreState!.version, reason: reason.trim() }, accessToken), "Result reopened and refreshed."); }}>{pending ? "Saving…" : "Reopen result"}</button></div></div> : null}
            {scoreState && !scoreState.finalResultConfirmed && !["live", "paused", "ended"].includes(scoreState.status) ? <div className="score-control-info" role="status"><strong>No recovery action available</strong><span>This fixture is {scoreState.status}. Rescheduling or recovery requires a separately defined lifecycle policy; no score mutation is offered here.</span></div> : null}
            {!scoreState && !canStart ? <div className="score-control-info" role="status"><strong>Fixture cannot be started</strong><span>The canonical fixture must be scheduled, approved, or published before manual scoring can begin.</span></div> : null}
          </>}
        </section>
      </div>
      {notice ? <p className="score-control-notice" role="status">{notice}</p> : null}
      {error ? <p className="score-control-error" role="alert">{error}</p> : null}
    </section>
  );
}
