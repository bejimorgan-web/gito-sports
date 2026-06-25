import type { Request } from "express";
import { Router } from "express";

import { MatchService } from "../services/match-service.js";
import { MobileFeatureService, DEFAULT_NAVIGATION_FEATURES } from "../services/mobile-feature-service.js";
import { getDatabase } from "../db/connection.js";

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
    const features = MobileFeatureService.getNavigationFeatures();

    const safeNavigation = {
      liveScores: {
        enabled: features?.navigation?.liveScores?.enabled ?? DEFAULT_NAVIGATION_FEATURES.navigation.liveScores.enabled,
        message: features?.navigation?.liveScores?.message ?? DEFAULT_NAVIGATION_FEATURES.navigation.liveScores.message
      },
      sports: {
        enabled: features?.navigation?.sports?.enabled ?? DEFAULT_NAVIGATION_FEATURES.navigation.sports.enabled,
        message: features?.navigation?.sports?.message ?? DEFAULT_NAVIGATION_FEATURES.navigation.sports.message
      },
      live: {
        enabled: features?.navigation?.live?.enabled ?? DEFAULT_NAVIGATION_FEATURES.navigation.live.enabled,
        message: features?.navigation?.live?.message ?? DEFAULT_NAVIGATION_FEATURES.navigation.live.message
      }
    };

    console.log("[MOBILE FEATURES RESPONSE]", { navigation: safeNavigation });

    response.json({
      data: {
        navigation: safeNavigation
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
      .all() as Array<{ feature_key: string; enabled: number; display_message: string | null }>;

    const rowsByKey = new Map(rawRows.map((row) => [row.feature_key, row]));

    const navigation = {
      liveScores: {
        enabled: Boolean(rowsByKey.get("navigation.liveScores")?.enabled),
        message: rowsByKey.get("navigation.liveScores")?.display_message ?? null
      },
      sports: {
        enabled: Boolean(rowsByKey.get("navigation.sports")?.enabled),
        message: rowsByKey.get("navigation.sports")?.display_message ?? null
      },
      live: {
        enabled: Boolean(rowsByKey.get("navigation.live")?.enabled),
        message: rowsByKey.get("navigation.live")?.display_message ?? null
      }
    };

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
