import { Router } from "express";
import crypto from "node:crypto";
import { soccerCompetitionFormats, type SoccerCompetitionRuleset } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { protectedRoute, type AuthenticatedRequest } from "../middleware/protected.js";
import { validateSoccerCompetitionRuleset } from "../services/soccer-ruleset-validation.js";

export const soccerRulesetsRouter = Router();
function admin(request: AuthenticatedRequest, response: any, next: () => void) {
  if (request.operator?.role !== "admin") { response.status(403).json({ error: "admin_required" }); return; }
  next();
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }

soccerRulesetsRouter.get("/formats", (_request, response) => response.json({ data: soccerCompetitionFormats }));
soccerRulesetsRouter.get("/competitions/:competitionId", (request, response) => {
  const rows = getDatabase().prepare(`SELECT id, competition_id AS competitionId, version, format_template_id AS formatTemplateId,
    ruleset_json AS ruleset, ruleset_hash AS rulesetHash, status, proposed_by_operator_id AS proposedByOperatorId,
    proposed_at AS proposedAt, approved_by_operator_id AS approvedByOperatorId, approved_at AS approvedAt
    FROM competition_soccer_rulesets WHERE competition_id = ? ORDER BY version DESC`).all(String(request.params.competitionId ?? ""));
  response.json({ data: rows.map((row: any) => ({ ...row, ruleset: JSON.parse(row.ruleset) })) });
});

soccerRulesetsRouter.post("/competitions/:competitionId", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  const operatorId = request.operator?.id;
  const ruleset = request.body?.ruleset;
  if (!validId(competitionId) || !operatorId) { response.status(400).json({ error: "soccer_ruleset_proposal_invalid" }); return; }
  try {
    validateSoccerCompetitionRuleset(ruleset);
    const database = getDatabase();
    const competition = database.prepare(`SELECT c.id, s.slug AS sport_slug FROM competitions c JOIN sports s ON s.id = c.sport_id WHERE c.id = ?`).get(competitionId) as { id: string; sport_slug: string } | undefined;
    if (!competition) { response.status(404).json({ error: "competition_not_found" }); return; }
    if (!/^(soccer|football)$/.test(competition.sport_slug.toLowerCase())) { response.status(409).json({ error: "competition_sport_is_not_soccer" }); return; }
    const version = Number((database.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM competition_soccer_rulesets WHERE competition_id = ?").get(competitionId) as any).next);
    const id = crypto.randomUUID(); const proposedAt = new Date().toISOString();
    const json = stableJson(ruleset);
    database.prepare(`INSERT INTO competition_soccer_rulesets (id, competition_id, version, format_template_id, ruleset_json,
      ruleset_hash, status, proposed_by_operator_id, proposed_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, competitionId, version, ruleset.formatTemplateId, json, hash(json), operatorId, proposedAt);
    response.status(201).json({ data: { id, competitionId, version, formatTemplateId: ruleset.formatTemplateId, status: "pending", proposedAt } });
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : "soccer_ruleset_invalid" }); }
});

soccerRulesetsRouter.post("/competitions/:competitionId/:rulesetId/approve", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const { competitionId, rulesetId } = request.params as { competitionId: string; rulesetId: string };
  const operatorId = request.operator?.id;
  if (!validId(competitionId) || !validId(rulesetId) || !operatorId) { response.status(400).json({ error: "soccer_ruleset_approval_invalid" }); return; }
  const database = getDatabase(); const now = new Date().toISOString();
  const transaction = database.transaction(() => {
    const update = database.prepare(`UPDATE competition_soccer_rulesets SET status = 'approved', approved_by_operator_id = ?, approved_at = ?
      WHERE id = ? AND competition_id = ? AND status = 'pending' AND proposed_by_operator_id <> ?`).run(operatorId, now, rulesetId, competitionId, operatorId);
    if (update.changes !== 1) return false;
    const row = database.prepare("SELECT format_template_id FROM competition_soccer_rulesets WHERE id = ?").get(rulesetId) as { format_template_id: string };
    database.prepare("UPDATE competitions SET default_soccer_ruleset_id = ?, default_soccer_format_id = ?, updated_at = ? WHERE id = ?")
      .run(rulesetId, row.format_template_id, now, competitionId);
    return true;
  });
  if (!transaction()) { response.status(409).json({ error: "soccer_ruleset_requires_second_admin_or_is_not_pending" }); return; }
  response.json({ data: { id: rulesetId, status: "approved", approvedByOperatorId: operatorId, approvedAt: now } });
});

soccerRulesetsRouter.post("/competitions/:competitionId/seasons/:seasonId/pin", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const { competitionId, seasonId } = request.params as { competitionId: string; seasonId: string };
  const sourceId = request.body?.rulesetId; const operatorId = request.operator?.id;
  if (!validId(competitionId) || !validId(seasonId) || !validId(sourceId) || !operatorId) { response.status(400).json({ error: "season_soccer_ruleset_pin_invalid" }); return; }
  const database = getDatabase();
  const source = database.prepare(`SELECT * FROM competition_soccer_rulesets WHERE id = ? AND competition_id = ? AND status = 'approved'`).get(sourceId, competitionId) as any;
  if (!source) { response.status(409).json({ error: "approved_competition_ruleset_required" }); return; }
  try { validateSoccerCompetitionRuleset(JSON.parse(source.ruleset_json)); }
  catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : "soccer_ruleset_invalid" }); return; }
  const version = Number((database.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM season_soccer_rulesets WHERE competition_id = ? AND season_id = ?").get(competitionId, seasonId) as any).next);
  const id = crypto.randomUUID(); const proposedAt = new Date().toISOString();
  try {
    database.prepare(`INSERT INTO season_soccer_rulesets (id, competition_id, season_id, source_ruleset_id, version,
      format_template_id, ruleset_json, ruleset_hash, status, proposed_by_operator_id, proposed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, competitionId, seasonId, source.id, version, source.format_template_id, source.ruleset_json, source.ruleset_hash, operatorId, proposedAt);
    response.status(201).json({ data: { id, competitionId, seasonId, sourceRulesetId: source.id, version, formatTemplateId: source.format_template_id, status: "pending", proposedAt } });
  } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "season_soccer_ruleset_pin_conflict" }); }
});

