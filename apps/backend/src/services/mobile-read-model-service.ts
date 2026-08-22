import type { Competition, Country, NewsArticle, Season, Sport, Team } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { getClubDetailById } from "../repositories/teams-repository.js";
import { getCanonicalFixtureById, listCanonicalFixtures, listCanonicalFixturesForTeam } from "../repositories/fixtures-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { listSports } from "../repositories/sports-repository.js";
import { listCompetitions } from "../repositories/competitions-repository.js";
import { listSeasons, getSeasonById } from "../repositories/seasons-repository.js";
import type { ScoreMatchSummary } from "./score-service.js";
import { getCachedScoreSnapshot } from "./score-service.js";
import { getFixtureLineups } from "../repositories/fixture-lineups-repository.js";

export type MobileClub = Team & { sport: Pick<Sport, "id" | "name">; country: Pick<Country, "id" | "name"> | null };
export type MobileSeason = Season & { competition?: Pick<Competition, "id" | "name" | "slug"> };
export type MobileStream = { id: string; matchId: string; channelId: string; channelName: string; providerId: string; providerName: string; status: string; approvalStatus: string; healthStatus: string };
export type MobileFixture = {
  id: string;
  startsAt: string;
  status: string;
  venue: string | null;
  competition: { id: string; name: string; slug: string };
  season: { id: string; name: string } | null;
  sport: { id: string; name: string } | null;
  country: { id: string; name: string } | null;
  homeClub: MobileClub;
  awayClub: MobileClub;
  score: { home: number | null; away: number | null; winner: string | null } | null;
  liveState: { isLive: boolean; status: string; homeScore: number | null; awayScore: number | null; elapsed: number | null; updatedAt: string | null } | null;
  live: boolean;
  streams: MobileStream[];
  lineups: MobileLineup[];
};
export type MobileLineup = {
  id: string;
  teamId: string;
  status: string;
  formation: { id: string; name: string; formation: string; positions: Array<{ x: number; y: number; label?: string }> };
  starters: Array<{ slotIndex: number; playerId: string; name: string; shirtNumber: number | null; photoUrl: string | null; position: string | null }>;
  substitutes: Array<{ playerId: string; name: string; shirtNumber: number | null; photoUrl: string | null; position: string | null }>;
  captainPlayerId: string | null;
};

function fixtureLineups(fixtureId: string): MobileLineup[] {
  const database = getDatabase();
  return getFixtureLineups(fixtureId).map((lineup) => {
    const formation = database.prepare("SELECT id, name, formation, positions_json FROM formation_templates WHERE id = ?").get(lineup.formationId) as any;
    const players = database.prepare("SELECT id, display_name, jersey_number, photo_url, position FROM players WHERE id IN (SELECT player_id FROM lineup_player_assignments WHERE lineup_id = ?)").all(lineup.id) as any[];
    const byId = new Map(players.map((player) => [player.id, player]));
    const mapPlayer = (playerId: string) => { const player = byId.get(playerId); return { playerId, name: player?.display_name ?? "Player", shirtNumber: player?.jersey_number ?? null, photoUrl: player?.photo_url ?? null, position: player?.position ?? null }; };
    return { id: lineup.id, teamId: lineup.teamId, status: lineup.status, formation: { id: formation.id, name: formation.name, formation: formation.formation, positions: JSON.parse(formation.positions_json) }, starters: lineup.players.filter((item) => item.role === "starter").map((item) => ({ ...mapPlayer(item.playerId), slotIndex: item.slotIndex ?? 0 })), substitutes: lineup.players.filter((item) => item.role === "substitute").map((item) => mapPlayer(item.playerId)), captainPlayerId: lineup.captainPlayerId ?? null };
  });
}

