/**
 * Event State Resolution Wrapper
 *
 * Enforces MANDATORY RULE: EVENT STATE > API STATE > BACKGROUND SYNC > CACHE
 *
 * All state updates must pass through this wrapper to ensure:
 * - event-driven updates take absolute priority
 * - API refreshes do not overwrite event state  
 * - background sync never overwrites event or API state
 * - cache is only used as last resort
 *
 * Usage in React:
 *   const state = resolveEventState("iptv:channels", channels, "api-refresh");
 *   if (state.shouldApply) {
 *     setState(state.value);
 *   }
 */

import { getStateResolver } from "./state-resolver";

export type StateSource = "event" | "api-refresh" | "background-sync" | "cache";

export interface StateResolution {
  shouldApply: boolean;
  value: any;
  source: StateSource;
  blockedReason?: string;
  appliedAt: number;
}

/**
 * Resolve state update through priority hierarchy.
 *
 * Returns {shouldApply: true, value} if update should be applied.
 * Returns {shouldApply: false, blockedReason} if update is blocked (stale/lower priority).
 */
export function resolveEventState(
  key: string,
  value: any,
  source: StateSource,
  eventId?: string
): StateResolution {
  const resolver = getStateResolver();
  const appliedAt = Date.now();

  // Core resolution logic
  const shouldApply = resolver.resolve(key, value, source, eventId);

  if (shouldApply) {
    console.debug(`[StateResolver] Update applied: key=${key} source=${source}`, {
      eventId,
      appliedAt
    });
    return {
      shouldApply: true,
      value,
      source,
      appliedAt
    };
  }

  // Get reason for blocking
  const currentSnapshot = resolver.getSnapshot(key);
  const blockedReason = generateBlockReason(source, currentSnapshot?.source, key);

  console.debug(`[StateResolver] Update blocked: key=${key} source=${source}`, {
    reason: blockedReason,
    currentSource: currentSnapshot?.source
  });

  return {
    shouldApply: false,
    value: currentSnapshot?.value ?? null,
    source: currentSnapshot?.source ?? "cache",
    blockedReason,
    appliedAt
  };
}

/**
 * Helper to generate human-readable block reason
 */
function generateBlockReason(
  requestedSource: StateSource,
  currentSource: StateSource | undefined,
  key: string
): string {
  if (!currentSource) {
    return "No current state to compare";
  }

  if (requestedSource === "background-sync" && (currentSource === "event" || currentSource === "api-refresh")) {
    return `Blocking ${requestedSource}: newer ${currentSource} state exists for ${key}`;
  }

  if (requestedSource === "cache") {
    return `Blocking cache: state from ${currentSource} takes priority`;
  }

  if (requestedSource === "api-refresh" && currentSource === "event") {
    return `Blocking API refresh: recent event state blocks updates for ${key}`;
  }

  return `Blocking ${requestedSource}: lower priority than ${currentSource}`;
}

/**
 * Safety wrapper for batch state updates
 *
 * Ensures all updates in batch respect priority rules.
 */
export function resolveEventStateBatch(
  updates: Array<{
    key: string;
    value: any;
    source: StateSource;
    eventId?: string;
  }>
): StateResolution[] {
  return updates.map((u) => resolveEventState(u.key, u.value, u.source, u.eventId));
}

/**
 * Assert that a state source is valid (for testing/validation)
 */
export function validateStateSource(source: StateSource): boolean {
  return ["event", "api-refresh", "background-sync", "cache"].includes(source);
}
