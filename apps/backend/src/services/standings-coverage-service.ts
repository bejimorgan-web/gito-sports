import crypto from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import {
  getScheduleManifest,
  type ScheduleManifestFixture,
  type ScheduleManifestFinding
} from "./standings-schedule-manifest-service.js";

export interface CoverageScope {
  type: string;
  competitionId: string;
  seasonId: string;
}

export type ExcludableFixtureStatus = "cancelled" | "postponed";

export interface CoverageExclusion {
  matchId: string;
  status: ExcludableFixtureStatus;
  reason: string;
}

export interface CoveragePolicy {
  allowedExclusionStatuses: readonly ExcludableFixtureStatus[];
}

export interface CoverageRevisionSelection {
  matchId: string;
  revisionId: string;
}

export interface AssessStandingsCoverageInput {
  scope: CoverageScope;
  snapshotId: string;
  policy: CoveragePolicy;
  exclusions: readonly CoverageExclusion[];
  revisionSelections?: readonly CoverageRevisionSelection[];
  manifestVersionId?: string;
  assessedAt?: string;
}

export type FixtureCoverageState =
  | "required_pending"
  | "required_covered"
  | "explicitly_excluded"
  | "unresolved_ambiguous";

export interface CoverageParticipantAssignment {
  entryId: string;
  slot: string;
  competitorType: string;
  teamId: string | null;
}

export interface FixtureCoverageDecision {
  fixtureId: string;
  fixtureStatus: string;
  homeTeamId: string;
  awayTeamId: string;
  participantAssignments: CoverageParticipantAssignment[];
  state: FixtureCoverageState;
  selectedRevisionId: string | null;
  reasonCode: string;
  reason: string;
}

export interface CoverageBlockingReason {
  code: string;
  message: string;
  fixtureId?: string;
}

export interface StandingsCoverageAssessment {
  id: string;
  sequence: number;
  competitionId: string;
  seasonId: string;
  scopeType: "competition_season";
  snapshotId: string;
  manifestVersionId: string | null;
  scheduleState: "unverified" | "incomplete" | "invalid" | "verified_complete";
  policy: CoveragePolicy;
  eligible: boolean;
  blockingReasons: CoverageBlockingReason[];
  decisions: FixtureCoverageDecision[];
  manifestDecisions: Array<{
    fixtureKey: string;
    canonicalMatchId: string | null;
    state: FixtureCoverageState;
    selectedRevisionId: string | null;
    reasonCode: string;
    reason: string;
  }>;
  manifestFindings: ScheduleManifestFinding[];
  assessedAt: string;
  contentHash: string;
  contentJson: string;
}

interface SnapshotRow {
  id: string;
  competition_id: string;
  season_id: string;
  is_complete: number;
}

interface FixtureRow {
  id: string;
  competition_id: string;
  season_id: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
}

interface ParticipantRow {
  match_id: string;
  slot: string;
  entry_id: string;
  entry_type: string;
  team_id: string | null;
}

interface RevisionRow {
  id: string;
  match_id: string;
  competition_id: string;
  season_id: string;
  home_team_id: string;
  away_team_id: string;
  result_status: string;
  final_result_confirmed: number;
  validation_state: string;
  home_score: number;
  away_score: number;
  revision_number: number;
}

interface SnapshotRevisionRow {
  match_id: string;
  revision_id: string;
  revision_number: number;
}

interface ManifestDecisionInput {
  fixture: ScheduleManifestFixture;
  decision: FixtureCoverageDecision;
}

const allowedExclusionStatuses = new Set<string>(["cancelled", "postponed"]);

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

