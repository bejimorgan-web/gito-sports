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
class SystemStabilizer {
    static instance;
    lastEventTimestamp = 0;
    eventLagHistory = [];
    lagHistorySize = 100;
    constructor() { }
    static getInstance() {
        if (!SystemStabilizer.instance) {
            SystemStabilizer.instance = new SystemStabilizer();
        }
        return SystemStabilizer.instance;
    }
    /**
     * Record event arrival for lag calculation
     */
    recordEventArrival(timestamp) {
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
    getSystemStabilityReport() {
        const deduplicator = getEventDeduplicator();
        const orderingEngine = getEventOrderingEngine();
        const resolver = getStateResolver();
        const dedupeStats = deduplicator.getStats();
        const orderingStats = orderingEngine.getStats();
        const resolverStats = resolver.getStats();
        // Calculate average event lag
        const avgEventLag = this.eventLagHistory.length > 0
            ? Math.round(this.eventLagHistory.reduce((a, b) => a + b, 0) / this.eventLagHistory.length)
            : 0;
        // Calculate ordering violation count
        let orderingViolationCount = 0;
        for (const eventTypeStats of Object.values(orderingStats)) {
            if (typeof eventTypeStats === "object" && "skippedCount" in eventTypeStats) {
                orderingViolationCount += eventTypeStats.skippedCount;
            }
        }
        // Determine stability status
        const duplicateRate = parseFloat(dedupeStats.duplicateRate);
        const conflictRate = parseFloat(resolverStats.conflictRate);
        let status = "stable";
        if (duplicateRate > 10 || conflictRate > 15 || orderingViolationCount > 10 || avgEventLag > 1000) {
            status = "unstable";
        }
        else if (duplicateRate > 5 || conflictRate > 8 || orderingViolationCount > 5 || avgEventLag > 500) {
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
    logStabilityReport() {
        const report = this.getSystemStabilityReport();
        console.info("[SystemStabilizer] Stability Report:", JSON.stringify(report, null, 2));
    }
    /**
     * Reset for testing
     */
    reset() {
        this.lastEventTimestamp = 0;
        this.eventLagHistory = [];
        getEventDeduplicator().reset();
        getEventOrderingEngine().reset();
        getStateResolver().reset();
    }
}
export function getSystemStabilizer() {
    return SystemStabilizer.getInstance();
}
