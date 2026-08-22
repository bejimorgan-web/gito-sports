import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SquadManagementScreen } from "./SquadManagementScreen";
import { navigationItems } from "../../types/navigation";

test("squad management is available in desktop navigation", () => {
  assert.equal(navigationItems.find((item) => item.key === "squads")?.label, "Squads & Players");
});

test("squad management renders team, season, player, and filter controls", () => {
  const markup = renderToStaticMarkup(<SquadManagementScreen accessToken="test-token" />);
  assert.match(markup, /Season Squad &amp; Players/);
  assert.match(markup, /Select team/);
  assert.match(markup, /Season Squad/);
  assert.match(markup, /Save Player/);
  assert.match(markup, /Search player/);
  assert.match(markup, /Players/);
});
