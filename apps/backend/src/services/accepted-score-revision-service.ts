import type { DatabaseSync } from "../db/sqlite.js";
import {
  appendResultRevisionInTransaction,
  type ResultRevisionRecord,
  type ResultRevisionInput
} from "./standings-snapshot-service.js";

export interface AcceptedScoreUpdate {
  matchId: string;
  homeScore: number;
  awayScore: number;
  resultStatus: ResultRevisionInput["resultStatus"];
  finalResultConfirmed: boolean;
  sourceCategory: NonNullable<ResultRevisionInput["sourceCategory"]>;
  actorOperatorId?: string | null;
  sourceReference?: string | null;
  createdAt?: string;
}

export interface ScoreRevisionWriteResult {
  appended: boolean;
  revisionId: string;
}

interface LatestRevisionRow {
  id: string;
  home_score: number;
  away_score: number;
  result_status: string;
  final_result_confirmed: number;
  validation_state: string;
}

export function recordAcceptedScoreUpdateInTransaction(
  database: DatabaseSync,
  update: AcceptedScoreUpdate
): ScoreRevisionWriteResult {
  if (update.finalResultConfirmed && update.resultStatus !== "ended") {
    throw new Error("[scores] only ended results can be marked as confirmed");
  }
  const validationState = update.resultStatus === "ended" && update.finalResultConfirmed
    ? "accepted"
    : "pending";
  const latest = database.prepare(`
    SELECT id, home_score, away_score, result_status, final_result_confirmed, validation_state
    FROM match_result_revisions
    WHERE match_id = ?
    ORDER BY revision_number DESC
    LIMIT 1
  `).get(update.matchId) as LatestRevisionRow | undefined;

  if (latest
    && latest.home_score === update.homeScore
    && latest.away_score === update.awayScore
    && latest.result_status === update.resultStatus
    && (latest.final_result_confirmed === 1) === update.finalResultConfirmed
    && latest.validation_state === validationState) {
    return { appended: false, revisionId: latest.id };
  }

  const revision: ResultRevisionRecord = appendResultRevisionInTransaction(database, {
    matchId: update.matchId,
    homeScore: update.homeScore,
    awayScore: update.awayScore,
    resultStatus: update.resultStatus,
    finalResultConfirmed: update.finalResultConfirmed,
    validationState,
    sourceCategory: update.sourceCategory,
    actorOperatorId: update.actorOperatorId,
    sourceReference: update.sourceReference,
    createdAt: update.createdAt
  });
  return { appended: true, revisionId: revision.id };
}
