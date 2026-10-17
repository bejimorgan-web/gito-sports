import assert from "node:assert/strict";
import test from "node:test";
import { soccerCompetitionFormats, type SoccerCompetitionFormatId, type SoccerCompetitionRuleset, type SoccerStageRules } from "../../../../packages/shared/src/soccer-rulesets.js";
import type { CompetitionScope } from "../../../../packages/shared/src/sports.js";
import { rulesetStandingsSupport, validateSoccerCompetitionRuleset } from "./soccer-ruleset-validation.js";

function table(id: string, kind: "league" | "groups" = "league"): SoccerStageRules {
  return { id, name: id, kind, scheduling: "single_round_robin", ...(kind === "groups" ? { groupCount: 2 } : {}),
    points: { win: 4, draw: 2, loss: 0 }, tieBreakers: [{ criterion: "points", direction: "desc" }, { criterion: "scoreDifference", direction: "desc" }, { criterion: "entryId", direction: "asc" }] };
}
function knockout(id: string, legs: 1 | 2): SoccerStageRules {
  return { id, name: id, kind: "knockout", tieResolution: { legs, aggregateGoals: legs === 2, awayGoals: "not_used", extraTime: true, penalties: true, unresolved: "incomplete" } };
}
const formats: SoccerCompetitionFormatId[] = ["domestic_league", "league_phase_knockout", "groups_only", "groups_knockout", "single_match_knockout", "two_legged_knockout", "league_playoffs", "custom_multi_stage"];
function rules(formatTemplateId: SoccerCompetitionFormatId): SoccerCompetitionRuleset {
  const stages = formatTemplateId === "domestic_league" ? [table("league")]
    : formatTemplateId === "league_phase_knockout" || formatTemplateId === "league_playoffs" ? [table("league"), knockout("final", 1)]
      : formatTemplateId === "groups_only" ? [table("groups", "groups")]
        : formatTemplateId === "groups_knockout" ? [table("groups", "groups"), knockout("final", 1)]
          : formatTemplateId === "single_match_knockout" ? [knockout("cup", 1)]
            : formatTemplateId === "two_legged_knockout" ? [knockout("cup", 2)]
              : [table("qualifier"), knockout("final", 1)];
  return { formatTemplateId, sport: "soccer", stages, qualificationRoutes: [] };
}

test("all published soccer templates have explicit, valid stage configurations", () => {
  assert.deepEqual(formats, soccerCompetitionFormats.map(({ id }) => id));
  for (const format of formats) assert.doesNotThrow(() => validateSoccerCompetitionRuleset(rules(format)), format);
});

test("table stages require explicit points and tie-break order; scope remains independent", () => {
  const domestic = rules("domestic_league");
  domestic.stages[0]!.points = undefined;
  assert.throws(() => validateSoccerCompetitionRuleset(domestic), /stage_points_required/);
  const scopes: CompetitionScope[] = ["domestic", "continental", "international", "global", "regional", "friendly", "custom"];
  assert.equal(scopes[6], "custom");
  assert.deepEqual(rulesetStandingsSupport(rules("domestic_league")), { supported: true });
  assert.equal(rulesetStandingsSupport(rules("groups_only")).supported, false);
  assert.equal(rulesetStandingsSupport(rules("two_legged_knockout")).supported, false);
});

test("two-legged aggregate rules do not accept a single leg or implicit knockout resolution", () => {
  const twoLegged = rules("two_legged_knockout");
  twoLegged.stages[0]!.tieResolution!.legs = 1;
  assert.throws(() => validateSoccerCompetitionRuleset(twoLegged), /aggregate_only_for_two_leg_tie|two_leg_tie_required/);
  const missing = rules("single_match_knockout");
  missing.stages[0]!.tieResolution = undefined;
  assert.throws(() => validateSoccerCompetitionRuleset(missing), /knockout_resolution_incomplete/);
});

test("qualification requires positions, destinations, eligibility and explicit vacancy/duplicate policies", () => {
  const candidate = rules("domestic_league");
  candidate.qualificationRoutes.push({ id: "continental", source: { type: "final_position", positions: [1, 2] },
    destinationCompetitionId: "destination", destinationSeasonId: "next-season", destinationStageId: "league", slots: 2,
    duplicatePolicy: "deduplicate", vacancyPolicy: "leave_vacant", eligibility: ["federation-registered"] });
  assert.doesNotThrow(() => validateSoccerCompetitionRuleset(candidate));
  candidate.qualificationRoutes[0]!.source.positions = [];
  assert.throws(() => validateSoccerCompetitionRuleset(candidate), /qualification_positions_required/);
});
