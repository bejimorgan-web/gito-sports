import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FixtureLineupEditor } from "./FixtureLineupEditor";

test("canonical fixture lineup editor exposes independent home and away workflows", () => {
  const markup = renderToStaticMarkup(<FixtureLineupEditor accessToken="token" fixture={{ id: "fixture-1", seasonId: "season-1", sport: { id: "sport-1" }, homeTeam: { id: "home", name: "Home FC" }, awayTeam: { id: "away", name: "Away FC" } }} />);
  assert.match(markup, /Home FC Lineup/);
  assert.match(markup, /Away FC Lineup/);
  assert.match(markup, /Season Squad/);
  assert.match(markup, /Formation/);
  assert.match(markup, /Lineup Status/);
  assert.match(markup, /Captain/);
  assert.match(markup, /Substitutes/);
  assert.match(markup, /Save lineup/);
});
