import React, { useEffect, useState } from "react";
import type { Competition, Season } from "@gito/shared";
import {
  ApiRequestError,
  apiClient,
  type StandingsResponse,
  type StandingsRulesetInput,
  type StandingsWorkflowContext,
  type StandingsWorkflowResult
} from "../../services/api-client";

interface StandingsScreenProps {
  accessToken: string;
  isAdmin: boolean;
}

function describeRequestError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 400) return "The selected competition or season identifier is invalid.";
    if (error.status === 401) return "Your session is no longer authorized. Sign in again to continue.";
    if (error.status === 403) return "Administrator access is required to review standings.";
    if (error.status === 404) {
      if (error.message === "standings_snapshot_not_found") return "No calculated standings snapshot is available for this season.";
      if (error.message === "competition_not_found") return "The selected competition could not be found.";
      if (error.message === "season_not_found") return "The selected season could not be found for this competition.";
      return "The requested standings or competition data could not be found.";
    }
    return `Standings request failed (HTTP ${error.status}): ${error.message}`;
  }
  return error instanceof Error ? `Unable to load standings: ${error.message}` : "Unable to load standings due to a network or server error.";
}

function coverageLabel(result: StandingsResponse): string {
  if (result.coverage.eligible) return "Eligible standings";
  switch (result.coverage.status) {
    case "incomplete":
      return "Ineligible — schedule coverage is incomplete or unresolved";
    case "superseded":
      return "Ineligible — assessment uses a superseded manifest";
    case "invalid":
      return "Ineligible — schedule or assessment is invalid";
    case "unassessed":
      return "Calculated standings — not assessed for eligibility";
    case "unverified":
      return "Ineligible — schedule completeness has not been verified";
    case "verified_complete":
      return "Ineligible — coverage assessment did not establish eligibility";
  }
}

