import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getDatabase } from "../db/connection.js";
import type { DatabaseSync } from "../db/sqlite.js";
import { getScheduleManifest } from "../services/standings-schedule-manifest-service.js";

export const publicStandingsRouter = Router();

interface SnapshotRow {
  entry_id: string;
  entry_type: string;
  team_id: string | null;
  player_id: string | null;
  display_name: string | null;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scores_for: number;
  scores_against: number;
  score_difference: number;
  points: number;
}

interface SnapshotRecord {
  id: string;
  competition_id: string;
  season_id: string;
  sequence: number;
  ruleset_id: string;
  ruleset_version: number;
  content_hash: string;
  content_json: string;
  calculated_at: string;
  expected_result_count: number;
  expected_row_count: number;
  is_complete: number;
}

interface AssessmentRecord {
  id: string;
  competition_id: string;
  season_id: string;
  snapshot_id: string;
  sequence: number;
  manifest_id: string | null;
  eligibility_state: string;
  schedule_state: string;
  blocking_reasons_json: string;
  content_hash: string;
  content_json: string;
  expected_fixture_count: number;
  expected_manifest_fixture_count: number;
  is_finalized: number;
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasValidSnapshotData(
  database: DatabaseSync,
  snapshot: SnapshotRecord,
  rows: SnapshotRow[]
): boolean {
  if (snapshot.is_complete !== 1
    || typeof snapshot.content_hash !== "string"
    || typeof snapshot.content_json !== "string"
    || typeof snapshot.calculated_at !== "string"
    || typeof snapshot.ruleset_id !== "string"
    || snapshot.ruleset_id.length === 0
    || !Number.isSafeInteger(snapshot.sequence)
    || snapshot.sequence < 1
    || !Number.isSafeInteger(snapshot.ruleset_version)
    || snapshot.ruleset_version < 1
    || !Number.isSafeInteger(snapshot.expected_result_count)
    || !Number.isSafeInteger(snapshot.expected_row_count)
    || rows.length !== snapshot.expected_row_count
    || !/^[a-f0-9]{64}$/.test(snapshot.content_hash)
    || crypto.createHash("sha256").update(snapshot.content_json).digest("hex") !== snapshot.content_hash
    || Number.isNaN(Date.parse(snapshot.calculated_at))) {
    return false;
  }

  const referenceCounts = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN revision.id IS NULL
        OR revision.revision_number <> source.revision_number
        OR revision.competition_id <> source.competition_id
        OR revision.season_id <> source.season_id
        OR revision.validation_state <> 'accepted'
        OR revision.result_status <> 'ended'
        OR revision.final_result_confirmed <> 1
        THEN 1 ELSE 0 END) AS invalid
    FROM standings_snapshot_results source
    LEFT JOIN match_result_revisions revision
      ON revision.id = source.revision_id AND revision.match_id = source.match_id
    WHERE source.snapshot_id = ?
  `).get(snapshot.id) as { total: number; invalid: number | null };
  if (referenceCounts.total !== snapshot.expected_result_count || (referenceCounts.invalid ?? 0) !== 0) {
    return false;
  }

  let content: {
    calculationInput?: {
      ruleset?: {
        id?: unknown;
        version?: unknown;
        points?: { win?: number; draw?: number; loss?: number };
      };
    };
    calculation?: { rows?: Array<Record<string, unknown>> };
  };
  try {
    content = JSON.parse(snapshot.content_json) as typeof content;
  } catch {
    return false;
  }
  const ruleset = content.calculationInput?.ruleset;
  const calculatedRows = content.calculation?.rows;
  const points = ruleset?.points;
  if (!Array.isArray(calculatedRows)
    || calculatedRows.length !== rows.length
    || !ruleset
    || typeof ruleset.id !== "string"
    || ruleset.id.length === 0
    || !Number.isSafeInteger(ruleset.version)
    || ruleset.version !== snapshot.ruleset_version
    || ruleset.id !== snapshot.ruleset_id
    || !points
    || typeof points.win !== "number"
    || typeof points.draw !== "number"
    || typeof points.loss !== "number"
    || ![points.win, points.draw, points.loss].every(Number.isSafeInteger)) {
    return false;
  }
  const winPoints = points.win;
  const drawPoints = points.draw;
  const lossPoints = points.loss;

  return rows.every((row, index) => {
    const calculated = calculatedRows[index];
    if (!calculated) {
      return false;
    }
    const stats = [
      row.rank, row.played, row.won, row.drawn, row.lost,
      row.scores_for, row.scores_against, row.score_difference, row.points
    ];
    return row.entry_type === "team"
      && row.team_id !== null
      && row.player_id === null
      && typeof row.display_name === "string"
      && row.display_name.trim().length > 0
      && stats.every(Number.isSafeInteger)
      && row.rank === index + 1
      && row.played >= 0
      && row.won >= 0
      && row.drawn >= 0
      && row.lost >= 0
      && row.scores_for >= 0
      && row.scores_against >= 0
      && row.points >= 0
      && row.played === row.won + row.drawn + row.lost
      && row.score_difference === row.scores_for - row.scores_against
      && row.points === row.won * winPoints + row.drawn * drawPoints
        + row.lost * lossPoints
      && calculated.entryId === row.entry_id
      && calculated.rank === row.rank
      && calculated.played === row.played
      && calculated.won === row.won
      && calculated.drawn === row.drawn
      && calculated.lost === row.lost
      && calculated.scoresFor === row.scores_for
      && calculated.scoresAgainst === row.scores_against
      && calculated.scoreDifference === row.score_difference
      && calculated.points === row.points;
  });
}

function getCoverage(
  database: DatabaseSync,
  competitionId: string,
  seasonId: string,
  snapshotId: string
): { status: string; manifestVersion: number | null; eligible: boolean; source?: { name: string; reference: string; contentHash: string } | null } {
  const assessment = database.prepare(`
    SELECT id, competition_id, season_id, snapshot_id, sequence, manifest_id,
           eligibility_state, schedule_state, blocking_reasons_json, content_hash,
           content_json, expected_fixture_count, expected_manifest_fixture_count,
           is_finalized
    FROM standings_coverage_assessments
    WHERE snapshot_id = ? AND competition_id = ? AND season_id = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(snapshotId, competitionId, seasonId) as AssessmentRecord | undefined;

