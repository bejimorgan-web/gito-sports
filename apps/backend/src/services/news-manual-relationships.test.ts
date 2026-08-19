import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { NewsRepository } from "../repositories/news-repository.js";

function setup() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT); CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT, status TEXT); CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, status TEXT); CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT, status TEXT); CREATE TABLE matches (id TEXT PRIMARY KEY, home_team_id TEXT, away_team_id TEXT); CREATE TABLE news_articles (id TEXT PRIMARY KEY, title TEXT, slug TEXT UNIQUE, status TEXT, sport_id TEXT, competition_id TEXT, team_id TEXT, country_id TEXT, match_id TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE news_article_categories (id TEXT PRIMARY KEY, article_id TEXT, category_type TEXT, entity_id TEXT, confidence INTEGER DEFAULT 100, reason TEXT, classification_source TEXT DEFAULT 'editorial', classification_status TEXT DEFAULT 'approved', created_at TEXT, updated_at TEXT); CREATE TABLE news_article_media (id TEXT, article_id TEXT, media_type TEXT, url TEXT, alt_text TEXT, sort_order INTEGER, created_at TEXT); CREATE TABLE news_article_links (id TEXT, article_id TEXT, url TEXT, label TEXT, sort_order INTEGER, created_at TEXT); CREATE TABLE news_article_audit (id TEXT, article_id TEXT, actor_id TEXT, action TEXT, note TEXT, created_at TEXT); CREATE TABLE news_sources (id TEXT, name TEXT, source_type TEXT);`);
  db.prepare("INSERT INTO sports VALUES ('sport-1','Football','football','active')").run();
  db.prepare("INSERT INTO countries VALUES ('country-1','Germany','active')").run();
  db.prepare("INSERT INTO teams VALUES ('team-bayern','Bayern Munich','active'),('team-dortmund','Borussia Dortmund','active')").run();
  db.prepare("INSERT INTO competitions VALUES ('competition-1','Bundesliga','active')").run();
  db.prepare("INSERT INTO matches VALUES ('match-1','team-bayern','team-dortmund')").run();
  db.prepare("INSERT INTO news_articles VALUES ('article-1','Bayern story','bayern-story','draft',NULL,NULL,NULL,NULL,NULL,datetime('now'),datetime('now'))").run();
  return db;
}

test("manual relationships support multiple entities, projection, destination preview, and safe removal", () => {
  const db = setup();
  const repository = new NewsRepository(db);
  const bayern = repository.addManualCategory("article-1", "team", "team-bayern");
  const dortmund = repository.addManualCategory("article-1", "team", "team-dortmund");
  const competition = repository.addManualCategory("article-1", "competition", "competition-1");
  const match = repository.addManualCategory("article-1", "match", "match-1");
  assert.equal(bayern.classificationSource, "editorial");
  assert.equal(repository.listApprovedCategories("article-1").length, 4);
  assert.equal(db.prepare("SELECT team_id, competition_id, match_id FROM news_articles WHERE id = 'article-1'").get().team_id, "team-bayern");
  assert.equal(repository.removeApprovedCategory("article-1", dortmund.id), true);
  assert.equal(repository.listApprovedCategories("article-1").some((item) => item.entityId === "team-dortmund"), false);
  assert.equal(db.prepare("SELECT id FROM teams WHERE id = 'team-dortmund'").get().id, "team-dortmund");
  assert.equal(repository.listApprovedCategories("article-1").some((item) => item.id === competition.id), true);
  assert.equal(repository.listApprovedCategories("article-1").some((item) => item.id === match.id), true);
  assert.throws(() => repository.addManualCategory("article-1", "team", "missing-team"), /classification_entity_not_found/);
});
