import type { Request } from "express";
import { Router } from "express";

import { MatchService } from "../services/match-service";

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
