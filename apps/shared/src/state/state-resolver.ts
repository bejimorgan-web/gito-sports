/**
 * Global State Resolution Engine
 *
 * Enforces FINAL RULE: EVENTS > API REFRESH > BACKGROUND SYNC > CACHE
 *
 * All state updates must go through resolveState() which ensures:
 * - merge state safely
 * - prevent overwriting newer data with older API responses
 * - ignore stale background sync results
 */

export interface StateSnapshot {
  value: any;
  source: "event" | "api-refresh" | "background-sync" | "cache";
  timestamp: number;
  eventId?: string | undefined;
}

interface StateTracking {
  current: StateSnapshot | null;
  previous: StateSnapshot | null;
  eventBlockUntil: number; // If event received, block lower-priority updates until this time
}

class StateResolver {
  private static instance: StateResolver;
  private stateTracking: Map<string, StateTracking> = new Map();
  private readonly eventBlockWindowMs = 5000; // Block API/sync updates for 5s after event
  private conflictCount = 0;
  private resolveCount = 0;

  private constructor() {}

  static getInstance(): StateResolver {
    if (!StateResolver.instance) {
      StateResolver.instance = new StateResolver();
    }
    return StateResolver.instance;
  }

  /**
   * Resolve new state update through priority hierarchy.
   * Returns true if update should be applied.
   * Returns false if update is rejected (stale/lower priority).
   */
  resolve(key: string, value: any, source: "event" | "api-refresh" | "background-sync" | "cache", eventId?: string): boolean {
    this.resolveCount += 1;

    const tracking = this.stateTracking.get(key) || {
      current: null,
      previous: null,
      eventBlockUntil: 0
    };

    const now = Date.now();
    const newSnapshot: StateSnapshot = {
      value,
      source,
      timestamp: now,
      eventId
    };

    // RULE 1: Events always win
    if (source === "event") {
      const blocked = tracking.current?.source === "event" && tracking.eventBlockUntil > now;
      if (!blocked) {
        tracking.previous = tracking.current || null;
        tracking.current = newSnapshot;
        tracking.eventBlockUntil = now + this.eventBlockWindowMs; // Block lower-priority updates
        this.stateTracking.set(key, tracking);
        return true;
      }
      // Event rejected if already processing another event
      return false;
    }

    // RULE 2: Block API refresh and background sync if event was recently received
    if (tracking.eventBlockUntil > now) {
      console.debug(`[StateResolver] Update blocked by recent event: key=${key} source=${source}`, {
        blockUntilMs: tracking.eventBlockUntil - now,
        recentEventId: tracking.current?.eventId
      });
      this.conflictCount += 1;
      return false;
    }

    // RULE 3: API refresh beats background sync and cache
    if (source === "api-refresh") {
      if (tracking.current?.source === "api-refresh" && tracking.current.timestamp > newSnapshot.timestamp) {
        // Reject if we already have a newer API refresh
        return false;
      }
      if (tracking.current?.source === "background-sync" || tracking.current?.source === "cache") {
        // Replace background sync or cache with API refresh
        tracking.previous = tracking.current;
        tracking.current = newSnapshot;
        this.stateTracking.set(key, tracking);
        return true;
      }
      // No current state, accept API refresh
      tracking.previous = tracking.current || null;
      tracking.current = newSnapshot;
      this.stateTracking.set(key, tracking);
      return true;
    }

    // RULE 4: Background sync beats cache but loses to events/API
    if (source === "background-sync") {
      if (
        tracking.current?.source === "event" ||
        tracking.current?.source === "api-refresh"
      ) {
        // Never overwrite event or API refresh with background sync
        console.debug(`[StateResolver] Background sync rejected (lower priority): key=${key}`, {
          currentSource: tracking.current.source,
          currentTimestamp: tracking.current.timestamp
        });
        return false;
      }
      // Accept background sync if no newer data
      if (!tracking.current || tracking.current.source === "cache") {
        tracking.previous = tracking.current || null;
        tracking.current = newSnapshot;
        this.stateTracking.set(key, tracking);
        return true;
      }
      return false;
    }

    // RULE 5: Cache is lowest priority
    if (source === "cache") {
      if (!tracking.current) {
        // Only accept cache if we have no state
        tracking.previous = null;
        tracking.current = newSnapshot;
        this.stateTracking.set(key, tracking);
        return true;
      }
      // Always reject cache if we have any state
      return false;
    }

    return false;
  }

  /**
   * Get current state for key
   */
  getState(key: string): any {
    return this.stateTracking.get(key)?.current?.value ?? null;
  }

  /**
   * Get full snapshot for debugging
   */
  getSnapshot(key: string): StateSnapshot | null {
    return this.stateTracking.get(key)?.current ?? null;
  }

  /**
   * Get resolver statistics
   */
  getStats() {
    return {
      resolveCount: this.resolveCount,
      conflictCount: this.conflictCount,
      conflictRate:
        this.resolveCount > 0 ? ((this.conflictCount / this.resolveCount) * 100).toFixed(2) + "%" : "0%",
      trackedKeys: this.stateTracking.size
    };
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.stateTracking.clear();
    this.conflictCount = 0;
    this.resolveCount = 0;
  }
}

export function getStateResolver(): StateResolver {
  return StateResolver.getInstance();
}
