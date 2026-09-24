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
export { getEventDeduplicator } from "./events/event-dedupe";
export { getEventOrderingEngine } from "./events/event-ordering";
// State Management
export { getStateResolver } from "./state/state-resolver";
export { resolveEventState, resolveEventStateBatch, validateStateSource } from "./state/state-resolution-wrapper";
export { getGlobalInvalidation } from "./state/global-invalidation";
// Stream Management
export { getStreamStateGuard } from "./stream/stream-state-guard";
// Health Monitoring
export { getSystemStabilizer } from "./health/system-stabilizer";
// Background Sync
export { getBackgroundSyncService } from "./sync/background-sync-locked";
// Hooks
export { useRealtimeSync } from "./hooks/useRealtimeSync";
// Tests
export { AcceptanceTests } from "./tests/acceptance-tests";
