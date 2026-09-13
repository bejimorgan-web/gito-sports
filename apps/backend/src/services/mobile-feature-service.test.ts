import "./iptv-test-environment.js";

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NAVIGATION_FEATURES, normalizeNavigation } from "./mobile-feature-service.js";
import { MobileFeatureService } from "./mobile-feature-service.js";
import { getDatabase } from "../db/connection.js";

test("normalizes mobile navigation flags into the public response shape", () => {
  const result = normalizeNavigation([
    { feature_key: "navigation.liveScores", enabled: 0, display_message: "Scores are offline" },
    { feature_key: "navigation.sports", enabled: "true", display_message: null },
    { feature_key: "navigation.live", enabled: false, display_message: null }
  ]);

  assert.deepEqual(result, {
    liveScores: { enabled: false, message: "Scores are offline" },
    sports: { enabled: true, message: null },
    live: { enabled: false, message: null }
  });
});

test("keeps live streaming off by default for the closed-test release candidate", () => {
  assert.deepEqual(DEFAULT_NAVIGATION_FEATURES.navigation, {
    liveScores: { enabled: true, message: null },
    sports: { enabled: true, message: null },
    live: { enabled: false, message: null }
  });
});

test("persists the Live navigation flag across reads in both directions", () => {
  const database = getDatabase();

  MobileFeatureService.updateNavigationFeature("navigation.live", false, null);
  assert.equal((database.prepare("SELECT enabled FROM mobile_feature_flags WHERE feature_key = ?").get("navigation.live") as { enabled: number }).enabled, 0);

  MobileFeatureService.updateNavigationFeature("navigation.live", true, null);
  assert.equal((database.prepare("SELECT enabled FROM mobile_feature_flags WHERE feature_key = ?").get("navigation.live") as { enabled: number }).enabled, 1);
  assert.equal(MobileFeatureService.getNavigationFeatures().navigation.live.enabled, true);

  MobileFeatureService.updateNavigationFeature("navigation.live", false, null);
  assert.equal((database.prepare("SELECT enabled FROM mobile_feature_flags WHERE feature_key = ?").get("navigation.live") as { enabled: number }).enabled, 0);
  assert.equal(MobileFeatureService.getNavigationFeatures().navigation.live.enabled, false);
});
