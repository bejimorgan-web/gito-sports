import type { ParsedChannel } from "@gito/shared";
import {
  createIptvOperation,
  getIptvOperation,
  recoverRunningIptvOperations,
  requestIptvOperationCancellation,
  updateIptvOperation
} from "../repositories/iptv-operation-repository.js";

export type IptvOperationType = "xtream_validation" | "m3u_validation" | "m3u_import" | "xtream_channel_sync";
export type IptvOperationStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "cancelled" | "interrupted";

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
  checkpoint?: string | null;
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
  checkpoint?: string | null;
}

type OperationTask = (operation: IptvOperation, report: (progress: IptvOperationProgress) => void, signal: AbortSignal) => Promise<void>;

export const IPTV_VALIDATION_TIMEOUT_MS = 30_000;

const operationCache = new Map<string, IptvOperation>();
const operationControllers = new Map<string, AbortController>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RETENTION_MS = 15 * 60 * 1000;

function clone(operation: IptvOperation) {
  return { ...operation };
}

function scheduleCleanup(id: string) {
  const previous = cleanupTimers.get(id);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    operationCache.delete(id);
    cleanupTimers.delete(id);
    operationControllers.delete(id);
  }, RETENTION_MS);
  timer.unref?.();
  cleanupTimers.set(id, timer);
}

function persist(id: string, progress: IptvOperationProgress & { status?: IptvOperationStatus; error?: string | null; cancelled?: boolean; completedAt?: string; startedAt?: string }) {
  const saved = updateIptvOperation(id, progress);
  if (saved) operationCache.set(id, saved);
  return saved;
}

export const IptvOperationManager = {
  start(type: IptvOperationType, task: OperationTask, createdBy?: string, timeoutMs: number | null | undefined = (type.endsWith("validation") || type.endsWith("sync")) ? IPTV_VALIDATION_TIMEOUT_MS : undefined, providerId?: string) {
    const operation = createIptvOperation({ type, createdBy, providerId });
    operationCache.set(operation.id, operation);
    const controller = new AbortController();
    operationControllers.set(operation.id, controller);
    const timeout = timeoutMs === undefined || timeoutMs === null ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    void (async () => {
      const running = persist(operation.id, { status: "running", currentStage: "starting", currentMessage: "Operation started.", startedAt: new Date().toISOString() }) ?? operation;
      try {
        await task(running, (progress) => { persist(operation.id, progress); }, controller.signal);
        const current = getIptvOperation(operation.id) ?? running;
        if (current.cancelled) {
          persist(operation.id, { status: "cancelled", currentStage: "cancelled", currentMessage: "Operation cancelled after the current safe batch.", cancelled: true });
        } else if (controller.signal.aborted) {
          const message = `Operation timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.`;
          persist(operation.id, { status: "timeout", currentStage: "timeout", currentMessage: message, error: message });
        } else {
          persist(operation.id, { status: "completed", currentStage: "completed", currentMessage: "Operation completed." });
        }
      } catch (error) {
        const current = getIptvOperation(operation.id) ?? running;
        const status = current.cancelled ? "cancelled" : controller.signal.aborted ? "timeout" : "failed";
        const safeMessage = error instanceof Error ? error.message : String(error);
        const message = status === "timeout" ? `Operation timed out after ${Math.round((timeoutMs ?? 0) / 1000)} seconds.` : safeMessage;
        persist(operation.id, { status, currentStage: status, currentMessage: message, error: message, cancelled: status === "cancelled" });
      } finally {
        if (timeout) clearTimeout(timeout);
        operationControllers.delete(operation.id);
        scheduleCleanup(operation.id);
      }
    })();

    return clone(operation);
  },

  get(id: string) {
    const durable = getIptvOperation(id);
    if (durable) operationCache.set(id, durable);
    return durable ? clone(durable) : undefined;
  },

  cancel(id: string) {
    const operation = getIptvOperation(id);
    if (!operation || ["completed", "failed", "timeout", "cancelled", "interrupted"].includes(operation.status)) return false;
    if (!requestIptvOperationCancellation(id)) return false;
    operationControllers.get(id)?.abort();
    return true;
  },

  isCancelled(operation: IptvOperation) {
    return operation.cancelled || getIptvOperation(operation.id)?.cancelled === true;
  },

  recoverInterrupted() {
    return recoverRunningIptvOperations();
  },

  clearCacheForTests() {
    operationCache.clear();
    operationControllers.clear();
  },

  size() {
    return operationCache.size;
  }
};

export type IptvOperationChannelBatch = {
  channels: ParsedChannel[];
  processed: number;
};
