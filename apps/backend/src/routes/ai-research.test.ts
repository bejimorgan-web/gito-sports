import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { createAiResearchRouter } from "./ai-research.js";
import { createAccessToken } from "../services/jwt.js";

test("research endpoint requires authentication and rejects client article content", async () => {
  const app = express(); app.use(express.json()); app.use("/research", createAiResearchRouter());
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/research`;
    const anonymous = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ articleId: "article-1", promptVersion: "research-v1" }) });
    assert.equal(anonymous.status, 401);
    const token = createAccessToken({ sub: "operator-1", role: "editor" });
    const forged = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ articleId: "article-1", promptVersion: "research-v1", article: { body: "untrusted" } }) });
    assert.equal(forged.status, 400);
    const publish = await fetch(`${endpoint}/task-id/publish`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
    assert.equal(publish.status, 404);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
