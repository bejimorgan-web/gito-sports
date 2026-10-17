import crypto from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import {
  calculateStandings,
  type StandingsCalculationResult,
  type StandingsEntry,
  type StandingsFixture,
  type StandingsFixtureParticipant,
  type StandingsRuleset,
  type ValidatedStandingsResult
} from "./standings-calculation-service.js";

export interface ResultRevisionInput {
  matchId: string;
  homeScore: number;
  awayScore: number;
  resultStatus: "scheduled" | "live" | "paused" | "ended" | "cancelled" | "postponed";
  finalResultConfirmed: boolean;
  validationState: "pending" | "accepted" | "rejected";
  sourceCategory?: "manual_operator" | "provider" | "system" | null;
  actorOperatorId?: string | null;
  sourceReference?: string | null;
  createdAt?: string;
}

export interface ResultRevisionRecord {
  id: string;
  matchId: string;
  competitionId: string;
  seasonId: string;
  revisionNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  resultStatus: string;
  finalResultConfirmed: boolean;
  validationState: string;
  sourceCategory: string | null;
  actorOperatorId: string | null;
  sourceReference: string | null;
  supersedesRevisionId: string | null;
  createdAt: string;
}

export interface RevisionSelection {
  matchId: string;
  revisionId: string;
}

export interface CreateStandingsSnapshotInput {
  competitionId: string;
  seasonId: string;
  ruleset: StandingsRuleset;
  revisionSelections: readonly RevisionSelection[];
  rulesetApproval?: {
    competitionId: string;
    seasonId: string;
    rulesetId: string;
    rulesetVersion: number;
    approvalId: string;
    approvedByOperatorId: string;
    approvedAt: string;
  };
  seasonSoccerRuleset?: { id: string; version: number; formatTemplateId: string; rulesetHash: string };
  calculatedAt?: string;
}

export interface StandingsSnapshotRecord extends CreateStandingsSnapshotInput {
  id: string;
  sequence: number;
  contentHash: string;
  result: StandingsCalculationResult;
  contentJson: string;
}

interface MatchRow {
  id: string;
  competition_id: string;
  season_id: string | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
}

interface RevisionRow {
  id: string;
  match_id: string;
  competition_id: string;
  season_id: string;
  revision_number: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  result_status: string;
  final_result_confirmed: number;
  validation_state: string;
  source_category: string | null;
  actor_operator_id: string | null;
  source_reference: string | null;
  supersedes_revision_id: string | null;
  created_at: string;
}

function withImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  if (database.inTransaction) {
    return action();
  }
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = action();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function assertScore(score: number, label: string): void {
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new Error(`[standings] ${label} must be a non-negative safe integer`);
  }
}

function toRevisionRecord(row: RevisionRow): ResultRevisionRecord {
  return {
    id: row.id,
    matchId: row.match_id,
    competitionId: row.competition_id,
    seasonId: row.season_id,
    revisionNumber: row.revision_number,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeScore: row.home_score,
    awayScore: row.away_score,
    resultStatus: row.result_status,
    finalResultConfirmed: row.final_result_confirmed === 1,
    validationState: row.validation_state,
    sourceCategory: row.source_category,
    actorOperatorId: row.actor_operator_id,
    sourceReference: row.source_reference,
    supersedesRevisionId: row.supersedes_revision_id,
    createdAt: row.created_at
  };
}

