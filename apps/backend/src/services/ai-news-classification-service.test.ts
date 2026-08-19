import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { AiNewsClassificationService, type AiClassificationProvider } from "./ai-news-classification-service.js";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT, short_name TEXT, slug TEXT, status TEXT);
    CREATE TABLE competitions (id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT);
    CREATE TABLE countries (id TEXT PRIMARY KEY, name TEXT, status TEXT);
    CREATE TABLE sports (id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT);
    CREATE TABLE matches (id TEXT PRIMARY KEY, starts_at TEXT);
  `);
  db.prepare("INSERT INTO teams VALUES ('team-bayern', 'Bayern Munich', 'Bayern', 'bayern-munich', 'active'), ('team-dortmund', 'Borussia Dortmund', 'Dortmund', 'borussia-dortmund', 'active')").run();
  db.prepare("INSERT INTO competitions VALUES ('competition-bundesliga', 'Bundesliga', 'bundesliga', 'active')").run();
  db.prepare("INSERT INTO countries VALUES ('country-germany', 'Germany', 'active')").run();
  db.prepare("INSERT INTO sports VALUES ('sport-football', 'Football', 'football', 'active')").run();
  db.prepare("INSERT INTO matches VALUES ('match-1', '2026-08-20T15:00:00Z')").run();
  return db;
}

function provider(response: unknown): AiClassificationProvider {
  return { async classify() { return response; } };
}

const request = { title: "Bayern Munich defeat Borussia Dortmund", summary: "Bundesliga story", deterministicSuggestions: [] };

test("validates closed-world multi-entity AI suggestions and confidence normalization", async () => {
  const service = new AiNewsClassificationService(database(), provider({ suggestions: [
    { categoryType: "team", entityId: "team-bayern", confidence: 0.92, reason: "Bayern is explicitly named." },
    { categoryType: "team", entityId: "team-dortmund", confidence: 91, reason: "Dortmund is explicitly named." },
    { categoryType: "competition", entityId: "competition-bundesliga", confidence: 88, reason: "The supplied article context identifies Bundesliga." }
  ] }));
  const result = await service.classify(request, "article-1");
  assert.equal(result.length, 3);
  assert.equal(result[0]?.confidence, 92);
  assert.equal(result[0]?.classificationSource, "ai");
  assert.equal(result[0]?.classificationStatus, "suggested");
});

test("rejects unknown IDs, unsupported types, invalid confidence, duplicates, and excessive output", async () => {
  const cases = [
    { suggestions: [{ categoryType: "team", entityId: "missing", confidence: 90, reason: "x" }] },
    { suggestions: [{ categoryType: "stadium", entityId: "team-bayern", confidence: 90, reason: "x" }] },
    { suggestions: [{ categoryType: "team", entityId: "team-bayern", confidence: 0, reason: "x" }] },
    { suggestions: [{ categoryType: "team", entityId: "team-bayern", confidence: 90, reason: "x" }, { categoryType: "team", entityId: "team-bayern", confidence: 91, reason: "x" }] },
    { suggestions: Array.from({ length: 21 }, (_, index) => ({ categoryType: "team", entityId: index % 2 ? "team-bayern" : "team-dortmund", confidence: 90, reason: `reason ${index}` })) }
  ];
  for (const response of cases) {
    const service = new AiNewsClassificationService(database(), provider(response));
    await assert.rejects(() => service.classify(request, "article-1"), /ai_classification_/);
  }
});

test("provider failures remain explicit and do not produce suggestions", async () => {
  const service = new AiNewsClassificationService(database(), { async classify() { throw new Error("timeout"); } });
  await assert.rejects(() => service.classify(request, "article-1"), /timeout/);
});