soccerRulesetsRouter.post("/competitions/:competitionId/seasons/:seasonId/:seasonRulesetId/approve", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const { competitionId, seasonId, seasonRulesetId } = request.params as { competitionId: string; seasonId: string; seasonRulesetId: string };
  const operatorId = request.operator?.id;
  if (!validId(competitionId) || !validId(seasonId) || !validId(seasonRulesetId) || !operatorId) { response.status(400).json({ error: "season_soccer_ruleset_approval_invalid" }); return; }
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`UPDATE season_soccer_rulesets SET status = 'approved', approved_by_operator_id = ?, approved_at = ?
    WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'pending' AND proposed_by_operator_id <> ?`)
    .run(operatorId, now, seasonRulesetId, competitionId, seasonId, operatorId);
  if (result.changes !== 1) { response.status(409).json({ error: "season_ruleset_requires_second_admin_or_is_not_pending" }); return; }
  response.json({ data: { id: seasonRulesetId, status: "approved", approvedByOperatorId: operatorId, approvedAt: now } });
});

soccerRulesetsRouter.get("/competitions/:competitionId/seasons/:seasonId", (request, response) => {
  const rows = getDatabase().prepare(`SELECT id, competition_id AS competitionId, season_id AS seasonId, source_ruleset_id AS sourceRulesetId,
    version, format_template_id AS formatTemplateId, ruleset_json AS ruleset, ruleset_hash AS rulesetHash, status,
    proposed_by_operator_id AS proposedByOperatorId, proposed_at AS proposedAt, approved_by_operator_id AS approvedByOperatorId,
    approved_at AS approvedAt FROM season_soccer_rulesets WHERE competition_id = ? AND season_id = ? ORDER BY version DESC`)
    .all(String(request.params.competitionId ?? ""), String(request.params.seasonId ?? ""));
  response.json({ data: rows.map((row: any) => ({ ...row, ruleset: JSON.parse(row.ruleset) })) });
});