function clubFromRow(row: any, fallback?: { sport?: { id: string; name: string } | null; country?: { id: string; name: string } | null }): MobileClub {
  const hostId = row.hostId ?? row.host_id;
  const host = hostId
    ? getDatabase().prepare("SELECT host_type, country_id, name FROM hosts WHERE id = ?").get(hostId) as { host_type: string; country_id: string | null; name: string } | undefined
    : undefined;
  const hostCountry = host?.host_type === "country"
    ? getDatabase().prepare("SELECT id, name FROM countries WHERE id = COALESCE(?, (SELECT id FROM countries WHERE lower(name) = lower(?) AND status = 'active'))").get(host.country_id, host.name) as { id: string; name: string } | undefined
    : undefined;
  return {
    id: row.id,
    name: row.name,
    sportId: row.sportId ?? row.sport_id,
    countryId: row.countryId ?? row.country_id ?? undefined,
    shortName: row.shortName ?? row.short_name ?? undefined,
    slug: row.slug ?? undefined,
    type: row.type,
    logoUrl: row.logoUrl ?? row.logo_url ?? undefined,
    status: row.status,
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
    sport: row.sport?.id || row.sportId || row.sport_id ? { id: row.sport?.id ?? row.sportId ?? row.sport_id, name: row.sport?.name ?? row.sport_name ?? fallback?.sport?.name ?? "" } : fallback?.sport ?? { id: "", name: "" },
    country: hostCountry ?? (row.country?.id || row.country_id ? { id: row.country?.id ?? row.country_id, name: row.country?.name ?? row.country_name ?? fallback?.country?.name ?? "" } : fallback?.country ?? null)
  };
}

function safeStreams(matchId: string): MobileStream[] {
  const rows = getDatabase().prepare(`
    SELECT s.id, s.match_id, s.channel_id, s.status, s.approval_status, s.health_status,
           c.name AS channel_name, c.provider_id, p.name AS provider_name
    FROM streams s
    JOIN channels c ON c.id = s.channel_id
    JOIN providers p ON p.id = c.provider_id
    WHERE s.match_id = ?
    ORDER BY s.updated_at DESC
  `).all(matchId) as any[];
  return rows.map((row) => ({ id: row.id, matchId: row.match_id, channelId: row.channel_id, channelName: row.channel_name, providerId: row.provider_id, providerName: row.provider_name, status: row.status, approvalStatus: row.approval_status, healthStatus: row.health_status }));
}

export function mapMobileFixture(fixture: any, suppliedSnapshot?: ScoreMatchSummary | null): MobileFixture {
  const home = clubFromRow(fixture.homeTeam, { sport: fixture.sport, country: fixture.country });
  const away = clubFromRow(fixture.awayTeam, { sport: fixture.sport, country: fixture.country });
  const snapshot = suppliedSnapshot ?? getCachedScoreSnapshot(fixture.externalMatchId);
  const score = snapshot?.score && typeof snapshot.score === "object" ? snapshot.score : null;
  const liveState = snapshot && score
    ? {
        isLive: ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "IN_PLAY", "PAUSED", "SUSPENDED"].includes(snapshot.status),
        status: snapshot.status,
        homeScore: score.home,
        awayScore: score.away,
        elapsed: snapshot.minute,
        updatedAt: new Date().toISOString()
      }
    : null;
  return {
    id: fixture.id,
    startsAt: fixture.startsAt,
    status: fixture.status,
    venue: fixture.venueName ?? null,
    competition: { id: fixture.competition.id, name: fixture.competition.name, slug: fixture.competition.slug },
    season: fixture.season ? { id: fixture.season.id, name: fixture.season.name } : null,
    sport: fixture.sport ? { id: fixture.sport.id, name: fixture.sport.name } : null,
    country: fixture.country ? { id: fixture.country.id, name: fixture.country.name } : null,
    homeClub: home,
    awayClub: away,
    score,
    liveState,
    live: liveState?.isLive ?? fixture.status === "live",
    streams: safeStreams(fixture.id)
    ,lineups: fixtureLineups(fixture.id)
  };
}

export function mobileSports() {
  return listSports().filter((sport) => sport.status === "active").map((sport) => ({ id: sport.id, name: sport.name, slug: sport.slug, logoUrl: sport.logoUrl ?? null }));
}

