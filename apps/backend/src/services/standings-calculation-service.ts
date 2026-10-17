export type StandingsStatistic =
  | "played"
  | "won"
  | "drawn"
  | "lost"
  | "scoresFor"
  | "scoresAgainst"
  | "scoreDifference"
  | "points";

export type StandingsTieBreakCriterion =
  | "points"
  | "played"
  | "won"
  | "drawn"
  | "lost"
  | "scoreDifference"
  | "scoresFor"
  | "scoresAgainst"
  | "headToHeadPoints"
  | "headToHeadScoreDifference"
  | "headToHeadScoresFor"
  | "entryId";

export interface StandingsTieBreaker {
  criterion: StandingsTieBreakCriterion;
  direction: "asc" | "desc";
}

export interface StandingsRuleset {
  id: string;
  version: number;
  points: {
    win: number;
    draw: number;
    loss: number;
  };
  trackedStatistics: readonly StandingsStatistic[];
  tieBreakers: readonly StandingsTieBreaker[];
}

// Explicit example configuration for tests and consumers; it is not a GiTO default.
export const conventionalTeamLeagueRuleset: StandingsRuleset = Object.freeze({
  id: "example-team-league",
  version: 1,
  points: Object.freeze({ win: 3, draw: 1, loss: 0 }),
  trackedStatistics: Object.freeze([
    "played",
    "won",
    "drawn",
    "lost",
    "scoresFor",
    "scoresAgainst",
    "scoreDifference",
    "points"
  ] satisfies StandingsStatistic[]),
  tieBreakers: Object.freeze([
    Object.freeze({ criterion: "points", direction: "desc" } satisfies StandingsTieBreaker),
    Object.freeze({ criterion: "scoreDifference", direction: "desc" } satisfies StandingsTieBreaker),
    Object.freeze({ criterion: "scoresFor", direction: "desc" } satisfies StandingsTieBreaker),
    Object.freeze({ criterion: "entryId", direction: "asc" } satisfies StandingsTieBreaker)
  ])
});

export interface StandingsContext {
  competitionId: string;
  seasonId: string;
}

export interface StandingsEntry extends StandingsContext {
  id: string;
  competitorType: "team" | "individual" | string;
  teamId?: string | null;
}

export interface StandingsFixture extends StandingsContext {
  id: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
}

export interface StandingsFixtureParticipant {
  fixtureId: string;
  entryId: string;
  slot: string;
}