// Qualification allocations are season-specific and immutable after independent approval.
soccerRulesetsRouter.post("/qualification-routes", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const operatorId = request.operator?.id; const route = request.body?.route;
  if (!operatorId || !route || !validId(route.id) || !validId(route.sourceCompetitionId) || !validId(route.sourceSeasonId)
    || !validId(route.destinationCompetitionId) || !validId(route.destinationSeasonId) || !validId(route.destinationStageId)) {
    response.status(400).json({ error: "qualification_route_invalid" }); return;
  }
  try {
    if (!Number.isSafeInteger(route.slots) || route.slots < 1 || !["final_position", "champion", "cup_winner", "playoff"].includes(route.source?.type)
      || !["deduplicate", "allow"].includes(route.duplicatePolicy) || !["leave_vacant", "configured_route"].includes(route.vacancyPolicy)
      || !Array.isArray(route.eligibility) || route.eligibility.length === 0
      || route.eligibility.some((condition: unknown) => typeof condition !== "string" || !condition.trim())
      || (route.source.type === "final_position" && (!Array.isArray(route.source.positions) || route.source.positions.length !== route.slots || route.source.positions.some((position: unknown) => !Number.isSafeInteger(position) || Number(position) < 1)))) throw new Error("qualification_route_rules_incomplete");
    const database = getDatabase();
    const sourceRuleset = database.prepare(`SELECT ruleset_json AS rulesetJson FROM season_soccer_rulesets
      WHERE competition_id = ? AND season_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`).get(route.sourceCompetitionId, route.sourceSeasonId) as { rulesetJson: string } | undefined;
    if (!sourceRuleset) throw new Error("source_season_ruleset_not_approved");
    const configured = (JSON.parse(sourceRuleset.rulesetJson) as SoccerCompetitionRuleset).qualificationRoutes.find(({ id }) => id === route.id);
    const { sourceCompetitionId: _sourceCompetitionId, sourceSeasonId: _sourceSeasonId, ...definition } = route;
    if (!configured || stableJson(configured) !== stableJson(definition)) throw new Error("qualification_route_must_match_the_approved_source_season_configuration");
    if (route.vacancyPolicy === "configured_route" && !(JSON.parse(sourceRuleset.rulesetJson) as SoccerCompetitionRuleset).qualificationRoutes.some(({ id }) => id === route.replacementRouteId)) throw new Error("qualification_replacement_route_not_configured");
    const destinationRuleset = database.prepare(`SELECT ruleset_json AS rulesetJson FROM season_soccer_rulesets
      WHERE competition_id = ? AND season_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1`).get(route.destinationCompetitionId, route.destinationSeasonId) as { rulesetJson: string } | undefined;
    if (!destinationRuleset || !(JSON.parse(destinationRuleset.rulesetJson) as SoccerCompetitionRuleset).stages.some(({ id }) => id === route.destinationStageId)) throw new Error("approved_destination_stage_not_found");
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO soccer_qualification_routes (id, source_competition_id, source_season_id, destination_competition_id,
      destination_season_id, destination_stage_id, route_json, status, proposed_by_operator_id, proposed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(route.id, route.sourceCompetitionId, route.sourceSeasonId, route.destinationCompetitionId, route.destinationSeasonId,
        route.destinationStageId, stableJson(route), operatorId, now);
    response.status(201).json({ data: { id: route.id, status: "pending", proposedAt: now } });
  } catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : "qualification_route_rejected" }); }
});

soccerRulesetsRouter.post("/qualification-routes/:routeId/approve", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const operatorId = request.operator?.id; const routeId = String(request.params.routeId ?? "");
  if (!operatorId || !validId(routeId)) { response.status(400).json({ error: "qualification_route_approval_invalid" }); return; }
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`UPDATE soccer_qualification_routes SET status = 'approved', approved_by_operator_id = ?, approved_at = ?
    WHERE id = ? AND status = 'pending' AND proposed_by_operator_id <> ?`).run(operatorId, now, routeId, operatorId);
  if (result.changes !== 1) { response.status(409).json({ error: "qualification_route_requires_second_admin_or_is_not_pending" }); return; }
  response.json({ data: { id: routeId, status: "approved", approvedByOperatorId: operatorId, approvedAt: now } });
});

