import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { createStoryUnderstandingRouter } from "./ai-story-understanding.js";
import { createAccessToken } from "../services/jwt.js";

test("Story Understanding rejects anonymous and client-supplied article content", async () => {
  const app = express(); app.use(express.json()); app.use("/story", createStoryUnderstandingRouter());
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number }; const endpoint = `http://127.0.0.1:${address.port}/story`;
    const anonymous = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ articleId: "article-1", promptVersion: "story-understanding-v1" }) });
    assert.equal(anonymous.status, 401);
    const token = createAccessToken({ sub: "operator-1", role: "editor" });
    const forged = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ articleId: "article-1", promptVersion: "story-understanding-v1", body: "not canonical" }) });
    assert.equal(forged.status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
