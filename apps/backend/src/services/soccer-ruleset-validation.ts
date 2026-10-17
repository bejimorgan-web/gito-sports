import type { SoccerCompetitionRuleset, SoccerStageRules } from "../../../../packages/shared/src/soccer-rulesets.js";
import { soccerCompetitionFormats } from "../../../../packages/shared/src/soccer-rulesets.js";

const formatIds = new Set<string>(soccerCompetitionFormats.map(({ id }) => id));
const tieBreakCriteria = new Set(["points", "played", "won", "drawn", "lost", "scoreDifference", "scoresFor", "scoresAgainst", "headToHeadPoints", "headToHeadScoreDifference", "headToHeadScoresFor", "entryId"]);
function fail(message: string): never { throw new Error(`soccer_ruleset_${message}`); }

export function validateSoccerCompetitionRuleset(value: unknown): asserts value is SoccerCompetitionRuleset {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object_required");
  const rules = value as Partial<SoccerCompetitionRuleset>;
  if (rules.sport !== "soccer") fail("sport_must_be_soccer");
  if (!rules.formatTemplateId || !formatIds.has(rules.formatTemplateId)) fail("format_invalid");
  if (!Array.isArray(rules.stages) || rules.stages.length === 0) fail("stages_required");
  const stageIds = new Set<string>();
  for (const stage of rules.stages) {
    if (!stage || typeof stage.id !== "string" || !stage.id.trim() || stage.id !== stage.id.trim() || stageIds.has(stage.id)) fail("stage_id_invalid_or_duplicate");
    stageIds.add(stage.id);
    if (!stage.name?.trim() || !["league", "groups", "knockout"].includes(stage.kind)) fail(`stage_definition_invalid:${stage.id}`);
    validateStage(stage);
  }
  for (const stage of rules.stages) {
    if (stage.progression && (!stageIds.has(stage.progression.winnerStageId) || (stage.progression.loserStageId && !stageIds.has(stage.progression.loserStageId)))) fail(`progression_destination_missing:${stage.id}`);
  }
  const kinds = new Set(rules.stages.map(({ kind }) => kind));
  const requireKinds: Partial<Record<NonNullable<typeof rules.formatTemplateId>, string[]>> = {
    domestic_league: ["league"],
    league_phase_knockout: ["league", "knockout"],
    groups_only: ["groups"],
    groups_knockout: ["groups", "knockout"],
    single_match_knockout: ["knockout"],
    two_legged_knockout: ["knockout"],
    league_playoffs: ["league", "knockout"]
  };
  for (const kind of requireKinds[rules.formatTemplateId] ?? []) if (!kinds.has(kind as SoccerStageRules["kind"])) fail(`template_stage_required:${rules.formatTemplateId}:${kind}`);
  if (rules.formatTemplateId === "two_legged_knockout" && !rules.stages.some((stage) => stage.kind === "knockout" && stage.tieResolution?.legs === 2)) fail("two_leg_tie_required");
  if (rules.formatTemplateId === "single_match_knockout" && !rules.stages.some((stage) => stage.kind === "knockout" && stage.tieResolution?.legs === 1)) fail("single_match_tie_required");
  if (!Array.isArray(rules.qualificationRoutes)) fail("qualification_routes_required");
  const routeIds = new Set<string>();
  for (const route of rules.qualificationRoutes) {
    if (!route || !route.id?.trim() || routeIds.has(route.id)) fail("qualification_route_id_invalid_or_duplicate");
    routeIds.add(route.id);
    if (!route.destinationCompetitionId?.trim() || !route.destinationSeasonId?.trim() || !route.destinationStageId?.trim()) fail(`qualification_destination_required:${route.id}`);
    if (!Number.isSafeInteger(route.slots) || route.slots < 1) fail(`qualification_slots_invalid:${route.id}`);
    if (!route.eligibility || !Array.isArray(route.eligibility) || route.eligibility.some((item) => typeof item !== "string" || !item.trim())) fail(`qualification_eligibility_required:${route.id}`);
    if (!route.source || !["final_position", "champion", "cup_winner", "playoff"].includes(route.source.type)) fail(`qualification_source_invalid:${route.id}`);
    if (route.source.type === "final_position" && (!route.source.positions?.length || route.source.positions.some((n) => !Number.isSafeInteger(n) || n < 1))) fail(`qualification_positions_required:${route.id}`);
    if (!["deduplicate", "allow"].includes(route.duplicatePolicy) || !["leave_vacant", "configured_route"].includes(route.vacancyPolicy)) fail(`qualification_allocation_policy_required:${route.id}`);
    if (route.vacancyPolicy === "configured_route" && (!route.replacementRouteId || route.replacementRouteId === route.id)) fail(`qualification_replacement_route_required:${route.id}`);
  }
  for (const route of rules.qualificationRoutes) if (route.replacementRouteId && !routeIds.has(route.replacementRouteId)) fail(`qualification_replacement_route_missing:${route.id}`);
}

function validateStage(stage: SoccerStageRules): void {
  if (stage.kind === "league" || stage.kind === "groups") {
    if (!["single_round_robin", "double_round_robin"].includes(stage.scheduling ?? "")) fail(`stage_scheduling_required:${stage.id}`);
    if (stage.kind === "groups" && (!Number.isSafeInteger(stage.groupCount) || (stage.groupCount ?? 0) < 1)) fail(`stage_group_count_required:${stage.id}`);
    if (!stage.points || [stage.points.win, stage.points.draw, stage.points.loss].some((score) => !Number.isSafeInteger(score) || score < 0)) fail(`stage_points_required:${stage.id}`);
    if (!Array.isArray(stage.tieBreakers) || stage.tieBreakers.length === 0) fail(`stage_tie_breakers_required:${stage.id}`);
    const seen = new Set<string>();
    for (const tiebreak of stage.tieBreakers) {
      if (!tiebreak?.criterion?.trim() || !["asc", "desc"].includes(tiebreak.direction) || seen.has(tiebreak.criterion)) fail(`stage_tie_breaker_invalid:${stage.id}`);
      seen.add(tiebreak.criterion);
      if (!tieBreakCriteria.has(tiebreak.criterion)) fail(`stage_tie_breaker_unsupported:${stage.id}:${tiebreak.criterion}`);
    }
    if (stage.tieBreakers[0]?.criterion !== "points" || stage.tieBreakers.at(-1)?.criterion !== "entryId" || stage.tieBreakers.at(-1)?.direction !== "asc") fail(`stage_tie_breaker_order_invalid:${stage.id}`);
  }
  if (stage.kind === "knockout") {
    const tie = stage.tieResolution;
    if (!tie || ![1, 2].includes(tie.legs) || typeof tie.aggregateGoals !== "boolean" || typeof tie.extraTime !== "boolean" || typeof tie.penalties !== "boolean" || !["not_used", "used"].includes(tie.awayGoals) || !["incomplete", "replay", "administrator_decision"].includes(tie.unresolved)) fail(`knockout_resolution_incomplete:${stage.id}`);
    if ((tie.legs === 2) !== tie.aggregateGoals) fail(`aggregate_only_for_two_leg_tie:${stage.id}`);
  }
}

export function rulesetStandingsSupport(ruleset: SoccerCompetitionRuleset): { supported: boolean; reason?: string } {
  if (ruleset.stages.some((stage) => stage.kind !== "league")) return { supported: false, reason: "standings_stage_not_supported" };
  if (ruleset.stages.length !== 1) return { supported: false, reason: "multi_stage_standings_not_supported" };
  return { supported: true };
}
