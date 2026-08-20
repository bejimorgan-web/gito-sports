import * as React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { MobileFeatureControlScreen } from "./MobileFeatureControlScreen";
import { navigationItems } from "../../types/navigation";
import * as apiClientModule from "../../services/api-client";

test("mobile configuration is visible in the desktop navigation", () => {
  const item = navigationItems.find((entry) => entry.key === "mobileFeatures");

  assert.ok(item, "Mobile configuration item should exist in sidebar navigation");
  assert.match(item!.label, /Mobile/i, "Mobile configuration label should be obvious to operators");
});

test("mobile configuration screen renders the loading state and mobile app heading", () => {
  const markup = renderToStaticMarkup(<MobileFeatureControlScreen accessToken="token-123" />);

  assert.match(markup, /Mobile App Configuration/i);
  assert.match(markup, /Loading mobile configuration/i);
  assert.match(markup, /Mobile App/i);
});
