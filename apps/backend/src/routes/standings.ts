import { Router } from "express";
import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import {
  addExpectedScheduleFixture,
  createScheduleManifest,
  finalizeScheduleManifest,
  getScheduleManifest,
  validateScheduleManifest
} from "../services/standings-schedule-manifest-service.js";
import { validateStandingsRuleset, type StandingsRuleset } from "../services/standings-calculation-service.js";
import { assessStandingsCoverage } from "../services/standings-coverage-service.js";
import { createStandingsSnapshot, type RevisionSelection } from "../services/standings-snapshot-service.js";

export const standingsRouter = Router();

standingsRouter.post("/:competitionId/:seasonId/rulesets", protectedRoute, requireAdmin, (request: AuthenticatedRequest, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  const operatorId = request.operator?.id;
  const body = request.body as { ruleset?: unknown } | undefined;
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId) || !operatorId || !isRecord(body) || !isRecord(body.ruleset)) {
    response.status(400).json({ error: "ruleset_proposal_invalid" });
    return;
  }
  try {
    const ruleset = body.ruleset as unknown as StandingsRuleset;
    validateStandingsRuleset(ruleset);
    const database = getDatabase();
    const rulesetJson = stableJson(ruleset);
    const rulesetHash = crypto.createHash("sha256").update(rulesetJson).digest("hex");
    const id = crypto.randomUUID();
    const proposedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO standings_rulesets (
        id, competition_id, season_id, ruleset_id, ruleset_version, ruleset_json,
        ruleset_hash, status, proposed_by_operator_id, proposed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, competitionId, seasonId, ruleset.id, ruleset.version, rulesetJson, rulesetHash, operatorId, proposedAt);
    response.status(201).json({ data: { id, rulesetId: ruleset.id, version: ruleset.version, status: "pending", proposedByOperatorId: operatorId, proposedAt } });
  } catch (error) {
    response.status(422).json({ error: "ruleset_proposal_rejected", message: error instanceof Error ? error.message : "Ruleset proposal rejected." });
  }
});

standingsRouter.post("/:competitionId/:seasonId/rulesets/:approvalId/approve", protectedRoute, requireAdmin, (request: AuthenticatedRequest, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  const approvalId = String(request.params.approvalId ?? "");
  const operatorId = request.operator?.id;
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId) || !isValidIdentifier(approvalId) || !operatorId) {
    response.status(400).json({ error: "ruleset_approval_invalid" });
    return;
  }
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`
    UPDATE standings_rulesets
    SET status = 'approved', approved_by_operator_id = ?, approved_at = ?
    WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'pending'
      AND proposed_by_operator_id <> ?
  `).run(operatorId, now, approvalId, competitionId, seasonId, operatorId);
  if (result.changes !== 1) {
    response.status(409).json({ error: "ruleset_requires_second_admin_or_is_not_pending" });
    return;
  }
  response.json({ data: { id: approvalId, status: "approved", approvedByOperatorId: operatorId, approvedAt: now } });
});

