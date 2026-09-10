import test from "node:test";
import assert from "node:assert/strict";
import { IptvOperationManager } from "./iptv-operation-manager.js";

test("starts operations immediately and publishes progress", async () => {
  const started = IptvOperationManager.start("m3u_validation", async (_operation, report) => {
    report({ total: 10, processed: 5, currentStage: "parsing", currentMessage: "Parsing." });
    await new Promise((resolve) => setTimeout(resolve, 5));
    report({ processed: 10, succeeded: 9, failed: 1 });
  });

  assert.ok(started.status === "queued" || started.status === "running");
  assert.equal(typeof started.id, "string");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = IptvOperationManager.get(started.id);
    if (current?.status === "completed") {
      assert.equal(current.processed, 10);
      assert.equal(current.succeeded, 9);
      assert.equal(current.failed, 1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail("operation did not complete");
});

test("cancellation is cooperative and marks the operation cancelled", async () => {
  const started = IptvOperationManager.start("xtream_channel_sync", async (operation, report) => {
    report({ currentStage: "saving_channels", currentMessage: "Saving batch." });
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!IptvOperationManager.isCancelled(operation)) {
      report({ processed: 1, succeeded: 1 });
    }
  });

  assert.equal(IptvOperationManager.cancel(started.id), true);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = IptvOperationManager.get(started.id);
    if (current?.status === "cancelled") {
      assert.equal(current.cancelled, true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail("operation was not cancelled");
});

test("validation operations reach timeout instead of remaining pending", async () => {
  const started = IptvOperationManager.start("m3u_validation", async (_operation, _report, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, undefined, 10);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = IptvOperationManager.get(started.id);
    if (current?.status === "timeout") {
      assert.match(current.currentMessage, /timed out/i);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail("validation operation remained pending instead of timing out");
});

test("Xtream sync operations reach timeout instead of remaining pending", async () => {
  const started = IptvOperationManager.start("xtream_channel_sync", async (_operation, _report, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, undefined, 10);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = IptvOperationManager.get(started.id);
    if (current?.status === "timeout") {
      assert.match(current.currentMessage, /timed out/i);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail("Xtream sync operation remained pending instead of timing out");
});
