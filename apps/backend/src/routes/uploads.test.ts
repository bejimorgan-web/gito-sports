import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gito-player-photo-upload-"));
process.env.NODE_ENV = "test";
process.env.UPLOAD_DIR = path.join(tempRoot, "uploads");
process.env.IMAGE_UPLOAD_MAX_BYTES = "128";

const [{ uploadsRouter }, { createAccessToken }] = await Promise.all([
  import("./uploads.js"),
  import("../services/jwt.js")
]);
const app = express();
app.use("/upload", uploadsRouter);
app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(error.statusCode ?? error.status ?? 500).json({ error: error.code ?? error.message });
});
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const token = createAccessToken({ sub: "photo-operator", role: "editor" });
const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/jfkAAAAASUVORK5CYII=", "base64");

async function upload(bytes: Buffer, filename = "player.png", mime = "image/png", authenticated = true) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  return fetch(`${baseUrl}/upload/images`, {
    method: "POST",
    headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    body: form
  });
}

test("image upload requires an authenticated operator", async () => {
  const response = await upload(validPng, "player.png", "image/png", false);
  assert.equal(response.status, 401);
  assert.deepEqual(await fs.readdir(process.env.UPLOAD_DIR!), []);
});

test("valid image content is persisted under a stable public upload URL", async () => {
  const response = await upload(validPng);
  assert.equal(response.status, 201);
  const body = await response.json() as { data: { url: string; contentType: string } };
  assert.match(body.data.url, /^\/uploads\/[0-9a-f-]+\.png$/);
  assert.equal(body.data.contentType, "image/png");
  assert.deepEqual(await fs.readFile(path.join(process.env.UPLOAD_DIR!, path.basename(body.data.url))), validPng);
});

test("misleading filename or MIME type cannot bypass image-content validation", async () => {
  const before = await fs.readdir(process.env.UPLOAD_DIR!);
  const response = await upload(Buffer.from("not an image"), "player.png", "image/png");
  assert.equal(response.status, 415);
  assert.deepEqual(await fs.readdir(process.env.UPLOAD_DIR!), before);
});

test("configured upload-size limit rejects oversized images", async () => {
  const oversized = Buffer.concat([validPng, Buffer.alloc(128)]);
  const response = await upload(oversized);
  assert.equal(response.status, 413);
});

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(tempRoot, { recursive: true, force: true });
});