function requireAdmin(request: AuthenticatedRequest, response: any, next: () => void) {
  if (request.operator?.role !== "admin") {
    response.status(403).json({ error: "admin_required" });
    return;
  }
  next();
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseOfficialScheduleCsv(csv: string): Array<{ homeTeam: string; awayTeam: string }> {
  if (csv.length === 0 || Buffer.byteLength(csv, "utf8") > 5 * 1024 * 1024) {
    throw new Error("uploaded schedule CSV must be non-empty and no larger than 5 MB");
  }
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = csv.charCodeAt(0) === 0xfeff ? 1 : 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') {
      if (field.length > 0) throw new Error("malformed quote in uploaded schedule CSV");
      quoted = true;
    } else if (character === ",") {
      record.push(field); field = "";
    } else if (character === "\n" || character === "\r") {
      record.push(field); field = "";
      if (record.some((cell) => cell.trim())) records.push(record);
      record = [];
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
    } else field += character;
  }
  if (quoted) throw new Error("unterminated quoted field in uploaded schedule CSV");
  record.push(field);
  if (record.some((cell) => cell.trim())) records.push(record);
  if (records.length < 2) throw new Error("schedule CSV must contain a header and at least one fixture");
  const headers = records[0]!.map((header) => header.trim().toLocaleLowerCase());
  const homeIndex = headers.indexOf("hometeam");
  const awayIndex = headers.indexOf("awayteam");
  if (homeIndex < 0 || awayIndex < 0 || homeIndex === awayIndex || new Set(headers).size !== headers.length) {
    throw new Error("schedule CSV must have unique homeTeam and awayTeam columns");
  }
  return records.slice(1).map((cells) => {
    if (cells.length !== headers.length) throw new Error("schedule CSV rows must match the header column count");
    const homeTeam = cells[homeIndex]?.trim() ?? "";
    const awayTeam = cells[awayIndex]?.trim() ?? "";
    if (!homeTeam || !awayTeam) throw new Error("schedule CSV rows must identify both home and away teams");
    return { homeTeam, awayTeam };
  });
}

