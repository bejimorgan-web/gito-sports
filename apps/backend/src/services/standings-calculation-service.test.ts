import assert from "node:assert/strict";
import test from "node:test";

import { competitionEntryMigration } from "../db/competition-entry-migration.js";
import { runMigrations } from "../db/migration-runner.js";
import { allowSqliteInstantiation, DatabaseSync } from "../db/sqlite.js";
import {
  calculateStandings,
  conventionalTeamLeagueRuleset,
  type StandingsCalculationInput,
  type StandingsEntry,
  type StandingsFixture,
  type StandingsFixtureParticipant,
  type StandingsRuleset,
  type ValidatedStandingsResult
} from "./standings-calculation-service.js";

const context = { competitionId: "competition-1", seasonId: "season-1" };

function entry(id: string, overrides: Partial<StandingsEntry> = {}): StandingsEntry {
  return {
    ...context,
    id: `entry-${id}`,
    competitorType: "team",
    teamId: `team-${id}`,
    ...overrides
  };
}

function fixture(
  id: string,
  home: string,
  away: string,
  overrides: Partial<StandingsFixture> = {}
): StandingsFixture {
  return {
    ...context,
    id,
    status: "ended",
    homeTeamId: `team-${home}`,
    awayTeamId: `team-${away}`,
    ...overrides
  };
}

function participant(fixtureId: string, side: "home" | "away", team: string): StandingsFixtureParticipant {
  return { fixtureId, entryId: `entry-${team}`, slot: side };
}

function result(
  fixtureId: string,
  home: string,
  away: string,
  homeScore: number | null,
  awayScore: number | null,
  overrides: Partial<ValidatedStandingsResult> = {}
): ValidatedStandingsResult {
  return {
    ...context,
    fixtureId,
    status: "ended",
    finalResultConfirmed: true,
    homeTeamId: `team-${home}`,
    awayTeamId: `team-${away}`,
    homeScore,
    awayScore,
    ...overrides
  };
}

function singleFixtureInput(
  homeScore: number | null,
  awayScore: number | null,
  ruleset: StandingsRuleset = conventionalTeamLeagueRuleset
): StandingsCalculationInput {
  const match = fixture("fixture-1", "home", "away");
  return {
    ...context,
    ruleset,
    entries: [entry("home"), entry("away")],
    fixtures: [match],
    participants: [
      participant(match.id, "home", "home"),
      participant(match.id, "away", "away")
    ],
    results: [result(match.id, "home", "away", homeScore, awayScore)]
  };
}

test("calculates win, draw, loss, scoring totals, and configured points", () => {
  const ruleset: StandingsRuleset = {
    ...conventionalTeamLeagueRuleset,
    id: "custom-points-test",
    points: { win: 5, draw: 2, loss: 0 }
  };
  const fixtures = [
    fixture("home-away", "home", "away"),
    fixture("away-idle", "away", "idle"),
    fixture("idle-home", "idle", "home")
  ];
  const input: StandingsCalculationInput = {
    ...context,
    ruleset,
    entries: [entry("home"), entry("away"), entry("idle")],
    fixtures,
    participants: [
      participant("home-away", "home", "home"), participant("home-away", "away", "away"),
      participant("away-idle", "home", "away"), participant("away-idle", "away", "idle"),
      participant("idle-home", "home", "idle"), participant("idle-home", "away", "home")
    ],
    results: [
      result("home-away", "home", "away", 2, 0),
      result("away-idle", "away", "idle", 0, 1),
      result("idle-home", "idle", "home", 1, 1)
    ]
  };

  const table = calculateStandings(input);
  assert.equal(table.rulesetId, "custom-points-test");
  assert.equal(table.rulesetVersion, 1);
  assert.deepEqual(table.rows.map(({ entryId, rank, played, won, drawn, lost, points }) => ({
    entryId, rank, played, won, drawn, lost, points
  })), [
    { entryId: "entry-home", rank: 1, played: 2, won: 1, drawn: 1, lost: 0, points: 7 },
    { entryId: "entry-idle", rank: 2, played: 2, won: 1, drawn: 1, lost: 0, points: 7 },
    { entryId: "entry-away", rank: 3, played: 2, won: 0, drawn: 0, lost: 2, points: 0 }
  ]);
  assert.deepEqual(
    [table.rows[0]!.scoresFor, table.rows[0]!.scoresAgainst, table.rows[0]!.scoreDifference],
    [3, 1, 2]
  );
});

