warning: in the working copy of 'apps/backend/src/routes/mobile.ts', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/apps/backend/src/routes/mobile.ts b/apps/backend/src/routes/mobile.ts[m
[1mindex dd11099..6f3c405 100644[m
[1m--- a/apps/backend/src/routes/mobile.ts[m
[1m+++ b/apps/backend/src/routes/mobile.ts[m
[36m@@ -223,14 +223,19 @@[m [mmobileRouter.get("/seasons/:seasonId/teams", (request, response) => {[m
 });[m
 [m
 mobileRouter.get("/matches/live", (request, response) => {[m
[31m-  const matches = MatchService.listPublishedLiveMatches().map((match) => ({[m
[31m-    ...match,[m
[31m-    homeTeamLogoUrl: normalizeUploadsUrl(request, match.homeTeamLogoUrl),[m
[31m-    awayTeamLogoUrl: normalizeUploadsUrl(request, match.awayTeamLogoUrl),[m
[31m-    competitionLogoUrl: normalizeUploadsUrl(request, match.competitionLogoUrl),[m
[31m-    sportLogoUrl: normalizeUploadsUrl(request, match.sportLogoUrl),[m
[31m-    countryLogoUrl: normalizeUploadsUrl(request, match.countryLogoUrl),[m
[31m-  }));[m
[32m+[m[32m  const matches = listPublishedPublicationFeed()[m
[32m+[m[32m    .filter((entry: any) => typeof entry.playbackUrl === "string" && entry.playbackUrl.length > 0)[m
[32m+[m[32m    .map((entry: any) => ({[m
[32m+[m[32m      match: entry.match,[m
[32m+[m[32m      publication: entry.publication,[m
[32m+[m[32m      playbackUrl: entry.playbackUrl,[m
[32m+[m[32m      deliveryReference: entry.deliveryReference,[m
[32m+[m[32m      stream: { id: entry.publication.publicationId, status: "active", healthStatus: entry.publication.availability === "degraded" ? "degraded" : "active" },[m
[32m+[m[32m      homeTeamName: entry.match.homeTeamName,[m
[32m+[m[32m      awayTeamName: entry.match.awayTeamName,[m
[32m+[m[32m      competitionName: entry.match.competitionName,[m
[32m+[m[32m      sportName: entry.match.sportName[m
[32m+[m[32m    }));[m
 [m
   response.json({[m
     data: matches[m
