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

    if (!features || !features.navigation) {
      console.warn("[MOBILE_FEATURES_FALLBACK_USED] invalid navigation payload from service; returning default navigation flags");
      response.json({
        data: {
          navigation: DEFAULT_NAVIGATION_FEATURES.navigation
        },
        timestamp: new Date().toISOString()
      });
      return;
    }

    const safeNavigation = {
      liveScores: {
        enabled: features.navigation.liveScores?.enabled ?? true,
        message: features.navigation.liveScores?.message ?? null
      },
      sports: {
        enabled: features.navigation.sports?.enabled ?? true,
        message: features.navigation.sports?.message ?? null
      },
      live: {
        enabled: features.navigation.live?.enabled ?? true,
        message: features.navigation.live?.message ?? null
      }
    };

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
    const rows = db
      .prepare(`SELECT feature_key, enabled FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`)
      .all() as Array<{ feature_key: string; enabled: number }>;

    const navigation = {
      liveScores: { enabled: true },
      sports: { enabled: true },
      live: { enabled: true }
    };

    for (const row of rows) {
      if (row.feature_key === "navigation.liveScores") {
        navigation.liveScores.enabled = row.enabled === 1;
      } else if (row.feature_key === "navigation.sports") {
        navigation.sports.enabled = row.enabled === 1;
      } else if (row.feature_key === "navigation.live") {
        navigation.live.enabled = row.enabled === 1;
      }
    }

    response.json({
      databaseConnected: true,
      rowsFound: rows.length,
      navigation,
      buildTimestamp: process.env.BUILD_TIMESTAMP ?? new Date().toISOString()
    });
  } catch (error) {
    console.error("[mobile/features/debug] GET failed:", error);
    response.status(500).json({
      databaseConnected: false,
      rowsFound: 0,
      navigation: {
        liveScores: { enabled: true },
        sports: { enabled: true },
        live: { enabled: true }
      },
      buildTimestamp: process.env.BUILD_TIMESTAMP ?? new Date().toISOString()
    });
  }
});
