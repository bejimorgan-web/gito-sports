import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FormationManagementScreen } from "./FormationManagementScreen";
import { navigationItems } from "../../types/navigation";

test("formation management is available in desktop navigation", () => {
  assert.equal(navigationItems.find((item) => item.key === "formations")?.label, "Formations");
});

test("formation management renders catalog, preview, and slot controls", () => {
  const markup = renderToStaticMarkup(<FormationManagementScreen accessToken="test-token" />);
  assert.match(markup, /Formation Templates/);
  assert.match(markup, /Formation Name/);
  assert.match(markup, /Create Formation/);
  assert.match(markup, /Select sport/);
  assert.match(markup, /Formations/);
});