soccerRulesetsRouter.post("/qualification-routes/:routeId/decisions", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const operatorId = request.operator?.id;
  const routeId = String(request.params.routeId ?? "");
  const { snapshotId, slotNumber, teamId, eligibilityConfirmed, eligibilityEvidence } = request.body ?? {};
  if (!operatorId || !validId(routeId) || !validId(snapshotId) || !validId(teamId) || !Number.isSafeInteger(slotNumber) || slotNumber < 1
    || eligibilityConfirmed !== true || !Array.isArray(eligibilityEvidence) || eligibilityEvidence.length === 0
    || eligibilityEvidence.some((item: unknown) => typeof item !== "string" || !item.trim())) {
    response.status(400).json({ error: "qualification_decision_invalid" }); return;
  }
  const database = getDatabase();
  const route = database.prepare("SELECT * FROM soccer_qualification_routes WHERE id = ? AND status = 'approved'").get(routeId) as any;
  const snapshot = database.prepare("SELECT * FROM standings_snapshots WHERE id = ? AND is_complete = 1").get(snapshotId) as any;
  const coverage = database.prepare(`SELECT eligibility_state AS eligibilityState, schedule_state AS scheduleState, is_finalized AS isFinalized
    FROM standings_coverage_assessments WHERE snapshot_id = ? ORDER BY sequence DESC LIMIT 1`).get(snapshotId) as any;
  if (!route || slotNumber > Number(JSON.parse(route.route_json).slots) || !snapshot || !coverage || coverage.eligibilityState !== "eligible" || coverage.scheduleState !== "verified_complete" || coverage.isFinalized !== 1
    || snapshot.competition_id !== route.source_competition_id || snapshot.season_id !== route.source_season_id) {
    response.status(409).json({ error: "qualification_requires_approved_route_and_final_complete_source_standings" }); return;
  }
  const content = JSON.parse(snapshot.content_json);
  const snapshotRuleset = content.seasonSoccerRuleset as { id?: string; version?: number; rulesetHash?: string } | undefined;
  const rulesPin = snapshotRuleset?.rulesetHash ? database.prepare(`SELECT ruleset_hash AS rulesetHash FROM season_soccer_rulesets
    WHERE id = ? AND competition_id = ? AND season_id = ? AND status = 'approved'`)
    .get(snapshotRuleset.id, route.source_competition_id, route.source_season_id) as { rulesetHash: string } | undefined : undefined;
  if (!rulesPin || rulesPin.rulesetHash !== snapshotRuleset?.rulesetHash) { response.status(409).json({ error: "source_snapshot_does_not_use_an_approved_pinned_season_ruleset" }); return; }
  const calculationRows = content.calculation?.rows as Array<{ entryId: string; rank: number }> | undefined;
  const entries = content.calculationInput?.entries as Array<{ id: string; teamId?: string }> | undefined;
  const entryToTeam = new Map((entries ?? []).map((entry) => [entry.id, entry.teamId]));
  const ranks = new Map((calculationRows ?? []).map((row) => [entryToTeam.get(row.entryId), row.rank]));
  const rank = ranks.get(teamId);
  const rule = JSON.parse(route.route_json);
  if (rule.source?.type !== "final_position") { response.status(409).json({ error: "qualification_source_requires_unsupported_champion_or_playoff_calculation" }); return; }
  if (!rank || rule.source.positions?.[slotNumber - 1] !== rank
    || (!database.prepare("SELECT 1 FROM competition_season_teams WHERE competition_id = ? AND season_id = ? AND team_id = ? AND membership_status = 'active'")
      .get(route.source_competition_id, route.source_season_id, teamId))) {
    response.status(409).json({ error: "team_not_eligible_under_final_standings_and_route" }); return;
  }
  const current = database.prepare("SELECT state, team_id AS teamId FROM soccer_qualification_decisions WHERE route_id = ? AND slot_number = ?")
    .get(routeId, slotNumber) as { state: string; teamId: string } | undefined;
  if (current?.state === "confirmed") { response.status(409).json({ error: "qualification_slot_already_confirmed" }); return; }
  if (current && current.teamId !== teamId) { response.status(409).json({ error: "qualification_slot_has_different_candidate" }); return; }
  if (rule.duplicatePolicy === "deduplicate" && database.prepare("SELECT 1 FROM soccer_qualification_decisions WHERE route_id = ? AND slot_number <> ? AND team_id = ? AND state IN ('provisional', 'confirmed')")
    .get(routeId, slotNumber, teamId)) { response.status(409).json({ error: "team_already_assigned_to_another_route_slot" }); return; }
  if (rule.duplicatePolicy === "deduplicate" && database.prepare(`SELECT 1 FROM soccer_qualification_decisions d
    JOIN soccer_qualification_routes other ON other.id = d.route_id
    WHERE d.team_id = ? AND d.state = 'confirmed' AND other.destination_competition_id = ? AND other.destination_season_id = ?`)
    .get(teamId, route.destination_competition_id, route.destination_season_id)) {
    response.status(409).json({ error: "team_already_confirmed_for_destination" }); return;
  }
  const decisionJson = stableJson({ rank, position: rank, route: rule, destinationCompetitionId: route.destination_competition_id,
    destinationSeasonId: route.destination_season_id, destinationStageId: route.destination_stage_id, sourceSnapshotHash: snapshot.content_hash,
    sourceRulesetHash: rulesPin.rulesetHash, sourceSeasonRulesetId: snapshotRuleset.id, sourceSeasonRulesetVersion: snapshotRuleset.version,
    eligibilityConfirmed, eligibilityEvidence });
  const id = crypto.randomUUID();
  if (current) {
    const existingDecision = database.prepare("SELECT id FROM soccer_qualification_decisions WHERE route_id = ? AND slot_number = ?").get(routeId, slotNumber) as { id: string };
    response.json({ data: { id: existingDecision.id, state: "provisional", rank } });
    return;
  }
  database.prepare(`INSERT INTO soccer_qualification_decisions (id, route_id, source_snapshot_id, source_ruleset_hash, slot_number,
    team_id, state, decision_json) VALUES (?, ?, ?, ?, ?, ?, 'provisional', ?)`)
    .run(id, routeId, snapshotId, rulesPin.rulesetHash, slotNumber, teamId, decisionJson);
  response.status(201).json({ data: { id, routeId, slotNumber, teamId, rank, state: "provisional", message: "A different administrator must confirm this qualification." } });
});