test("orders entries by points before later tie-break criteria", () => {
  const table = calculateStandings(singleFixtureInput(1, 0));
  assert.equal(table.rows[0]?.entryId, "entry-home");
  assert.equal(table.rows[0]?.points, 3);
  assert.equal(table.rows[1]?.points, 0);
});

test("applies score difference, then scores for, then stable entry ID in declared order", () => {
  const entries = ["a", "b", "x", "y"].map((id) => entry(id));
  const fixtures = [
    fixture("a-x", "a", "x"),
    fixture("b-y", "b", "y")
  ];
  const base: StandingsCalculationInput = {
    ...context,
    ruleset: conventionalTeamLeagueRuleset,
    entries,
    fixtures,
    participants: [
      participant("a-x", "home", "a"), participant("a-x", "away", "x"),
      participant("b-y", "home", "b"), participant("b-y", "away", "y")
    ],
    results: [
      result("a-x", "a", "x", 2, 0),
      result("b-y", "b", "y", 3, 1)
    ]
  };
  const scoreForTable = calculateStandings(base);
  assert.equal(scoreForTable.rows[0]?.entryId, "entry-b");
  assert.equal(scoreForTable.rows[1]?.entryId, "entry-a");
  assert.equal(scoreForTable.rows[0]?.scoreDifference, scoreForTable.rows[1]?.scoreDifference);
  assert.ok(scoreForTable.rows[0]!.scoresFor > scoreForTable.rows[1]!.scoresFor);

  const scoreDifferenceInput: StandingsCalculationInput = {
    ...base,
    results: [
      result("a-x", "a", "x", 2, 0),
      result("b-y", "b", "y", 1, 0)
    ]
  };
  const scoreDifferenceTable = calculateStandings(scoreDifferenceInput);
  assert.equal(scoreDifferenceTable.rows[0]?.entryId, "entry-a");
  assert.ok(scoreDifferenceTable.rows[0]!.scoreDifference > scoreDifferenceTable.rows[1]!.scoreDifference);

  const idTable = calculateStandings({
    ...base,
    fixtures: [],
    participants: [],
    results: []
  });
  assert.deepEqual(idTable.rows.map((row) => row.entryId), ["entry-a", "entry-b", "entry-x", "entry-y"]);
  assert.deepEqual(idTable.rows.map((row) => row.rank), [1, 2, 3, 4]);
});

test("retains eligible entries with no completed matches", () => {
  const table = calculateStandings({
    ...context,
    ruleset: conventionalTeamLeagueRuleset,
    entries: [entry("idle"), entry("scheduled-home"), entry("scheduled-away")],
    fixtures: [fixture("scheduled", "scheduled-home", "scheduled-away", { status: "scheduled" })],
    participants: [
      participant("scheduled", "home", "scheduled-home"),
      participant("scheduled", "away", "scheduled-away")
    ],
    results: []
  });

  assert.equal(table.rows.length, 3);
  for (const row of table.rows) {
    assert.equal(row.played, 0);
    assert.equal(row.points, 0);
  }
  assert.deepEqual(table.excludedFixtures, [{ fixtureId: "scheduled", reason: "fixture_not_completed" }]);
});

test("excludes scheduled, abandoned, missing, and unconfirmed results", () => {
  const fixtures = [
    fixture("scheduled", "a", "b", { status: "scheduled" }),
    fixture("abandoned", "a", "b", { status: "abandoned" }),
    fixture("missing", "a", "b"),
    fixture("unconfirmed", "a", "b"),
    fixture("scheduled-result", "a", "b"),
    fixture("incomplete-result", "a", "b")
  ];
  const input: StandingsCalculationInput = {
    ...context,
    ruleset: conventionalTeamLeagueRuleset,
    entries: [entry("a"), entry("b")],
    fixtures,
    participants: fixtures.flatMap((match) => [
      participant(match.id, "home", "a"),
      participant(match.id, "away", "b")
    ]),
    results: [
      result("scheduled", "a", "b", 1, 0),
      result("abandoned", "a", "b", 1, 0),
      result("unconfirmed", "a", "b", 1, 0, { finalResultConfirmed: false }),
      result("scheduled-result", "a", "b", 1, 0, { status: "scheduled" }),
      result("incomplete-result", "a", "b", 1, 0, { status: "incomplete" })
    ]
  };
  const table = calculateStandings(input);
  assert.deepEqual(table.excludedFixtures, [
    { fixtureId: "scheduled", reason: "fixture_not_completed" },
    { fixtureId: "abandoned", reason: "fixture_not_completed" },
    { fixtureId: "missing", reason: "missing_result" },
    { fixtureId: "unconfirmed", reason: "result_not_final" },
    { fixtureId: "scheduled-result", reason: "result_not_final" },
    { fixtureId: "incomplete-result", reason: "result_not_final" }
  ]);
  assert.ok(table.rows.every((row) => row.played === 0));
});

