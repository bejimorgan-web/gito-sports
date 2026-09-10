import crypto from "node:crypto";
import type { ParsedChannel } from "@gito/shared";

export type IptvOperationType = "xtream_validation" | "m3u_validation" | "m3u_import" | "xtream_channel_sync";
export type IptvOperationStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export interface IptvOperation {
  id: string;
  type: IptvOperationType;
  status: IptvOperationStatus;
  startedAt: string;
  completedAt?: string;
  total?: number;
  processed: number;
  succeeded: number;
  updated: number;
  skipped: number;
  failed: number;
  currentStage: string;
  currentMessage: string;
  error?: string;
  cancelled: boolean;
  createdBy?: string;
}

export interface IptvOperationProgress {
  total?: number;
  processed?: number;
  succeeded?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  currentStage?: string;
  currentMessage?: string;
}

type OperationTask = (operation: IptvOperation, report: (progress: IptvOperationProgress) => void, signal: AbortSignal) => Promise<void>;

export const IPTV_VALIDATION_TIMEOUT_MS = 30_000;

const operations = new Map<string, IptvOperation>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const operationControllers = new Map<string, AbortController>();
const RETENTION_MS = 15 * 60 * 1000;

function now() {
  return new Date().toISOString();
}

function clone(operation: IptvOperation) {
  return { ...operation };
}

function scheduleCleanup(id: string) {
  const previous = cleanupTimers.get(id);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    operations.delete(id);
    cleanupTimers.delete(id);
    operationControllers.delete(id);
  }, RETENTION_MS);
  timer.unref?.();
  cleanupTimers.set(id, timer);
}

export const IptvOperationManager = {
  start(type: IptvOperationType, task: OperationTask, createdBy?: string, timeoutMs = (type.endsWith("validation") || type.endsWith("sync")) ? IPTV_VALIDATION_TIMEOUT_MS : undefined) {
    const id = `iptv_${crypto.randomUUID()}`;
    const operation: IptvOperation = {
      id,
      type,
      status: "queued",
      startedAt: now(),
      processed: 0,
      succeeded: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      currentStage: "queued",
      currentMessage: "Operation queued.",
      cancelled: false,
      ...(createdBy ? { createdBy } : {})
    };
    operations.set(id, operation);
    const controller = new AbortController();
    operationControllers.set(id, controller);
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
    console.info("[iptv-validation] started", { operationId: id, type, timeoutMs: timeoutMs ?? null });

    void (async () => {
      operation.status = "running";
      operation.currentStage = "starting";
      operation.currentMessage = "Operation started.";
      try {
        await task(operation, (progress) => {
          Object.assign(operation, progress);
        }, controller.signal);
        if (operation.cancelled) {
          operation.status = "cancelled";
          operation.currentStage = "cancelled";
          operation.currentMessage = "Operation cancelled after the current safe batch.";
        } else if (controller.signal.aborted) {
          operation.status = "timeout";
          operation.currentStage = "timeout";
          operation.currentMessage = `Operation timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`;
          operation.error = operation.currentMessage;
        } else {
          operation.status = "completed";
          operation.currentStage = "completed";
          operation.currentMessage = "Operation completed.";
        }
        console.info("[iptv-validation] completed", { operationId: id, type, status: operation.status });
      } catch (error) {
        operation.status = operation.cancelled ? "cancelled" : controller.signal.aborted ? "timeout" : "failed";
        operation.error = error instanceof Error ? error.message : String(error);
        operation.currentStage = operation.status === "timeout" ? "timeout" : operation.status;
        operation.currentMessage = operation.status === "timeout"
          ? `Operation timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`
          : operation.error;
        console.warn("[iptv-validation] failed", { operationId: id, type, status: operation.status, message: operation.currentMessage });
      } finally {
        if (timeout) clearTimeout(timeout);
        operationControllers.delete(id);
        operation.completedAt = now();
        scheduleCleanup(id);
      }
    })();

    return clone(operation);
  },

  get(id: string) {
    const operation = operations.get(id);
    return operation ? clone(operation) : undefined;
  },

  cancel(id: string) {
    const operation = operations.get(id);
    if (!operation) return false;
    if (operation.status === "completed" || operation.status === "failed" || operation.status === "timeout" || operation.status === "cancelled") return false;
    operation.cancelled = true;
    operationControllers.get(id)?.abort();
    operation.currentMessage = "Cancellation requested; finishing the current safe batch.";
    return true;
  },

  isCancelled(operation: IptvOperation) {
    return operation.cancelled;
  },

  size() {
    return operations.size;
  }
};

export type IptvOperationChannelBatch = {
  channels: ParsedChannel[];
  processed: number;
};
