import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { createAiClaimsRouter } from "./ai-claims.js";
import { createAccessToken } from "../services/jwt.js";

let serviceCalls = 0;
const fakeService = {
  extract() { serviceCalls++; return { claims: [], researchSessionId: "session" }; },
  async verify() { serviceCalls++; return { task: { status: "completed" }, result: {}, assessment: {} }; },
  getClaim() { serviceCalls++; return null; },
  getClaimsForResearchTask() { serviceCalls++; return null; }
} as any;
const app = express(); app.use(express.json()); app.use("/news/ai", createAiClaimsRouter({ service: fakeService }));
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number }; const baseUrl = `http://127.0.0.1:${address.port}`;
const token = createAccessToken({ sub: "claim-operator", role: "editor" });

async function request(path: string, method: string, body?: unknown, options: { authenticated?: boolean; idempotencyKey?: string } = {}) {
  return fetch(`${baseUrl}/news/ai${path}`, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.authenticated === false ? {} : { authorization: `Bearer ${token}` }), ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("claim extraction and verification require Bearer authentication", async () => {
  const extract = await request("/claims/extract", "POST", { articleId: "article", researchTaskId: "task" }, { authenticated: false });
  const verify = await request("/claims/verify", "POST", { claimId: "claim", researchTaskId: "task" }, { authenticated: false });
  const read = await request("/claims/claim-1", "GET", undefined, { authenticated: false });
  assert.equal(extract.status, 401); assert.equal(verify.status, 401); assert.equal(read.status, 401); assert.equal(serviceCalls, 0);
});

test("verification rejects client supplied evidence and requires an idempotency key", async () => {
  const forged = await request("/claims/verify", "POST", { claimId: "claim", researchTaskId: "task", evidence: [{ id: "invented" }] }, { idempotencyKey: "key" });
  const missingKey = await request("/claims/verify", "POST", { claimId: "claim", researchTaskId: "task" });
  assert.equal(forged.status, 400); assert.equal(missingKey.status, 400); assert.equal(serviceCalls, 0);
});

test("claim API has no publish operation", async () => {
  const response = await request("/claims/claim-1/publish", "POST", {});
  assert.equal(response.status, 404);
});

test.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