  if (!assessment) {
    return { status: "unassessed", manifestVersion: null, eligible: false };
  }
  if (!Number.isSafeInteger(assessment.sequence)
    || assessment.sequence < 1
    || assessment.is_finalized !== 1
    || typeof assessment.content_hash !== "string"
    || typeof assessment.content_json !== "string"
    || !/^[a-f0-9]{64}$/.test(assessment.content_hash)
    || crypto.createHash("sha256").update(assessment.content_json).digest("hex") !== assessment.content_hash
    || !Number.isSafeInteger(assessment.expected_fixture_count)
    || !Number.isSafeInteger(assessment.expected_manifest_fixture_count)
    || !["eligible", "ineligible"].includes(assessment.eligibility_state)
    || !["unverified", "incomplete", "invalid", "verified_complete"].includes(assessment.schedule_state)) {
    return { status: "invalid", manifestVersion: null, eligible: false };
  }

  let reasons: unknown;
  let assessmentContent: {
    scope?: { competitionId?: string; seasonId?: string };
    snapshotId?: string;
    manifestVersionId?: string | null;
    scheduleState?: string;
    blockingReasons?: unknown;
  };
  try {
    reasons = JSON.parse(assessment.blocking_reasons_json);
    assessmentContent = JSON.parse(assessment.content_json) as typeof assessmentContent;
  } catch {
    return { status: "invalid", manifestVersion: null, eligible: false };
  }
  if (!Array.isArray(reasons)
    || assessmentContent.scope?.competitionId !== competitionId
    || assessmentContent.scope.seasonId !== seasonId
    || assessmentContent.snapshotId !== snapshotId
    || assessmentContent.manifestVersionId !== assessment.manifest_id
    || assessmentContent.scheduleState !== assessment.schedule_state
    || JSON.stringify(assessmentContent.blockingReasons) !== JSON.stringify(reasons)) {
    return { status: "invalid", manifestVersion: null, eligible: false };
  }