export interface ValidatedStandingsResult extends StandingsContext {
  // An adapter must source these identities from the fixture's home/away sides,
  // and only mark a manual result final when status is ended and confirmation is true.
  fixtureId: string;
  status: string;
  finalResultConfirmed: boolean;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface StandingsCalculationInput extends StandingsContext {
  entries: readonly StandingsEntry[];
  fixtures: readonly StandingsFixture[];
  participants: readonly StandingsFixtureParticipant[];
  results: readonly ValidatedStandingsResult[];
  ruleset: StandingsRuleset;
}

export interface StandingsRow extends StandingsStatisticValues {
  entryId: string;
  rank: number;
  tieBreakValues: Readonly<Record<StandingsTieBreakCriterion, number | string>>;
}

interface StandingsStatisticValues {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoresFor: number;
  scoresAgainst: number;
  scoreDifference: number;
  points: number;
}

export type StandingsExclusionReason =
  | "duplicate_entry_id"
  | "entry_outside_competition_or_season"
  | "unsupported_competitor_type"
  | "duplicate_fixture_id"
  | "fixture_outside_competition_or_season"
  | "fixture_not_completed"
  | "missing_result"
  | "duplicate_result"
  | "result_outside_competition_or_season"
  | "result_not_final"
  | "invalid_scores"
  | "unsafe_standings_totals"
  | "invalid_participants";

export interface StandingsExclusion {
  fixtureId: string;
  reason: StandingsExclusionReason;
}

export interface StandingsEntryExclusion {
  entryId: string;
  reason: Exclude<
    StandingsExclusionReason,
    | "duplicate_fixture_id"
    | "fixture_outside_competition_or_season"
    | "fixture_not_completed"
    | "missing_result"
    | "duplicate_result"
    | "result_outside_competition_or_season"
    | "result_not_final"
    | "invalid_scores"
    | "unsafe_standings_totals"
    | "invalid_participants"
  >;
}

export interface StandingsCalculationResult {
  rulesetId: string;
  rulesetVersion: number;
  rows: StandingsRow[];
  excludedFixtures: StandingsExclusion[];
  excludedEntries: StandingsEntryExclusion[];
}

const requiredStatistics: readonly StandingsStatistic[] = [
  "played",
  "won",
  "drawn",
  "lost",
  "scoresFor",
  "scoresAgainst",
  "scoreDifference",
  "points"
];

const statisticSet = new Set<string>(requiredStatistics);
const criterionSet = new Set<string>([
  "points",
  "played",
  "won",
  "drawn",
  "lost",
  "scoreDifference",
  "scoresFor",
  "scoresAgainst",
  "headToHeadPoints",
  "headToHeadScoreDifference",
  "headToHeadScoresFor",
  "entryId"
]);

export class StandingsRulesetValidationError extends Error {
  constructor(message: string) {
    super(`[standings] invalid ruleset: ${message}`);
    this.name = "StandingsRulesetValidationError";
  }
}

export function validateStandingsRuleset(ruleset: StandingsRuleset): void {
  if (!ruleset || typeof ruleset !== "object") {
    throw new StandingsRulesetValidationError("a ruleset object is required");
  }
  if (typeof ruleset.id !== "string" || ruleset.id.trim() !== ruleset.id || ruleset.id.length === 0) {
    throw new StandingsRulesetValidationError("id must be a non-empty, trimmed string");
  }
  if (!Number.isSafeInteger(ruleset.version) || ruleset.version < 1) {
    throw new StandingsRulesetValidationError("version must be a positive safe integer");
  }
  for (const outcome of ["win", "draw", "loss"] as const) {
    const value = ruleset.points?.[outcome];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StandingsRulesetValidationError(`${outcome} points must be a non-negative safe integer`);
    }
  }

  if (!Array.isArray(ruleset.trackedStatistics) || ruleset.trackedStatistics.length === 0) {
    throw new StandingsRulesetValidationError("trackedStatistics must list the statistics used by the table");
  }
  const tracked = new Set<string>();
  for (const statistic of ruleset.trackedStatistics) {
    if (!statisticSet.has(statistic)) {
      throw new StandingsRulesetValidationError(`unknown tracked statistic "${statistic}"`);
    }
    if (tracked.has(statistic)) {
      throw new StandingsRulesetValidationError(`duplicate tracked statistic "${statistic}"`);
    }
    tracked.add(statistic);
  }
  for (const statistic of requiredStatistics) {
    if (!tracked.has(statistic)) {
      throw new StandingsRulesetValidationError(`required statistic "${statistic}" is not tracked`);
    }
  }

  if (!Array.isArray(ruleset.tieBreakers) || ruleset.tieBreakers.length < 2) {
    throw new StandingsRulesetValidationError("tieBreakers must include points and a final entryId ordering");
  }
  const orderedCriteria = new Set<string>();
  for (const [index, tieBreaker] of ruleset.tieBreakers.entries()) {
    if (!tieBreaker || !criterionSet.has(tieBreaker.criterion)) {
      throw new StandingsRulesetValidationError(`unknown tie-break criterion "${String(tieBreaker?.criterion)}"`);
    }
    if (tieBreaker.direction !== "asc" && tieBreaker.direction !== "desc") {
      throw new StandingsRulesetValidationError(`invalid direction for "${tieBreaker.criterion}"`);
    }
    if (orderedCriteria.has(tieBreaker.criterion)) {
      throw new StandingsRulesetValidationError(`duplicate tie-break criterion "${tieBreaker.criterion}"`);
    }
    orderedCriteria.add(tieBreaker.criterion);
    if (tieBreaker.criterion === "entryId"
      && (index !== ruleset.tieBreakers.length - 1 || tieBreaker.direction !== "asc")) {
      throw new StandingsRulesetValidationError("entryId must be the final ascending tie-break criterion");
    }
  }
  if (ruleset.tieBreakers[0]?.criterion !== "points") {
    throw new StandingsRulesetValidationError("points must be the first tie-break criterion");
  }
  if (ruleset.tieBreakers[ruleset.tieBreakers.length - 1]?.criterion !== "entryId") {
    throw new StandingsRulesetValidationError("entryId must be the final tie-break criterion");
  }
}

