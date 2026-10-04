import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = path.join(os.tmpdir(), `gito-ai-news-tasks-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(tempRoot, "ai-news.sqlite");
process.env.LEGACY_DATABASE_PATH = path.join(tempRoot, "missing-legacy.sqlite");
process.env.UPLOAD_DIR = path.join(tempRoot, "uploads");
process.env.BACKUP_DIR = path.join(tempRoot, "backups");
process.env.AUTO_RESTORE_BACKUP = "false";
process.env.GITO_NEWS_TEST_MODE = "true";

const [{ aiNewsTaskRouter }, { createAccessToken }] = await Promise.all([
  import("./ai-news-tasks.js"),
  import("../services/jwt.js")
]);
const app = express();
app.use(express.json());
app.use("/news/ai/tasks", aiNewsTaskRouter);
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${address.port}`;
const token = createAccessToken({ sub: "ai-news-operator", role: "editor" });

async function post(path: string, body: unknown, authenticated = true) {
  return fetch(`${baseUrl}/news/ai/tasks${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

test("AI task mutations require the existing Bearer authentication", async () => {
  const response = await post("/", { taskType: "research", promptVersion: "research-v1" }, false);
  assert.equal(response.status, 401);
});

test("task creation rejects published status and unsupported secret fields", async () => {
  const forbidden = await post("/", { taskType: "article_generation", promptVersion: "generation-v1", status: "published" });
  assert.equal(forbidden.status, 400);
  const credentials = await post("/", { taskType: "research", promptVersion: "research-v1", apiKey: "private" });
  assert.equal(credentials.status, 400);
});

test("AI task API does not expose a publish operation", async () => {
  const response = await post("/task-id/publish", {});
  assert.equal(response.status, 404);
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(tempRoot, { recursive: true, force: true });
});
