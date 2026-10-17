import { useEffect, useState } from "react";
import { apiClient } from "../../services/api-client";

type Format = { id: string; name: string; description: string };
type Version = { id: string; version: number; formatTemplateId: string; status: "pending" | "approved"; proposedByOperatorId: string };

function stageKinds(format: string, custom: string[]): Array<{ id: string; kind: "league" | "groups" | "knockout" }> {
  if (format === "domestic_league") return [{ id: "league", kind: "league" }];
  if (format === "league_phase_knockout") return [{ id: "league_phase", kind: "league" }, { id: "knockout", kind: "knockout" }];
  if (format === "groups_only") return [{ id: "groups", kind: "groups" }];
  if (format === "groups_knockout") return [{ id: "groups", kind: "groups" }, { id: "knockout", kind: "knockout" }];
  if (format === "single_match_knockout") return [{ id: "knockout", kind: "knockout" }];
  if (format === "two_legged_knockout") return [{ id: "knockout", kind: "knockout" }];
  if (format === "league_playoffs") return [{ id: "league", kind: "league" }, { id: "playoffs", kind: "knockout" }];
  return custom.map((kind, index) => ({ id: `${kind}_${index + 1}`, kind: kind as "league" | "groups" | "knockout" }));
}

export function SoccerRulesetPanel({ competitionId, accessToken }: { competitionId: string; accessToken: string }) {
  const [formats, setFormats] = useState<Format[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [format, setFormat] = useState("domestic_league");
  const [customStages, setCustomStages] = useState<string[]>([]);
  const [win, setWin] = useState(""); const [draw, setDraw] = useState(""); const [loss, setLoss] = useState("");
  const [tieBreakers, setTieBreakers] = useState(""); const [scheduling, setScheduling] = useState("single_round_robin");
  const [groupCount, setGroupCount] = useState(""); const [legs, setLegs] = useState("1");
  const [aggregateAwayGoals, setAggregateAwayGoals] = useState("not_used");
  const [extraTime, setExtraTime] = useState(false); const [penalties, setPenalties] = useState(false);
  const [unresolved, setUnresolved] = useState("incomplete"); const [status, setStatus] = useState("Ruleset not configured");

  const reload = async () => {
    try { const [catalog, history] = await Promise.all([apiClient.listSoccerCompetitionFormats(), apiClient.listSoccerRulesets(competitionId)]); setFormats(catalog); setVersions(history); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Unable to load soccer rulesets."); }
  };
  useEffect(() => { void reload(); }, [competitionId]);

  const propose = async () => {
    try {
      const kinds = stageKinds(format, customStages);
      if (kinds.length === 0) throw new Error("Select at least one stage for the custom format.");
      const orderedTieBreakers = tieBreakers.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
        const [criterion, direction, extra] = item.split(":").map((part) => part?.trim());
        if (!criterion || !direction || extra || !["asc", "desc"].includes(direction)) throw new Error("Tie-breakers must use criterion:direction entries, for example points:desc,scoreDifference:desc.");
        return { criterion, direction };
      });
      if (stageKinds(format, customStages).some(({ kind }) => kind !== "knockout")
        && (orderedTieBreakers[0]?.criterion !== "points" || orderedTieBreakers.at(-1)?.criterion !== "entryId" || orderedTieBreakers.at(-1)?.direction !== "asc")) {
        throw new Error("List points first and entryId:asc last so tied entries have a deterministic final order.");
      }
      const points = { win: Number(win), draw: Number(draw), loss: Number(loss) };
      if ([win, draw, loss].some((item) => item.trim() === "" || !Number.isSafeInteger(Number(item)))) throw new Error("Enter explicit whole-number win, draw, and loss points.");
      const stageList = kinds.map(({ id, kind }) => kind === "knockout" ? {
        id, name: id.replaceAll("_", " "), kind,
        tieResolution: { legs: Number(legs), aggregateGoals: Number(legs) === 2, awayGoals: aggregateAwayGoals, extraTime, penalties, unresolved }
      } : {
        id, name: id.replaceAll("_", " "), kind, scheduling,
        ...(kind === "groups" ? { groupCount: Number(groupCount) } : {}), points, tieBreakers: orderedTieBreakers
      });
      const result = await apiClient.proposeSoccerRuleset(competitionId, { sport: "soccer", formatTemplateId: format, stages: stageList, qualificationRoutes: [] }, accessToken);
      setStatus(`Version ${result.version} proposed. A different administrator must approve it.`);
      await reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Ruleset proposal failed."); }
  };
  const approve = async (version: Version) => {
    try { await apiClient.approveSoccerRuleset(competitionId, version.id, accessToken); setStatus(`Version ${version.version} approved as the default for future seasons.`); await reload(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Ruleset approval failed."); }
  };

  return <section className="console-panel">
    <div className="panel-heading"><h3>Soccer Format & Ruleset</h3><span className="status-pill">{status}</span></div>
    <p className="field-note">This is the competition default for future seasons. Existing seasons keep their approved, pinned version. Scope remains the separate geographic field above.</p>
    <div className="form-grid two-column">
      <label>Format template<select value={format} onChange={(event) => setFormat(event.target.value)}>{formats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="field-note">{formats.find((item) => item.id === format)?.description}</p>
      {format === "custom_multi_stage" ? <fieldset><legend>Custom stages</legend>{(["league", "groups", "knockout"] as const).map((kind) => <label key={kind}><input type="checkbox" checked={customStages.includes(kind)} onChange={(event) => setCustomStages((current) => event.target.checked ? [...current, kind] : current.filter((item) => item !== kind))} />{kind}</label>)}</fieldset> : null}
      {stageKinds(format, customStages).some(({ kind }) => kind !== "knockout") ? <>
        <label>Points for win<input type="number" min="0" step="1" value={win} onChange={(event) => setWin(event.target.value)} /></label>
        <label>Points for draw<input type="number" min="0" step="1" value={draw} onChange={(event) => setDraw(event.target.value)} /></label>
        <label>Points for loss<input type="number" min="0" step="1" value={loss} onChange={(event) => setLoss(event.target.value)} /></label>
        <label>Ordered tie-break criteria<input value={tieBreakers} onChange={(event) => setTieBreakers(event.target.value)} placeholder="points:desc,scoreDifference:desc,entryId:asc" /><small>Enter the competition's actual ordered rules; list points first and entryId:asc last. No defaults are applied.</small></label>
        <label>Round-robin schedule<select value={scheduling} onChange={(event) => setScheduling(event.target.value)}><option value="single_round_robin">Single round-robin</option><option value="double_round_robin">Double round-robin</option></select></label>
      </> : null}
      {stageKinds(format, customStages).some(({ kind }) => kind === "groups") ? <label>Number of groups<input type="number" min="1" step="1" value={groupCount} onChange={(event) => setGroupCount(event.target.value)} /></label> : null}
      {stageKinds(format, customStages).some(({ kind }) => kind === "knockout") ? <>
        <label>Legs per tie<select value={legs} onChange={(event) => setLegs(event.target.value)}><option value="1">Single match</option><option value="2">Two legs with aggregate goals</option></select></label>
        <label>Away-goals rule<select value={aggregateAwayGoals} onChange={(event) => setAggregateAwayGoals(event.target.value)}><option value="not_used">Not used</option><option value="used">Used</option></select></label>
        <label><input type="checkbox" checked={extraTime} onChange={(event) => setExtraTime(event.target.checked)} />Extra time applies</label>
        <label><input type="checkbox" checked={penalties} onChange={(event) => setPenalties(event.target.checked)} />Penalties apply</label>
        <label>Unresolved tie<select value={unresolved} onChange={(event) => setUnresolved(event.target.value)}><option value="incomplete">Remain incomplete</option><option value="replay">Replay required</option><option value="administrator_decision">Administrator decision required</option></select></label>
      </> : null}
    </div>
    <div className="button-row"><button type="button" onClick={() => void propose()}>Propose ruleset version</button></div>
    {versions.length ? <div className="entity-list">{versions.map((version) => <div className="entity-list-item" key={version.id}><span>Version {version.version} · {formats.find((item) => item.id === version.formatTemplateId)?.name ?? version.formatTemplateId} · {version.status}</span>{version.status === "pending" ? <button type="button" className="secondary" onClick={() => void approve(version)}>Approve (second administrator)</button> : null}</div>)}</div> : null}
  </section>;
}