export function mobileCompetitions() {
  return listCompetitions().filter((competition) => competition.status === "active").map((competition) => ({ id: competition.id, name: competition.name, slug: competition.slug, sportId: competition.sportId }));
}

export function mobileClubs(filters?: { sportId?: string; countryId?: string; status?: string; teamIds?: string[] }) {
  const teamIds = uniqueIds(filters?.teamIds);
  validateFixtureFilterIds({ sportIds: [], competitionIds: [], teamIds });
  const teamClause = teamIds.length ? `AND t.id IN (${teamIds.map(() => "?").join(",")})` : "";
  const rows = getDatabase().prepare(`
    SELECT t.id, t.sport_id, t.host_id, t.country_id, t.name, t.short_name, t.slug, t.type, t.logo_url, t.status,
           sp.name AS sport_name, c.name AS country_name
    FROM teams t
    JOIN sports sp ON sp.id = t.sport_id
    LEFT JOIN countries c ON c.id = t.country_id
    WHERE t.type = 'club'
      AND t.status = 'active'
      AND (? IS NULL OR t.sport_id = ?)
      AND (? IS NULL OR t.country_id = ?)
      AND (? IS NULL OR t.status = ?)
      ${teamClause}
    ORDER BY t.name
  `).all(filters?.sportId ?? null, filters?.sportId ?? null, filters?.countryId ?? null, filters?.countryId ?? null, filters?.status ?? null, filters?.status ?? null, ...teamIds) as any[];
  return rows.map((row) => clubFromRow(row));
}

function uniqueIds(values?: string[]) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function validateFixtureFilterIds(filters: { sportIds: string[]; competitionIds: string[]; teamIds: string[] }) {
  const database = getDatabase();
  for (const [table, ids] of [["sports", filters.sportIds], ["competitions", filters.competitionIds], ["teams", filters.teamIds]] as const) {
    for (const id of ids) {
      if (!database.prepare(`SELECT id FROM ${table} WHERE id = ? AND status = 'active'`).get(id)) {
        throw new Error("invalid_fixture_filter_id");
      }
    }
  }
}

export function mobileFixtures(filters?: {
  mode?: "all" | "following";
  sportId?: string;
  sportIds?: string[];
  competitionId?: string;
  competitionIds?: string[];
  teamId?: string;
  teamIds?: string[];
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  const selectedSportId = filters?.sportId?.trim() || undefined;
  const followedSportIds = uniqueIds(filters?.sportIds);
  const sportIds = uniqueIds([...(followedSportIds), ...(selectedSportId ? [selectedSportId] : [])]);
  const competitionIds = uniqueIds([...(filters?.competitionIds ?? []), ...(filters?.competitionId ? [filters.competitionId] : [])]);
  const teamIds = uniqueIds([...(filters?.teamIds ?? []), ...(filters?.teamId ? [filters.teamId] : [])]);
  validateFixtureFilterIds({ sportIds, competitionIds, teamIds });

  const common = { status: filters?.status, from: filters?.from, to: filters?.to, limit: 100, offset: 0 };
  const following = filters?.mode === "following";
  if (following && !sportIds.length && !competitionIds.length && !teamIds.length) return [];

  const fixtureSets = following
    ? [
        ...followedSportIds
          .filter((sportId) => !selectedSportId || sportId === selectedSportId)
          .map((sportId) => listCanonicalFixtures({ ...common, sportId })),
        ...competitionIds.map((competitionId) => listCanonicalFixtures({ ...common, sportId: selectedSportId, competitionId })),
        ...teamIds.map((teamId) => listCanonicalFixtures({ ...common, sportId: selectedSportId, teamId }))
      ]
    : [listCanonicalFixtures({ ...common, sportId: selectedSportId, competitionIds, teamIds })];
  const seen = new Set<string>();
  const fixtures = fixtureSets.flat().filter((fixture): fixture is NonNullable<typeof fixture> => {
    if (!fixture || seen.has(fixture.id)) return false;
    seen.add(fixture.id);
    return true;
  });
  const offset = Math.max(filters?.offset ?? 0, 0);
  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 100);
  return fixtures.slice(offset, offset + limit).map((fixture) => mapMobileFixture(fixture));
}

