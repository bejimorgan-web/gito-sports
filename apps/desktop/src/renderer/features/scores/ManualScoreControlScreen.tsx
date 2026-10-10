import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ApiRequestError, apiClient } from "../../services/api-client";

type Sport = { id: string; name: string; slug?: string };
type Competition = { id: string; name: string; sportId: string; hostId?: string | null };
type Host = { id: string; name: string; sportId?: string };
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
type ScoreClock = { matchId: string; phase: string; running: boolean; runningSince: string | null; elapsedSeconds: number; firstHalfAddedMinutes: number | null; secondHalfAddedMinutes: number | null; version: number; startsAt?: string | null };

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

export function ManualScoreControlScreen({ accessToken, isAdmin, initialFixtureId }: { accessToken: string; isAdmin: boolean; initialFixtureId?: string | undefined }) {
  const [sports, setSports] = useState<Sport[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [sportId, setSportId] = useState("");
  const [hostId, setHostId] = useState("");
  const [competitionId, setCompetitionId] = useState("");
  const [matchDate, setMatchDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [fixtureId, setFixtureId] = useState("");
  const [scoreState, setScoreState] = useState<ManualScoreState | null>(null);
  const [clock, setClock] = useState<ScoreClock | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [addedMinutes, setAddedMinutes] = useState(3);
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
    Promise.all([apiClient.listSports(), apiClient.listHosts(sportId || undefined), apiClient.listCompetitions("catalog", hostId || undefined)])
      .then(([sportRows, hostRows, competitionRows]) => {
        if (!active) return;
        setSports(sportRows as Sport[]);
        setHosts(hostRows as Host[]);
        setCompetitions(competitionRows as Competition[]);
      })
      .catch((loadError) => { if (active) setError(describeScoreError(loadError)); })
      .finally(() => { if (active) setLoadingCatalog(false); });
    apiClient.getScoreSourceMode(accessToken)
      .then((source) => { if (active) { setSourceMode(source); setSourceModeAvailable(true); } })
      .catch(() => { if (active) setSourceModeAvailable(false); });
    return () => { active = false; };
  }, [accessToken, hostId, isAdmin, sportId]);

  useEffect(() => {
    if (!initialFixtureId || !isAdmin) return;
    let active = true;
    void apiClient.getFixture(initialFixtureId).then((fixture: Fixture) => {
      if (!active) return;
      setFixtures([fixture]); setSportId(fixture.sport?.id ?? ""); setCompetitionId(fixture.competition.id); setFixtureId(fixture.id);
    }).catch((loadError) => { if (active) setError(describeScoreError(loadError)); });
    return () => { active = false; };
  }, [initialFixtureId, isAdmin]);

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
      const from = new Date(`${matchDate}T00:00:00`).toISOString();
      const to = new Date(`${matchDate}T23:59:59.999`).toISOString();
      const rows = await apiClient.listFixtures({ sportId, competitionId, from, to, limit: pageSize, offset: nextOffset }) as Fixture[];
      setFixtures((current) => append ? [...current, ...rows] : rows);
      setOffset(nextOffset);
      setHasMoreFixtures(rows.length === pageSize);
    } catch (loadError) {
      setError(describeScoreError(loadError));
    } finally {
      setLoadingCatalog(false);
    }
  }, [competitionId, isAdmin, matchDate, sportId]);

  useEffect(() => {
    if (initialFixtureId) return;
    setFixtureId("");
    setScoreState(null);
    if (sportId && competitionId) void loadFixtures(0, false);
    else setFixtures([]);
  }, [competitionId, loadFixtures, matchDate, sportId, initialFixtureId]);

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

  const refreshClock = useCallback(async () => {
    if (!fixtureId || !accessToken) return;
    try { setClock(await apiClient.getManualScoreClock(fixtureId, accessToken) as ScoreClock); }
    catch (clockError) { if (clockError instanceof ApiRequestError && clockError.status === 404) setClock(null); else setError(describeScoreError(clockError)); }
  }, [accessToken, fixtureId]);

  useEffect(() => {
    setClock(null);
    void refreshClock();
    const poll = window.setInterval(() => void refreshClock(), 15000);
    const tick = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [refreshClock]);

  const runClockAction = useCallback(async (action: string, minutes?: number) => {
    if (!fixtureId || !clock || pending || sourceMode.mode !== "manual") return;
    setPending(true); setError(null); setNotice(null);
    try {
      const updated = await apiClient.updateManualScoreClock(fixtureId, { version: clock.version, action, ...(minutes !== undefined ? { minutes } : {}) }, accessToken) as ScoreClock;
      setClock(updated); setNotice("Match clock updated."); await refreshScore(fixtureId);
    } catch (clockError) { setError(describeScoreError(clockError)); await refreshClock(); await refreshScore(fixtureId); }
    finally { setPending(false); }
  }, [accessToken, clock, fixtureId, pending, refreshClock, refreshScore, sourceMode.mode]);

  const elapsed = clock ? clock.elapsedSeconds + (clock.running && clock.runningSince ? Math.max(0, Math.floor((clockNow - new Date(clock.runningSince).getTime()) / 1000)) : 0) : 0;
  const isSoccer = Boolean(selectedSport && ["football", "soccer"].includes((selectedSport.slug ?? selectedSport.name).trim().toLowerCase()));
  const firstAddedDue = Boolean(isSoccer && (clock?.phase === "first_half" || (clock?.phase === "paused" && elapsed < 5400)) && elapsed >= 45 * 60 && clock.firstHalfAddedMinutes === null);
  const secondHalfRegulationEnd = 5400 + (clock?.firstHalfAddedMinutes ?? 0) * 60;
  const secondAddedDue = Boolean(isSoccer && (clock?.phase === "second_half" || clock?.phase === "paused") && elapsed >= secondHalfRegulationEnd && clock.secondHalfAddedMinutes === null);
  const halfTimeDue = Boolean(isSoccer && (clock?.phase === "first_half" || clock?.phase === "paused") && !firstAddedDue && elapsed >= (45 + (clock?.firstHalfAddedMinutes ?? 0)) * 60 && elapsed < secondHalfRegulationEnd);
  const fullTimeDue = Boolean(isSoccer && (clock?.phase === "second_half" || clock?.phase === "paused") && !secondAddedDue && elapsed >= 5400 + ((clock?.firstHalfAddedMinutes ?? 0) + (clock?.secondHalfAddedMinutes ?? 0)) * 60);
  const clockMinutes = Math.floor(elapsed / 60);
  const clockLabel = isSoccer && clockMinutes > 45 && clock?.phase === "first_half" ? `45+${clockMinutes - 45}` : isSoccer && clockMinutes > 90 ? `90+${clockMinutes - 90}` : `${String(clockMinutes).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

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
        await refreshClock();
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
  }, [accessDenied, accessToken, fixtureId, isAdmin, pending, refreshClock, refreshScore]);

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

  if (!initialFixtureId) {
    const openFixture = (id: string) => {
      if (!window.gito?.scoreWindows) { setError("Separate match windows are available in the installed desktop application."); return; }
      void window.gito.scoreWindows.openMatch({ matchId: id, accessToken, role: "admin" }).catch((openError) => setError(describeScoreError(openError)));
    };
    return <section className="screen-stack score-control-screen score-operations-home">
      <header className="screen-header score-control-header"><div><p className="eyebrow">Live Matchday</p><h2>Manual Score Operations</h2><span>Choose today’s fixtures, then open each match in its own independent operations window.</span></div></header>
      <section className="score-control-panel score-source-panel"><div className="score-panel-heading"><div><span className="card-label">Live feed source</span><h3>{sourceMode.mode === "manual" ? "Manual operation" : `Live API · ${sourceMode.provider ?? "configured provider"}`}</h3></div><span className={`score-status-chip status-${sourceMode.mode}`}>{sourceMode.mode.toUpperCase()}</span></div>
        <div className="score-update-actions"><button type="button" className={sourceMode.mode === "manual" ? "button-primary" : "button-secondary"} disabled={sourceModePending || sourceMode.mode === "manual"} onClick={() => void changeSourceMode("manual")}>Use manual scores</button><button type="button" className={sourceMode.mode === "api" ? "button-primary" : "button-secondary"} disabled={sourceModePending || !sourceModeAvailable || !sourceMode.apiConfigured || sourceMode.mode === "api"} onClick={() => void changeSourceMode("api")}>Use live-score API</button></div>
      </section>
      <section className="score-control-panel"><div className="score-panel-heading"><div><span className="card-label">Matchday filters</span><h3>Find fixtures</h3></div></div>
        <div className="score-filter-row"><label>Match date<input type="date" value={matchDate} onChange={(event) => setMatchDate(event.target.value)} /></label><label>Sport<select value={sportId} onChange={(event) => { setSportId(event.target.value); setHostId(""); setCompetitionId(""); }}><option value="">Choose sport</option>{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label><label>Host<select value={hostId} disabled={!sportId} onChange={(event) => { setHostId(event.target.value); setCompetitionId(""); }}><option value="">All hosts</option>{hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select></label><label>Competition<select value={competitionId} disabled={!sportId} onChange={(event) => setCompetitionId(event.target.value)}><option value="">Choose competition</option>{filteredCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label></div>
      </section>
      <section className="score-control-panel"><div className="score-panel-heading"><div><span className="card-label">{matchDate}</span><h3>Fixtures</h3></div><span>{fixtures.length} listed</span></div>
        {!sportId || !competitionId ? <p className="field-note">Select a sport and competition to show this day’s matches. Use Host to narrow the competition list.</p> : loadingCatalog ? <p role="status">Loading matchday fixtures…</p> : fixtures.length ? <div className="score-fixture-list">{fixtures.map((fixture) => { const kickoffReached = Date.parse(fixture.startsAt) <= clockNow && startableFixtureStatuses.has(fixture.status); return <article className="score-fixture-row" key={fixture.id}><div className="score-fixture-row-main"><strong>{fixture.homeTeam.name} <span>vs</span> {fixture.awayTeam.name}</strong><small>{fixture.competition.name} · {formatKickoff(fixture.startsAt)}</small>{kickoffReached ? <span className="score-kickoff-alert" role="status">Kickoff time reached · start match clock</span> : null}</div><span className={`score-status-chip status-${fixture.status}`}>{fixture.status}</span><button className="button-primary" type="button" onClick={() => openFixture(fixture.id)}>Open match desk</button></article>; })}</div> : <p className="field-note">No fixtures are scheduled for this sport, competition, and date.</p>}
        {hasMoreFixtures ? <button className="button-quiet" type="button" disabled={loadingCatalog} onClick={() => void loadFixtures(offset + pageSize, true)}>Load more fixtures</button> : null}
      </section>
      {error ? <p className="score-control-error" role="alert">{error}</p> : null}
    </section>;
  }

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
        {!initialFixtureId ? <section className="score-control-panel score-fixture-panel">
          <div className="score-panel-heading"><div><span className="card-label">01 · Select fixture</span><h3>Canonical fixture</h3></div><span className="score-panel-mark">ID</span></div>
          <label>Sport<select value={sportId} onChange={(event) => { setSportId(event.target.value); setCompetitionId(""); }}><option value="">Choose a sport</option>{sports.map((sport) => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select></label>
          <label>Competition<select value={competitionId} disabled={!sportId} onChange={(event) => setCompetitionId(event.target.value)}><option value="">Choose a competition</option>{filteredCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label>
          <label>Fixture<select value={fixtureId} disabled={!competitionId || loadingCatalog} onChange={(event) => setFixtureId(event.target.value)}><option value="">Choose a fixture</option>{fixtures.map((fixture) => <option key={fixture.id} value={fixture.id}>{fixture.homeTeam.name} vs {fixture.awayTeam.name} · {formatKickoff(fixture.startsAt)}</option>)}</select></label>
          {hasMoreFixtures ? <button className="button-quiet" type="button" disabled={loadingCatalog} onClick={() => void loadFixtures(offset + pageSize, true)}>{loadingCatalog ? "Loading…" : "Load more fixtures"}</button> : null}
          {selectedFixture ? <div className="score-fixture-meta"><span>Canonical ID</span><code>{selectedFixture.id}</code><span>Competition</span><strong>{selectedFixture.competition.name}</strong><span>Kickoff</span><strong>{formatKickoff(selectedFixture.startsAt)}</strong><span>Fixture status</span><strong>{selectedFixture.status}</strong></div> : <p className="field-note">Choose a sport and competition to find a fixture. Select by the canonical fixture record, never by a provider ID.</p>}
        </section> : null}

        <section className="score-control-panel score-edit-panel">
          <div className="score-panel-heading"><div><span className="card-label">02 · Score desk</span><h3>{selectedFixture ? `${selectedFixture.homeTeam.name} vs ${selectedFixture.awayTeam.name}` : "Match score"}</h3></div><span className={`score-status-chip status-${effectiveStatus}`}>{effectiveStatus}{scoreState?.finalResultConfirmed ? " · CONFIRMED" : ""}</span></div>
          {sourceMode.mode === "api" ? <div className="score-control-info" role="status"><strong>API source is active</strong><span>Manual score controls are disabled until you switch the source back to Manual.</span></div> : !selectedFixture ? <p className="field-note">Loading the canonical fixture…</p> : !supportedSport ? <div className="score-control-info" role="status"><strong>Read only for this sport</strong><span>The existing manual score API currently validates football and soccer fixtures only. No score controls are shown for other sports.</span></div> : loadingScore ? <p role="status">Loading authoritative score state…</p> : <>
            {selectedFixture && !clock && !scoreState && selectedFixture.startsAt ? <div className="score-clock-kickoff"><span>Scheduled kickoff</span><strong>{formatKickoff(selectedFixture.startsAt)}</strong><small>{Date.parse(selectedFixture.startsAt) > clockNow ? `Kickoff in ${Math.ceil((Date.parse(selectedFixture.startsAt) - clockNow) / 60000)} minutes` : "Kickoff time reached · start the clock when play begins"}</small></div> : null}
            {scoreState && !clock && ["live", "paused"].includes(scoreState.status) ? <div className="score-control-info"><strong>Match clock not initialized</strong><span>Start a clock for this existing live match. Its canonical scheduled kickoff time is used when available.</span><button className="button-primary" type="button" disabled={pending} onClick={async () => { setPending(true); try { setClock(await apiClient.updateManualScoreClock(fixtureId, { version: 0, action: "initialize" }, accessToken) as ScoreClock); } catch (clockError) { setError(describeScoreError(clockError)); } finally { setPending(false); } }}>Initialize match clock</button></div> : null}
            {clock ? <section className="score-clock-panel" aria-label="Match clock"><div className="score-clock-face"><span>{clock.phase.replaceAll("_", " ")}</span><strong>{clockLabel}</strong><small>{clock.running ? "Clock running" : "Clock stopped"} · clock version {clock.version}</small></div><div className="score-clock-actions">
              {clock.running ? <button className="button-secondary" type="button" disabled={pending} onClick={() => void runClockAction("pause")}>Pause clock</button> : null}
              {!clock.running && ["first_half", "second_half", "paused"].includes(clock.phase) ? <button className="button-primary" type="button" disabled={pending} onClick={() => void runClockAction("resume")}>Resume clock</button> : null}
              {clock.phase === "halftime" ? <button className="button-primary" type="button" disabled={pending} onClick={() => void runClockAction("start_second_half")}>Start second half</button> : null}
              {halfTimeDue && clock.running ? <button className="button-primary" type="button" disabled={pending} onClick={() => void runClockAction("halftime")}>End first half</button> : null}
              {fullTimeDue ? <button className="button-primary" type="button" disabled={pending} onClick={() => void runClockAction("end")}>End match</button> : null}
              {!isSoccer && clock.running ? <button className="button-primary" type="button" disabled={pending} onClick={() => void runClockAction("end")}>End match</button> : null}
            </div></section> : null}
            {firstAddedDue || secondAddedDue ? <div className="score-clock-alert" role="alert"><strong>Match needs attention</strong><span>{firstAddedDue ? "The first 45 minutes are complete. Set first-half added time." : "The second 45 minutes are complete. Set second-half added time."}</span><label>Added minutes<input type="number" min="0" max="30" value={addedMinutes} onChange={(event) => setAddedMinutes(Number(event.target.value))} /></label><button className="button-primary" type="button" disabled={pending || !Number.isInteger(addedMinutes) || addedMinutes < 0 || addedMinutes > 30} onClick={() => void runClockAction(firstAddedDue ? "set_first_added" : "set_second_added", addedMinutes)}>Save added time</button></div> : null}
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
