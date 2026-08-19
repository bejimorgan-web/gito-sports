import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NAVIGATION_FEATURES, normalizeNavigation } from "./mobile-feature-service.js";

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

test("keeps all mobile sections enabled as the safe default", () => {
  assert.deepEqual(DEFAULT_NAVIGATION_FEATURES.navigation, {
    liveScores: { enabled: true, message: null },
    sports: { enabled: true, message: null },
    live: { enabled: true, message: null }
  });
});
