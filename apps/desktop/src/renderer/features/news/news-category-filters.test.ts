import test from "node:test";
import assert from "node:assert/strict";

import {
  getFilteredCategoryOptions,
  type NewsCategoryFormRow,
  type NewsCategoryFilterInput
} from "./news-category-filters";

const sports = [
  { id: "sport-soccer", name: "Soccer", countryIds: ["country-england", "country-spain"] },
  { id: "sport-basketball", name: "Basketball", countryIds: ["country-usa"] }
] as any;

const countries = [
  { id: "country-england", name: "England" },
  { id: "country-spain", name: "Spain" },
  { id: "country-usa", name: "USA" }
] as any;

const competitions = [
  { id: "comp-premier", name: "Premier League", sportId: "sport-soccer" },
  { id: "comp-la-liga", name: "La Liga", sportId: "sport-soccer" },
  { id: "comp-nba", name: "NBA", sportId: "sport-basketball" }
] as any;

const teams = [
  { id: "team-man-utd", name: "Manchester United", sportId: "sport-soccer", countryId: "country-england" },
  { id: "team-barcelona", name: "Barcelona", sportId: "sport-soccer", countryId: "country-spain" },
  { id: "team-lakers", name: "Lakers", sportId: "sport-basketball", countryId: "country-usa" }
] as any;

const matches = [
  { id: "match-1", competitionId: "comp-premier", homeTeamId: "team-man-utd", awayTeamId: "team-arsenal", sportId: "sport-soccer" },
  { id: "match-2", competitionId: "comp-la-liga", homeTeamId: "team-barcelona", awayTeamId: "team-real", sportId: "sport-soccer" },
  { id: "match-3", competitionId: "comp-nba", homeTeamId: "team-lakers", awayTeamId: "team-celtics", sportId: "sport-basketball" }
] as any;

const categoryRows: NewsCategoryFormRow[] = [
  { id: "sport-1", categoryType: "sport", entityId: "sport-soccer" },
  { id: "country-1", categoryType: "country", entityId: "country-england" }
];

test("competition choices respect the selected sport", () => {
  const options = getFilteredCategoryOptions({
    categoryType: "competition",
    rows: categoryRows,
    sports,
    countries,
    competitions,
    teams,
    matches
  } as NewsCategoryFilterInput);

  assert.deepEqual(options.map((option) => option.id).sort(), ["comp-la-liga", "comp-premier"]);
});

test("team choices respect sport and country filters", () => {
  const options = getFilteredCategoryOptions({
    categoryType: "team",
    rows: [
      ...categoryRows,
      { id: "competition-1", categoryType: "competition", entityId: "comp-premier" }
    ],
    sports,
    countries,
    competitions,
    teams,
    matches
  } as NewsCategoryFilterInput);

  assert.deepEqual(options.map((option) => option.id), ["team-man-utd"]);
});

test("match choices respect competition and team filters", () => {
  const options = getFilteredCategoryOptions({
    categoryType: "match",
    rows: [
      { id: "sport-1", categoryType: "sport", entityId: "sport-soccer" },
      { id: "competition-1", categoryType: "competition", entityId: "comp-premier" },
      { id: "team-1", categoryType: "team", entityId: "team-man-utd" }
    ],
    sports,
    countries,
    competitions,
    teams,
    matches
  } as NewsCategoryFilterInput);

  assert.deepEqual(options.map((option) => option.id), ["match-1"]);
});
