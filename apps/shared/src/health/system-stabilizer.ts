/**
 * System Stabilizer & Health Monitor
 *
 * Monitors:
 * - event lag
 * - duplicate rate
 * - sync conflicts
 * - cache overwrite attempts
 * - ordering violations
 *
 * Reports system stability status.
 */

import { getEventDeduplicator } from "../events/event-dedupe";
import { getEventOrderingEngine } from "../events/event-ordering";
import { getStateResolver } from "../state/state-resolver";

export type StabilityStatus = "stable" | "degraded" | "unstable";

export interface SystemStabilityReport {
  status: StabilityStatus;
  eventLagMs: number;
  duplicateEventRate: string;
  orderingViolationCount: number;
  cacheConflictCount: number;
  syncSkipCount: number;
  lastEventTimestamp: number;
  details: {
    dedupeStats: any;
    orderingStats: any;
    resolverStats: any;
  };
}

class SystemStabilizer {
  private static instance: SystemStabilizer;
  private lastEventTimestamp = 0;
  private eventLagHistory: number[] = [];
  private readonly lagHistorySize = 100;

  private constructor() {}

  static getInstance(): SystemStabilizer {
    if (!SystemStabilizer.instance) {
      SystemStabilizer.instance = new SystemStabilizer();
    }
    return SystemStabilizer.instance;
  }

  /**
   * Record event arrival for lag calculation
   */
  recordEventArrival(timestamp: number): void {
    const now = Date.now();
    const lag = now - timestamp;
    this.lastEventTimestamp = now;

    this.eventLagHistory.push(lag);
    if (this.eventLagHistory.length > this.lagHistorySize) {
      this.eventLagHistory.shift();
    }
  }

  /**
   * Get comprehensive system stability report
   */
  getSystemStabilityReport(): SystemStabilityReport {
    const deduplicator = getEventDeduplicator();
    const orderingEngine = getEventOrderingEngine();
    const resolver = getStateResolver();

    const dedupeStats = deduplicator.getStats();
    const orderingStats = orderingEngine.getStats();
    const resolverStats = resolver.getStats();

    // Calculate average event lag
    const avgEventLag =
      this.eventLagHistory.length > 0
        ? Math.round(this.eventLagHistory.reduce((a, b) => a + b, 0) / this.eventLagHistory.length)
        : 0;

    // Calculate ordering violation count
    let orderingViolationCount = 0;
    for (const eventTypeStats of Object.values(orderingStats)) {
      if (typeof eventTypeStats === "object" && "skippedCount" in eventTypeStats) {
        orderingViolationCount += (eventTypeStats as any).skippedCount;
      }
    }

    // Determine stability status
    const duplicateRate = parseFloat(dedupeStats.duplicateRate);
    const conflictRate = parseFloat(resolverStats.conflictRate);

    let status: StabilityStatus = "stable";

    if (duplicateRate > 10 || conflictRate > 15 || orderingViolationCount > 10 || avgEventLag > 1000) {
      status = "unstable";
    } else if (duplicateRate > 5 || conflictRate > 8 || orderingViolationCount > 5 || avgEventLag > 500) {
      status = "degraded";
    }

    return {
      status,
      eventLagMs: avgEventLag,
      duplicateEventRate: dedupeStats.duplicateRate,
      orderingViolationCount,
      cacheConflictCount: resolverStats.conflictCount,
      syncSkipCount: orderingViolationCount,
      lastEventTimestamp: this.lastEventTimestamp,
      details: {
        dedupeStats,
        orderingStats,
        resolverStats
      }
    };
  }

  /**
   * Log stability report
   */
  logStabilityReport(): void {
    const report = this.getSystemStabilityReport();
    console.info("[SystemStabilizer] Stability Report:", JSON.stringify(report, null, 2));
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.lastEventTimestamp = 0;
    this.eventLagHistory = [];
    getEventDeduplicator().reset();
    getEventOrderingEngine().reset();
    getStateResolver().reset();
  }
}

export function getSystemStabilizer(): SystemStabilizer {
  return SystemStabilizer.getInstance();
}