export function mobileClubDetail(clubId: string) {
  const detail = getClubDetailById(clubId);
  if (!detail || detail.type !== "club") return undefined;
  const fixtures = listCanonicalFixturesForTeam(clubId).map((fixture) => mapMobileFixture(fixture));
  const nextFixture = fixtures.find((fixture) => !["ended", "completed", "cancelled"].includes(fixture.status) && Date.parse(fixture.startsAt) >= Date.now()) ?? null;
  const previousResult = [...fixtures].filter((fixture) => ["ended", "completed"].includes(fixture.status)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0] ?? null;
  return { club: clubFromRow(detail), competitions: detail.competitions, seasons: detail.seasons, nextFixture, previousResult };
}

function fixtureOptions(filters?: { seasonId?: string; competitionId?: string; status?: string; from?: string; to?: string }) {
  const fixtures = listCanonicalFixtures({ competitionId: filters?.competitionId, seasonId: filters?.seasonId }).map((fixture) => mapMobileFixture(fixture));
  return fixtures.filter((fixture) => (!filters?.status || fixture.status === filters.status) && (!filters?.from || fixture.startsAt >= filters.from) && (!filters?.to || fixture.startsAt <= filters.to));
}

export function mobileClubFixtures(clubId: string, filters?: { seasonId?: string; competitionId?: string; status?: string; from?: string; to?: string }) {
  return listCanonicalFixturesForTeam(clubId, { seasonId: filters?.seasonId, competitionId: filters?.competitionId }).map((fixture) => mapMobileFixture(fixture)).filter((fixture) => (!filters?.status || fixture.status === filters.status) && (!filters?.from || fixture.startsAt >= filters.from) && (!filters?.to || fixture.startsAt <= filters.to));
}

export function mobileFixture(fixtureId: string) {
  const fixture = getCanonicalFixtureById(fixtureId);
  if (!fixture) return undefined;
  const news = new NewsRepository().listArticles({ matchId: fixtureId, status: "published" });
  return { ...mapMobileFixture(fixture), news };
}

