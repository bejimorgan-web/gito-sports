import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { createAiArticleGenerationRouter } from "./ai-article-generation.js";
import { createAccessToken } from "../services/jwt.js";

let calls = 0;
let workflowActorId: string | undefined;
const service = {
  async generate() { calls++; return { task: { status: "completed" }, version: null, context: [] }; },
  getWorkflowState(_articleId: string, actorId: string) { calls++; workflowActorId = actorId; return { articleExists: true, storyUnderstanding: null, research: null }; },
  getTask() { calls++; return null; }, listVersions() { calls++; return []; }, getVersion() { calls++; return null; }
} as any;
const app = express(); app.use(express.json()); app.use("/news/ai", createAiArticleGenerationRouter({ service }));
const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number }; const base = `http://127.0.0.1:${address.port}/news/ai`;
const token = createAccessToken({ sub: "article-writer", role: "editor" });

async function request(path: string, method: string, body?: unknown, authenticated = true, idempotencyKey?: string) {
  return fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("generation and generation reads require Bearer authentication", async () => {
  const create = await request("/generate-article", "POST", { articleId: "article-1" }, false, "key");
  const taskRead = await request("/generate-article/task-1", "GET", undefined, false);
  const listRead = await request("/articles/article-1/generations", "GET", undefined, false);
  const workflow = await request("/workflow/article-1", "GET", undefined, false);
  assert.equal(create.status, 401); assert.equal(taskRead.status, 401); assert.equal(listRead.status, 401); assert.equal(workflow.status, 401); assert.equal(calls, 0);
});

test("workflow state is authenticated, actor-scoped by service, and read-only", async () => {
  const response = await request("/workflow/article-1?actorId=forged-operator", "GET");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { articleExists: true, storyUnderstanding: null, research: null } });
  assert.equal(workflowActorId, "article-writer");
  assert.equal(calls, 1);
});

test("generation rejects client supplied evidence, claim data, article text, and missing idempotency key", async () => {
  calls = 0;
  const forged = await request("/generate-article", "POST", { articleId: "article-1", evidence: [{ id: "fake" }] }, true, "key");
  const forgedClaim = await request("/generate-article", "POST", { articleId: "article-1", claims: [{ id: "fake" }] }, true, "key");
  const articleText = await request("/generate-article", "POST", { articleId: "article-1", body: "Authoritative injected text" }, true, "key");
  const noKey = await request("/generate-article", "POST", { articleId: "article-1" });
  assert.equal(forged.status, 400); assert.equal(forgedClaim.status, 400); assert.equal(articleText.status, 400); assert.equal(noKey.status, 400); assert.equal(calls, 0);
});

test("generation router has no publish route", async () => {
  const response = await request("/generate-article/task-1/publish", "POST", {}, true, "key");
  assert.equal(response.status, 404);
});

test.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