export function appendResultRevisionInTransaction(
  database: DatabaseSync,
  input: ResultRevisionInput
): ResultRevisionRecord {
  assertScore(input.homeScore, "homeScore");
  assertScore(input.awayScore, "awayScore");
  if (!["scheduled", "live", "paused", "ended", "cancelled", "postponed"].includes(input.resultStatus)) {
    throw new Error(`[standings] unsupported result status "${input.resultStatus}"`);
  }
  if (!["pending", "accepted", "rejected"].includes(input.validationState)) {
    throw new Error(`[standings] unsupported result validation state "${input.validationState}"`);
  }
  if (typeof input.finalResultConfirmed !== "boolean") {
    throw new Error("[standings] finalResultConfirmed must be a boolean");
  }
  if (input.validationState === "accepted"
    && (input.resultStatus !== "ended" || !input.finalResultConfirmed)) {
    throw new Error("[standings] only confirmed ended results can be accepted");
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("[standings] createdAt must be a valid timestamp");
  }

  const match = database.prepare(`
    SELECT id, competition_id, season_id, status, home_team_id, away_team_id
    FROM matches WHERE id = ?
  `).get(input.matchId) as MatchRow | undefined;
  if (!match) {
    throw new Error(`[standings] cannot append a result revision for unknown match "${input.matchId}"`);
  }
  if (!match.season_id) {
    throw new Error(`[standings] match "${input.matchId}" has no season and cannot enter a standings revision chain`);
  }

  const previous = database.prepare(`
    SELECT id, revision_number FROM match_result_revisions
    WHERE match_id = ? ORDER BY revision_number DESC LIMIT 1
  `).get(input.matchId) as { id: string; revision_number: number } | undefined;
  const id = crypto.randomUUID();
  const revisionNumber = (previous?.revision_number ?? 0) + 1;
  database.prepare(`
    INSERT INTO match_result_revisions (
      id, match_id, competition_id, season_id, revision_number,
      home_team_id, away_team_id, home_score, away_score, result_status,
      final_result_confirmed, validation_state, source_category, actor_operator_id,
      source_reference, supersedes_revision_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    match.id,
    match.competition_id,
    match.season_id,
    revisionNumber,
    match.home_team_id,
    match.away_team_id,
    input.homeScore,
    input.awayScore,
    input.resultStatus,
    input.finalResultConfirmed ? 1 : 0,
    input.validationState,
    input.sourceCategory ?? null,
    input.actorOperatorId ?? null,
    input.sourceReference ?? null,
    previous?.id ?? null,
    createdAt
  );
  return toRevisionRecord(database.prepare(
    "SELECT * FROM match_result_revisions WHERE id = ?"
  ).get(id) as RevisionRow);
}

export function appendResultRevision(
  database: DatabaseSync,
  input: ResultRevisionInput
): ResultRevisionRecord {
  return withImmediateTransaction(database, () => appendResultRevisionInTransaction(database, input));
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

function asRecord(row: RevisionRow): ResultRevisionRecord {
  return toRevisionRecord(row);
}

export function createStandingsSnapshot(
  database: DatabaseSync,
  input: CreateStandingsSnapshotInput
): StandingsSnapshotRecord {
  return withImmediateTransaction(database, () => {
    const selectionByMatch = new Map<string, string>();
    const selectedRevisionIds = new Set<string>();
    for (const selection of input.revisionSelections) {
      if (selectionByMatch.has(selection.matchId)) {
        throw new Error(`[standings] ambiguous result selection: match "${selection.matchId}" has multiple selected revisions`);
      }
      if (selectedRevisionIds.has(selection.revisionId)) {
        throw new Error(`[standings] result revision "${selection.revisionId}" was selected more than once`);
      }
      selectionByMatch.set(selection.matchId, selection.revisionId);
      selectedRevisionIds.add(selection.revisionId);
    }

    const entries = database.prepare(`
      SELECT id, competition_id AS competitionId, season_id AS seasonId,
             entry_type AS competitorType, team_id AS teamId
      FROM competition_entries
      WHERE competition_id = ? AND season_id = ?
      ORDER BY id
    `).all(input.competitionId, input.seasonId) as StandingsEntry[];
    const fixtureRows = database.prepare(`
      SELECT id, competition_id AS competitionId, season_id AS seasonId,
             status, home_team_id AS homeTeamId, away_team_id AS awayTeamId
      FROM matches
      WHERE competition_id = ? AND season_id = ?
      ORDER BY id
    `).all(input.competitionId, input.seasonId) as StandingsFixture[];
    const fixtureById = new Map(fixtureRows.map((fixture) => [fixture.id, fixture]));

    for (const fixture of fixtureRows) {
      const selectedId = selectionByMatch.get(fixture.id);
      if (fixture.status === "ended" && !selectedId) {
        throw new Error(`[standings] ended match "${fixture.id}" requires an explicit result revision selection`);
      }
      if (selectedId && fixture.status !== "ended") {
        throw new Error(`[standings] result revision selected for non-ended match "${fixture.id}"`);
      }
    }
    for (const matchId of selectionByMatch.keys()) {
      if (!fixtureById.has(matchId)) {
        throw new Error(`[standings] selected match "${matchId}" is outside the requested competition and season`);
      }
    }

    const participants = database.prepare(`
      SELECT match_id AS fixtureId, entry_id AS entryId, slot
      FROM fixture_participants
      WHERE competition_id = ? AND season_id = ?
      ORDER BY match_id, slot, entry_id
    `).all(input.competitionId, input.seasonId) as StandingsFixtureParticipant[];
    const revisions: ResultRevisionRecord[] = [];
    const results: ValidatedStandingsResult[] = [];
    for (const [matchId, revisionId] of [...selectionByMatch].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )) {
      const row = database.prepare(`
        SELECT * FROM match_result_revisions WHERE match_id = ? AND id = ?
      `).get(matchId, revisionId) as RevisionRow | undefined;
      if (!row) {
        throw new Error(`[standings] selected revision "${revisionId}" does not belong to match "${matchId}"`);
      }
      if (row.validation_state !== "accepted"
        || row.result_status !== "ended"
        || row.final_result_confirmed !== 1) {
        throw new Error(`[standings] selected revision "${revisionId}" is not an accepted final result`);
      }
      const fixture = fixtureById.get(matchId);
      if (!fixture
        || row.competition_id !== input.competitionId
        || row.season_id !== input.seasonId
        || row.home_team_id !== fixture.homeTeamId
        || row.away_team_id !== fixture.awayTeamId) {
        throw new Error(`[standings] selected revision "${revisionId}" no longer matches its fixture context`);
      }

      revisions.push(asRecord(row));
      results.push({
        competitionId: row.competition_id,
        seasonId: row.season_id,
        fixtureId: row.match_id,
        status: row.result_status,
        finalResultConfirmed: row.final_result_confirmed === 1,
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeScore: row.home_score,
        awayScore: row.away_score
      });
    }

    const calculationInput = {
      competitionId: input.competitionId,
      seasonId: input.seasonId,
      entries,
      fixtures: fixtureRows,
      participants,
      results,
      ruleset: input.ruleset
    };
    const result = calculateStandings(calculationInput);
    if (result.excludedEntries.length > 0) {
      throw new Error(`[standings] snapshot cannot include unsupported or out-of-scope entries: ${JSON.stringify(result.excludedEntries)}`);
    }
    const countedFixtureIds = new Set(fixtureRows
      .filter((fixture) => fixture.status === "ended")
      .map((fixture) => fixture.id)
      .filter((fixtureId) => !result.excludedFixtures.some((excluded) => excluded.fixtureId === fixtureId)));
    for (const fixture of fixtureRows) {
      if (fixture.status === "ended" && result.excludedFixtures.some((item) => item.fixtureId === fixture.id)) {
        throw new Error(`[standings] snapshot calculation rejected ended match "${fixture.id}": ${
          result.excludedFixtures.find((item) => item.fixtureId === fixture.id)?.reason
        }`);
      }
    }

    const countedRevisions = revisions.filter((revision) => countedFixtureIds.has(revision.matchId));
    if (countedRevisions.length !== countedFixtureIds.size) {
      throw new Error("[standings] calculated fixture set does not match its explicit revision selections");
    }
    const canonicalContent = {
      calculationInput,
      acceptedRevisions: revisions,
      calculation: result,
      ...(input.rulesetApproval ? { rulesetApproval: input.rulesetApproval } : {}),
      ...(input.seasonSoccerRuleset ? { seasonSoccerRuleset: input.seasonSoccerRuleset } : {})
    };
    const contentJson = stableJson(canonicalContent);
    const contentHash = crypto.createHash("sha256").update(contentJson).digest("hex");
    const calculatedAt = input.calculatedAt ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(calculatedAt))) {
      throw new Error("[standings] calculatedAt must be a valid timestamp");
    }
    const sequence = Number((database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM standings_snapshots
      WHERE competition_id = ? AND season_id = ?
    `).get(input.competitionId, input.seasonId) as { nextSequence: number }).nextSequence);
    const id = crypto.randomUUID();
    database.prepare(`
      INSERT INTO standings_snapshots (
        id, competition_id, season_id, sequence, ruleset_id, ruleset_version,
        content_hash, content_json, calculated_at, expected_result_count, expected_row_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.competitionId,
      input.seasonId,
      sequence,
      input.ruleset.id,
      input.ruleset.version,
      contentHash,
      contentJson,
      calculatedAt,
      countedRevisions.length,
      result.rows.length
    );

    const insertResult = database.prepare(`
      INSERT INTO standings_snapshot_results (
        snapshot_id, competition_id, season_id, match_id, revision_id, revision_number
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const revision of countedRevisions) {
      insertResult.run(id, input.competitionId, input.seasonId, revision.matchId, revision.id, revision.revisionNumber);
    }

    const insertRow = database.prepare(`
      INSERT INTO standings_snapshot_rows (
        snapshot_id, competition_id, season_id, entry_id, rank, played, won, drawn, lost,
        scores_for, scores_against, score_difference, points, tie_break_values_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of result.rows) {
      insertRow.run(
        id,
        input.competitionId,
        input.seasonId,
        row.entryId,
        row.rank,
        row.played,
        row.won,
        row.drawn,
        row.lost,
        row.scoresFor,
        row.scoresAgainst,
        row.scoreDifference,
        row.points,
        stableJson(row.tieBreakValues)
      );
    }
    database.prepare(
      "UPDATE standings_snapshots SET is_complete = 1 WHERE id = ?"
    ).run(id);

    return {
      ...input,
      id,
      sequence,
      contentHash,
      contentJson,
      result,
      calculatedAt
    };
  });
}
