import crypto from "node:crypto";
import type { ParsedChannel } from "@gito/shared";

export type IptvOperationType = "xtream_validation" | "m3u_validation" | "m3u_import" | "xtream_channel_sync";
export type IptvOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

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

type OperationTask = (operation: IptvOperation, report: (progress: IptvOperationProgress) => void) => Promise<void>;

const operations = new Map<string, IptvOperation>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  }, RETENTION_MS);
  timer.unref?.();
  cleanupTimers.set(id, timer);
}

export const IptvOperationManager = {
  start(type: IptvOperationType, task: OperationTask, createdBy?: string) {
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

    void (async () => {
      operation.status = "running";
      operation.currentStage = "starting";
      operation.currentMessage = "Operation started.";
      try {
        await task(operation, (progress) => {
          Object.assign(operation, progress);
        });
        if (operation.cancelled) {
          operation.status = "cancelled";
          operation.currentStage = "cancelled";
          operation.currentMessage = "Operation cancelled after the current safe batch.";
        } else {
          operation.status = "completed";
          operation.currentStage = "completed";
          operation.currentMessage = "Operation completed.";
        }
      } catch (error) {
        operation.status = operation.cancelled ? "cancelled" : "failed";
        operation.error = error instanceof Error ? error.message : String(error);
        operation.currentStage = operation.cancelled ? "cancelled" : "failed";
        operation.currentMessage = operation.error;
      } finally {
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
    if (operation.status === "completed" || operation.status === "failed" || operation.status === "cancelled") return false;
    operation.cancelled = true;
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
