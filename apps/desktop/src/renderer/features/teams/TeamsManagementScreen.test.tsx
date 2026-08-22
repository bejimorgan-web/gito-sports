import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamsManagementScreen } from "./TeamsManagementScreen";

test("club form uses one host/country context selector", () => {
  const markup = renderToStaticMarkup(<TeamsManagementScreen accessToken="test-token" />);
  const creationPanel = markup.split('<section class="console-panel">')[1] ?? markup;
  assert.match(markup, /Participating Host \/ Country/);
  assert.doesNotMatch(creationPanel, />Country</);
  assert.match(markup, /Team Type/);
});
