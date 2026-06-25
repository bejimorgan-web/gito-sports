import type { Request } from "express";
import { Router } from "express";

import { MatchService } from "../services/match-service.js";
import { MobileFeatureService, DEFAULT_NAVIGATION_FEATURES, MobileFeatureNavigationRow } from "../services/mobile-feature-service.js";
import { getDatabase } from "../db/connection.js";

console.log("[RUNTIME VERSION]", process.env.NODE_ENV);

function normalizeUploadsUrl(request: Request, url: string | undefined | null) {
  if (!url) {
    return url;
  }

  const uploadsPathMatch = url.match(/^\/uploads\/.*$/);
  const localhostUploadMatch = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(\/uploads\/.*)$/);

  if (uploadsPathMatch) {
    const normalized = `${request.protocol}://${request.get("host")}${uploadsPathMatch[0]}`;
    console.debug("normalized upload URL", { original: url, normalized });
    return normalized;
  }

  if (localhostUploadMatch) {
    const normalized = `${request.protocol}://${request.get("host")}${localhostUploadMatch[1]}`;
    console.debug("normalized localhost upload URL", { original: url, normalized });
    return normalized;
  }

  return url;
}

export const mobileRouter = Router();

mobileRouter.get("/matches/live", (request, response) => {
  const matches = MatchService.listPublishedLiveMatches().map((match) => ({
    ...match,
    homeTeamLogoUrl: normalizeUploadsUrl(request, match.homeTeamLogoUrl),
    awayTeamLogoUrl: normalizeUploadsUrl(request, match.awayTeamLogoUrl),
    competitionLogoUrl: normalizeUploadsUrl(request, match.competitionLogoUrl),
    sportLogoUrl: normalizeUploadsUrl(request, match.sportLogoUrl),
    countryLogoUrl: normalizeUploadsUrl(request, match.countryLogoUrl),
  }));

  response.json({
    data: matches
  });
});

mobileRouter.get("/features", (_request, response) => {
  try {
    console.debug("[MOBILE_FEATURES_FETCH] fetching mobile navigation feature flags");
    const result = MobileFeatureService.getNavigationFeatures();
    const navigation = result.navigation;

    console.log("[MOBILE FEATURES RESPONSE]", { navigation });
    console.log("[ROUTE RESPONSE SOURCE]", typeof navigation, navigation);
    console.log("[DEBUG FINAL NAVIGATION]", navigation);
    if (!navigation || Object.keys(navigation).length === 0) {
      console.error("[CRITICAL] navigation was lost after normalization");
    }

    response.json({
      data: {
        navigation
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[mobile/features] GET failed:", error);
    response.status(500).json({
      error: "mobile_features_fetch_failed",
      message: "Failed to fetch mobile feature flags"
    });
  }
});

mobileRouter.get("/features/debug", (_request, response) => {
  try {
    console.debug("[MOBILE_FEATURES_FETCH] fetching mobile navigation feature flags debug info");
    const db = getDatabase();
    const rawRows = db
      .prepare(`SELECT feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`)
      .all() as Array<MobileFeatureNavigationRow>;

    const result = MobileFeatureService.getNavigationFeatures();
    const navigation = result.navigation;

    console.log("[ROUTE RESPONSE SOURCE]", typeof navigation, navigation);
    console.log("[DEBUG FINAL NAVIGATION]", navigation);
    if (!navigation || Object.keys(navigation).length === 0) {
      console.error("[CRITICAL] navigation was lost after normalization");
    }

    response.json({
      databaseConnected: true,
      rowsFound: rawRows.length,
      rawRows,
      normalizedNavigation: navigation,
      navigation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[mobile/features/debug] GET failed:", error);
    response.status(500).json({
      databaseConnected: false,
      rowsFound: 0,
      rawRows: [],
      navigation: DEFAULT_NAVIGATION_FEATURES.navigation,
      timestamp: new Date().toISOString()
    });
  }
});
