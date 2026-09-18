import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const databasePath = path.join(os.tmpdir(), `gito-mobile-read-${process.pid}-${Date.now()}.sqlite`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = databasePath;
process.env.AUTO_RESTORE_BACKUP = "false";

const { getDatabase } = await import("../db/connection.js");
const { createCanonicalFixture } = await import("../repositories/fixtures-repository.js");
const { NewsRepository } = await import("../repositories/news-repository.js");
const mobile = await import("./mobile-read-model-service.js");

function seed() {
  const db = getDatabase();
  const now = new Date().toISOString();
  for (const table of ["publication_delivery", "publication_artifacts", "news_article_categories", "news_articles", "scheduling_matches", "matches", "competition_season_teams", "seasons", "competitions", "teams", "hosts", "countries", "sports"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-football", "Football", "football", now, now);
  db.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-germany", "Germany", "DE", "DEU", now, now);
  db.prepare("INSERT INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, ?, ?, 'country', ?, 'active', ?, ?)").run("host-germany", "sport-football", "Germany", "country-germany", now, now);
  db.prepare("INSERT INTO competitions (id, sport_id, host_id, country_id, name, slug, scope, competition_type, participant_type, logo_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'domestic', 'league', 'clubs', ?, 'active', ?, ?)").run("competition-bundesliga", "sport-football", "host-germany", "country-germany", "Bundesliga", "bundesliga", "https://example.com/bundesliga.png", now, now);
  db.prepare("INSERT INTO seasons (id, competition_id, name, status) VALUES (?, ?, ?, 'active')").run("season-2026", "competition-bundesliga", "2026/27");
  for (const [id, name, slug] of [["team-bayern", "Bayern Munich", "bayern-munich"], ["team-dortmund", "Borussia Dortmund", "borussia-dortmund"], ["team-other", "Another Club", "another-club"]] as const) {
    db.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, logo_url, status, created_at, updated_at) VALUES (?, 'sport-football', 'country-germany', ?, ?, 'club', ?, 'active', ?, ?)").run(id, name, slug, `https://example.com/${slug}.png`, now, now);
  }
  db.prepare("UPDATE teams SET host_id = ?, country_id = NULL WHERE id = ?").run("host-germany", "team-bayern");
  db.prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("membership-bayern", "competition-bundesliga", "season-2026", "team-bayern", now, now);
  db.prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("membership-dortmund", "competition-bundesliga", "season-2026", "team-dortmund", now, now);
  const fixture = createCanonicalFixture({ competitionId: "competition-bundesliga", seasonId: "season-2026", homeTeamId: "team-bayern", awayTeamId: "team-dortmund", startsAt: "2099-08-20T15:00:00.000Z", venueName: "Arena" });
  assert.ok(fixture);
  const publication = db.prepare("INSERT INTO publication_artifacts (publication_id, match_id, schema_version, source_reference, capability, publication_status, availability, created_at, updated_at, published_at) VALUES (?, ?, 1, ?, 'live', 'published', 'ready', ?, ?, ?)");
  publication.run("publication-1", fixture.id, "source-local-1", now, now, now);
  db.prepare("INSERT INTO publication_delivery (publication_id, delivery_reference, playback_url, updated_at) VALUES (?, ?, ?, ?)").run("publication-1", "delivery-1", "https://media.example/live/match.m3u8", now);
  const article = new NewsRepository().createArticle({ title: "Important Bundesliga story", status: "published" });
  const repository = new NewsRepository();
  const suggestions = [
    { articleId: article.id, categoryType: "team" as const, entityId: "team-bayern", confidence: 99, reason: "Editorial test relationship", classificationSource: "editorial" as const, classificationStatus: "suggested" as const },
    { articleId: article.id, categoryType: "team" as const, entityId: "team-dortmund", confidence: 99, reason: "Editorial test relationship", classificationSource: "editorial" as const, classificationStatus: "suggested" as const },
    { articleId: article.id, categoryType: "competition" as const, entityId: "competition-bundesliga", confidence: 99, reason: "Editorial test relationship", classificationSource: "editorial" as const, classificationStatus: "suggested" as const },
    { articleId: article.id, categoryType: "match" as const, entityId: fixture.id, confidence: 99, reason: "Editorial test relationship", classificationSource: "editorial" as const, classificationStatus: "suggested" as const }
  ];
  repository.saveClassificationSuggestions(article.id, suggestions);
  repository.approveCategories(article.id, repository.listClassificationSuggestions(article.id).map((item) => item.id));
  return { fixture, article };
}

test("mobile read model exposes publication delivery without IPTV stream relationships", () => {
  const db = getDatabase();
  const { fixture, article } = seed();
  const clubs = mobile.mobileClubs({ sportId: "sport-football" });
  assert.equal(clubs.length, 3);
  assert.equal(clubs.find((club) => club.id === "team-bayern")?.country?.id, "country-germany");

  const detail = mobile.mobileClubDetail("team-bayern")!;
  assert.equal(detail.club.id, "team-bayern");
  assert.equal(detail.competitions[0]?.hostId, "host-germany");
  assert.equal(detail.seasons[0]?.id, "season-2026");
  assert.equal(detail.nextFixture?.id, fixture.id);

  assert.equal(mobile.mobileClubNews("team-bayern").filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileClubNews("team-dortmund").filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileFixture(fixture.id)?.news.filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileFixture(fixture.id)?.playbackUrl, "https://media.example/live/match.m3u8");
  const mapped = mobile.mobileFixture(fixture.id)!;
  assert.equal(mapped.competition.logoUrl, "https://example.com/bundesliga.png");
  assert.equal(mapped.homeClub.logoUrl, "https://example.com/bayern-munich.png");
  assert.equal(mapped.awayClub.logoUrl, "https://example.com/borussia-dortmund.png");
  assert.deepEqual(mobile.mobileCompetitions({ sportId: "sport-football", hostId: "host-germany" }), [{
    id: "competition-bundesliga",
    name: "Bundesliga",
    slug: "bundesliga",
    sportId: "sport-football",
    hostId: "host-germany",
    countryId: "country-germany",
    logoUrl: "https://example.com/bundesliga.png"
  }]);
  db.prepare("DELETE FROM publication_delivery WHERE publication_id = ?").run("publication-1");
  assert.equal(mobile.mobileFixture(fixture.id)?.playbackUrl, null);
  assert.equal(mobile.mobileCompetitionFixtures("competition-bundesliga").length, 1);
  assert.equal(mobile.mobileSeasonFixtures("season-2026")?.fixtures.length, 1);
  assert.equal(mobile.mobileSeasonTeams("season-2026")?.teams.length, 2);
  assert.equal(mobile.mobileFixture(fixture.id)?.score, null);
  assert.equal(mobile.mapMobileFixture(fixture).liveState, null);
  const liveState = mobile.mapMobileFixture(fixture, {
    id: "provider-fixture-1",
    utcDate: fixture.startsAt,
    status: "2H",
    minute: 42,
    competition: { id: "competition-bundesliga", name: "Bundesliga", logoUrl: null },
    homeTeam: { id: "team-bayern", name: "Bayern Munich", logoUrl: null },
    awayTeam: { id: "team-dortmund", name: "Borussia Dortmund", logoUrl: null },
    score: { home: 2, away: 1, winner: "home" },
    events: []
  }).liveState!;
  assert.equal(liveState.isLive, true);
  assert.equal(liveState.homeScore, 2);
  assert.equal(liveState.awayScore, 1);
  assert.equal(liveState.elapsed, 42);
  assert.equal(typeof liveState.updatedAt, "string");
  assert.equal(mobile.mapMobileFixture(fixture, {
    id: "provider-fixture-1",
    utcDate: fixture.startsAt,
    status: "FT",
    minute: null,
    competition: { id: "competition-bundesliga", name: "Bundesliga", logoUrl: null },
    homeTeam: { id: "team-bayern", name: "Bayern Munich", logoUrl: null },
    awayTeam: { id: "team-dortmund", name: "Borussia Dortmund", logoUrl: null },
    score: { home: 2, away: 1, winner: "home" },
    events: []
  }).liveState?.isLive, false);

  const dateWindow = { from: "2099-08-20T00:00:00.000Z", to: "2099-08-21T00:00:00.000Z" };
  assert.equal(mobile.mobileFixtures({ mode: "all", sportId: "sport-football", ...dateWindow }).filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileFixtures({ mode: "following", sportId: "sport-football", teamIds: ["team-bayern"], ...dateWindow }).filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileFixtures({ mode: "following", sportId: "sport-football", competitionIds: ["competition-bundesliga"], ...dateWindow }).filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileFixtures({ mode: "following", sportId: "sport-football", sportIds: ["sport-football"], ...dateWindow }).filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileFixtures({ mode: "following", sportId: "sport-football", teamIds: ["team-bayern"], competitionIds: ["competition-bundesliga"], ...dateWindow }).filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileClubFixtures("team-bayern").filter((item) => item.id === fixture.id).length, 1);
  assert.equal(mobile.mobileClubFixtures("team-dortmund").filter((item) => item.id === fixture.id).length, 1);

  const byTeam = mobile.mobileNews({
    mode: "following",
    teamIds: ["team-bayern"],
    competitionIds: [],
    sportIds: []
  });
  const byCompetition = mobile.mobileNews({
    mode: "following",
    teamIds: [],
    competitionIds: ["competition-bundesliga"],
    sportIds: []
  });
  const mixed = mobile.mobileNews({
    mode: "following",
    teamIds: ["team-bayern"],
    competitionIds: ["competition-bundesliga"],
    sportIds: ["sport-football"]
  });

  assert.ok(byTeam.some((item) => item.id === article.id));
  assert.ok(byCompetition.some((item) => item.id === article.id));
  assert.equal(mixed.filter((item) => item.id === article.id).length, 1);
  assert.equal(byTeam.filter((item) => item.id === article.id).length, 1);
});

test("mobile competition catalog preserves canonical host ownership", () => {
  const db = getDatabase();
  const now = new Date().toISOString();
  const hosts = [
    ["host-england", "England", "country-england"],
    ["host-france", "France", "country-france"],
    ["host-italy", "Italy", "country-italy"],
    ["host-uefa", "UEFA", null]
  ] as const;

  for (const [hostId, name, countryId] of hosts) {
    if (countryId) {
      db.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run(countryId, name, `${name.slice(0, 2).toUpperCase()}`, `${name.slice(0, 3).toUpperCase()}`, now, now);
    }
    db.prepare("INSERT INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, 'sport-football', ?, 'country', ?, 'active', ?, ?)").run(hostId, name, countryId, now, now);
  }

  const competitions = [
    ["competition-premier", "Premier League", "host-england", "country-england"],
    ["competition-efl", "EFL Championship Shield", "host-england", "country-england"],
    ["competition-ligue1", "Ligue 1", "host-france", "country-france"],
    ["competition-seriea", "Serie A", "host-italy", "country-italy"],
    ["competition-uefa", "UEFA Champions League", "host-uefa", null]
  ] as const;

  for (const [id, name, hostId, countryId] of competitions) {
    db.prepare("INSERT INTO competitions (id, sport_id, host_id, country_id, name, slug, scope, competition_type, participant_type, logo_url, status, created_at, updated_at) VALUES (?, 'sport-football', ?, ?, ?, ?, 'international', 'league', 'clubs', ?, 'active', ?, ?)").run(id, hostId, countryId, name, id, `https://example.com/${id}.png`, now, now);
  }

  const namesFor = (hostId: string) => mobile.mobileCompetitions({ sportId: "sport-football", hostId }).map((item) => item.name);
  assert.deepEqual(namesFor("host-england").sort(), ["EFL Championship Shield", "Premier League"]);
  assert.deepEqual(namesFor("host-france"), ["Ligue 1"]);
  assert.deepEqual(namesFor("host-italy"), ["Serie A"]);
  assert.deepEqual(namesFor("host-uefa"), ["UEFA Champions League"]);
  assert.equal(namesFor("host-england").includes("Bundesliga"), false);
  assert.equal(mobile.mobileCompetitions({ sportId: "sport-football", hostId: "host-uefa" })[0]?.logoUrl, "https://example.com/competition-uefa.png");
});

test.after(() => {
  const database = getDatabase() as unknown as { close?: () => void };
  database.close?.();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
