import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { NewsClassificationService } from "./news-classification-service.js";
import { NewsRepository } from "../repositories/news-repository.js";

function createDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, status TEXT NOT NULL);
    CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT NOT NULL, iso2_code TEXT, iso3_code TEXT, status TEXT NOT NULL);
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL);
    CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT, sport_id TEXT, country_id TEXT, status TEXT NOT NULL);
    CREATE TABLE sport_countries (id TEXT PRIMARY KEY, sport_id TEXT, country_id TEXT);
    CREATE TABLE matches (id TEXT PRIMARY KEY, competition_id TEXT, home_team_id TEXT, away_team_id TEXT);
    CREATE TABLE news_articles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, summary TEXT, body TEXT,
      status TEXT NOT NULL, sport_id TEXT, competition_id TEXT, team_id TEXT, country_id TEXT, match_id TEXT,
      source_id TEXT, source_name TEXT, source_url TEXT, author TEXT, categories_json TEXT, tags_json TEXT,
      content_availability TEXT, created_by TEXT, published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE news_article_media (id TEXT PRIMARY KEY, article_id TEXT, media_type TEXT, url TEXT, alt_text TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE news_article_links (id TEXT PRIMARY KEY, article_id TEXT, url TEXT, label TEXT, sort_order INTEGER, created_at TEXT);
    CREATE TABLE news_article_audit (id TEXT PRIMARY KEY, article_id TEXT, actor_id TEXT, action TEXT, note TEXT, created_at TEXT);
    CREATE TABLE news_article_categories (id TEXT PRIMARY KEY, article_id TEXT, category_type TEXT, entity_id TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE news_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, source_type TEXT, base_url TEXT, feed_url TEXT, enabled INTEGER, created_at TEXT, updated_at TEXT);
  `);
  db.exec(`
    INSERT INTO sports VALUES ('sport-football', 'Football', 'football', 'active');
    INSERT INTO countries VALUES ('country-england', 'England', 'GB', 'GBR', 'active');
    INSERT INTO countries VALUES ('country-spain', 'Spain', 'ES', 'ESP', 'active');
    INSERT INTO teams VALUES ('team-united', 'Manchester United', 'United', 'sport-football', 'country-england', 'active');
    INSERT INTO teams VALUES ('team-city', 'Manchester City', 'City', 'sport-football', 'country-england', 'active');
    INSERT INTO competitions VALUES ('competition-premier', 'Premier League', 'premier-league', 'sport-football', 'country-england', 'active');
    INSERT INTO sport_countries VALUES ('sport-country-1', 'sport-football', 'country-england');
    INSERT INTO matches VALUES ('match-1', 'competition-premier', 'team-united', 'team-city');
  `);
  return db;
}

test("classifies known football team, sport, country, and existing match", () => {
  const db = createDatabase();
  const result = new NewsClassificationService(db).classify({
    title: "Manchester United prepare for Premier League match",
    summary: "England club Manchester United prepare for the weekend.",
    categories: ["Football"]
  });
  assert.equal(result.sportId, "sport-football");
  assert.equal(result.teamId, "team-united");
  assert.equal(result.countryId, "country-england");
  assert.equal(result.competitionId, "competition-premier");
  assert.equal(result.matchId, "match-1");
});

test("leaves unknown and ambiguous team names unassigned", () => {
  const db = createDatabase();
  const classifier = new NewsClassificationService(db);
  assert.equal(classifier.classify({ title: "Unknown Athletic Club news" }).teamId, null);
  assert.equal(classifier.classify({ title: "Manchester derby news" }).teamId, null);
  assert.equal(classifier.classify({ title: "Manchester United news" }).teamId, "team-united");
});

test("assigns a known competition only on a confident catalog match", () => {
  const result = new NewsClassificationService(createDatabase()).classify({ title: "Premier League preview" });
  assert.equal(result.competitionId, "competition-premier");
  assert.equal(result.sportId, null);
});

test("manual editorial updates remain authoritative and collected articles stay drafts", () => {
  const db = createDatabase();
  const repository = new NewsRepository(db as any);
  db.exec("INSERT INTO news_sources VALUES ('source-1', 'BBC Sport', 'external', NULL, 'https://example.com/feed', 1, datetime('now'), datetime('now'))");
  const article = repository.createArticle({ title: "Manchester United news", status: "draft", sourceId: "source-1" });
  const updated = repository.updateArticle(article.id, { teamId: null, status: "review" });
  assert.ok(updated);
  assert.equal(updated.status, "review");
  assert.equal(updated.teamId, null);
});