standingsRouter.get("/:competitionId/:seasonId", protectedRoute, requireAdmin, (request, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId)) {
    response.status(400).json({ error: "identifier_invalid" });
    return;
  }

  const database = getDatabase();
  const competition = database.prepare(`
    SELECT id, name FROM competitions WHERE id = ?
  `).get(competitionId) as { id: string; name: string } | undefined;
  if (!competition) {
    response.status(404).json({ error: "competition_not_found" });
    return;
  }

  const season = database.prepare(`
    SELECT id, competition_id, name
    FROM seasons
    WHERE id = ? AND competition_id = ?
  `).get(seasonId, competitionId) as { id: string; competition_id: string; name: string } | undefined;
  if (!season) {
    response.status(404).json({ error: "season_not_found" });
    return;
  }

  const snapshot = database.prepare(`
    SELECT id, sequence, ruleset_id, ruleset_version, calculated_at, is_complete, content_json
    FROM standings_snapshots
    WHERE competition_id = ? AND season_id = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(competitionId, seasonId) as {
    id: string;
    sequence: number;
    ruleset_id: string;
    ruleset_version: number;
    calculated_at: string;
    is_complete: number;
    content_json: string;
  } | undefined;
  if (!snapshot) {
    response.status(404).json({ error: "standings_snapshot_not_found" });
    return;
  }
  const snapshotContent = JSON.parse(snapshot.content_json) as {
    rulesetApproval?: {
      competitionId: string;
      seasonId: string;
      rulesetId: string;
      rulesetVersion: number;
      approvalId?: string;
      approvedByOperatorId: string;
      approvedAt: string;
    };
  };
  const rulesetApproval = snapshotContent.rulesetApproval;
  const approvedRuleset = rulesetApproval?.approvalId ? database.prepare(`
    SELECT 1 FROM standings_rulesets
    WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'approved'
      AND ruleset_id = ? AND ruleset_version = ?
  `).get(rulesetApproval.approvalId, competitionId, seasonId, snapshot.ruleset_id, snapshot.ruleset_version) : undefined;

  const rows = database.prepare(`
    SELECT
      sr.entry_id,
      ce.entry_type,
      ce.team_id,
      ce.player_id,
      COALESCE(t.name, p.display_name) AS display_name,
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
    JOIN competition_entries ce
      ON ce.id = sr.entry_id
     AND ce.competition_id = sr.competition_id
     AND ce.season_id = sr.season_id
    LEFT JOIN teams t ON t.id = ce.team_id
    LEFT JOIN players p ON p.id = ce.player_id
    WHERE sr.snapshot_id = ?
    ORDER BY sr.rank, sr.entry_id
  `).all(snapshot.id) as Array<{
    entry_id: string;
    entry_type: "team" | "individual";
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
  }>;

  const revisions = database.prepare(`
    SELECT match_id, revision_id, revision_number
    FROM standings_snapshot_results
    WHERE snapshot_id = ?
    ORDER BY match_id
  `).all(snapshot.id) as Array<{
    match_id: string;
    revision_id: string;
    revision_number: number;
  }>;

  const assessment = database.prepare(`
    SELECT id, sequence, manifest_id, eligibility_state, schedule_state,
           blocking_reasons_json, is_finalized
    FROM standings_coverage_assessments
    WHERE snapshot_id = ?
    ORDER BY sequence DESC
    LIMIT 1
  `).get(snapshot.id) as {
    id: string;
    sequence: number;
    manifest_id: string | null;
    eligibility_state: "eligible" | "ineligible";
    schedule_state: "unverified" | "incomplete" | "invalid" | "verified_complete";
    blocking_reasons_json: string;
    is_finalized: number;
  } | undefined;

  let manifest: ReturnType<typeof getScheduleManifest> | null = null;
  let manifestIsSelectedAndValid = false;
  let manifestCoverageStatus: "verified_complete" | "incomplete" | "invalid" | "superseded" | null = null;
  if (assessment?.manifest_id) {
    manifest = getScheduleManifest(database, assessment.manifest_id) ?? null;
    if (manifest) {
      const latestManifest = database.prepare(`
        SELECT id, state
        FROM standings_schedule_manifests
        WHERE competition_id = ? AND season_id = ?
        ORDER BY version DESC
        LIMIT 1
      `).get(competitionId, seasonId) as { id: string; state: string } | undefined;
      manifestCoverageStatus = latestManifest?.id !== manifest.id
        ? "superseded"
        : latestManifest.state !== "finalized" || manifest.state !== "finalized" || !manifest.validation.valid || !manifest.source
          ? "invalid"
          : !manifest.validation.complete
            ? "incomplete"
            : "verified_complete";
      manifestIsSelectedAndValid = latestManifest?.id === manifest.id
        && latestManifest.state === "finalized"
        && manifest.state === "finalized"
        && manifest.validation.valid
        && manifest.validation.complete
        && manifest.source !== null
        && Boolean(approvedRuleset);
    }
  }

  const eligible = snapshot.is_complete === 1
    && assessment?.is_finalized === 1
    && assessment.eligibility_state === "eligible"
    && assessment.schedule_state === "verified_complete"
    && manifestIsSelectedAndValid;
  const coverageStatus = snapshot.is_complete !== 1
    ? "invalid"
    : !assessment || assessment.is_finalized !== 1
    ? "unassessed"
      : assessment.manifest_id
        ? manifestCoverageStatus === "verified_complete" && !approvedRuleset
          ? "invalid"
          : manifestCoverageStatus ?? "invalid"
        : assessment.schedule_state === "verified_complete"
          ? "invalid"
          : assessment.schedule_state;

  response.json({
    data: {
      competition: { id: competition.id, name: competition.name },
      season: { id: season.id, name: season.name },
      snapshot: {
        id: snapshot.id,
        sequence: snapshot.sequence,
        calculatedAt: snapshot.calculated_at,
        ruleset: { id: snapshot.ruleset_id, version: snapshot.ruleset_version },
        rulesetApproval: rulesetApproval && approvedRuleset ? rulesetApproval : null,
        complete: snapshot.is_complete === 1
      },
      rows: rows.map((row) => ({
        rank: row.rank,
        entry: {
          id: row.entry_id,
          type: row.entry_type,
          teamId: row.team_id,
          playerId: row.player_id,
          displayName: row.display_name
        },
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.scores_for,
        goalsAgainst: row.scores_against,
        goalDifference: row.score_difference,
        points: row.points
      })),
      resultRevisions: revisions.map((revision) => ({
        matchId: revision.match_id,
        revisionId: revision.revision_id,
        revisionNumber: revision.revision_number
      })),
      coverage: {
        status: coverageStatus,
        eligible,
        assessment: assessment && assessment.is_finalized === 1
          ? {
              id: assessment.id,
              sequence: assessment.sequence,
              manifest: manifest
                ? { id: manifest.id, version: manifest.version, state: manifest.state, source: manifest.source }
                : null,
              blockingReasons: JSON.parse(assessment.blocking_reasons_json) as unknown[]
            }
          : null
      }
    }
  });
});

standingsRouter.get("/:competitionId/:seasonId/workflow-context", protectedRoute, requireAdmin, (request, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId)) {
    response.status(400).json({ error: "identifier_invalid" });
    return;
  }

  const database = getDatabase();
  const competition = database.prepare(`
    SELECT id, name, participant_type AS participantType
    FROM competitions WHERE id = ?
  `).get(competitionId) as { id: string; name: string; participantType: string } | undefined;
  if (!competition) {
    response.status(404).json({ error: "competition_not_found" });
    return;
  }
  if (!["clubs", "teams", "team"].includes(competition.participantType)) {
    response.status(422).json({ error: "team_competition_required" });
    return;
  }
  const season = database.prepare(`
    SELECT id, name FROM seasons WHERE id = ? AND competition_id = ?
  `).get(seasonId, competitionId) as { id: string; name: string } | undefined;
  if (!season) {
    response.status(404).json({ error: "season_not_found" });
    return;
  }

  const teamCandidates = database.prepare(`
    SELECT cst.team_id AS teamId, t.name
    FROM competition_season_teams cst
    JOIN teams t ON t.id = cst.team_id
    WHERE cst.competition_id = ? AND cst.season_id = ? AND cst.membership_status = 'active'
    ORDER BY t.name, t.id
  `).all(competitionId, seasonId) as Array<{ teamId: string; name: string }>;
  const entries = database.prepare(`
    SELECT id, team_id AS teamId
    FROM competition_entries
    WHERE competition_id = ? AND season_id = ? AND entry_type = 'team'
    ORDER BY team_id
  `).all(competitionId, seasonId) as Array<{ id: string; teamId: string }>;
  const fixtures = database.prepare(`
    SELECT m.id, m.home_team_id AS homeTeamId, ht.name AS homeTeamName,
           m.away_team_id AS awayTeamId, at.name AS awayTeamName, m.status
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    WHERE m.competition_id = ? AND m.season_id = ?
    ORDER BY m.starts_at, m.id
  `).all(competitionId, seasonId) as Array<{
    id: string;
    homeTeamId: string;
    homeTeamName: string;
    awayTeamId: string;
    awayTeamName: string;
    status: string;
  }>;
  const revisions = database.prepare(`
    SELECT id, match_id AS matchId, revision_number AS revisionNumber,
           home_score AS homeScore, away_score AS awayScore, created_at AS createdAt
    FROM match_result_revisions
    WHERE competition_id = ? AND season_id = ? AND validation_state = 'accepted'
      AND result_status = 'ended' AND final_result_confirmed = 1
    ORDER BY match_id, revision_number DESC
  `).all(competitionId, seasonId) as Array<{
    id: string;
    matchId: string;
    revisionNumber: number;
    homeScore: number;
    awayScore: number;
    createdAt: string;
  }>;
  const rulesets = database.prepare(`
    SELECT id, ruleset_id AS rulesetId, ruleset_version AS version, ruleset_json AS rulesetJson,
           status, proposed_by_operator_id AS proposedByOperatorId,
           approved_by_operator_id AS approvedByOperatorId, proposed_at AS proposedAt, approved_at AS approvedAt
    FROM standings_rulesets WHERE competition_id = ? AND season_id = ?
    ORDER BY proposed_at DESC, ruleset_id, ruleset_version DESC
  `).all(competitionId, seasonId).map((row) => ({ ...row, ruleset: JSON.parse((row as { rulesetJson: string }).rulesetJson) }));
  response.json({ data: { competition, season, teamCandidates, entries, fixtures, acceptedRevisions: revisions, rulesets } });
});

standingsRouter.post("/:competitionId/:seasonId/prepare", protectedRoute, requireAdmin, (request, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const seasonId = String(request.params.seasonId ?? "");
  const operatorId = (request as AuthenticatedRequest).operator?.id;
  if (!isValidIdentifier(competitionId) || !isValidIdentifier(seasonId)) {
    response.status(400).json({ error: "identifier_invalid" });
    return;
  }
  const body = request.body as Record<string, unknown> | undefined;
  if (!isRecord(body)
    || body.scheduleConfirmed !== true
    || !Array.isArray(body.teamIds)
    || !Array.isArray(body.expectedFixtures)
    || !Array.isArray(body.revisionSelections)
    || typeof body.rulesetApprovalId !== "string"
    || typeof body.scheduleSourceName !== "string"
    || typeof body.scheduleSourceReference !== "string"
    || typeof body.scheduleCsvBase64 !== "string") {
    response.status(400).json({ error: "workflow_confirmation_required" });
    return;
  }
  const teamIds = body.teamIds;
  const expectedFixtures = body.expectedFixtures;
  const revisionSelections = body.revisionSelections;
  const rulesetApprovalId = body.rulesetApprovalId;
  const scheduleSourceName = body.scheduleSourceName;
  const scheduleSourceReference = body.scheduleSourceReference;
  const scheduleCsvBase64 = body.scheduleCsvBase64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(scheduleCsvBase64)) {
    response.status(400).json({ error: "schedule_csv_encoding_invalid" });
    return;
  }
  const scheduleCsvBytes = Buffer.from(scheduleCsvBase64, "base64");
  if (scheduleCsvBytes.length === 0 || scheduleCsvBytes.length > 5 * 1024 * 1024 || scheduleCsvBytes.toString("base64") !== scheduleCsvBase64) {
    response.status(400).json({ error: "schedule_csv_size_or_encoding_invalid" });
    return;
  }
  let scheduleCsv: string;
  try {
    scheduleCsv = new TextDecoder("utf-8", { fatal: true }).decode(scheduleCsvBytes);
  } catch {
    response.status(400).json({ error: "schedule_csv_must_be_utf8" });
    return;
  }
  const scheduleCsvContentHash = crypto.createHash("sha256").update(scheduleCsvBytes).digest("hex");
  if (teamIds.length === 0
    || teamIds.some((id) => typeof id !== "string" || !isValidIdentifier(id))
    || new Set(teamIds).size !== teamIds.length
    || expectedFixtures.length === 0
    || expectedFixtures.some((fixture) => !isRecord(fixture)
      || typeof fixture.fixtureKey !== "string" || !isValidIdentifier(fixture.fixtureKey)
      || typeof fixture.matchId !== "string" || !isValidIdentifier(fixture.matchId)
      || typeof fixture.homeTeamId !== "string" || !isValidIdentifier(fixture.homeTeamId)
      || typeof fixture.awayTeamId !== "string" || !isValidIdentifier(fixture.awayTeamId))
    || revisionSelections.some((selection) => !isRecord(selection)
      || typeof selection.matchId !== "string" || !isValidIdentifier(selection.matchId)
      || typeof selection.revisionId !== "string" || !isValidIdentifier(selection.revisionId))) {
    response.status(400).json({ error: "workflow_input_invalid" });
    return;
  }
  const fixturesInput = expectedFixtures as Array<{
    fixtureKey: string;
    matchId: string;
    homeTeamId: string;
    awayTeamId: string;
  }>;
  const selections = revisionSelections as RevisionSelection[];
  if (new Set(fixturesInput.map(({ matchId }) => matchId)).size !== fixturesInput.length
    || new Set(fixturesInput.map(({ fixtureKey }) => fixtureKey)).size !== fixturesInput.length
    || new Set(selections.map(({ matchId }) => matchId)).size !== selections.length
    || new Set(selections.map(({ revisionId }) => revisionId)).size !== selections.length) {
    response.status(400).json({ error: "workflow_input_duplicate" });
    return;
  }

  const database = getDatabase();
  const now = new Date().toISOString();
  try {
    database.exec("BEGIN IMMEDIATE;");
    const competition = database.prepare(`
      SELECT id, participant_type FROM competitions WHERE id = ?
    `).get(competitionId) as { id: string; participant_type: string } | undefined;
    if (!competition || !["clubs", "teams", "team"].includes(competition.participant_type)) {
      throw new Error("competition scope does not support team standings");
    }
    if (!database.prepare("SELECT 1 FROM seasons WHERE id = ? AND competition_id = ?").get(seasonId, competitionId)) {
      throw new Error("season is outside the selected competition");
    }

    const approvedRuleset = database.prepare(`
      SELECT id, ruleset_id AS rulesetId, ruleset_version AS version,
             ruleset_json AS rulesetJson, ruleset_hash AS rulesetHash,
             approved_by_operator_id AS approvedByOperatorId, approved_at AS approvedAt
      FROM standings_rulesets
      WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'approved'
    `).get(rulesetApprovalId, competitionId, seasonId) as {
      id: string; rulesetId: string; version: number; rulesetJson: string; rulesetHash: string;
      approvedByOperatorId: string; approvedAt: string;
    } | undefined;
    if (!approvedRuleset
      || crypto.createHash("sha256").update(approvedRuleset.rulesetJson).digest("hex") !== approvedRuleset.rulesetHash) {
      throw new Error("a separately approved, unchanged ruleset is required");
    }
    const ruleset = JSON.parse(approvedRuleset.rulesetJson) as StandingsRuleset;
    validateStandingsRuleset(ruleset);
    if (ruleset.id !== approvedRuleset.rulesetId || ruleset.version !== approvedRuleset.version) {
      throw new Error("approved ruleset metadata does not match its immutable definition");
    }

    const activeMemberships = database.prepare(`
      SELECT team_id FROM competition_season_teams
      WHERE competition_id = ? AND season_id = ? AND membership_status = 'active'
    `).all(competitionId, seasonId) as Array<{ team_id: string }>;
    const activeTeamIds = new Set(activeMemberships.map(({ team_id }) => team_id));
    if (teamIds.some((teamId) => !activeTeamIds.has(teamId as string)) || teamIds.length !== activeTeamIds.size) {
      throw new Error("selected teams must include every active member of this competition season exactly once");
    }
    const selectedTeamIds = new Set(teamIds as string[]);
    const officialRows = parseOfficialScheduleCsv(scheduleCsv);
    const activeTeams = database.prepare(`
      SELECT t.id, t.name
      FROM competition_season_teams membership
      JOIN teams t ON t.id = membership.team_id
      WHERE membership.competition_id = ? AND membership.season_id = ? AND membership.membership_status = 'active'
      ORDER BY t.name, t.id
    `).all(competitionId, seasonId) as Array<{ id: string; name: string }>;
    const teamIdsByName = new Map<string, string>();
    const ambiguousTeamNames = new Set<string>();
    for (const team of activeTeams) {
      if (teamIdsByName.has(team.name)) ambiguousTeamNames.add(team.name);
      else teamIdsByName.set(team.name, team.id);
    }
    if (ambiguousTeamNames.size > 0) throw new Error("official schedule team names are ambiguous in this season");
    const canonicalFixtures = database.prepare(`
      SELECT m.id, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
             home.name AS homeTeamName, away.name AS awayTeamName
      FROM matches m
      JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      WHERE m.competition_id = ? AND m.season_id = ? ORDER BY m.id
    `).all(competitionId, seasonId) as Array<{ id: string; homeTeamId: string; awayTeamId: string; homeTeamName: string; awayTeamName: string }>;
    if (canonicalFixtures.length === 0 || canonicalFixtures.length !== fixturesInput.length) {
      throw new Error("expected schedule must include every canonical fixture exactly once");
    }
    if (officialRows.length !== canonicalFixtures.length) {
      throw new Error("uploaded official schedule fixture count does not match the canonical schedule");
    }
    const expectedPairCounts = new Map<string, number>();
    for (const fixture of canonicalFixtures) {
      const pair = `${fixture.homeTeamId}\u0000${fixture.awayTeamId}`;
      expectedPairCounts.set(pair, (expectedPairCounts.get(pair) ?? 0) + 1);
    }
    const importedPairCounts = new Map<string, number>();
    for (const row of officialRows) {
      const homeTeamId = teamIdsByName.get(row.homeTeam);
      const awayTeamId = teamIdsByName.get(row.awayTeam);
      if (!homeTeamId || !awayTeamId || !selectedTeamIds.has(homeTeamId) || !selectedTeamIds.has(awayTeamId)) {
        throw new Error("uploaded official schedule contains a team outside the reviewed season entrants");
      }
      const pair = `${homeTeamId}\u0000${awayTeamId}`;
      importedPairCounts.set(pair, (importedPairCounts.get(pair) ?? 0) + 1);
    }
    if (stableJson([...expectedPairCounts].sort()) !== stableJson([...importedPairCounts].sort())) {
      throw new Error("uploaded official schedule home/away fixtures do not match the canonical fixtures");
    }
    const expectedByMatch = new Map(fixturesInput.map((fixture) => [fixture.matchId, fixture]));
    if (canonicalFixtures.some((fixture) => {
      const expected = expectedByMatch.get(fixture.id);
      return !expected
        || expected.homeTeamId !== fixture.homeTeamId
        || expected.awayTeamId !== fixture.awayTeamId
        || !selectedTeamIds.has(fixture.homeTeamId)
        || !selectedTeamIds.has(fixture.awayTeamId);
    })) {
      throw new Error("expected schedule does not match all canonical fixtures and selected teams");
    }

    const currentEntries = database.prepare(`
      SELECT id, team_id AS teamId, entry_type AS entryType
      FROM competition_entries WHERE competition_id = ? AND season_id = ?
    `).all(competitionId, seasonId) as Array<{ id: string; teamId: string | null; entryType: string }>;
    if (currentEntries.some(({ entryType, teamId }) => entryType !== "team" || !teamId || !selectedTeamIds.has(teamId))) {
      throw new Error("existing competition entries include participants outside the reviewed team selection");
    }
    const entryIdByTeamId = new Map(currentEntries.map(({ id, teamId }) => [teamId!, id]));
    for (const teamId of teamIds as string[]) {
      if (!entryIdByTeamId.has(teamId)) {
        const entryId = crypto.randomUUID();
        database.prepare(`
          INSERT INTO competition_entries (
            id, competition_id, season_id, entry_type, team_id, player_id, created_at
          ) VALUES (?, ?, ?, 'team', ?, NULL, ?)
        `).run(entryId, competitionId, seasonId, teamId, now);
        entryIdByTeamId.set(teamId, entryId);
      }
    }
    for (const fixture of canonicalFixtures) {
      const participants = database.prepare(`
        SELECT entry_id AS entryId, slot
        FROM fixture_participants
        WHERE match_id = ? AND competition_id = ? AND season_id = ?
        ORDER BY slot
      `).all(fixture.id, competitionId, seasonId) as Array<{ entryId: string; slot: string }>;
      const expectedParticipants = [
        { entryId: entryIdByTeamId.get(fixture.homeTeamId)!, slot: "home" },
        { entryId: entryIdByTeamId.get(fixture.awayTeamId)!, slot: "away" }
      ];
      if (participants.length > 0) {
        if (participants.length !== 2 || expectedParticipants.some((participant) =>
          !participants.some((existing) => existing.entryId === participant.entryId && existing.slot === participant.slot)
        )) {
          throw new Error("canonical fixture already has different participant assignments");
        }
      } else {
        for (const participant of expectedParticipants) {
          database.prepare(`
            INSERT INTO fixture_participants (
              id, match_id, competition_id, season_id, entry_id, slot, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(crypto.randomUUID(), fixture.id, competitionId, seasonId, participant.entryId, participant.slot, now);
        }
      }
    }

    const manifest = createScheduleManifest(database, { competitionId, seasonId, createdAt: now });
    for (const fixture of fixturesInput) {
      addExpectedScheduleFixture(database, manifest.id, fixture);
    }
    const checkedManifest = validateScheduleManifest(database, manifest.id);
    if (!checkedManifest.validation.valid || !checkedManifest.validation.complete) {
      throw new Error("explicit schedule review is incomplete or invalid");
    }
    const finalizedManifest = finalizeScheduleManifest(database, manifest.id, now, {
      name: scheduleSourceName,
      reference: scheduleSourceReference,
      contentHash: scheduleCsvContentHash
    });
    if (!finalizedManifest.validation.valid || !finalizedManifest.validation.complete) {
      throw new Error("finalized schedule did not pass completeness validation");
    }

    const rulesetHistory = database.prepare(`
      SELECT content_json AS contentJson
      FROM standings_snapshots
      WHERE competition_id = ? AND season_id = ?
      ORDER BY sequence DESC
    `).all(competitionId, seasonId) as Array<{ contentJson: string }>;
    let previousVersion = 0;
    let previousDefinition: unknown;
    for (const row of rulesetHistory) {
      const parsed = JSON.parse(row.contentJson) as { calculationInput?: { ruleset?: StandingsRuleset } };
      const previous = parsed.calculationInput?.ruleset;
      if (previous?.id === ruleset.id && previous.version > previousVersion) {
        previousVersion = previous.version;
        previousDefinition = previous;
      }
    }
    if (ruleset.version < previousVersion
      || (ruleset.version === previousVersion && previousDefinition
        && stableJson(previousDefinition) !== stableJson(ruleset))) {
      throw new Error("ruleset versions cannot be rolled back or redefined within this competition season");
    }

    const revisionByMatch = new Map(selections.map(({ matchId, revisionId }) => [matchId, revisionId]));
    const endedMatches = database.prepare(`
      SELECT id FROM matches WHERE competition_id = ? AND season_id = ? AND status = 'ended'
    `).all(competitionId, seasonId) as Array<{ id: string }>;
    if (endedMatches.some(({ id }) => !revisionByMatch.has(id))) {
      throw new Error("every ended fixture requires an explicitly selected accepted result revision");
    }
    for (const selection of selections) {
      const revision = database.prepare(`
        SELECT 1 FROM match_result_revisions
        WHERE id = ? AND match_id = ? AND competition_id = ? AND season_id = ?
          AND validation_state = 'accepted' AND result_status = 'ended' AND final_result_confirmed = 1
      `).get(selection.revisionId, selection.matchId, competitionId, seasonId);
      if (!revision) {
        throw new Error("selected result revisions must be accepted final results for fixtures in this season");
      }
    }

    const snapshot = createStandingsSnapshot(database, {
      competitionId,
      seasonId,
      ruleset,
      revisionSelections: selections,
      rulesetApproval: {
        competitionId,
        seasonId,
        rulesetId: ruleset.id,
        rulesetVersion: ruleset.version,
        approvalId: approvedRuleset.id,
        approvedByOperatorId: approvedRuleset.approvedByOperatorId,
        approvedAt: approvedRuleset.approvedAt
      }
    });
    const coverage = assessStandingsCoverage(database, {
      scope: { type: "competition_season", competitionId, seasonId },
      snapshotId: snapshot.id,
      policy: { allowedExclusionStatuses: [] },
      exclusions: [],
      revisionSelections: selections,
      manifestVersionId: finalizedManifest.id,
      assessedAt: now
    });
    database.exec("COMMIT;");
    response.status(201).json({
      data: {
        snapshot: { id: snapshot.id, sequence: snapshot.sequence, rulesetId: ruleset.id, rulesetVersion: ruleset.version },
        manifest: { id: finalizedManifest.id, version: finalizedManifest.version, state: finalizedManifest.state, source: finalizedManifest.source },
        coverage: { id: coverage.id, eligible: coverage.eligible, scheduleState: coverage.scheduleState, blockingReasons: coverage.blockingReasons }
      }
    });
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK;");
    console.error("[standings] administrator workflow rejected", error);
    response.status(422).json({
      error: "standings_workflow_rejected",
      message: "Standings were not prepared. Review the team selection, complete schedule, ruleset approval, and accepted results."
    });
  }
});