soccerRulesetsRouter.post("/qualification-routes/:routeId/decisions/:decisionId/confirm", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const operatorId = request.operator?.id;
  const { routeId, decisionId } = request.params as { routeId: string; decisionId: string };
  if (!operatorId || !validId(routeId) || !validId(decisionId)) { response.status(400).json({ error: "qualification_decision_confirmation_invalid" }); return; }
  const now = new Date().toISOString();
  try {
    const database = getDatabase();
    const result = database.transaction(() => {
      const decision = database.prepare(`SELECT d.team_id AS teamId, r.destination_competition_id AS competitionId, r.destination_season_id AS seasonId
        FROM soccer_qualification_decisions d JOIN soccer_qualification_routes r ON r.id = d.route_id
        WHERE d.id = ? AND d.route_id = ? AND d.state = 'provisional'`).get(decisionId, routeId) as
        { teamId: string; competitionId: string; seasonId: string } | undefined;
      if (!decision) return false;
      const destination = database.prepare("SELECT sport_id, participant_type FROM competitions WHERE id = ?").get(decision.competitionId) as { sport_id: string; participant_type: string } | undefined;
      const season = database.prepare("SELECT 1 FROM seasons WHERE id = ? AND competition_id = ?").get(decision.seasonId, decision.competitionId);
      const team = database.prepare("SELECT sport_id, type FROM teams WHERE id = ?").get(decision.teamId) as { sport_id: string; type: string } | undefined;
      const expectedType = destination?.participant_type === "nationalTeams" ? "national" : destination?.participant_type === "clubs" ? "club" : "custom";
      if (!destination || !season || !team || team.sport_id !== destination.sport_id || (expectedType !== "custom" && team.type !== expectedType)) {
        throw new Error("qualified_team_is_not_eligible_for_destination_season");
      }
      const updated = database.prepare(`UPDATE soccer_qualification_decisions SET state = 'confirmed', decided_by_operator_id = ?, decided_at = ?
        WHERE id = ? AND route_id = ? AND state = 'provisional'`).run(operatorId, now, decisionId, routeId);
      if (updated.changes !== 1) return false;
      database.prepare("INSERT OR IGNORE INTO competition_teams (id, competition_id, team_id, created_at) VALUES (?, ?, ?, ?)")
        .run(crypto.randomUUID(), decision.competitionId, decision.teamId, now);
      database.prepare(`INSERT OR IGNORE INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)`)
        .run(crypto.randomUUID(), decision.competitionId, decision.seasonId, decision.teamId, now, now);
      return true;
    })();
    if (!result) { response.status(409).json({ error: "qualification_decision_not_provisional" }); return; }
    response.json({ data: { id: decisionId, state: "confirmed", decidedByOperatorId: operatorId, decidedAt: now } });
  } catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "qualification_confirmation_rejected" }); }
});

