import type { FixtureConfidence, FixtureLinkStatus } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import type { FixtureReconciliationDecision } from "@gito/shared";

export interface SchedulingMatchLink {
  schedulingMatchId: string;
  matchId: string;
  linkStatus: FixtureLinkStatus;
  confidence: FixtureConfidence;
  linkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapLink(row: any): SchedulingMatchLink {
  return {
    schedulingMatchId: row.scheduling_match_id,
    matchId: row.match_id,
    linkStatus: row.link_status,
    confidence: row.confidence,
    linkedAt: row.linked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getSchedulingMatchLink(schedulingMatchId: string, database = getDatabase()): SchedulingMatchLink | undefined {
  const row = database.prepare("SELECT * FROM scheduling_match_links WHERE scheduling_match_id = ?").get(schedulingMatchId);
  return row ? mapLink(row) : undefined;
}

export function listSchedulingMatchLinks(database = getDatabase()): SchedulingMatchLink[] {
  return (database.prepare("SELECT * FROM scheduling_match_links ORDER BY created_at ASC").all() as any[]).map(mapLink);
}

export function createHighConfidenceLink(decision: FixtureReconciliationDecision, database: any = getDatabase()): SchedulingMatchLink {
  if (decision.linkStatus !== "linked" || decision.confidence !== "high" || !decision.selectedMatchId) {
    throw new Error("fixture_link_requires_high_confidence");
  }

  const existingScheduling = getSchedulingMatchLink(decision.schedulingMatchId, database);
  if (existingScheduling) throw new Error("scheduling_match_link_exists");
  const existingCanonical = database.prepare("SELECT scheduling_match_id FROM scheduling_match_links WHERE match_id = ?").get(decision.selectedMatchId);
  if (existingCanonical) throw new Error("canonical_match_link_exists");

  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO scheduling_match_links (scheduling_match_id, match_id, link_status, confidence, linked_at, created_at, updated_at)
    VALUES (?, ?, 'linked', 'high', ?, ?, ?)
  `).run(decision.schedulingMatchId, decision.selectedMatchId, timestamp, timestamp, timestamp);
  return getSchedulingMatchLink(decision.schedulingMatchId, database)!;
}

export function applyHighConfidenceLinks(decisions: FixtureReconciliationDecision[], database: any = getDatabase()): { applied: SchedulingMatchLink[]; skipped: Array<{ schedulingMatchId: string; reason: string }> } {
  const applied: SchedulingMatchLink[] = [];
  const skipped: Array<{ schedulingMatchId: string; reason: string }> = [];
  const transaction = database.transaction(() => {
    for (const decision of decisions) {
      if (decision.linkStatus !== "linked" || decision.confidence !== "high" || !decision.selectedMatchId) {
        skipped.push({ schedulingMatchId: decision.schedulingMatchId, reason: "only high-confidence decisions can be applied" });
        continue;
      }
      try {
        applied.push(createHighConfidenceLink(decision, database));
      } catch (error) {
        skipped.push({ schedulingMatchId: decision.schedulingMatchId, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  transaction();
  return { applied, skipped };
}
