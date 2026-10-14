import crypto from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";

const scoringEventTypes = new Set([
  "goal",
  "penalty_scored",
  "var_penalty_scored",
]);
const timelineSnapshotMigration = "timeline_score_snapshots_v1";
type TimelineSnapshotDatabase = Pick<DatabaseSync, "prepare" | "exec">;

export function recalculateTimelineScoreSnapshots(
  database: TimelineSnapshotDatabase,
  matchId: string,
): boolean {
  const fixture = database
    .prepare(
      `SELECT match.home_team_id AS homeTeamId, match.away_team_id AS awayTeamId,
      state.home_score AS homeScore, state.away_score AS awayScore
    FROM matches AS match
    JOIN match_score_state AS state ON state.match_id=match.id
    WHERE match.id=?`,
    )
    .get(matchId) as
    | {
        homeTeamId: string;
        awayTeamId: string;
        homeScore: number;
        awayScore: number;
      }
    | undefined;
  if (!fixture) return false;

  const events = database
    .prepare(
      `SELECT id, event_type AS eventType, team_id AS teamId
    FROM match_score_timeline WHERE match_id=? ORDER BY minute, created_at, rowid`,
    )
    .all(matchId) as Array<{
    id: string;
    eventType: string;
    teamId: string | null;
  }>;
  const homeGoals = events.filter(
    (event) =>
      scoringEventTypes.has(event.eventType) &&
      event.teamId === fixture.homeTeamId,
  ).length;
  const awayGoals = events.filter(
    (event) =>
      scoringEventTypes.has(event.eventType) &&
      event.teamId === fixture.awayTeamId,
  ).length;
  if (
    homeGoals > Number(fixture.homeScore) ||
    awayGoals > Number(fixture.awayScore)
  ) {
    console.error(
      `[manual-score-timeline] match ${matchId} has more goal events than its authoritative result`,
    );
  }

  let homeScore = Number(fixture.homeScore) - homeGoals;
  let awayScore = Number(fixture.awayScore) - awayGoals;
  if (homeScore < 0) homeScore = 0;
  if (awayScore < 0) awayScore = 0;
  const updateSnapshot = database.prepare(
    "UPDATE match_score_timeline SET home_score=?, away_score=? WHERE id=?",
  );
  for (const event of events) {
    if (scoringEventTypes.has(event.eventType)) {
      if (
        event.teamId === fixture.homeTeamId &&
        homeScore < Number(fixture.homeScore)
      )
        homeScore++;
      if (
        event.teamId === fixture.awayTeamId &&
        awayScore < Number(fixture.awayScore)
      )
        awayScore++;
    }
    updateSnapshot.run(homeScore, awayScore, event.id);
  }
  return true;
}

export function shouldIncrementAuthoritativeScore(
  database: TimelineSnapshotDatabase,
  matchId: string,
  teamId: string,
  minute: number,
): boolean {
  const latestGoal = database
    .prepare(
      `SELECT MAX(minute) AS minute FROM match_score_timeline
    WHERE match_id=? AND team_id=? AND event_type IN ('goal', 'penalty_scored', 'var_penalty_scored')`,
    )
    .get(matchId, teamId) as {
    minute: number | null;
  };
  return latestGoal.minute === null || minute >= Number(latestGoal.minute);
}

export function migrateManualTimelineSnapshots(database: DatabaseSync): void {
  const matches = database
    .prepare(
      `SELECT state.match_id AS matchId
    FROM match_score_state AS state
    WHERE EXISTS (SELECT 1 FROM match_score_timeline AS event WHERE event.match_id=state.match_id)
      AND NOT EXISTS (SELECT 1 FROM match_score_system_audit AS audit
        WHERE audit.match_id=state.match_id AND audit.action=?)`,
    )
    .all(timelineSnapshotMigration) as Array<{ matchId: string }>;
  const recordMigration = database.prepare(`INSERT INTO match_score_system_audit
    (id,match_id,action,previous_state,new_state,created_at) VALUES (?,?,?,NULL,?,?)`);

  for (const { matchId } of matches) {
    database.exec("BEGIN IMMEDIATE;");
    try {
      recalculateTimelineScoreSnapshots(database, matchId);
      recordMigration.run(
        crypto.randomUUID(),
        matchId,
        timelineSnapshotMigration,
        JSON.stringify({ recalculated: true }),
        new Date().toISOString(),
      );
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }
}