export function StandingsScreen({ accessToken, isAdmin }: StandingsScreenProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [result, setResult] = useState<StandingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCompetitions, setLoadingCompetitions] = useState(false);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [workflowContext, setWorkflowContext] = useState<StandingsWorkflowContext | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<Record<string, string>>({});
  const [rulesetJson, setRulesetJson] = useState("");
  const [rulesetApprovalId, setRulesetApprovalId] = useState("");
  const [scheduleSourceName, setScheduleSourceName] = useState("");
  const [scheduleSourceReference, setScheduleSourceReference] = useState("");
  const [scheduleCsvBase64, setScheduleCsvBase64] = useState("");
  const [scheduleCsvName, setScheduleCsvName] = useState("");
  const [workflowContextRefresh, setWorkflowContextRefresh] = useState(0);
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowResult, setWorkflowResult] = useState<StandingsWorkflowResult | null>(null);

  useEffect(() => {
    if (!isAdmin || !accessToken) return;
    let active = true;
    setLoadingCompetitions(true);
    setError(null);
    void apiClient.listCompetitions("legacy").then((items) => {
      if (!active) return;
      setCompetitions(items);
      setCompetitionId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    }).catch((loadError: unknown) => {
      if (active) setError(describeRequestError(loadError));
    }).finally(() => {
      if (active) setLoadingCompetitions(false);
    });
    return () => { active = false; };
  }, [accessToken, isAdmin]);

  useEffect(() => {
    setResult(null);
    setSeasonId("");
    setSeasons([]);
    setError(null);
    if (!isAdmin || !accessToken || !competitionId) return;
    let active = true;
    setLoadingSeasons(true);
    void apiClient.listSeasons(competitionId).then((items) => {
      if (!active) return;
      setSeasons(items);
      const competition = competitions.find((item) => item.id === competitionId);
      const preferredSeason = competition?.currentSeasonId
        ? items.find((item) => item.id === competition.currentSeasonId)
        : undefined;
      setSeasonId(preferredSeason?.id ?? items[0]?.id ?? "");
    }).catch((loadError: unknown) => {
      if (active) setError(describeRequestError(loadError));
    }).finally(() => {
      if (active) setLoadingSeasons(false);
    });
    return () => { active = false; };
  }, [accessToken, competitionId, competitions, isAdmin]);

  useEffect(() => {
    setResult(null);
    setError(null);
    if (!isAdmin || !accessToken || !competitionId || !seasonId) return;
    let active = true;
    setLoadingStandings(true);
    void apiClient.getStandings(competitionId, seasonId, accessToken).then((response) => {
      if (active) setResult(response);
    }).catch((loadError: unknown) => {
      if (active) setError(describeRequestError(loadError));
    }).finally(() => {
      if (active) setLoadingStandings(false);
    });
    return () => { active = false; };
  }, [accessToken, competitionId, isAdmin, refreshSequence, seasonId]);

  useEffect(() => {
    setWorkflowContext(null);
    setSelectedTeamIds([]);
    setSelectedFixtureIds([]);
    setSelectedRevisionIds({});
    setRulesetJson("");
    setRulesetApprovalId("");
    setScheduleSourceName("");
    setScheduleSourceReference("");
    setScheduleCsvBase64("");
    setScheduleCsvName("");
    setScheduleConfirmed(false);
    setWorkflowResult(null);
    setWorkflowError(null);
    if (!isAdmin || !accessToken || !competitionId || !seasonId) return;
    let active = true;
    void apiClient.getStandingsWorkflowContext(competitionId, seasonId, accessToken).then(({ data }) => {
      if (active) setWorkflowContext(data);
    }).catch((loadError: unknown) => {
      if (active) setWorkflowError(describeRequestError(loadError));
    });
    return () => { active = false; };
  }, [accessToken, competitionId, isAdmin, seasonId, workflowContextRefresh]);

  async function proposeRuleset() {
    if (!workflowContext || !competitionId || !seasonId) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      const ruleset: StandingsRulesetInput = JSON.parse(rulesetJson);
      await apiClient.proposeStandingsRuleset(competitionId, seasonId, ruleset, accessToken);
      setWorkflowContextRefresh((value) => value + 1);
    } catch (proposalError) {
      setWorkflowError(proposalError instanceof Error ? `Unable to propose ruleset: ${proposalError.message}` : "Unable to propose ruleset.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function approveRuleset(approvalId: string) {
    if (!competitionId || !seasonId) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      await apiClient.approveStandingsRuleset(competitionId, seasonId, approvalId, accessToken);
      setWorkflowContextRefresh((value) => value + 1);
    } catch (approvalError) {
      setWorkflowError(approvalError instanceof Error ? `Unable to approve ruleset: ${approvalError.message}` : "Unable to approve ruleset.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function prepareStandings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflowContext || !competitionId || !seasonId) return;
    setWorkflowBusy(true);
    setWorkflowError(null);
    setWorkflowResult(null);
    try {
      const expectedFixtures = workflowContext.fixtures
        .filter((fixture) => selectedFixtureIds.includes(fixture.id))
        .map((fixture) => ({
          fixtureKey: fixture.id,
          matchId: fixture.id,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId
        }));
      const revisionSelections = Object.entries(selectedRevisionIds)
        .filter(([matchId, revisionId]) => revisionId && selectedFixtureIds.includes(matchId))
        .map(([matchId, revisionId]) => ({ matchId, revisionId }));
      const { data } = await apiClient.prepareStandings(competitionId, seasonId, {
        teamIds: selectedTeamIds,
        expectedFixtures,
        revisionSelections,
        rulesetApprovalId,
        scheduleConfirmed: true,
        scheduleSourceName,
        scheduleSourceReference,
        scheduleCsvBase64
      }, accessToken);
      setWorkflowResult(data);
      setRefreshSequence((current) => current + 1);
    } catch (submitError) {
      setWorkflowError(submitError instanceof Error
        ? `Unable to prepare standings: ${submitError.message}`
        : "Unable to prepare standings due to a network or server error.");
    } finally {
      setWorkflowBusy(false);
    }
  }

  if (!isAdmin) {
    return <section className="console-panel" role="alert">Administrator access required to review standings.</section>;
  }

  return (
    <section className="console-panel standings-workspace">
      <header className="section-header">
        <div>
          <p className="eyebrow">Competition review</p>
          <h2>Standings</h2>
          <p className="field-note">Persisted standings snapshots and schedule coverage. This view does not recalculate standings.</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setRefreshSequence((current) => current + 1)}
          disabled={!competitionId || !seasonId || loadingStandings}
        >
          {loadingStandings ? "Refreshing…" : "Refresh standings"}
        </button>
      </header>

      <div className="standings-selectors">
        <label>
          Competition
          <select
            aria-label="Competition"
            value={competitionId}
            disabled={loadingCompetitions}
            onChange={(event) => {
              setResult(null);
              setError(null);
              setCompetitionId(event.target.value);
            }}
          >
            <option value="">Select a competition</option>
            {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
          </select>
        </label>
        <label>
          Season
          <select
            aria-label="Season"
            value={seasonId}
            disabled={!competitionId || loadingSeasons}
            onChange={(event) => {
              setResult(null);
              setError(null);
              setSeasonId(event.target.value);
            }}
          >
            <option value="">Select a season</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>
      </div>

      {loadingCompetitions ? <p role="status">Loading competitions…</p> : null}
      {loadingSeasons ? <p role="status">Loading seasons…</p> : null}
      {loadingStandings ? <p role="status">Loading persisted standings…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loadingStandings && !error && competitionId && seasonId && !result
        ? <p role="status">No standings have been loaded for this selection.</p>
        : null}
      {result ? (
        <>
          <section className={`standings-coverage ${result.coverage.eligible ? "eligible" : "ineligible"}`} aria-label="Standings eligibility">
            <strong>{coverageLabel(result)}</strong>
            <span>Coverage status: {result.coverage.status.replaceAll("_", " ")}</span>
            {result.coverage.assessment?.manifest
              ? <span>Manifest version {result.coverage.assessment.manifest.version} · {result.coverage.assessment.manifest.state}{result.coverage.assessment.manifest.source ? ` · Source: ${result.coverage.assessment.manifest.source.name} (${result.coverage.assessment.manifest.source.reference})` : " · No source attestation"}</span>
              : null}
            {result.coverage.assessment?.blockingReasons.map((reason, index) => (
              <small key={`${reason.code}-${reason.fixtureId ?? index}`}>{reason.message}</small>
            ))}
          </section>
          <section className="standings-snapshot-metadata" aria-label="Snapshot metadata">
            <span>{result.competition.name} · {result.season.name}</span>
            <span>Snapshot {result.snapshot.sequence} · {result.snapshot.id}</span>
            <span>Ruleset {result.snapshot.ruleset.id} v{result.snapshot.ruleset.version}</span>
            {result.snapshot.rulesetApproval
              ? <span>Approved by {result.snapshot.rulesetApproval.approvedByOperatorId} · {new Date(result.snapshot.rulesetApproval.approvedAt).toLocaleString()}</span>
              : <span>Legacy snapshot — no persisted ruleset approval record</span>}
            <span>Calculated {new Date(result.snapshot.calculatedAt).toLocaleString()}</span>
          </section>
          {result.rows.length === 0 ? <p>No team rows were stored in this snapshot.</p> : (
            <div className="table-scroll">
              <table className="data-table standings-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Team</th>
                    <th scope="col">Played</th>
                    <th scope="col">Won</th>
                    <th scope="col">Drawn</th>
                    <th scope="col">Lost</th>
                    <th scope="col">Goals for</th>
                    <th scope="col">Goals against</th>
                    <th scope="col">Goal difference</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.entry.id}>
                      <td>{row.rank}</td>
                      <td>{row.entry.displayName ?? "Unnamed team"}</td>
                      <td>{row.played}</td>
                      <td>{row.won}</td>
                      <td>{row.drawn}</td>
                      <td>{row.lost}</td>
                      <td>{row.goalsFor}</td>
                      <td>{row.goalsAgainst}</td>
                      <td>{row.goalDifference}</td>
                      <td>{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
      {competitionId && seasonId ? (
        <section className="standings-preparation" aria-labelledby="standings-preparation-title">
          <h3 id="standings-preparation-title">Prepare standings</h3>
          <p>
            This team-only workflow creates immutable records. Stored fixtures are not proof of a complete schedule:
            review each fixture below, confirm the full season schedule, and create missing canonical fixtures first.
          </p>
          {!workflowContext ? <p role="status">Loading preparation inputs…</p> : (
            <form onSubmit={(event) => void prepareStandings(event)}>
              <fieldset>
                <legend>Competition teams — select the complete set of entrants</legend>
                {workflowContext.teamCandidates.length === 0
                  ? <p>No active season team memberships are available. Add canonical team memberships before preparing standings.</p>
                  : workflowContext.teamCandidates.map((team) => (
                    <label className="standings-workflow-choice" key={team.teamId}>
                      <input
                        type="checkbox"
                        checked={selectedTeamIds.includes(team.teamId)}
                        onChange={(event) => setSelectedTeamIds((current) => event.target.checked
                          ? [...current, team.teamId]
                          : current.filter((id) => id !== team.teamId))}
                      />
                      {team.name}
                    </label>
                  ))}
              </fieldset>
              <fieldset>
                <legend>Expected season schedule — select and review every expected fixture</legend>
                {workflowContext.fixtures.length === 0
                  ? <p>No canonical fixtures exist for this competition season.</p>
                  : workflowContext.fixtures.map((fixture) => {
                    const revisions = workflowContext.acceptedRevisions.filter((revision) => revision.matchId === fixture.id);
                    return (
                      <div className="standings-workflow-fixture" key={fixture.id}>
                        <label className="standings-workflow-choice">
                          <input
                            type="checkbox"
                            checked={selectedFixtureIds.includes(fixture.id)}
                            onChange={(event) => setSelectedFixtureIds((current) => event.target.checked
                              ? [...current, fixture.id]
                              : current.filter((id) => id !== fixture.id))}
                          />
                          {fixture.homeTeamName} vs {fixture.awayTeamName} · {fixture.status}
                        </label>
                        {fixture.status === "ended" ? (
                          <label>
                            Accepted result revision
                            <select
                              aria-label={`Accepted result for ${fixture.homeTeamName} vs ${fixture.awayTeamName}`}
                              value={selectedRevisionIds[fixture.id] ?? ""}
                              onChange={(event) => setSelectedRevisionIds((current) => ({
                                ...current,
                                [fixture.id]: event.target.value
                              }))}
                              disabled={!selectedFixtureIds.includes(fixture.id)}
                            >
                              <option value="">Select the accepted final result</option>
                              {revisions.map((revision) => (
                                <option key={revision.id} value={revision.id}>
                                  Revision {revision.revisionNumber}: {revision.homeScore}–{revision.awayScore} · {revision.createdAt}
                                </option>
                              ))}
                            </select>
                            {revisions.length === 0 ? <small>No accepted final revision exists for this ended fixture.</small> : null}
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
              </fieldset>
              <fieldset>
                <legend>Ruleset approval — a different administrator must approve a proposal</legend>
                {workflowContext.rulesets.map((approval) => (
                  <div className="standings-workflow-choice" key={approval.id}>
                    <label>
                      <input type="radio" name="rulesetApproval" value={approval.id} checked={rulesetApprovalId === approval.id && approval.status === "approved"} disabled={approval.status !== "approved"} onChange={() => setRulesetApprovalId(approval.id)} />
                      {approval.rulesetId} v{approval.version} · {approval.status}
                      {approval.approvedByOperatorId ? ` · approved by ${approval.approvedByOperatorId}` : ` · proposed by ${approval.proposedByOperatorId}`}
                    </label>
                    {approval.status === "pending" ? <button type="button" disabled={workflowBusy} onClick={() => void approveRuleset(approval.id)}>Approve (second admin)</button> : null}
                  </div>
                ))}
                <label className="standings-ruleset-input">
                Propose a new versioned ruleset (approval is a separate step)
                <textarea
                  value={rulesetJson}
                  onChange={(event) => setRulesetJson(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={'{"id":"competition-rules","version":1,"points":{"win":3,"draw":1,"loss":0},"trackedStatistics":["played","won","drawn","lost","scoresFor","scoresAgainst","scoreDifference","points"],"tieBreakers":[{"criterion":"points","direction":"desc"},{"criterion":"scoreDifference","direction":"desc"},{"criterion":"scoresFor","direction":"desc"},{"criterion":"entryId","direction":"asc"}]}'}
                />
                </label>
                <button type="button" disabled={workflowBusy || !rulesetJson.trim()} onClick={() => void proposeRuleset()}>Submit ruleset for approval</button>
              </fieldset>
              <label>
                Schedule source name
                <input value={scheduleSourceName} onChange={(event) => setScheduleSourceName(event.target.value)} required minLength={2} maxLength={200} placeholder="Official competition schedule" />
              </label>
              <label>
                Schedule source reference (URL or document reference)
                <input value={scheduleSourceReference} onChange={(event) => setScheduleSourceReference(event.target.value)} required minLength={2} maxLength={1000} placeholder="https://… or internal document ID" />
              </label>
              <label>
                Official schedule CSV (up to 5 MB; columns: homeTeam,awayTeam)
                <input
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setScheduleCsvBase64("");
                    setScheduleCsvName(file?.name ?? "");
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      setWorkflowError("Official schedule CSV must be 5 MB or smaller.");
                      event.target.value = "";
                      setScheduleCsvName("");
                      return;
                    }
                    setWorkflowError(null);
                    void file.arrayBuffer().then((buffer) => {
                      const bytes = new Uint8Array(buffer);
                      let binary = "";
                      const chunkSize = 0x8000;
                      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                      }
                      setScheduleCsvBase64(btoa(binary));
                    }).catch(() => setWorkflowError("Unable to read the selected schedule CSV."));
                  }}
                />
                <small>{scheduleCsvName ? `${scheduleCsvName} selected` : "Use canonical team names; every home/away fixture must match the season fixtures."}</small>
              </label>
              <label className="standings-workflow-choice">
                <input type="checkbox" checked={scheduleConfirmed} onChange={(event) => setScheduleConfirmed(event.target.checked)} />
                I reconciled the full fixture list against the named source and confirm it is complete.
              </label>
              <button
                type="submit"
                className="primary-button"
                disabled={workflowBusy
                  || selectedTeamIds.length !== workflowContext.teamCandidates.length
                  || selectedFixtureIds.length !== workflowContext.fixtures.length
                  || !workflowContext.teamCandidates.length
                  || !workflowContext.fixtures.length
                  || !scheduleConfirmed
                  || !rulesetApprovalId
                  || !scheduleSourceName.trim()
                  || !scheduleSourceReference.trim()
                  || !scheduleCsvBase64}
              >
                {workflowBusy ? "Preparing and assessing…" : "Create snapshot and assess coverage"}
              </button>
            </form>
          )}
          {workflowError ? <p role="alert">{workflowError}</p> : null}
          {workflowResult ? (
            <section className={`standings-coverage ${workflowResult.coverage.eligible ? "eligible" : "ineligible"}`} aria-live="polite">
              <strong>{workflowResult.coverage.eligible ? "Eligible standings prepared" : "Provisional standings prepared — not eligible for authoritative publication"}</strong>
              <span>Snapshot {workflowResult.snapshot.sequence} · Schedule manifest {workflowResult.manifest.version}</span>
              {workflowResult.manifest.source ? <span>Schedule source: {workflowResult.manifest.source.name} · {workflowResult.manifest.source.reference}</span> : null}
              {workflowResult.coverage.blockingReasons.map((reason, index) => (
                <small key={`${reason.code}-${reason.fixtureId ?? index}`}>{reason.message}</small>
              ))}
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
