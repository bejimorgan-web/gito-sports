import test from "node:test";
import assert from "node:assert/strict";
import { IptvOperationManager } from "./iptv-operation-manager.js";
import { createIptvOperation, getIptvOperation, recoverRunningIptvOperations, updateIptvOperation } from "../repositories/iptv-operation-repository.js";

async function waitForStatus(id: string, status: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = IptvOperationManager.get(id);
    if (current?.status === status) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`operation did not reach ${status}`);
}

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

test("persists creation, progress, and completion", async () => {
  const started = IptvOperationManager.start("m3u_validation", async (_operation, report) => {
    report({ total: 4, processed: 2, succeeded: 2, currentStage: "parsing", currentMessage: "Parsing." });
    await new Promise((resolve) => setTimeout(resolve, 5));
    report({ processed: 4, succeeded: 4, checkpoint: JSON.stringify({ phase: "movies", offset: 4, batchSize: 500 }) });
  }, undefined, 1_000, "provider-a");

  const created = getIptvOperation(started.id);
  assert.ok(created?.status === "queued" || created?.status === "running");
  assert.equal(created?.type, "m3u_validation");
  assert.equal((await waitForStatus(started.id, "completed")).processed, 4);
  const completed = getIptvOperation(started.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.succeeded, 4);
  assert.equal(completed?.checkpoint, JSON.stringify({ phase: "movies", offset: 4, batchSize: 500 }));
});

test("polling reads durable state after the in-memory cache is cleared", async () => {
  const started = IptvOperationManager.start("m3u_validation", async (_operation, report) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    report({ processed: 1, succeeded: 1 });
  }, undefined, 1_000, "provider-b");

  IptvOperationManager.clearCacheForTests();
  assert.equal(IptvOperationManager.get(started.id)?.id, started.id);
  assert.equal((await waitForStatus(started.id, "completed")).status, "completed");
});

test("persists failures and cancellation requests", async () => {
  const failed = IptvOperationManager.start("m3u_validation", async () => {
    throw new Error("deterministic_failure");
  }, undefined, 1_000, "provider-c");
  assert.equal((await waitForStatus(failed.id, "failed")).error, "deterministic_failure");

  const cancelled = IptvOperationManager.start("xtream_channel_sync", async (_operation, _report, signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }, undefined, 1_000, "provider-d");
  assert.equal(IptvOperationManager.cancel(cancelled.id), true);
  assert.equal((await waitForStatus(cancelled.id, "cancelled")).cancelled, true);
  assert.equal(getIptvOperation(cancelled.id)?.status, "cancelled");
});

test("recovers persisted running operations as interrupted without completing them", () => {
  const running = createIptvOperation({ type: "xtream_channel_sync", providerId: "provider-recovery" });
  updateIptvOperation(running.id, { status: "running", currentStage: "saving", currentMessage: "Saving." });
  assert.equal(recoverRunningIptvOperations() >= 1, true);
  const recovered = getIptvOperation(running.id);
  assert.equal(recovered?.status, "interrupted");
  assert.equal(recovered?.error, "operation_interrupted");
});

test("keeps a large catalogue operation observable while batches yield", async () => {
  const total = 20_000;
  const started = IptvOperationManager.start("xtream_channel_sync", async (_operation, report, signal) => {
    for (let processed = 500; processed <= total; processed += 500) {
      if (signal.aborted) return;
      report({ total, processed, succeeded: processed, currentStage: "saving_movies", currentMessage: `${processed} records saved.` });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });

  let observedProgress = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = IptvOperationManager.get(started.id);
    if ((current?.processed ?? 0) > 0 && (current?.processed ?? 0) < total) observedProgress = true;
    if (current?.status === "completed") {
      assert.equal(current.processed, total);
      assert.equal(current.succeeded, total);
      assert.equal(observedProgress, true);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  assert.fail("large catalogue operation did not complete with observable progress");
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
