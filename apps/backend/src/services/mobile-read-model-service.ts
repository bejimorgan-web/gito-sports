import type { Competition, Country, NewsArticle, Season, Sport, Team } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import { getClubDetailById } from "../repositories/teams-repository.js";
import { getCanonicalFixtureById, listCanonicalFixtures, listCanonicalFixturesForTeam } from "../repositories/fixtures-repository.js";
import { NewsRepository } from "../repositories/news-repository.js";
import { listSports } from "../repositories/sports-repository.js";
import { listSeasons, getSeasonById } from "../repositories/seasons-repository.js";

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
  score: null;
  live: boolean;
  streams: MobileStream[];
};

function clubFromRow(row: any, fallback?: { sport?: { id: string; name: string } | null; country?: { id: string; name: string } | null }): MobileClub {
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
    country: row.country?.id || row.country_id ? { id: row.country?.id ?? row.country_id, name: row.country?.name ?? row.country_name ?? fallback?.country?.name ?? "" } : fallback?.country ?? null
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

export function mapMobileFixture(fixture: any): MobileFixture {
  const home = clubFromRow(fixture.homeTeam, { sport: fixture.sport, country: fixture.country });
  const away = clubFromRow(fixture.awayTeam, { sport: fixture.sport, country: fixture.country });
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
    score: null,
    live: fixture.status === "live",
    streams: safeStreams(fixture.id)
  };
}

export function mobileSports() {
  return listSports().filter((sport) => sport.status === "active").map((sport) => ({ id: sport.id, name: sport.name, slug: sport.slug, logoUrl: sport.logoUrl ?? null }));
}

export function mobileClubs(filters?: { sportId?: string; countryId?: string; status?: string }) {
  const rows = getDatabase().prepare(`
    SELECT t.id, t.sport_id, t.country_id, t.name, t.short_name, t.slug, t.type, t.logo_url, t.status,
           sp.name AS sport_name, c.name AS country_name
    FROM teams t
    JOIN sports sp ON sp.id = t.sport_id
    LEFT JOIN countries c ON c.id = t.country_id
    WHERE t.type = 'club'
      AND (? IS NULL OR t.sport_id = ?)
      AND (? IS NULL OR t.country_id = ?)
      AND (? IS NULL OR t.status = ?)
    ORDER BY t.name
  `).all(filters?.sportId ?? null, filters?.sportId ?? null, filters?.countryId ?? null, filters?.countryId ?? null, filters?.status ?? null, filters?.status ?? null) as any[];
  return rows.map((row) => clubFromRow(row));
}

export function mobileClubDetail(clubId: string) {
  const detail = getClubDetailById(clubId);
  if (!detail || detail.type !== "club") return undefined;
  const fixtures = listCanonicalFixturesForTeam(clubId).map(mapMobileFixture);
  const nextFixture = fixtures.find((fixture) => !["ended", "completed", "cancelled"].includes(fixture.status) && Date.parse(fixture.startsAt) >= Date.now()) ?? null;
  const previousResult = [...fixtures].filter((fixture) => ["ended", "completed"].includes(fixture.status)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0] ?? null;
  return { club: clubFromRow(detail), competitions: detail.competitions, seasons: detail.seasons, nextFixture, previousResult };
}

function fixtureOptions(filters?: { seasonId?: string; competitionId?: string; status?: string; from?: string; to?: string }) {
  const fixtures = listCanonicalFixtures({ competitionId: filters?.competitionId, seasonId: filters?.seasonId }).map(mapMobileFixture);
  return fixtures.filter((fixture) => (!filters?.status || fixture.status === filters.status) && (!filters?.from || fixture.startsAt >= filters.from) && (!filters?.to || fixture.startsAt <= filters.to));
}

export function mobileClubFixtures(clubId: string, filters?: { seasonId?: string; competitionId?: string; status?: string; from?: string; to?: string }) {
  return listCanonicalFixturesForTeam(clubId, { seasonId: filters?.seasonId, competitionId: filters?.competitionId }).map(mapMobileFixture).filter((fixture) => (!filters?.status || fixture.status === filters.status) && (!filters?.from || fixture.startsAt >= filters.from) && (!filters?.to || fixture.startsAt <= filters.to));
}

export function mobileFixture(fixtureId: string) {
  const fixture = getCanonicalFixtureById(fixtureId);
  if (!fixture) return undefined;
  const news = new NewsRepository().listArticles({ matchId: fixtureId, status: "published" });
  return { ...mapMobileFixture(fixture), news };
}

export function mobileNews(filters: { teamId?: string; competitionId?: string; sportId?: string; countryId?: string; matchId?: string; limit?: number; offset?: number }) {
  return new NewsRepository().listArticles({ status: "published", teamId: filters.teamId, competitionId: filters.competitionId, sportId: filters.sportId, countryId: filters.countryId, matchId: filters.matchId, limit: filters.limit ?? 50, offset: filters.offset ?? 0 });
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
