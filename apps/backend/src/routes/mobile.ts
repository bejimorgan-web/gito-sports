import type { Request } from "express";
import { Router } from "express";

import { MatchService } from "../services/match-service.js";
import { MobileFeatureService, DEFAULT_NAVIGATION_FEATURES, MobileFeatureNavigationRow } from "../services/mobile-feature-service.js";
import { getDatabase } from "../db/connection.js";
import {
  mobileSports,
  mobileClubs,
  mobileClubDetail,
  mobileClubFixtures,
  mobileClubNews,
  mobileCompetitionFixtures,
  mobileCompetitionNews,
  mobileCompetitionSeasons,
  mobileFixture,
  mobileNews,
  mobileSeasonFixtures,
  mobileSeason,
  mobileSeasonTeams
} from "../services/mobile-read-model-service.js";

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

function parsePaging(request: Request) {
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error("invalid_pagination");
  return { limit, offset };
}

function filters(request: Request) {
  return {
    ...(typeof request.query.seasonId === "string" ? { seasonId: request.query.seasonId } : {}),
    ...(typeof request.query.competitionId === "string" ? { competitionId: request.query.competitionId } : {}),
    ...(typeof request.query.status === "string" ? { status: request.query.status } : {}),
    ...(typeof request.query.from === "string" ? { from: request.query.from } : {}),
    ...(typeof request.query.to === "string" ? { to: request.query.to } : {})
  };
}

mobileRouter.get("/sports", (_request, response) => response.json({ data: mobileSports() }));

mobileRouter.get("/clubs", (request, response) => {
  try {
    response.json({ data: mobileClubs({
      ...(typeof request.query.sportId === "string" ? { sportId: request.query.sportId } : {}),
      ...(typeof request.query.countryId === "string" ? { countryId: request.query.countryId } : {}),
      ...(typeof request.query.status === "string" ? { status: request.query.status } : {})
    }) });
  } catch { response.status(400).json({ error: "invalid_club_filter" }); }
});

mobileRouter.get("/clubs/:clubId", (request, response) => {
  const detail = mobileClubDetail(String(request.params.clubId ?? ""));
  if (!detail) { response.status(404).json({ error: "club_not_found" }); return; }
  response.json({ data: detail });
});

mobileRouter.get("/clubs/:clubId/news", (request, response) => {
  const clubId = String(request.params.clubId ?? "");
  if (!getDatabase().prepare("SELECT id FROM teams WHERE id = ? AND type = 'club'").get(clubId)) { response.status(404).json({ error: "club_not_found" }); return; }
  try { response.json({ data: mobileClubNews(clubId) }); }
  catch { response.status(400).json({ error: "invalid_club_news_request" }); }
});

mobileRouter.get("/clubs/:clubId/fixtures", (request, response) => {
  const clubId = String(request.params.clubId ?? "");
  if (!getDatabase().prepare("SELECT id FROM teams WHERE id = ? AND type = 'club'").get(clubId)) { response.status(404).json({ error: "club_not_found" }); return; }
  try { response.json({ data: mobileClubFixtures(clubId, filters(request)) }); }
  catch { response.status(400).json({ error: "invalid_club_fixture_request" }); }
});

mobileRouter.get("/clubs/:clubId/results", (request, response) => {
  const clubId = String(request.params.clubId ?? "");
  if (!getDatabase().prepare("SELECT id FROM teams WHERE id = ? AND type = 'club'").get(clubId)) { response.status(404).json({ error: "club_not_found" }); return; }
  try { response.json({ data: mobileClubFixtures(clubId, { ...filters(request), status: "ended" }).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)) }); }
  catch { response.status(400).json({ error: "invalid_club_results_request" }); }
});

mobileRouter.get("/clubs/:clubId/live", (request, response) => {
  const clubId = String(request.params.clubId ?? "");
  if (!getDatabase().prepare("SELECT id FROM teams WHERE id = ? AND type = 'club'").get(clubId)) { response.status(404).json({ error: "club_not_found" }); return; }
  try { response.json({ data: mobileClubFixtures(clubId, { ...filters(request), status: "live" }) }); }
  catch { response.status(400).json({ error: "invalid_club_live_request" }); }
});

mobileRouter.get("/news", (request, response) => {
  try {
    const paging = parsePaging(request);
    response.json({ data: mobileNews({
      ...paging,
      ...(typeof request.query.teamId === "string" ? { teamId: request.query.teamId } : {}),
      ...(typeof request.query.competitionId === "string" ? { competitionId: request.query.competitionId } : {}),
      ...(typeof request.query.sportId === "string" ? { sportId: request.query.sportId } : {}),
      ...(typeof request.query.countryId === "string" ? { countryId: request.query.countryId } : {}),
      ...(typeof request.query.matchId === "string" ? { matchId: request.query.matchId } : {})
    }) });
  } catch { response.status(400).json({ error: "invalid_mobile_news_request" }); }
});

