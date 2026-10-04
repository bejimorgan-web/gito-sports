import assert from "node:assert/strict";
import test from "node:test";
import { AiNewsClassificationService, type AiClassificationProvider } from "./ai-news-classification-service.js";

function database() {
  const rowsByQuery: Record<string, unknown[]> = {
    "SELECT id, name, short_name, slug FROM teams WHERE status = 'active' ORDER BY name": [
      { id: "team-bayern", name: "Bayern Munich", short_name: "Bayern", slug: "bayern-munich" },
      { id: "team-dortmund", name: "Borussia Dortmund", short_name: "Dortmund", slug: "borussia-dortmund" }
    ],
    "SELECT id, name, slug FROM competitions WHERE status = 'active' ORDER BY name": [{ id: "competition-bundesliga", name: "Bundesliga", slug: "bundesliga" }],
    "SELECT id, name FROM countries WHERE status = 'active' ORDER BY name": [{ id: "country-germany", name: "Germany" }],
    "SELECT id, name, slug FROM sports WHERE status = 'active' ORDER BY name": [{ id: "sport-football", name: "Football", slug: "football" }],
    "SELECT id, id AS name FROM matches ORDER BY starts_at": [{ id: "match-1", name: "match-1" }]
  };
  return { prepare(sql: string) { return { all: () => rowsByQuery[sql] ?? [] }; } } as any;
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
