import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";

import { allCoreReadinessFlagsReady, setReady } from "../core/server-readiness.js";
import { readinessGuard } from "./readiness-guard.js";

function invokeGuard(method: string, baseUrl: string, path: string) {
  let nextCalled = false;
  let responseStatus: number | null = null;
  const request = { method, baseUrl, path } as Request;
  const response = {
    set: () => response,
    status: (status: number) => {
      responseStatus = status;
      return response;
    },
    json: () => response
  } as unknown as Response;

  readinessGuard(request, response, (() => {
    nextCalled = true;
  }) as NextFunction);

  return { nextCalled, responseStatus };
}

test("allows feature config reads when database and feature flags are ready", () => {
  setReady("databaseReady");
  setReady("featureFlagsReady");

  const result = invokeGuard("GET", "/mobile", "/features");

  assert.equal(result.nextCalled, true);
  assert.equal(result.responseStatus, null);
});

test("core service readiness does not depend on the optional score cache", () => {
  setReady("databaseReady");
  setReady("featureFlagsReady");
  setReady("analyticsReady");

  assert.equal(allCoreReadinessFlagsReady(), true);
});

test("keeps other mobile requests blocked until full server readiness", () => {
  const result = invokeGuard("GET", "/mobile", "/clubs");

  assert.equal(result.nextCalled, false);
  assert.equal(result.responseStatus, 503);
});
