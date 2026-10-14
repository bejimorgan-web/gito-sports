import assert from "node:assert/strict";
import { after, test } from "node:test";

import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import {
  migrateManualTimelineSnapshots,
  recalculateTimelineScoreSnapshots,
  shouldIncrementAuthoritativeScore,
} from "./manual-score-timeline.js";

const database = allowSqliteInstantiation(() => new DatabaseSync(":memory:"));
database.exec(`
  CREATE TABLE matches (id TEXT PRIMARY KEY, home_team_id TEXT NOT NULL, away_team_id TEXT NOT NULL);
  CREATE TABLE match_score_state (match_id TEXT PRIMARY KEY, home_score INTEGER NOT NULL, away_score INTEGER NOT NULL);
  CREATE TABLE match_score_timeline (
    id TEXT PRIMARY KEY, match_id TEXT NOT NULL, minute INTEGER NOT NULL, created_at TEXT NOT NULL,
    event_type TEXT NOT NULL, team_id TEXT, home_score INTEGER NOT NULL, away_score INTEGER NOT NULL
  );
  CREATE TABLE match_score_system_audit (
    id TEXT PRIMARY KEY, match_id TEXT NOT NULL, action TEXT NOT NULL,
    previous_state TEXT, new_state TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);

after(() => database.close());

test("rebuilds existing event score snapshots in match-minute order once", () => {
  database
    .prepare("INSERT INTO matches VALUES ('fixture', 'home', 'away')")
    .run();
  database
    .prepare("INSERT INTO match_score_state VALUES ('fixture', 4, 0)")
    .run();
  const insertEvent = database.prepare(`INSERT INTO match_score_timeline
    VALUES (?, 'fixture', ?, ?, ?, ?, 5, 0)`);
  insertEvent.run("goal-46", 46, "2026-08-21T12:00:00.000Z", "goal", "home");
  insertEvent.run(
    "card-61",
    61,
    "2026-08-21T12:01:00.000Z",
    "yellow_card",
    "away",
  );
  insertEvent.run("goal-68", 68, "2026-08-21T12:02:00.000Z", "goal", "home");
  insertEvent.run("goal-80", 80, "2026-08-21T12:03:00.000Z", "goal", "home");
  insertEvent.run("goal-90", 90, "2026-08-21T12:04:00.000Z", "goal", "home");

  assert.equal(
    shouldIncrementAuthoritativeScore(database, "fixture", "home", 46),
    false,
  );
  assert.equal(
    shouldIncrementAuthoritativeScore(database, "fixture", "home", 90),
    true,
  );
  migrateManualTimelineSnapshots(database);
  const snapshots = database
    .prepare(
      `SELECT id, home_score AS homeScore, away_score AS awayScore
    FROM match_score_timeline ORDER BY minute, created_at, rowid`,
    )
    .all();
  assert.deepEqual(snapshots, [
    { id: "goal-46", homeScore: 1, awayScore: 0 },
    { id: "card-61", homeScore: 1, awayScore: 0 },
    { id: "goal-68", homeScore: 2, awayScore: 0 },
    { id: "goal-80", homeScore: 3, awayScore: 0 },
    { id: "goal-90", homeScore: 4, awayScore: 0 },
  ]);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM match_score_system_audit WHERE action='timeline_score_snapshots_v1'",
      )
      .get()?.count,
    1,
  );

  database
    .prepare("UPDATE match_score_timeline SET home_score=5 WHERE id='goal-46'")
    .run();
  migrateManualTimelineSnapshots(database);
  assert.equal(
    database
      .prepare("SELECT home_score FROM match_score_timeline WHERE id='goal-46'")
      .get()?.home_score,
    5,
  );
});

test("keeps rebuilt snapshots chronological and capped at the authoritative score", () => {
  database
    .prepare("INSERT INTO matches VALUES ('inconsistent', 'home', 'away')")
    .run();
  database
    .prepare("INSERT INTO match_score_state VALUES ('inconsistent', 1, 0)")
    .run();
  database
    .prepare(
      `INSERT INTO match_score_timeline VALUES
    ('goal-a', 'inconsistent', 46, '2026-08-21T12:00:00.000Z', 'goal', 'home', 9, 0),
    ('goal-b', 'inconsistent', 68, '2026-08-21T12:01:00.000Z', 'goal', 'home', 9, 0)`,
    )
    .run();

  assert.equal(
    recalculateTimelineScoreSnapshots(database, "inconsistent"),
    true,
  );
  assert.deepEqual(
    database
      .prepare(
        "SELECT home_score AS homeScore FROM match_score_timeline WHERE match_id='inconsistent' ORDER BY minute",
      )
      .all(),
    [{ homeScore: 1 }, { homeScore: 1 }],
  );
});
