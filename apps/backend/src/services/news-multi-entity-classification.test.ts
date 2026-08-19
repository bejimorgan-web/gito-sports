import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { NewsClassificationService } from "./news-classification-service.js";
import { NewsRepository } from "../repositories/news-repository.js";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT NOT NULL, iso2_code TEXT, iso3_code TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, slug TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL, created_at TEXT, updated_at TEXT);
    CREATE TABLE sport_countries (id TEXT PRIMARY KEY, sport_id TEXT, country_id TEXT);
    CREATE TABLE matches (id TEXT PRIMARY KEY, competition_id TEXT, season_id TEXT, home_team_id TEXT, away_team_id TEXT, starts_at TEXT, venue_name TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, summary TEXT, body TEXT, status TEXT NOT NULL, sport_id TEXT, competition_id TEXT, team_id TEXT, country_id TEXT, match_id TEXT, source_id TEXT, source_name TEXT, source_url TEXT, external_id TEXT, author TEXT, categories_json TEXT, tags_json TEXT, content_availability TEXT, content_origin TEXT, fetched_body TEXT, fetched_at TEXT, fetch_status TEXT, fetch_error TEXT, created_by TEXT, published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE news_article_categories (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, category_type TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE news_article_media (id TEXT PRIMARY KEY, article_id TEXT, media_type TEXT, url TEXT, alt_text TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE news_article_links (id TEXT PRIMARY KEY, article_id TEXT, url TEXT, label TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE news_article_audit (id TEXT PRIMARY KEY, article_id TEXT, actor_id TEXT, action TEXT, note TEXT, created_at TEXT);
    CREATE TABLE news_article_research_results (id TEXT PRIMARY KEY, article_id TEXT, query TEXT, research_json TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE news_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_type TEXT, base_url TEXT, feed_url TEXT, enabled INTEGER, created_at TEXT, updated_at TEXT);
  `);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sports VALUES (?, ?, ?, 'active', ?, ?)").run("sport-football", "Football", "football", now, now);
  db.prepare("INSERT INTO sports VALUES (?, ?, ?, 'active', ?, ?)").run("sport-basketball", "Basketball", "basketball", now, now);
  db.prepare("INSERT INTO countries VALUES (?, ?, ?, ?, 'active', ?, ?)").run("country-germany", "Germany", "DE", "DEU", now, now);
  for (const [id, name, shortName] of [["team-bayern", "Bayern Munich", "Bayern"], ["team-dortmund", "Borussia Dortmund", "Dortmund"], ["team-leipzig", "RB Leipzig", "Leipzig"], ["team-leverkusen", "Bayer Leverkusen", "Leverkusen"]] as const) {
    db.prepare("INSERT INTO teams VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(id, name, shortName, name.toLowerCase().replace(/[^a-z]+/g, "-"), "sport-football", "country-germany", now, now);
  }
  for (const [id, name, slug] of [["competition-bundesliga", "Bundesliga", "bundesliga"], ["competition-champions", "UEFA Champions League", "champions-league"]]) {
    db.prepare("INSERT INTO competitions VALUES (?, ?, ?, ?, ?, 'active', ?, ?)").run(id, name, slug, "sport-football", "country-germany", now, now);
  }
  db.prepare("INSERT INTO matches VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)").run("match-der-klassiker", "competition-bundesliga", "season-1", "team-bayern", "team-dortmund", "2026-08-20T15:00:00Z", "Allianz Arena", now, now);
  return db;
}

test("classifier returns unlimited multi-entity suggestions without creating catalog rows", () => {
  const db = createDatabase();
  const before = db.prepare("SELECT COUNT(*) AS count FROM teams").get().count;
  const result = new NewsClassificationService(db).classify({
    title: "Bayern Munich defeat Borussia Dortmund as RB Leipzig chase the Bundesliga title",
    summary: "Bayern prepare for their UEFA Champions League campaign after the Bundesliga victory in Germany.",
    categories: ["Football"]
  });
  assert.deepEqual(new Set(result.suggestions.filter((item) => item.categoryType === "team").map((item) => item.entityId)), new Set(["team-bayern", "team-dortmund", "team-leipzig"]));
  assert.deepEqual(new Set(result.suggestions.filter((item) => item.categoryType === "competition").map((item) => item.entityId)), new Set(["competition-bundesliga", "competition-champions"]));
  assert.ok(result.suggestions.some((item) => item.categoryType === "country" && item.entityId === "country-germany"));
  assert.ok(result.suggestions.some((item) => item.categoryType === "sport" && item.entityId === "sport-football"));
  assert.ok(result.suggestions.some((item) => item.categoryType === "match" && item.entityId === "match-der-klassiker"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM teams").get().count, before);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM competitions").get().count, 2);
});

test("classification approvals are independent, reruns preserve decisions, and approved filters use categories", () => {
  const db = createDatabase();
  const repository = new NewsRepository(db);
  const article = repository.createArticle({ title: "Bayern and Dortmund report", status: "draft" });
  const classifier = new NewsClassificationService(db);
  const suggestions = classifier.classify({ articleId: article.id, title: "Bayern Munich defeat Borussia Dortmund in Bundesliga" }).suggestions;
  repository.saveClassificationSuggestions(article.id, suggestions);
  const teamSuggestions = repository.listClassificationSuggestions(article.id).filter((item) => item.categoryType === "team");
  assert.ok(teamSuggestions.length >= 2);
  const approved = repository.approveCategory(teamSuggestions[0]!.id);
  const rejected = repository.rejectCategory(teamSuggestions[1]!.id);
  assert.equal(approved?.classificationStatus, "approved");
  assert.equal(rejected?.classificationStatus, "rejected");
  const updatedArticle = repository.getArticleById(article.id)!;
  assert.equal(updatedArticle.teamId, approved?.entityId);
  assert.equal(repository.listArticles({ teamId: approved!.entityId }).some((item) => item.id === article.id), true);
  repository.saveClassificationSuggestions(article.id, suggestions);
  const afterRerun = repository.listArticleCategories(article.id);
  assert.equal(afterRerun.find((item) => item.id === approved!.id)?.classificationStatus, "approved");
  assert.equal(afterRerun.find((item) => item.id === rejected!.id)?.classificationStatus, "rejected");
});