  const fixtureCounts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM standings_coverage_fixtures WHERE assessment_id = ?) AS canonical,
      (SELECT COUNT(*) FROM standings_coverage_manifest_fixtures WHERE assessment_id = ?) AS manifest,
      (SELECT COUNT(*) FROM standings_coverage_fixtures
        WHERE assessment_id = ? AND coverage_state NOT IN ('required_covered', 'explicitly_excluded')) AS unresolvedCanonical,
      (SELECT COUNT(*) FROM standings_coverage_manifest_fixtures
        WHERE assessment_id = ? AND coverage_state NOT IN ('required_covered', 'explicitly_excluded')) AS unresolvedManifest
  `).get(assessment.id, assessment.id, assessment.id, assessment.id) as {
    canonical: number;
    manifest: number;
    unresolvedCanonical: number;
    unresolvedManifest: number;
  };
  if (fixtureCounts.canonical !== assessment.expected_fixture_count
    || fixtureCounts.manifest !== assessment.expected_manifest_fixture_count) {
    return { status: "invalid", manifestVersion: null, eligible: false };
  }

  if (!assessment.manifest_id) {
    return {
      status: assessment.schedule_state === "unverified" ? "unverified" : assessment.schedule_state,
      manifestVersion: null,
      eligible: false
    };
  }

  const latestManifest = database.prepare(`
    SELECT id, version, state
    FROM standings_schedule_manifests
    WHERE competition_id = ? AND season_id = ?
    ORDER BY version DESC
    LIMIT 1
  `).get(competitionId, seasonId) as { id: string; version: number; state: string } | undefined;
  let manifest: ReturnType<typeof getScheduleManifest> | undefined;
  try {
    manifest = getScheduleManifest(database, assessment.manifest_id);
  } catch {
    return { status: "invalid", manifestVersion: null, eligible: false };
  }
  const manifestVersion = Number.isSafeInteger(manifest.version) ? manifest.version : null;
  const manifestContentHash = crypto.createHash("sha256").update(stableJson({
    competitionId: manifest.competitionId,
    seasonId: manifest.seasonId,
    version: manifest.version,
    supersedesManifestId: manifest.supersedesManifestId,
    ...(manifest.source ? { source: manifest.source } : {}),
    fixtures: manifest.fixtures.map((fixture) => ({
      fixtureKey: fixture.fixtureKey,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      matchId: fixture.matchId
    }))
  })).digest("hex");
  if (latestManifest?.id !== manifest.id) {
    return { status: "superseded", manifestVersion, eligible: false };
  }
  if (latestManifest.state !== "finalized" || manifest.state !== "finalized"
    || !manifest.validation.valid
    || !/^[a-f0-9]{64}$/.test(manifest.contentHash ?? "")
    || manifestContentHash !== manifest.contentHash) {
    return { status: "invalid", manifestVersion, eligible: false };
  }
  if (!manifest.validation.complete) {
    return { status: "incomplete", manifestVersion, eligible: false };
  }

  let rulesetApprovalId: string | undefined;
  try {
    const snapshotRecord = database.prepare(
      "SELECT ruleset_id, ruleset_version, content_json FROM standings_snapshots WHERE id = ?"
    ).get(snapshotId) as { ruleset_id: string; ruleset_version: number; content_json: string };
    const snapshotContent = JSON.parse(snapshotRecord.content_json) as {
      rulesetApproval?: { approvalId?: unknown };
    };
    if (typeof snapshotContent.rulesetApproval?.approvalId === "string") {
      rulesetApprovalId = snapshotContent.rulesetApproval.approvalId;
    }
  } catch {
    return { status: "invalid", manifestVersion, eligible: false };
  }
  const snapshotRecord = database.prepare("SELECT ruleset_id, ruleset_version FROM standings_snapshots WHERE id = ?")
    .get(snapshotId) as { ruleset_id: string; ruleset_version: number } | undefined;
  const approvedRuleset = rulesetApprovalId && snapshotRecord ? database.prepare(`
    SELECT 1 FROM standings_rulesets
    WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'approved'
      AND ruleset_id = ? AND ruleset_version = ?
  `).get(rulesetApprovalId, competitionId, seasonId, snapshotRecord.ruleset_id, snapshotRecord.ruleset_version) : undefined;

  const sourceIsVerified = Boolean(manifest.source && /^[a-f0-9]{64}$/.test(manifest.source.contentHash));
  const eligible = assessment.eligibility_state === "eligible"
    && assessment.schedule_state === "verified_complete"
    && sourceIsVerified
    && Boolean(approvedRuleset)
    && reasons.length === 0
    && fixtureCounts.unresolvedCanonical === 0
    && fixtureCounts.unresolvedManifest === 0;
  return {
    status: !sourceIsVerified || !approvedRuleset ? "invalid" : eligible ? "verified_complete" : assessment.schedule_state,
    manifestVersion,
    eligible,
    source: manifest.source
  };
}

function respondWithInvalidData(response: Response): void {
  response.status(500).json({ error: "standings_data_invalid" });
}

publicStandingsRouter.get("/:competitionId/:seasonId", (request: Request, response: Response, next) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId)) {
    response.status(400).json({ error: "identifier_invalid" });
    return;
  }

  try {
    const database = getDatabase();
    const competition = database.prepare(`
      SELECT id, name FROM competitions WHERE id = ?
    `).get(competitionId) as { id: string; name: string } | undefined;
    if (!competition) {
      response.status(404).json({ error: "competition_not_found" });
      return;
    }

    const season = database.prepare(`
      SELECT id, name FROM seasons WHERE id = ? AND competition_id = ?
    `).get(seasonId, competitionId) as { id: string; name: string } | undefined;
    if (!season) {
      response.status(404).json({ error: "season_not_found" });
      return;
    }

    const snapshot = database.prepare(`
      SELECT id, competition_id, season_id, sequence, ruleset_id, ruleset_version,
             content_hash, content_json, calculated_at, expected_result_count,
             expected_row_count, is_complete
      FROM standings_snapshots
      WHERE competition_id = ? AND season_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(competitionId, seasonId) as SnapshotRecord | undefined;
    if (!snapshot) {
      response.status(404).json({ error: "standings_snapshot_not_found" });
      return;
    }

    const rows = database.prepare(`
      SELECT
        sr.entry_id,
        ce.entry_type,
        ce.team_id,
        ce.player_id,
        t.name AS display_name,
        sr.rank,
        sr.played,
        sr.won,
        sr.drawn,
        sr.lost,
        sr.scores_for,
        sr.scores_against,
        sr.score_difference,
        sr.points
      FROM standings_snapshot_rows sr
      LEFT JOIN competition_entries ce
        ON ce.id = sr.entry_id
       AND ce.competition_id = sr.competition_id
       AND ce.season_id = sr.season_id
      LEFT JOIN teams t ON t.id = ce.team_id
      WHERE sr.snapshot_id = ?
      ORDER BY sr.rank, sr.entry_id
    `).all(snapshot.id) as SnapshotRow[];

    if (snapshot.competition_id !== competitionId
      || snapshot.season_id !== seasonId
      || !hasValidSnapshotData(database, snapshot, rows)) {
      respondWithInvalidData(response);
      return;
    }

    const coverage = getCoverage(database, competitionId, seasonId, snapshot.id);
    const explanation = coverage.eligible
      ? null
      : coverage.status === "superseded"
        ? "The schedule manifest has been superseded; coverage is not verified."
        : coverage.status === "incomplete" || coverage.status === "unverified"
          ? "Schedule coverage is incomplete or unresolved; these standings are provisional."
          : coverage.status === "unassessed"
            ? "Coverage has not been verified for this snapshot; these standings are provisional."
            : "Coverage could not be verified; these standings are provisional.";

    response.json({
      data: {
        competition: { id: competition.id, name: competition.name },
        season: { id: season.id, name: season.name },
        snapshot: {
          id: snapshot.id,
          sequence: snapshot.sequence,
          calculatedAt: snapshot.calculated_at,
          ruleset: { id: snapshot.ruleset_id, version: snapshot.ruleset_version }
        },
        status: coverage.eligible ? "eligible" : "provisional",
        explanation,
        rows: rows.map((row) => ({
          rank: row.rank,
          team: { id: row.team_id, name: row.display_name },
          played: row.played,
          won: row.won,
          drawn: row.drawn,
          lost: row.lost,
          goalsFor: row.scores_for,
          goalsAgainst: row.scores_against,
          goalDifference: row.score_difference,
          points: row.points
        })),
        coverage: {
          status: coverage.status,
          manifestVersion: coverage.manifestVersion,
          scheduleSource: coverage.source ? { name: coverage.source.name } : null
        }
      }
    });
  } catch (error) {
    next(error);
  }
});