function validateInput(input: AssessStandingsCoverageInput): void {
  if (!input.scope || input.scope.type !== "competition_season") {
    throw new Error(`[coverage] unsupported scope type "${String(input.scope?.type)}"; only competition_season is represented by the current fixture model`);
  }
  for (const [label, value] of [
    ["competitionId", input.scope.competitionId],
    ["seasonId", input.scope.seasonId],
    ["snapshotId", input.snapshotId]
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`[coverage] ${label} must be a non-empty string`);
    }
    if (input.manifestVersionId !== undefined
      && (typeof input.manifestVersionId !== "string" || input.manifestVersionId.trim().length === 0)) {
      throw new Error("[coverage] manifestVersionId must be a non-empty string when provided");
    }
  }
  if (!input.policy || !Array.isArray(input.policy.allowedExclusionStatuses)) {
    throw new Error("[coverage] policy.allowedExclusionStatuses must be an array");
  }
  const statuses = new Set<string>();
  for (const status of input.policy.allowedExclusionStatuses) {
    if (!allowedExclusionStatuses.has(status)) {
      throw new Error(`[coverage] unsupported exclusion status "${String(status)}"`);
    }
    if (statuses.has(status)) {
      throw new Error(`[coverage] duplicate allowed exclusion status "${status}"`);
    }
    statuses.add(status);
  }
  if (!Array.isArray(input.exclusions)) {
    throw new Error("[coverage] exclusions must be an array");
  }
  for (const exclusion of input.exclusions) {
    if (!exclusion || typeof exclusion.matchId !== "string" || exclusion.matchId.trim().length === 0) {
      throw new Error("[coverage] every exclusion must identify a fixture");
    }
    if (!allowedExclusionStatuses.has(exclusion.status)) {
      throw new Error(`[coverage] unsupported exclusion status "${String(exclusion.status)}"`);
    }
    if (typeof exclusion.reason !== "string" || exclusion.reason.trim().length === 0) {
      throw new Error("[coverage] every explicit exclusion requires a non-empty reason");
    }
  }
  if (input.revisionSelections !== undefined && !Array.isArray(input.revisionSelections)) {
    throw new Error("[coverage] revisionSelections must be an array when provided");
  }
  for (const selection of input.revisionSelections ?? []) {
    if (!selection || typeof selection.matchId !== "string" || selection.matchId.trim().length === 0
      || typeof selection.revisionId !== "string" || selection.revisionId.trim().length === 0) {
      throw new Error("[coverage] every result selection must identify a fixture and revision");
    }
  }
  if (input.assessedAt !== undefined && Number.isNaN(Date.parse(input.assessedAt))) {
    throw new Error("[coverage] assessedAt must be a valid timestamp");
  }
}

function addGlobalReason(
  reasons: CoverageBlockingReason[],
  code: string,
  message: string,
  fixtureId?: string
): void {
  reasons.push({ code, message, ...(fixtureId ? { fixtureId } : {}) });
}

