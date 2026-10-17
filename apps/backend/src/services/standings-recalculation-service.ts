import type { DatabaseSync } from "../db/sqlite.js";
import {
  assessStandingsCoverage,
  type CoverageExclusion,
  type CoveragePolicy,
  type StandingsCoverageAssessment
} from "./standings-coverage-service.js";
import {
  createStandingsSnapshot,
  type RevisionSelection,
  type StandingsSnapshotRecord
} from "./standings-snapshot-service.js";
import type { StandingsRuleset } from "./standings-calculation-service.js";

export interface RecalculateStandingsInput {
  competitionId: string;
  seasonId: string;
  ruleset: StandingsRuleset;
  revisionSelections: readonly RevisionSelection[];
  manifestVersionId: string;
  policy: CoveragePolicy;
  exclusions: readonly CoverageExclusion[];
  calculatedAt?: string;
  assessedAt?: string;
}

export interface RecalculatedStandings {
  snapshot: StandingsSnapshotRecord;
  coverage: StandingsCoverageAssessment;
}

export class StandingsCoverageAssessmentError extends Error {
  readonly snapshot: StandingsSnapshotRecord;
  readonly manifestVersionId: string;
  readonly cause: unknown;

  constructor(snapshot: StandingsSnapshotRecord, manifestVersionId: string, cause: unknown) {
    super(
      `[standings] snapshot ${snapshot.id} was created, but coverage assessment failed; retry assessment for this snapshot and manifest`
    );
    this.name = "StandingsCoverageAssessmentError";
    this.snapshot = snapshot;
    this.manifestVersionId = manifestVersionId;
    this.cause = cause;
  }
}

export function recalculateStandingsAfterAcceptedResultChange(
  database: DatabaseSync,
  input: RecalculateStandingsInput
): RecalculatedStandings {
  const snapshot = createStandingsSnapshot(database, {
    competitionId: input.competitionId,
    seasonId: input.seasonId,
    ruleset: input.ruleset,
    revisionSelections: input.revisionSelections,
    calculatedAt: input.calculatedAt
  });
  let coverage: StandingsCoverageAssessment;
  try {
    coverage = assessStandingsCoverage(database, {
      scope: {
        type: "competition_season",
        competitionId: input.competitionId,
        seasonId: input.seasonId
      },
      snapshotId: snapshot.id,
      policy: input.policy,
      exclusions: input.exclusions,
      revisionSelections: input.revisionSelections,
      manifestVersionId: input.manifestVersionId,
      assessedAt: input.assessedAt
    });
  } catch (error) {
    throw new StandingsCoverageAssessmentError(snapshot, input.manifestVersionId, error);
  }
  return { snapshot, coverage };
}