test("reports missing, negative, fractional, and unsafe scores without coercing them to zero", () => {
  for (const [homeScore, awayScore] of [
    [null, 0],
    [-1, 0],
    [1.5, 0],
    [Number.MAX_SAFE_INTEGER + 1, 0]
  ] as Array<[number | null, number | null]>) {
    const table = calculateStandings(singleFixtureInput(homeScore, awayScore));
    assert.deepEqual(table.excludedFixtures, [{ fixtureId: "fixture-1", reason: "invalid_scores" }]);
    assert.ok(table.rows.every((row) => row.played === 0 && row.points === 0));
  }
});

test("excludes fixtures with missing, duplicate, mismatched, or unsupported participant assignments", () => {
  const validInput = singleFixtureInput(1, 0);
  const invalidInputs: StandingsCalculationInput[] = [
    { ...validInput, participants: validInput.participants.slice(0, 1) },
    {
      ...validInput,
      participants: [
        participant("fixture-1", "home", "home"),
        participant("fixture-1", "away", "home")
      ]
    },
    {
      ...validInput,
      results: [result("fixture-1", "away", "home", 1, 0)]
    },
    {
      ...validInput,
      entries: [
        entry("home", { competitorType: "individual" }),
        entry("away")
      ]
    },
    {
      ...validInput,
      participants: [
        ...validInput.participants,
        { fixtureId: "fixture-1", entryId: "entry-home", slot: "extra" }
      ]
    }
  ];

  for (const input of invalidInputs) {
    const table = calculateStandings(input);
    assert.deepEqual(table.excludedFixtures, [{ fixtureId: "fixture-1", reason: "invalid_participants" }]);
    assert.ok(table.rows.every((row) => row.played === 0));
  }
  assert.deepEqual(calculateStandings(invalidInputs[3]!).excludedEntries, [
    { entryId: "entry-home", reason: "unsupported_competitor_type" }
  ]);
});

test("duplicate fixture input cannot double-count a completed result", () => {
  const input = singleFixtureInput(2, 0);
  const table = calculateStandings({ ...input, fixtures: [...input.fixtures, ...input.fixtures] });
  assert.ok(table.rows.every((row) => row.played === 0));
  assert.deepEqual(table.excludedFixtures, [
    { fixtureId: "fixture-1", reason: "duplicate_fixture_id" },
    { fixtureId: "fixture-1", reason: "duplicate_fixture_id" }
  ]);
});

test("foreign competition and season fixtures and results are not included", () => {
  const foreign = fixture("foreign-season", "home", "away", { seasonId: "season-2" });
  const mismatchedResult = result("fixture-1", "home", "away", 3, 0, { competitionId: "competition-2" });
  const input = singleFixtureInput(1, 0);
  const table = calculateStandings({
    ...input,
    fixtures: [...input.fixtures, foreign],
    participants: [
      ...input.participants,
      participant("foreign-season", "home", "home"),
      participant("foreign-season", "away", "away")
    ],
    results: [mismatchedResult]
  });
  assert.deepEqual(table.excludedFixtures, [
    { fixtureId: "fixture-1", reason: "result_outside_competition_or_season" },
    { fixtureId: "foreign-season", reason: "fixture_outside_competition_or_season" }
  ]);
  assert.equal(table.rows.find((row) => row.entryId === "entry-home")?.played, 0);
});

