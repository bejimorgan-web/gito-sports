import type Database from "better-sqlite3";
import type {
  FixtureConfidence,
  FixtureReconciliationCandidate,
  FixtureReconciliationDecision,
  FixtureReconciliationPreview
} from "@gito/shared";
import { getDatabase } from "../db/connection.js";

export interface SchedulingMatchRow {
  id: string;
  competition_id: string;
  season_id: string | null;
  home_team_id: string;
  away_team_id: string;
  kickoff_time: string;
  venue_name: string | null;
  external_provider: string | null;
  external_match_id: string | null;
}

interface CanonicalMatchRow {
  id: string;
  competition_id: string;
  season_id: string | null;
  home_team_id: string;
  away_team_id: string;
  starts_at: string;
  venue_name: string | null;
  external_provider: string | null;
  external_match_id: string | null;
}

const DEFAULT_KICKOFF_TOLERANCE_MS = 2 * 60 * 60 * 1000;
const HIGH_CONFIDENCE_KICKOFF_TOLERANCE_MS = 15 * 60 * 1000;

function normalizeProvider(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeExternalId(value: string | null | undefined) {
  return value?.trim() || null;
}

function kickoffDeltaMs(legacy: SchedulingMatchRow, canonical: CanonicalMatchRow) {
  const legacyTime = Date.parse(legacy.kickoff_time);
  const canonicalTime = Date.parse(canonical.starts_at);
  if (Number.isNaN(legacyTime) || Number.isNaN(canonicalTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(legacyTime - canonicalTime);
}

function confidenceForDelta(deltaMs: number): FixtureConfidence {
  return deltaMs <= HIGH_CONFIDENCE_KICKOFF_TOLERANCE_MS ? "high" : "medium";
}

export class FixtureReconciliationService {
  constructor(
    private readonly database: Database = getDatabase(),
    private readonly kickoffToleranceMs = DEFAULT_KICKOFF_TOLERANCE_MS
  ) {}

  listSchedulingMatches(): SchedulingMatchRow[] {
    return this.database.prepare(`
      SELECT id, competition_id, season_id, home_team_id, away_team_id, kickoff_time,
             venue_name, external_provider, external_match_id
      FROM scheduling_matches ORDER BY kickoff_time ASC, id ASC
    `).all() as SchedulingMatchRow[];
  }

  reconcile(row: SchedulingMatchRow): FixtureReconciliationDecision {
    const allMatches = this.database.prepare(`
      SELECT id, competition_id, season_id, home_team_id, away_team_id, starts_at,
             venue_name, external_provider, external_match_id
      FROM matches
    `).all() as CanonicalMatchRow[];
    const legacyProvider = normalizeProvider(row.external_provider);
    const legacyExternalId = normalizeExternalId(row.external_match_id);

    if (legacyProvider && legacyExternalId) {
      const externalCandidates = allMatches.filter((candidate) =>
        normalizeProvider(candidate.external_provider) === legacyProvider &&
        normalizeExternalId(candidate.external_match_id) === legacyExternalId
      );
      if (externalCandidates.length === 1) {
        const candidate = externalCandidates[0]!;
        const reasons = ["same trusted external provider identity"];
        if (candidate.competition_id === row.competition_id) reasons.push("same competition");
        if (row.season_id && candidate.season_id === row.season_id) reasons.push("same season");
        return this.decision(row.id, [candidate], candidate.id, "high", "linked", reasons);
      }
      if (externalCandidates.length > 1) {
        return this.decision(row.id, externalCandidates, undefined, "low", "ambiguous", ["external provider identity matched multiple canonical fixtures"]);
      }
    }

    const catalogCandidates = allMatches.filter((candidate) => {
      if (candidate.competition_id !== row.competition_id) return false;
      if (row.season_id && candidate.season_id !== row.season_id) return false;
      if (candidate.home_team_id !== row.home_team_id || candidate.away_team_id !== row.away_team_id) return false;
      return kickoffDeltaMs(row, candidate) <= this.kickoffToleranceMs;
    });

    const candidates = catalogCandidates.map((candidate) => {
      const delta = kickoffDeltaMs(row, candidate);
      const reasons = ["same competition", "same home team", "same away team", `kickoff difference ${Math.round(delta / 60000)} minutes`];
      if (row.season_id && candidate.season_id === row.season_id) reasons.push("same season");
      if (row.venue_name && candidate.venue_name && row.venue_name.trim().toLowerCase() === candidate.venue_name.trim().toLowerCase()) reasons.push("same venue");
      return { candidate, confidence: confidenceForDelta(delta), reasons };
    }).sort((left, right) => kickoffDeltaMs(row, left.candidate) - kickoffDeltaMs(row, right.candidate));

    if (candidates.length === 1) {
      const selected = candidates[0]!;
      const selectedConfidence = selected.confidence;
      return this.decision(row.id, candidates.map((item) => item.candidate), selectedConfidence === "high" ? selected.candidate.id : undefined, selectedConfidence, selectedConfidence === "high" ? "linked" : "unresolved", selected.reasons);
    }

    if (candidates.length > 1) {
      return this.decision(row.id, candidates.map((item) => item.candidate), undefined, "low", "ambiguous", ["multiple canonical fixtures share the catalog identity within the kickoff tolerance", "manual review required"]);
    }

    return this.decision(row.id, [], undefined, "low", "unresolved", ["no canonical fixture matched competition, season, team IDs, and bounded kickoff tolerance"]);
  }

  preview(rows = this.listSchedulingMatches()): FixtureReconciliationPreview {
    const decisions = rows.map((row) => this.reconcile(row));
    return {
      decisions,
      summary: {
        total: decisions.length,
        highConfidence: decisions.filter((decision) => decision.confidence === "high").length,
        mediumConfidence: decisions.filter((decision) => decision.confidence === "medium").length,
        lowConfidence: decisions.filter((decision) => decision.confidence === "low").length,
        linked: decisions.filter((decision) => decision.linkStatus === "linked").length,
        unresolved: decisions.filter((decision) => decision.linkStatus === "unresolved").length,
        ambiguous: decisions.filter((decision) => decision.linkStatus === "ambiguous").length
      }
    };
  }

  private decision(schedulingMatchId: string, rows: CanonicalMatchRow[], selectedMatchId: string | undefined, confidence: FixtureConfidence, linkStatus: FixtureReconciliationDecision["linkStatus"], reasons: string[]): FixtureReconciliationDecision {
    const candidates: FixtureReconciliationCandidate[] = rows.map((row) => ({ matchId: row.id, confidence, reasons }));
    return {
      schedulingMatchId,
      candidateMatchIds: rows.map((row) => row.id),
      ...(selectedMatchId ? { selectedMatchId } : {}),
      confidence,
      linkStatus,
      reasons,
      candidates
    };
  }
}

export function previewFixtureReconciliation(database?: Database) {
  return new FixtureReconciliationService(database).preview();
}