function createStats(): StandingsStatisticValues {
  return {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    scoresFor: 0,
    scoresAgainst: 0,
    scoreDifference: 0,
    points: 0
  };
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface CountedHeadToHeadResult {
  homeEntryId: string;
  awayEntryId: string;
  homeScore: number;
  awayScore: number;
}

function headToHeadValue(
  entryId: string,
  group: ReadonlySet<string>,
  results: readonly CountedHeadToHeadResult[],
  ruleset: StandingsRuleset,
  criterion: "headToHeadPoints" | "headToHeadScoreDifference" | "headToHeadScoresFor"
): number {
  let points = 0;
  let scoresFor = 0;
  let scoresAgainst = 0;
  for (const result of results) {
    const isHome = result.homeEntryId === entryId && group.has(result.awayEntryId);
    const isAway = result.awayEntryId === entryId && group.has(result.homeEntryId);
    if (!isHome && !isAway) continue;
    const scored = isHome ? result.homeScore : result.awayScore;
    const conceded = isHome ? result.awayScore : result.homeScore;
    scoresFor += scored;
    scoresAgainst += conceded;
    points += scored > conceded ? ruleset.points.win
      : scored < conceded ? ruleset.points.loss
        : ruleset.points.draw;
  }
  return criterion === "headToHeadPoints" ? points
    : criterion === "headToHeadScoreDifference" ? scoresFor - scoresAgainst
      : scoresFor;
}

function rankStandingsRows(
  rows: readonly StandingsRow[],
  tieBreakers: readonly StandingsTieBreaker[],
  results: readonly CountedHeadToHeadResult[],
  ruleset: StandingsRuleset
): StandingsRow[] {
  let groups: StandingsRow[][] = [[...rows]];
  for (const { criterion, direction } of tieBreakers) {
    const nextGroups: StandingsRow[][] = [];
    for (const group of groups) {
      const entryIds = new Set(group.map(({ entryId }) => entryId));
      const valueFor = (row: StandingsRow): number | string => criterion.startsWith("headToHead")
        ? headToHeadValue(row.entryId, entryIds, results, ruleset, criterion as
            "headToHeadPoints" | "headToHeadScoreDifference" | "headToHeadScoresFor")
        : row.tieBreakValues[criterion];
      const ordered = [...group].sort((left, right) => {
        const leftValue = valueFor(left);
        const rightValue = valueFor(right);
        const comparison = typeof leftValue === "string" && typeof rightValue === "string"
          ? compareStableIds(leftValue, rightValue)
          : Number(leftValue) - Number(rightValue);
        return direction === "desc" ? -comparison : comparison;
      });
      let currentGroup: StandingsRow[] = [];
      let priorValue: number | string | undefined;
      for (const row of ordered) {
        const value = valueFor(row);
        if (currentGroup.length > 0 && value !== priorValue) {
          nextGroups.push(currentGroup);
          currentGroup = [];
        }
        currentGroup.push(row);
        priorValue = value;
      }
      if (currentGroup.length > 0) nextGroups.push(currentGroup);
    }
    groups = nextGroups;
  }
  return groups.flat();
}

function isValidScore(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function calculateStandings(input: StandingsCalculationInput): StandingsCalculationResult {
  validateStandingsRuleset(input.ruleset);

  const excludedEntries: StandingsEntryExclusion[] = [];
  const entriesById = new Map<string, StandingsEntry>();
  const duplicateEntryIds = new Set<string>();

  for (const entry of input.entries) {
    if (entriesById.has(entry.id)) {
      duplicateEntryIds.add(entry.id);
    } else {
      entriesById.set(entry.id, entry);
    }
  }
  for (const entry of input.entries) {
    if (duplicateEntryIds.has(entry.id)) {
      excludedEntries.push({ entryId: entry.id, reason: "duplicate_entry_id" });
    } else if (entry.competitionId !== input.competitionId || entry.seasonId !== input.seasonId) {
      excludedEntries.push({ entryId: entry.id, reason: "entry_outside_competition_or_season" });
    } else if (entry.competitorType !== "team" || !entry.teamId) {
      excludedEntries.push({ entryId: entry.id, reason: "unsupported_competitor_type" });
    }
  }

  const validEntries = new Map(
    [...entriesById].filter(([id, entry]) =>
      !duplicateEntryIds.has(id)
      && entry.competitionId === input.competitionId
      && entry.seasonId === input.seasonId
      && entry.competitorType === "team"
      && Boolean(entry.teamId)
    )
  );
  const statsByEntry = new Map<string, StandingsStatisticValues>(
    [...validEntries.keys()].map((entryId) => [entryId, createStats()])
  );

  const fixtureCounts = new Map<string, number>();
  for (const fixture of input.fixtures) {
    fixtureCounts.set(fixture.id, (fixtureCounts.get(fixture.id) ?? 0) + 1);
  }
  const resultsByFixture = new Map<string, ValidatedStandingsResult[]>();
  for (const result of input.results) {
    const results = resultsByFixture.get(result.fixtureId) ?? [];
    results.push(result);
    resultsByFixture.set(result.fixtureId, results);
  }

  const excludedFixtures: StandingsExclusion[] = [];
  const countedFixtureIds = new Set<string>();
  const headToHeadResults: CountedHeadToHeadResult[] = [];

  for (const fixture of input.fixtures) {
    let reason: StandingsExclusionReason | undefined;
    if (fixtureCounts.get(fixture.id) !== 1) {
      reason = "duplicate_fixture_id";
    } else if (fixture.competitionId !== input.competitionId || fixture.seasonId !== input.seasonId) {
      reason = "fixture_outside_competition_or_season";
    } else if (fixture.status !== "ended") {
      reason = "fixture_not_completed";
    }

    const fixtureResults = resultsByFixture.get(fixture.id) ?? [];
    const result = fixtureResults[0];
    if (!reason) {
      if (fixtureResults.length > 1) {
        reason = "duplicate_result";
      } else if (!result) {
        reason = "missing_result";
      } else if (result.competitionId !== input.competitionId || result.seasonId !== input.seasonId) {
        reason = "result_outside_competition_or_season";
      } else if (result.status !== "ended" || result.finalResultConfirmed !== true) {
        reason = "result_not_final";
      } else if (!isValidScore(result.homeScore) || !isValidScore(result.awayScore)) {
        reason = "invalid_scores";
      }
    }

    if (!reason && result && isValidScore(result.homeScore) && isValidScore(result.awayScore)) {
      const homeParticipants = input.participants.filter(
        (participant) => participant.fixtureId === fixture.id && participant.slot === "home"
      );
      const awayParticipants = input.participants.filter(
        (participant) => participant.fixtureId === fixture.id && participant.slot === "away"
      );
      const allFixtureParticipants = input.participants.filter(
        (participant) => participant.fixtureId === fixture.id
      );
      const homeParticipant = homeParticipants[0];
      const awayParticipant = awayParticipants[0];
      const homeEntry = homeParticipant ? validEntries.get(homeParticipant.entryId) : undefined;
      const awayEntry = awayParticipant ? validEntries.get(awayParticipant.entryId) : undefined;

      if (
        homeParticipants.length !== 1
        || awayParticipants.length !== 1
        || allFixtureParticipants.length !== 2
        || !homeParticipant
        || !awayParticipant
        || homeParticipant.entryId === awayParticipant.entryId
        || !homeEntry
        || !awayEntry
        || homeEntry.teamId !== fixture.homeTeamId
        || awayEntry.teamId !== fixture.awayTeamId
        || result.homeTeamId !== fixture.homeTeamId
        || result.awayTeamId !== fixture.awayTeamId
      ) {
        reason = "invalid_participants";
      } else {
        const homeStats = statsByEntry.get(homeParticipant.entryId);
        const awayStats = statsByEntry.get(awayParticipant.entryId);
        if (!homeStats || !awayStats) {
          reason = "invalid_participants";
        } else {
          const homeWon = result.homeScore > result.awayScore;
          const awayWon = result.homeScore < result.awayScore;
          const homeNext = {
            played: homeStats.played + 1,
            won: homeStats.won + Number(homeWon),
            drawn: homeStats.drawn + Number(!homeWon && !awayWon),
            lost: homeStats.lost + Number(awayWon),
            scoresFor: homeStats.scoresFor + result.homeScore,
            scoresAgainst: homeStats.scoresAgainst + result.awayScore,
            points: homeStats.points + (
              homeWon ? input.ruleset.points.win
                : awayWon ? input.ruleset.points.loss
                  : input.ruleset.points.draw
            )
          };
          const awayNext = {
            played: awayStats.played + 1,
            won: awayStats.won + Number(awayWon),
            drawn: awayStats.drawn + Number(!homeWon && !awayWon),
            lost: awayStats.lost + Number(homeWon),
            scoresFor: awayStats.scoresFor + result.awayScore,
            scoresAgainst: awayStats.scoresAgainst + result.homeScore,
            points: awayStats.points + (
              awayWon ? input.ruleset.points.win
                : homeWon ? input.ruleset.points.loss
                  : input.ruleset.points.draw
            )
          };
          if (
            Object.values(homeNext).some((value) => !Number.isSafeInteger(value))
            || Object.values(awayNext).some((value) => !Number.isSafeInteger(value))
          ) {
            reason = "unsafe_standings_totals";
          } else {
            Object.assign(homeStats, homeNext, {
              scoreDifference: homeNext.scoresFor - homeNext.scoresAgainst
            });
            Object.assign(awayStats, awayNext, {
              scoreDifference: awayNext.scoresFor - awayNext.scoresAgainst
            });
            countedFixtureIds.add(fixture.id);
            headToHeadResults.push({
              homeEntryId: homeParticipant.entryId,
              awayEntryId: awayParticipant.entryId,
              homeScore: result.homeScore,
              awayScore: result.awayScore
            });
          }
        }
      }
    }

    if (reason) {
      excludedFixtures.push({ fixtureId: fixture.id, reason });
    }
  }

  for (const fixtureId of resultsByFixture.keys()) {
    if (!fixtureCounts.has(fixtureId) && !countedFixtureIds.has(fixtureId)) {
      excludedFixtures.push({ fixtureId, reason: "fixture_outside_competition_or_season" });
    }
  }

  const rows = [...statsByEntry].map(([entryId, stats]) => {
    const h2hGroup = new Set(validEntries.keys());
    const tieBreakValues: Record<StandingsTieBreakCriterion, number | string> = {
      points: stats.points,
      played: stats.played,
      won: stats.won,
      drawn: stats.drawn,
      lost: stats.lost,
      scoreDifference: stats.scoreDifference,
      scoresFor: stats.scoresFor,
      scoresAgainst: stats.scoresAgainst,
      headToHeadPoints: headToHeadValue(entryId, h2hGroup, headToHeadResults, input.ruleset, "headToHeadPoints"),
      headToHeadScoreDifference: headToHeadValue(entryId, h2hGroup, headToHeadResults, input.ruleset, "headToHeadScoreDifference"),
      headToHeadScoresFor: headToHeadValue(entryId, h2hGroup, headToHeadResults, input.ruleset, "headToHeadScoresFor"),
      entryId
    };
    return { entryId, rank: 0, ...stats, tieBreakValues };
  });

  const orderedRows = rankStandingsRows(rows, input.ruleset.tieBreakers, headToHeadResults, input.ruleset);
  orderedRows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    rulesetId: input.ruleset.id,
    rulesetVersion: input.ruleset.version,
    rows: orderedRows,
    excludedFixtures,
    excludedEntries
  };
}