soccerRulesetsRouter.post("/qualification-routes/:routeId/vacancies", protectedRoute, admin, (request: AuthenticatedRequest, response) => {
  const operatorId = request.operator?.id; const routeId = String(request.params.routeId ?? "");
  const { snapshotId, slotNumber, reason } = request.body ?? {};
  if (!operatorId || !validId(routeId) || !validId(snapshotId) || !Number.isSafeInteger(slotNumber) || slotNumber < 1 || typeof reason !== "string" || !reason.trim()) {
    response.status(400).json({ error: "qualification_vacancy_invalid" }); return;
  }
  const database = getDatabase();
  const route = database.prepare("SELECT * FROM soccer_qualification_routes WHERE id = ? AND status = 'approved'").get(routeId) as any;
  const rule = route ? JSON.parse(route.route_json) : undefined;
  const snapshot = database.prepare("SELECT competition_id, season_id, content_hash, content_json, is_complete FROM standings_snapshots WHERE id = ?").get(snapshotId) as any;
  const coverage = database.prepare(`SELECT eligibility_state AS eligibilityState, schedule_state AS scheduleState, is_finalized AS isFinalized
    FROM standings_coverage_assessments WHERE snapshot_id = ? ORDER BY sequence DESC LIMIT 1`).get(snapshotId) as any;
  if (!route || rule.vacancyPolicy !== "leave_vacant" || slotNumber > rule.slots || !snapshot || snapshot.competition_id !== route.source_competition_id
    || snapshot.season_id !== route.source_season_id || snapshot.is_complete !== 1 || !coverage || coverage.eligibilityState !== "eligible"
    || coverage.scheduleState !== "verified_complete" || coverage.isFinalized !== 1) {
    response.status(409).json({ error: "vacancy_requires_leave_vacant_policy_and_final_complete_standings" }); return;
  }
  if (database.prepare("SELECT 1 FROM soccer_qualification_decisions WHERE route_id = ? AND slot_number = ?").get(routeId, slotNumber)) {
    response.status(409).json({ error: "qualification_slot_already_decided" }); return;
  }
  const snapshotRuleset = JSON.parse(snapshot.content_json).seasonSoccerRuleset as { id?: string; rulesetHash?: string } | undefined;
  const seasonRuleset = snapshotRuleset?.id ? database.prepare(`SELECT ruleset_hash AS rulesetHash FROM season_soccer_rulesets
    WHERE competition_id = ? AND season_id = ? AND id = ? AND status = 'approved'`).get(route.source_competition_id, route.source_season_id, snapshotRuleset.id) as { rulesetHash: string } | undefined : undefined;
  if (!seasonRuleset || seasonRuleset.rulesetHash !== snapshotRuleset?.rulesetHash) { response.status(409).json({ error: "source_snapshot_ruleset_not_approved" }); return; }
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  database.prepare(`INSERT INTO soccer_qualification_decisions (id, route_id, source_snapshot_id, source_ruleset_hash, slot_number,
    team_id, state, decision_json, decided_by_operator_id, decided_at) VALUES (?, ?, ?, ?, ?, NULL, 'vacant', ?, ?, ?)`)
    .run(id, routeId, snapshotId, seasonRuleset.rulesetHash, slotNumber, stableJson({ state: "vacant", reason: reason.trim(), decidedByOperatorId: operatorId }), operatorId, now);
  response.status(201).json({ data: { id, routeId, slotNumber, state: "vacant", reason: reason.trim(), decidedByOperatorId: operatorId, decidedAt: now } });
});

export function parseSoccerRuleset(value: string): SoccerCompetitionRuleset { return JSON.parse(value) as SoccerCompetitionRuleset; }
