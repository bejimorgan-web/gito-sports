/**
 * GiTO Shared Module Exports
 *
 * Central export point for all shared utilities, types, and hooks
 * used across desktop and mobile apps.
 */

// Re-export all domain types and utilities from packages/shared
export * from "../../../packages/shared/src/index";

// Event System
export { getEventClient, getEventSystemHealth } from "./events/event-client";
export type { EventName, EventPayload, EventHandler, EventSystemHealth } from "./events/event-client";

export { getEventDeduplicator } from "./events/event-dedupe";
export type { DedupeableEvent } from "./events/event-dedupe";

export { getEventOrderingEngine } from "./events/event-ordering";
export type { OrderableEvent } from "./events/event-ordering";

// State Management
export { getStateResolver } from "./state/state-resolver";
export type { StateSnapshot } from "./state/state-resolver";

export { resolveEventState, resolveEventStateBatch, validateStateSource } from "./state/state-resolution-wrapper";
export type { StateSource, StateResolution } from "./state/state-resolution-wrapper";

export { getGlobalInvalidation } from "./state/global-invalidation";

// Stream Management
export { getStreamStateGuard } from "./stream/stream-state-guard";
export type { StreamState } from "./stream/stream-state-guard";

// Health Monitoring
export { getSystemStabilizer } from "./health/system-stabilizer";

// Background Sync
export { getBackgroundSyncService } from "./sync/background-sync-locked";

// Hooks
export { useRealtimeSync } from "./hooks/useRealtimeSync";

// Tests
export { AcceptanceTests } from "./tests/acceptance-tests";
export type { TestResult } from "./tests/acceptance-tests";
