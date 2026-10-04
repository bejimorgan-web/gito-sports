import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { createCorsMiddleware, ELECTRON_PRODUCTION_ORIGIN, parseCorsOrigins } from "./cors-policy.js";
import { protectedRoute } from "./protected.js";
import { createAccessToken } from "../services/jwt.js";

const allowedOrigins = parseCorsOrigins("https://gito-sports.onrender.com");
const app = express();
app.use(createCorsMiddleware(allowedOrigins));
app.get("/protected", protectedRoute, (_request, response) => response.json({ allowed: true }));
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}`;
const token = createAccessToken({ sub: "cors-operator", role: "editor" });

test("CORS allowlist includes the deterministic packaged origin and local development ports", () => {
  assert.ok(parseCorsOrigins("https://gito-sports.onrender.com").includes(ELECTRON_PRODUCTION_ORIGIN));
  assert.equal(parseCorsOrigins().includes(ELECTRON_PRODUCTION_ORIGIN), true);
});

test("approved packaged Electron origin is permitted but protected routes still require a token", async () => {
  const preflight = await fetch(`${base}/auth/login`, { method: "OPTIONS", headers: {
    origin: ELECTRON_PRODUCTION_ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type"
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ELECTRON_PRODUCTION_ORIGIN);

  const unauthenticated = await fetch(`${base}/protected`, { headers: { origin: ELECTRON_PRODUCTION_ORIGIN } });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("access-control-allow-origin"), ELECTRON_PRODUCTION_ORIGIN);

  const authenticated = await fetch(`${base}/protected`, { headers: {
    origin: ELECTRON_PRODUCTION_ORIGIN,
    authorization: `Bearer ${token}`
  } });
  assert.equal(authenticated.status, 200);
});

test("localhost and loopback development origins remain allowed", async () => {
  for (const origin of ["http://localhost:4200", "http://127.0.0.1:4201"]) {
    const response = await fetch(`${base}/protected`, { method: "OPTIONS", headers: {
      origin,
      "access-control-request-method": "GET"
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
});

test("arbitrary origins get no CORS permission and requests without Origin retain existing access", async () => {
  const arbitrary = await fetch(`${base}/protected`, { method: "OPTIONS", headers: {
    origin: "https://untrusted.example",
    "access-control-request-method": "GET"
  } });
  assert.equal(arbitrary.headers.get("access-control-allow-origin"), null);

  const noOrigin = await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(noOrigin.status, 200);
  assert.equal(noOrigin.headers.get("access-control-allow-origin"), null);
});

test.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
