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
  db.prepare("INSERT INTO sports (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)").run("sport-football", "Football", "football", now, now);
  db.prepare("INSERT INTO countries (id, name, iso2_code, iso3_code, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-germany", "Germany", "DE", "DEU", now, now);
  db.prepare("INSERT INTO competitions (id, sport_id, country_id, name, slug, scope, competition_type, participant_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'domestic', 'league', 'clubs', 'active', ?, ?)").run("competition-bundesliga", "sport-football", "country-germany", "Bundesliga", "bundesliga", now, now);
  db.prepare("INSERT INTO seasons (id, competition_id, name, status) VALUES (?, ?, ?, 'active')").run("season-2026", "competition-bundesliga", "2026/27");
  for (const [id, name, slug] of [["team-bayern", "Bayern Munich", "bayern-munich"], ["team-dortmund", "Borussia Dortmund", "borussia-dortmund"], ["team-other", "Another Club", "another-club"]] as const) {
    db.prepare("INSERT INTO teams (id, sport_id, country_id, name, slug, type, status, created_at, updated_at) VALUES (?, 'sport-football', 'country-germany', ?, ?, 'club', 'active', ?, ?)").run(id, name, slug, now, now);
  }
  db.prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("membership-bayern", "competition-bundesliga", "season-2026", "team-bayern", now, now);
  db.prepare("INSERT INTO competition_season_teams (id, competition_id, season_id, team_id, membership_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("membership-dortmund", "competition-bundesliga", "season-2026", "team-dortmund", now, now);
  db.prepare("INSERT INTO providers (id, name, base_url, type, auth_type, status, created_at, updated_at) VALUES (?, ?, ?, 'manual', 'none', 'active', ?, ?)").run("provider-1", "Public Provider", "https://provider.example", now, now);
  db.prepare("INSERT INTO channels (id, provider_id, name, url, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").run("channel-1", "provider-1", "Sports HD", "https://stream.example/live.m3u8", now, now);
  const fixture = createCanonicalFixture({ competitionId: "competition-bundesliga", seasonId: "season-2026", homeTeamId: "team-bayern", awayTeamId: "team-dortmund", startsAt: "2099-08-20T15:00:00.000Z", venueName: "Arena" });
  assert.ok(fixture);
  db.prepare("INSERT INTO streams (id, match_id, channel_id, protocol, status, approval_status, health_status, failure_count, created_at, updated_at) VALUES (?, ?, ?, 'hls', 'active', 'active', 'active', 0, ?, ?)").run("stream-1", fixture.id, "channel-1", now, now);
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

test("mobile read model exposes stable club, fixture, News, season, and stream relationships", () => {
  const { fixture, article } = seed();
  const clubs = mobile.mobileClubs({ sportId: "sport-football" });
  assert.equal(clubs.length, 3);
  assert.equal(clubs.find((club) => club.id === "team-bayern")?.country?.id, "country-germany");

  const detail = mobile.mobileClubDetail("team-bayern")!;
  assert.equal(detail.club.id, "team-bayern");
  assert.equal(detail.seasons[0]?.id, "season-2026");
  assert.equal(detail.nextFixture?.id, fixture.id);

  assert.equal(mobile.mobileClubNews("team-bayern").filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileClubNews("team-dortmund").filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileFixture(fixture.id)?.news.filter((item) => item.id === article.id).length, 1);
  assert.equal(mobile.mobileFixture(fixture.id)?.streams[0]?.providerId, "provider-1");
  assert.equal(mobile.mobileCompetitionFixtures("competition-bundesliga").length, 1);
  assert.equal(mobile.mobileSeasonFixtures("season-2026")?.fixtures.length, 1);
  assert.equal(mobile.mobileSeasonTeams("season-2026")?.teams.length, 2);
  assert.equal(mobile.mobileFixture(fixture.id)?.score, null);
});

test.after(() => {
  const database = getDatabase() as unknown as { close?: () => void };
  database.close?.();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch { /* temporary test artifact */ }
  }
});