test("duplicate result records invalidate their fixture instead of double-counting", () => {
  const input = singleFixtureInput(1, 0);
  const table = calculateStandings({
    ...input,
    results: [...input.results, ...input.results]
  });
  assert.ok(table.rows.every((row) => row.played === 0));
  assert.deepEqual(table.excludedFixtures, [{ fixtureId: "fixture-1", reason: "duplicate_result" }]);
});

test("recalculating unchanged inputs is deterministic and a valid result change updates the table", () => {
  const original = singleFixtureInput(2, 1);
  assert.deepEqual(calculateStandings(original), calculateStandings(original));

  const changed: StandingsCalculationInput = {
    ...original,
    results: [result("fixture-1", "home", "away", 0, 3)]
  };
  const changedTable = calculateStandings(changed);
  assert.equal(changedTable.rows[0]?.entryId, "entry-away");
  assert.equal(changedTable.rows[0]?.points, 3);
  assert.equal(changedTable.rows[1]?.points, 0);
});

test("reports results with no supplied fixture rather than including them", () => {
  const input = singleFixtureInput(1, 0);
  const orphanResult = result("not-supplied", "home", "away", 9, 0);
  const table = calculateStandings({ ...input, fixtures: [], participants: [], results: [orphanResult] });
  assert.deepEqual(table.excludedFixtures, [
    { fixtureId: "not-supplied", reason: "fixture_outside_competition_or_season" }
  ]);
  assert.ok(table.rows.every((row) => row.played === 0));
});

test("rejects unknown, duplicate, and ambiguous ruleset definitions", () => {
  const input = singleFixtureInput(1, 0);
  const invalidRulesets = [
    {
      ...conventionalTeamLeagueRuleset,
      tieBreakers: [
        { criterion: "points", direction: "desc" },
        { criterion: "name", direction: "asc" },
        { criterion: "entryId", direction: "asc" }
      ]
    },
    {
      ...conventionalTeamLeagueRuleset,
      tieBreakers: [
        { criterion: "scoreDifference", direction: "desc" },
        { criterion: "points", direction: "desc" },
        { criterion: "entryId", direction: "asc" }
      ]
    },
    {
      ...conventionalTeamLeagueRuleset,
      tieBreakers: [
        { criterion: "points", direction: "desc" },
        { criterion: "entryId", direction: "asc" },
        { criterion: "scoresFor", direction: "desc" }
      ]
    },
    {
      ...conventionalTeamLeagueRuleset,
      tieBreakers: [
        { criterion: "points", direction: "desc" },
        { criterion: "points", direction: "asc" },
        { criterion: "entryId", direction: "asc" }
      ]
    },
    {
      ...conventionalTeamLeagueRuleset,
      points: { win: -1, draw: 1, loss: 0 }
    },
    {
      ...conventionalTeamLeagueRuleset,
      version: 0
    },
    {
      ...conventionalTeamLeagueRuleset,
      trackedStatistics: ["played", "madeUp"]
    }
  ] as unknown as StandingsRuleset[];

  for (const ruleset of invalidRulesets) {
    assert.throws(
      () => calculateStandings({ ...input, ruleset }),
      /\[standings\] invalid ruleset:/
    );
  }
});

test("rejects a result that would overflow deterministic integer totals", () => {
  const fixtures = [
    fixture("large-score-1", "home", "away"),
    fixture("large-score-2", "home", "away")
  ];
  const table = calculateStandings({
    ...context,
    ruleset: conventionalTeamLeagueRuleset,
    entries: [entry("home"), entry("away")],
    fixtures,
    participants: fixtures.flatMap((match) => [
      participant(match.id, "home", "home"),
      participant(match.id, "away", "away")
    ]),
    results: fixtures.map((match) =>
      result(match.id, "home", "away", Number.MAX_SAFE_INTEGER, 0)
    )
  });
  assert.equal(table.rows.find((row) => row.entryId === "entry-home")?.played, 1);
  assert.deepEqual(table.excludedFixtures, [
    { fixtureId: "large-score-2", reason: "unsafe_standings_totals" }
  ]);
});