function createDecision(
  fixture: FixtureRow,
  participants: readonly ParticipantRow[],
  state: FixtureCoverageState,
  selectedRevisionId: string | null,
  reasonCode: string,
  reason: string
): FixtureCoverageDecision {
  const participantAssignments = participants
    .map(({ entry_id, slot, entry_type, team_id }) => ({
      entryId: entry_id,
      slot,
      competitorType: entry_type,
      teamId: team_id
    }))
    .sort((left, right) => {
      const leftKey = `${left.slot}\u0000${left.entryId}`;
      const rightKey = `${right.slot}\u0000${right.entryId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return {
    fixtureId: fixture.id,
    fixtureStatus: fixture.status,
    homeTeamId: fixture.home_team_id,
    awayTeamId: fixture.away_team_id,
    participantAssignments,
    state,
    selectedRevisionId,
    reasonCode,
    reason
  };
}

function participantProblem(fixture: FixtureRow, participants: readonly ParticipantRow[]): string | null {
  if (participants.length !== 2) {
    return "fixture must have exactly one home and one away participant assignment";
  }
  const home = participants.filter((participant) => participant.slot === "home");
  const away = participants.filter((participant) => participant.slot === "away");
  if (home.length !== 1 || away.length !== 1) {
    return "fixture participant slots must contain exactly one home and one away assignment";
  }
  const homeParticipant = home[0];
  const awayParticipant = away[0];
  if (!homeParticipant || !awayParticipant
    || homeParticipant.entry_type !== "team" || awayParticipant.entry_type !== "team"
    || !homeParticipant.team_id || !awayParticipant.team_id) {
    return "only team participant assignments are supported for standings coverage";
  }
  if (homeParticipant.team_id !== fixture.home_team_id || awayParticipant.team_id !== fixture.away_team_id) {
    return "participant entries do not match the fixture's canonical home and away teams";
  }
  return null;
}

function revisionProblem(fixture: FixtureRow, revision: RevisionRow | undefined): string | null {
  if (!revision) {
    return "selected result revision does not belong to this fixture";
  }
  if (revision.competition_id !== fixture.competition_id || revision.season_id !== fixture.season_id) {
    return "selected result revision has a conflicting competition or season";
  }
  if (revision.home_team_id !== fixture.home_team_id || revision.away_team_id !== fixture.away_team_id) {
    return "selected result revision has conflicting home or away participants";
  }
  if (revision.validation_state !== "accepted"
    || revision.result_status !== "ended"
    || revision.final_result_confirmed !== 1) {
    return "selected result revision is not an accepted, confirmed final result";
  }
  if (!Number.isSafeInteger(revision.home_score) || revision.home_score < 0
    || !Number.isSafeInteger(revision.away_score) || revision.away_score < 0) {
    return "selected result revision contains invalid scores";
  }
  return null;
}

function resolveFixture(
  database: DatabaseSync,
  fixture: FixtureRow,
  participants: readonly ParticipantRow[],
  snapshotRevisionId: string | undefined,
  suppliedRevisionIds: readonly string[],
  exclusions: readonly CoverageExclusion[],
  policy: CoveragePolicy,
  blockingReasons: CoverageBlockingReason[]
): FixtureCoverageDecision {
  const ambiguous = (reasonCode: string, reason: string, revisionId: string | null = null): FixtureCoverageDecision => {
    const decision = createDecision(fixture, participants, "unresolved_ambiguous", revisionId, reasonCode, reason);
    blockingReasons.push({ code: reasonCode, message: reason, fixtureId: fixture.id });
    return decision;
  };
  const pending = (reasonCode: string, reason: string): FixtureCoverageDecision => {
    blockingReasons.push({ code: reasonCode, message: reason, fixtureId: fixture.id });
    return createDecision(fixture, participants, "required_pending", null, reasonCode, reason);
  };

  if (suppliedRevisionIds.length > 1) {
    return ambiguous("CONFLICTING_SELECTED_REVISIONS", "more than one result revision was explicitly selected for this fixture");
  }
  const suppliedRevisionId = suppliedRevisionIds[0];
  if (suppliedRevisionId && suppliedRevisionId !== snapshotRevisionId) {
    return ambiguous(
      "SNAPSHOT_REVISION_MISMATCH",
      "explicitly selected result revision does not match the revision captured by the snapshot",
      snapshotRevisionId ?? null
    );
  }
  const selectedRevisionId = snapshotRevisionId ?? suppliedRevisionId;
  const exclusionMatches = exclusions.filter((exclusion) => exclusion.matchId === fixture.id);
  if (exclusionMatches.length > 1) {
    return ambiguous("CONFLICTING_FIXTURE_EXCLUSIONS", "more than one exclusion decision was supplied for this fixture", selectedRevisionId ?? null);
  }
  const exclusion = exclusionMatches[0];
  if (exclusion) {
    if (selectedRevisionId) {
      return ambiguous("EXCLUDED_FIXTURE_HAS_RESULT", "fixture has both an explicit exclusion and a snapshot result selection", selectedRevisionId);
    }
    if (exclusion.status !== fixture.status) {
      return ambiguous("EXCLUSION_STATUS_MISMATCH", "exclusion status does not match the fixture's current status");
    }
    if (!policy.allowedExclusionStatuses.includes(exclusion.status)) {
      return ambiguous("EXCLUSION_NOT_ALLOWED", `policy does not allow exclusion of ${exclusion.status} fixtures`);
    }
    if (typeof exclusion.reason !== "string" || exclusion.reason.trim().length === 0) {
      return ambiguous("EXCLUSION_REASON_REQUIRED", "an allowed fixture exclusion requires a non-empty reason");
    }
    return createDecision(
      fixture,
      participants,
      "explicitly_excluded",
      null,
      "EXPLICIT_POLICY_EXCLUSION",
      exclusion.reason.trim()
    );
  }

  if (!["draft", "scheduled", "assigned", "approved", "published", "live", "ended", "cancelled", "postponed"].includes(fixture.status)) {
    return ambiguous("UNSUPPORTED_FIXTURE_STATUS", `fixture has unsupported status "${fixture.status}"`, selectedRevisionId ?? null);
  }
  if (fixture.status === "cancelled" || fixture.status === "postponed") {
    return ambiguous(
      "TERMINAL_FIXTURE_REQUIRES_EXPLICIT_EXCLUSION",
      `${fixture.status} fixture requires a documented, policy-allowed explicit exclusion`,
      selectedRevisionId ?? null
    );
  }
  const participantIssue = participantProblem(fixture, participants);
  if (participantIssue) {
    return ambiguous("INVALID_PARTICIPANT_ASSIGNMENT", participantIssue, selectedRevisionId ?? null);
  }
  if (fixture.status !== "ended") {
    if (selectedRevisionId) {
      return ambiguous("RESULT_SELECTED_FOR_NON_FINAL_FIXTURE", "snapshot selects a result revision for a fixture that is not ended", selectedRevisionId);
    }
    return pending(
      "AWAITING_ACCEPTABLE_RESULT",
      `fixture status is ${fixture.status}; no acceptable result is present in the snapshot`
    );
  }
  if (!selectedRevisionId) {
    return pending("MISSING_SELECTED_RESULT", "ended fixture has no result revision selected by the snapshot");
  }

  const revision = database.prepare(`
    SELECT id, match_id, competition_id, season_id, home_team_id, away_team_id,
           result_status, final_result_confirmed, validation_state,
           home_score, away_score, revision_number
    FROM match_result_revisions
    WHERE match_id = ? AND id = ?
  `).get(fixture.id, selectedRevisionId) as RevisionRow | undefined;
  const revisionIssue = revisionProblem(fixture, revision);
  if (revisionIssue) {
    return ambiguous("INVALID_SELECTED_RESULT", revisionIssue, revision ? selectedRevisionId : null);
  }
  return createDecision(
    fixture,
    participants,
    "required_covered",
    selectedRevisionId,
    "COVERED_BY_ACCEPTED_REVISION",
    `covered by accepted final result revision ${selectedRevisionId}`
  );
}

export function assessStandingsCoverage(
  database: DatabaseSync,
  input: AssessStandingsCoverageInput
): StandingsCoverageAssessment {
  validateInput(input);
  return withImmediateTransaction(database, () => {
    const { competitionId, seasonId } = input.scope;
    const snapshot = database.prepare(`
      SELECT id, competition_id, season_id, is_complete
      FROM standings_snapshots
      WHERE id = ?
    `).get(input.snapshotId) as SnapshotRow | undefined;
    if (!snapshot) {
      throw new Error(`[coverage] unknown standings snapshot "${input.snapshotId}"`);
    }
    if (snapshot.competition_id !== competitionId || snapshot.season_id !== seasonId) {
      throw new Error("[coverage] snapshot competition and season do not match the assessed scope");
    }
    if (snapshot.is_complete !== 1) {
      throw new Error("[coverage] publication eligibility requires a finalized standings snapshot");
    }
    const manifest = input.manifestVersionId
      ? getScheduleManifest(database, input.manifestVersionId)
      : null;
    if (manifest && (manifest.competitionId !== competitionId || manifest.seasonId !== seasonId)) {
      throw new Error("[coverage] selected schedule manifest does not belong to the assessed competition and season");
    }
    if (manifest && manifest.state !== "finalized") {
      throw new Error("[coverage] coverage requires an explicitly selected finalized schedule manifest");
    }

    const fixtures = database.prepare(`
      SELECT id, competition_id, season_id, status, home_team_id, away_team_id
      FROM matches
      WHERE competition_id = ? AND season_id = ?
      ORDER BY id
    `).all(competitionId, seasonId) as FixtureRow[];
    const participants = database.prepare(`
      SELECT fp.match_id, fp.slot, fp.entry_id, ce.entry_type, ce.team_id
      FROM fixture_participants fp
      JOIN competition_entries ce
        ON ce.id = fp.entry_id
       AND ce.competition_id = fp.competition_id
       AND ce.season_id = fp.season_id
      WHERE fp.competition_id = ? AND fp.season_id = ?
      ORDER BY fp.match_id, fp.slot, fp.entry_id
    `).all(competitionId, seasonId) as ParticipantRow[];
    const participantMap = new Map<string, ParticipantRow[]>();
    for (const participant of participants) {
      const assignments = participantMap.get(participant.match_id) ?? [];
      assignments.push(participant);
      participantMap.set(participant.match_id, assignments);
    }
    const fixtureIds = new Set(fixtures.map(({ id }) => id));
    const snapshotRows = database.prepare(`
      SELECT match_id, revision_id, revision_number
      FROM standings_snapshot_results
      WHERE snapshot_id = ?
      ORDER BY match_id
    `).all(input.snapshotId) as SnapshotRevisionRow[];
    const snapshotRevisionMap = new Map(snapshotRows.map((row) => [row.match_id, row.revision_id]));
    const suppliedSelections = input.revisionSelections ?? [];
    const selectionsByMatch = new Map<string, string[]>();
    const selectedRevisionOwners = new Map<string, string>();
    const blockingReasons: CoverageBlockingReason[] = [];

    for (const selection of suppliedSelections) {
      const list = selectionsByMatch.get(selection.matchId) ?? [];
      list.push(selection.revisionId);
      selectionsByMatch.set(selection.matchId, list);
      const priorOwner = selectedRevisionOwners.get(selection.revisionId);
      if (priorOwner && priorOwner !== selection.matchId) {
        addGlobalReason(
          blockingReasons,
          "REVISION_SELECTED_FOR_MULTIPLE_FIXTURES",
          `result revision ${selection.revisionId} was selected for both ${priorOwner} and ${selection.matchId}`
        );
      } else {
        selectedRevisionOwners.set(selection.revisionId, selection.matchId);
      }
      if (!fixtureIds.has(selection.matchId)) {
        addGlobalReason(
          blockingReasons,
          "SELECTION_OUTSIDE_SCOPE",
          `selected fixture ${selection.matchId} is not explicitly associated with this competition and season`
        );
      }
    }
    for (const matchId of snapshotRevisionMap.keys()) {
      if (!fixtureIds.has(matchId)) {
        addGlobalReason(
          blockingReasons,
          "SNAPSHOT_FIXTURE_OUTSIDE_SCOPE",
          `snapshot result for fixture ${matchId} is no longer associated with this competition and season`
        );
      }
    }

    const exclusionsByMatch = new Map<string, CoverageExclusion[]>();
    for (const exclusion of input.exclusions) {
      const list = exclusionsByMatch.get(exclusion.matchId) ?? [];
      list.push(exclusion);
      exclusionsByMatch.set(exclusion.matchId, list);
      if (!fixtureIds.has(exclusion.matchId)) {
        addGlobalReason(
          blockingReasons,
          "EXCLUSION_OUTSIDE_SCOPE",
          `explicit exclusion for fixture ${exclusion.matchId} is not associated with this competition and season`
        );
      }
    }

    const representedFixtureDecisions = fixtures.map((fixture) => resolveFixture(
      database,
      fixture,
      participantMap.get(fixture.id) ?? [],
      snapshotRevisionMap.get(fixture.id),
      selectionsByMatch.get(fixture.id) ?? [],
      exclusionsByMatch.get(fixture.id) ?? [],
      input.policy,
      blockingReasons
    ));

    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const decisionByFixtureId = new Map(representedFixtureDecisions.map((decision) => [decision.fixtureId, decision]));
    const manifestEntryByMatchId = new Map<string, ScheduleManifestFixture>();
    const manifestDecisions: StandingsCoverageAssessment["manifestDecisions"] = [];
    let decisions = representedFixtureDecisions;
    let scheduleState: StandingsCoverageAssessment["scheduleState"] = "unverified";
    const manifestFindings = manifest?.validation.findings ?? [];

    if (!manifest) {
      addGlobalReason(
        blockingReasons,
        "SCHEDULE_MANIFEST_REQUIRED",
        "no finalized schedule-completeness manifest was selected; represented fixtures alone cannot establish the full schedule"
      );
    } else {
      const invalidFindingCodes = new Set([
        "EMPTY_MANIFEST",
        "DUPLICATE_CANONICAL_FIXTURE",
        "UNKNOWN_CANONICAL_FIXTURE",
        "CANONICAL_FIXTURE_SCOPE_MISMATCH",
        "CANONICAL_FIXTURE_PARTICIPANT_MISMATCH",
        "CANONICAL_FIXTURE_OMITTED"
      ]);
      scheduleState = !manifest.source || !/^[a-f0-9]{64}$/.test(manifest.source.contentHash)
        || manifestFindings.some(({ code }) => invalidFindingCodes.has(code))
        ? "invalid"
        : manifestFindings.length > 0 ? "incomplete" : "verified_complete";

      if (!manifest.source || !/^[a-f0-9]{64}$/.test(manifest.source.contentHash)) {
        addGlobalReason(
          blockingReasons,
          "SCHEDULE_SOURCE_ATTESTATION_REQUIRED",
          "the finalized schedule manifest has no verified uploaded source file hash, source name, and reference"
        );
      }

      for (const finding of manifestFindings) {
        addGlobalReason(blockingReasons, finding.code, finding.message);
      }
      for (const entry of manifest.fixtures) {
        if (entry.matchId) manifestEntryByMatchId.set(entry.matchId, entry);
      }

      const manifestDecisionInputs: ManifestDecisionInput[] = [];
      for (const entry of manifest.fixtures) {
        const matchedFixture = entry.matchId ? fixtureById.get(entry.matchId) : undefined;
        const resultForFixture = entry.matchId ? decisionByFixtureId.get(entry.matchId) : undefined;
        let decision: FixtureCoverageDecision;
        if (!entry.matchId) {
          const reasonCode = "UNRESOLVED_EXPECTED_FIXTURE";
          const reason = "expected schedule fixture has not been matched to a canonical fixture";
          decision = {
            fixtureId: entry.fixtureKey,
            fixtureStatus: "unresolved",
            homeTeamId: entry.homeTeamId,
            awayTeamId: entry.awayTeamId,
            participantAssignments: [],
            state: "unresolved_ambiguous",
            selectedRevisionId: null,
            reasonCode,
            reason
          };
        } else if (!matchedFixture) {
          const canonicalRow = database.prepare(`
            SELECT id, competition_id, season_id, status, home_team_id, away_team_id
            FROM matches WHERE id = ?
          `).get(entry.matchId) as FixtureRow | undefined;
          const reasonCode = canonicalRow ? "CANONICAL_FIXTURE_SCOPE_MISMATCH" : "UNKNOWN_CANONICAL_FIXTURE";
          const reason = canonicalRow
            ? "canonical fixture belongs to a different competition or season"
            : "expected fixture references an unknown canonical fixture";
          decision = {
            fixtureId: entry.matchId,
            fixtureStatus: canonicalRow?.status ?? "unknown",
            homeTeamId: entry.homeTeamId,
            awayTeamId: entry.awayTeamId,
            participantAssignments: [],
            state: "unresolved_ambiguous",
            selectedRevisionId: null,
            reasonCode,
            reason
          };
        } else if (matchedFixture.home_team_id !== entry.homeTeamId
          || matchedFixture.away_team_id !== entry.awayTeamId) {
          const reasonCode = "CANONICAL_FIXTURE_PARTICIPANT_MISMATCH";
          const reason = "expected home and away teams do not match the canonical fixture";
          decision = {
            fixtureId: entry.matchId,
            fixtureStatus: matchedFixture.status,
            homeTeamId: entry.homeTeamId,
            awayTeamId: entry.awayTeamId,
            participantAssignments: [],
            state: "unresolved_ambiguous",
            selectedRevisionId: null,
            reasonCode,
            reason
          };
        } else {
          decision = resultForFixture!;
        }
        if (decision.state === "unresolved_ambiguous" || decision.state === "required_pending") {
          addGlobalReason(blockingReasons, decision.reasonCode, decision.reason, decision.fixtureId);
        }
        manifestDecisionInputs.push({ fixture: entry, decision });
      }
      const manifestDecisionByMatchId = new Map(manifestDecisionInputs
        .filter(({ fixture }) => fixture.matchId !== null)
        .map(({ fixture, decision }) => [fixture.matchId!, decision]));

      decisions = fixtures.map((fixture) => {
        if (manifestEntryByMatchId.has(fixture.id)) {
          return manifestDecisionByMatchId.get(fixture.id)!;
        }
        const reasonCode = "FIXTURE_NOT_IN_MANIFEST";
        const reason = "canonical fixture is not included in the selected finalized schedule manifest";
        blockingReasons.push({ code: reasonCode, message: reason, fixtureId: fixture.id });
        return createDecision(
          fixture,
          participantMap.get(fixture.id) ?? [],
          "unresolved_ambiguous",
          snapshotRevisionMap.get(fixture.id) ?? null,
          reasonCode,
          reason
        );
      });
      for (const { fixture, decision } of manifestDecisionInputs) {
        manifestDecisions.push({
          fixtureKey: fixture.fixtureKey,
          canonicalMatchId: fixture.matchId,
          state: decision.state,
          selectedRevisionId: decision.selectedRevisionId,
          reasonCode: decision.reasonCode,
          reason: decision.reason
        });
      }
    }

    if (fixtures.length === 0) {
      addGlobalReason(
        blockingReasons,
        "NO_EXPLICIT_FIXTURES",
        "no fixtures are explicitly associated with this competition and season; an empty fixture set is not evidence of completion"
      );
    }

    blockingReasons.sort((left, right) => {
      const leftKey = `${left.fixtureId ?? ""}\u0000${left.code}\u0000${left.message}`;
      const rightKey = `${right.fixtureId ?? ""}\u0000${right.code}\u0000${right.message}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const eligible = scheduleState === "verified_complete" && decisions.every((decision) =>
      decision.state === "required_covered" || decision.state === "explicitly_excluded"
    ) && blockingReasons.length === 0;
    const assessedAt = input.assessedAt ?? new Date().toISOString();
    const normalizedPolicy: CoveragePolicy = {
      allowedExclusionStatuses: [...input.policy.allowedExclusionStatuses].sort()
    };
    const canonicalContent = {
      scope: {
        type: "competition_season",
        competitionId,
        seasonId
      },
      snapshotId: input.snapshotId,
      manifestVersionId: manifest?.id ?? null,
      manifestContentHash: manifest?.contentHash ?? null,
      scheduleState,
      policy: normalizedPolicy,
      suppliedRevisionSelections: [...suppliedSelections]
        .sort((a, b) => {
          const leftKey = `${a.matchId}\u0000${a.revisionId}`;
          const rightKey = `${b.matchId}\u0000${b.revisionId}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
      exclusions: [...input.exclusions]
        .sort((a, b) => {
          const leftKey = `${a.matchId}\u0000${a.status}\u0000${a.reason}`;
          const rightKey = `${b.matchId}\u0000${b.status}\u0000${b.reason}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
      decisions,
      manifestDecisions,
      manifestFindings,
      blockingReasons
    };
    const contentJson = stableJson(canonicalContent);
    const contentHash = crypto.createHash("sha256").update(contentJson).digest("hex");
    const sequence = Number((database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM standings_coverage_assessments
      WHERE snapshot_id = ?
    `).get(input.snapshotId) as { nextSequence: number }).nextSequence);
    const id = crypto.randomUUID();
    const policyJson = stableJson(normalizedPolicy);
    database.prepare(`
      INSERT INTO standings_coverage_assessments (
        id, competition_id, season_id, scope_type, snapshot_id, sequence,
        policy_json, eligibility_state, blocking_reasons_json, content_hash,
        content_json, assessed_at, expected_fixture_count, manifest_id,
        schedule_state, expected_manifest_fixture_count
      ) VALUES (?, ?, ?, 'competition_season', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      competitionId,
      seasonId,
      input.snapshotId,
      sequence,
      policyJson,
      eligible ? "eligible" : "ineligible",
      stableJson(blockingReasons),
      contentHash,
      contentJson,
      assessedAt,
      decisions.length,
      manifest?.id ?? null,
      scheduleState,
      manifestDecisions.length
    );
    const insertDecision = database.prepare(`
      INSERT INTO standings_coverage_fixtures (
        assessment_id, competition_id, season_id, match_id, fixture_status,
        home_team_id, away_team_id, participant_assignments_json, coverage_state,
        selected_revision_id, reason_code, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const decision of decisions) {
      insertDecision.run(
        id,
        competitionId,
        seasonId,
        decision.fixtureId,
        decision.fixtureStatus,
        decision.homeTeamId,
        decision.awayTeamId,
        stableJson(decision.participantAssignments),
        decision.state,
        decision.selectedRevisionId,
        decision.reasonCode,
        decision.reason
      );
    }
    if (manifest) {
      const insertManifestDecision = database.prepare(`
        INSERT INTO standings_coverage_manifest_fixtures (
          assessment_id, manifest_id, fixture_key, canonical_match_id,
          coverage_state, selected_revision_id, reason_code, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const decision of manifestDecisions) {
        insertManifestDecision.run(
          id,
          manifest.id,
          decision.fixtureKey,
          decision.canonicalMatchId,
          decision.state,
          decision.selectedRevisionId,
          decision.reasonCode,
          decision.reason
        );
      }
    }
    database.prepare(`
      UPDATE standings_coverage_assessments
      SET is_finalized = 1
      WHERE id = ?
    `).run(id);

    return {
      id,
      sequence,
      competitionId,
      seasonId,
      scopeType: "competition_season",
      snapshotId: input.snapshotId,
      manifestVersionId: manifest?.id ?? null,
      scheduleState,
      policy: normalizedPolicy,
      eligible,
      blockingReasons,
      decisions,
      manifestDecisions,
      manifestFindings,
      assessedAt,
      contentHash,
      contentJson
    };
  });
}