mobileRouter.get("/fixtures/:fixtureId", (request, response) => {
  const fixture = mobileFixture(String(request.params.fixtureId ?? ""));
  if (!fixture) { response.status(404).json({ error: "fixture_not_found" }); return; }
  response.json({ data: fixture });
});

mobileRouter.get("/competitions/:competitionId/news", (request, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  if (!getDatabase().prepare("SELECT id FROM competitions WHERE id = ?").get(competitionId)) { response.status(404).json({ error: "competition_not_found" }); return; }
  response.json({ data: mobileCompetitionNews(competitionId) });
});

mobileRouter.get("/competitions/:competitionId/fixtures", (request, response) => {
  const competitionId = String(request.params.competitionId ?? "");
  if (!getDatabase().prepare("SELECT id FROM competitions WHERE id = ?").get(competitionId)) { response.status(404).json({ error: "competition_not_found" }); return; }
  response.json({ data: mobileCompetitionFixtures(competitionId, filters(request)) });
});

mobileRouter.get("/competitions/:competitionId/seasons", (request, response) => {
  const seasons = mobileCompetitionSeasons(String(request.params.competitionId ?? ""));
  if (!seasons) { response.status(404).json({ error: "competition_not_found" }); return; }
  response.json({ data: seasons });
});

mobileRouter.get("/seasons/:seasonId", (request, response) => {
  const season = mobileSeason(String(request.params.seasonId ?? ""));
  if (!season) { response.status(404).json({ error: "season_not_found" }); return; }
  response.json({ data: season });
});

mobileRouter.get("/seasons/:seasonId/fixtures", (request, response) => {
  const result = mobileSeasonFixtures(String(request.params.seasonId ?? ""));
  if (!result) { response.status(404).json({ error: "season_not_found" }); return; }
  response.json({ data: result.fixtures });
});

mobileRouter.get("/seasons/:seasonId/teams", (request, response) => {
  const result = mobileSeasonTeams(String(request.params.seasonId ?? ""));
  if (!result) { response.status(404).json({ error: "season_not_found" }); return; }
  response.json({ data: result.teams });
});

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
    const result = MobileFeatureService.getNavigationFeatures();
    const navigation = result.navigation;

    if (!navigation || Object.keys(navigation).length === 0) {
      console.error("[mobile/features] navigation response was empty");
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
    const db = getDatabase();
    const rawRows = db
      .prepare(`SELECT feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`)
      .all() as Array<MobileFeatureNavigationRow>;

    const result = MobileFeatureService.getNavigationFeatures();
    const navigation = result.navigation;

    if (!navigation || Object.keys(navigation).length === 0) {
      console.error("[mobile/features/debug] navigation response was empty");
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

mobileRouter.post("/features/update", (request, response) => {
  try {
    const body = request.body as {
      navigation?: {
        liveScores?: boolean;
        sports?: boolean;
        live?: boolean;
      };
    };

    if (!body.navigation || typeof body.navigation !== "object") {
      response.status(400).json({
        error: "invalid_payload",
        message: "Request body must contain 'navigation' object"
      });
      return;
    }

    const navigation = body.navigation;
    const updates: Record<string, boolean> = {};

    // Update each navigation feature
    if (typeof navigation.liveScores === "boolean") {
      MobileFeatureService.updateNavigationFeature("navigation.liveScores", navigation.liveScores, null);
      updates.liveScores = navigation.liveScores;
      console.log("[MOBILE_FEATURES_UPDATE] updated navigation.liveScores =", navigation.liveScores);
    }

    if (typeof navigation.sports === "boolean") {
      MobileFeatureService.updateNavigationFeature("navigation.sports", navigation.sports, null);
      updates.sports = navigation.sports;
      console.log("[MOBILE_FEATURES_UPDATE] updated navigation.sports =", navigation.sports);
    }

    if (typeof navigation.live === "boolean") {
      MobileFeatureService.updateNavigationFeature("navigation.live", navigation.live, null);
      updates.live = navigation.live;
      console.log("[MOBILE_FEATURES_UPDATE] updated navigation.live =", navigation.live);
    }

    // Fetch and return updated navigation
    const result = MobileFeatureService.getNavigationFeatures();
    const updatedNavigation = result.navigation;

    console.info("[mobile/features] updated navigation flags", { updates });

    response.json({
      data: {
        navigation: updatedNavigation
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[mobile/features] POST failed:", error);
    response.status(500).json({
      error: "mobile_features_update_failed",
      message: "Failed to update mobile feature flags"
    });
  }
});