test("disposable v2 schema inputs calculate from explicit participants and confirmed score state", () => {
  allowSqliteInstantiation(() => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      runMigrations(database, [{
        version: 1,
        name: "disposable-standings-test-prerequisites",
        sql: `
          CREATE TABLE competitions (id TEXT PRIMARY KEY);
          CREATE TABLE seasons (
            id TEXT PRIMARY KEY,
            competition_id TEXT NOT NULL,
            UNIQUE (competition_id, id),
            FOREIGN KEY (competition_id) REFERENCES competitions(id)
          );
          CREATE TABLE teams (id TEXT PRIMARY KEY);
          CREATE TABLE players (id TEXT PRIMARY KEY);
          CREATE TABLE matches (
            id TEXT PRIMARY KEY,
            competition_id TEXT NOT NULL,
            season_id TEXT,
            home_team_id TEXT NOT NULL,
            away_team_id TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (competition_id) REFERENCES competitions(id),
            FOREIGN KEY (season_id) REFERENCES seasons(id),
            FOREIGN KEY (home_team_id) REFERENCES teams(id),
            FOREIGN KEY (away_team_id) REFERENCES teams(id)
          );
          CREATE TABLE match_score_state (
            match_id TEXT PRIMARY KEY,
            home_score INTEGER NOT NULL,
            away_score INTEGER NOT NULL,
            status TEXT NOT NULL,
            final_result_confirmed INTEGER NOT NULL
          );
        `
      }, competitionEntryMigration]);

      database.exec(`
        INSERT INTO competitions(id) VALUES ('competition-1');
        INSERT INTO seasons(id, competition_id) VALUES ('season-1', 'competition-1');
        INSERT INTO teams(id) VALUES ('team-home'), ('team-away');
        INSERT INTO matches(id, competition_id, season_id, home_team_id, away_team_id, status)
          VALUES ('fixture-1', 'competition-1', 'season-1', 'team-home', 'team-away', 'ended');
        INSERT INTO competition_entries
          (id, competition_id, season_id, entry_type, team_id, created_at)
          VALUES ('entry-home', 'competition-1', 'season-1', 'team', 'team-home', 'now'),
                 ('entry-away', 'competition-1', 'season-1', 'team', 'team-away', 'now');
        INSERT INTO fixture_participants
          (id, match_id, competition_id, season_id, entry_id, slot, created_at)
          VALUES ('participant-home', 'fixture-1', 'competition-1', 'season-1', 'entry-home', 'home', 'now'),
                 ('participant-away', 'fixture-1', 'competition-1', 'season-1', 'entry-away', 'away', 'now');
        INSERT INTO match_score_state(match_id, home_score, away_score, status, final_result_confirmed)
          VALUES ('fixture-1', 2, 0, 'ended', 1);
      `);

      const entries = database.prepare(`
        SELECT id, competition_id AS competitionId, season_id AS seasonId,
               entry_type AS competitorType, team_id AS teamId
        FROM competition_entries
      `).all() as StandingsEntry[];
      const fixtures = database.prepare(`
        SELECT id, competition_id AS competitionId, season_id AS seasonId,
               status, home_team_id AS homeTeamId, away_team_id AS awayTeamId
        FROM matches
      `).all() as StandingsFixture[];
      const participants = database.prepare(`
        SELECT match_id AS fixtureId, entry_id AS entryId, slot
        FROM fixture_participants
      `).all() as StandingsFixtureParticipant[];
      const resultRows = database.prepare(`
        SELECT m.id AS fixtureId, m.competition_id AS competitionId, m.season_id AS seasonId,
               ms.status, ms.final_result_confirmed AS finalResultConfirmed,
               m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId,
               ms.home_score AS homeScore, ms.away_score AS awayScore
        FROM matches m
        JOIN match_score_state ms ON ms.match_id = m.id
      `).all() as Array<
        Omit<ValidatedStandingsResult, "finalResultConfirmed"> & { finalResultConfirmed: number }
      >;
      const results: ValidatedStandingsResult[] = resultRows.map((row) => ({
        ...row,
        finalResultConfirmed: row.finalResultConfirmed === 1
      }));

      const table = calculateStandings({
        ...context,
        entries,
        fixtures,
        participants,
        results,
        ruleset: conventionalTeamLeagueRuleset
      });
      assert.deepEqual(table.rows.map(({ entryId, rank, played, points }) => ({
        entryId, rank, played, points
      })), [
        { entryId: "entry-home", rank: 1, played: 1, points: 3 },
        { entryId: "entry-away", rank: 2, played: 1, points: 0 }
      ]);
      assert.deepEqual(table.excludedFixtures, []);
    } finally {
      database.close();
    }
  });
});