function safeAbsoluteUrl(value: string | null | undefined, baseUrl?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeArticleBody(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || null;
}

function toMobileNewsArticle(article: any, includeBody = false) {
  const media = Array.isArray(article.media)
    ? article.media
        .filter((item: any) => item?.mediaType === "image" || item?.media_type === "image")
        .sort((a: any, b: any) => Number(a.sortOrder ?? a.sort_order ?? 0) - Number(b.sortOrder ?? b.sort_order ?? 0))
        .map((item: any) => ({
          url: safeAbsoluteUrl(item.url, article.sourceUrl ?? undefined),
          altText: item.altText ?? item.alt_text ?? null
        }))
        .filter((item: any) => item.url)
    : [];

  return {
    id: article.id,
    title: article.title,
    summary: article.summary ?? null,
    ...(includeBody ? { body: safeArticleBody(article.body ?? article.fetchedBody) } : {}),
    ...(includeBody ? { bodyBlocks: Array.isArray(article.bodyBlocks) ? article.bodyBlocks : [] } : {}),
    status: "published",
    sourceName: article.sourceName ?? article.source?.name ?? null,
    sourceUrl: safeAbsoluteUrl(article.sourceUrl),
    publishedAt: article.publishedAt ?? null,
    imageUrl: media[0]?.url ?? null,
    media,
    categories: (article.categories ?? []).map((category: any) => ({
      type: category.categoryType,
      entityId: category.entityId
    })),
    sport: article.sport ?? null,
    competition: article.competition ?? null,
    team: article.team ?? null,
    country: article.country ?? null,
    match: article.match ?? null
  };
}

type MobileNewsFilterInput = {
  mode?: "all" | "following";
  teamId?: string;
  competitionId?: string;
  sportId?: string;
  countryId?: string;
  matchId?: string;
  teamIds?: string[];
  competitionIds?: string[];
  sportIds?: string[];
  limit?: number;
  offset?: number;
};

function asUniqueList(values?: string[] | string): string[] {
  const next = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(next.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function dedupeMobileNewsArticles(items: any[]) {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function mobileNews(filters: MobileNewsFilterInput) {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const directTeamIds = asUniqueList(filters.teamIds ?? filters.teamId);
  const directCompetitionIds = asUniqueList(filters.competitionIds ?? filters.competitionId);
  const directSportIds = asUniqueList(filters.sportIds ?? filters.sportId);

  const followingMode = filters.mode === "following";
  if (followingMode && !(directTeamIds.length || directCompetitionIds.length || directSportIds.length)) {
    return [];
  }

  if (followingMode) {
    const queries = [] as Array<{ teamId?: string; competitionId?: string; sportId?: string }>;

    for (const teamId of directTeamIds) {
      queries.push({ teamId });
    }
    for (const competitionId of directCompetitionIds) {
      queries.push({ competitionId });
    }
    for (const sportId of directSportIds) {
      queries.push({ sportId });
    }

    if (queries.length === 0) {
      return [];
    }

    const merged = dedupeMobileNewsArticles(
      queries.flatMap((query) =>
        new NewsRepository()
          .listArticles({
            status: "published",
            teamId: query.teamId,
            competitionId: query.competitionId,
            sportId: query.sportId,
            countryId: filters.countryId,
            matchId: filters.matchId,
            limit: limit,
            offset: 0
          })
          .map((article) => toMobileNewsArticle(article))
      )
    );

    return merged.slice(offset, offset + limit);
  }

  return new NewsRepository()
    .listArticles({ status: "published", teamId: filters.teamId, competitionId: filters.competitionId, sportId: filters.sportId, countryId: filters.countryId, matchId: filters.matchId, limit, offset })
    .map((article) => toMobileNewsArticle(article));
}

export function mobileNewsArticle(articleId: string) {
  const article = new NewsRepository().getArticleById(articleId);
  if (!article || article.status !== "published") return undefined;
  return toMobileNewsArticle(article, true);
}

export function mobileCompetitionSeasons(competitionId: string) {
  const competition = getDatabase().prepare("SELECT id, name, slug FROM competitions WHERE id = ?").get(competitionId) as { id: string; name: string; slug: string } | undefined;
  if (!competition) return undefined;
  return listSeasons(competitionId).map((season) => ({ ...season, competition }));
}

export function mobileSeason(seasonId: string) {
  const season = getSeasonById(seasonId);
  if (!season) return undefined;
  const competition = getDatabase().prepare("SELECT id, name, slug FROM competitions WHERE id = ?").get(season.competitionId) as { id: string; name: string; slug: string } | undefined;
  return { ...season, competition: competition ?? null };
}

export function mobileSeasonFixtures(seasonId: string) {
  const season = getSeasonById(seasonId);
  if (!season) return undefined;
  return { season, fixtures: fixtureOptions({ seasonId }).filter((fixture) => fixture.season?.id === seasonId) };
}

export function mobileSeasonTeams(seasonId: string) {
  const season = getSeasonById(seasonId);
  if (!season) return undefined;
  const rows = getDatabase().prepare("SELECT t.id FROM competition_season_teams cst JOIN teams t ON t.id = cst.team_id WHERE cst.season_id = ? ORDER BY t.name").all(seasonId) as Array<{ id: string }>;
  return { season, teams: rows.map((row) => mobileClubs().find((club) => club.id === row.id)).filter(Boolean) };
}

export function mobileCompetitionFixtures(competitionId: string, filters?: { seasonId?: string; status?: string; from?: string; to?: string }) {
  return fixtureOptions({ competitionId, ...filters });
}

export function mobileCompetitionNews(competitionId: string) {
  return mobileNews({ competitionId });
}

export function mobileClubNews(clubId: string) {
  return mobileNews({ teamId: clubId });
}
