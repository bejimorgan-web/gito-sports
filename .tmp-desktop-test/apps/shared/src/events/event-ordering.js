/**
 * Event Ordering System
 *
 * Enforces timestamp-based ordering to prevent out-of-order state updates.
 * Maintains per-eventType ordering state.
 *
 * RULE: Events with older timestamps are ignored.
 * Events must be processed in timestamp order.
 */
// Priority ordering rules
const PRIORITY_RULES = {
    "iptv:ingestion:completed": "critical",
    "iptv:channel:updated": "high",
    "iptv:provider:updated": "high",
    "stream:recovered": "critical",
    "stream:reconnected": "critical",
    "stream:failed": "high",
    "scores:updated": "normal",
    "scores:cache:refreshed": "normal"
};
const PRIORITY_VALUE = {
    critical: 100,
    high: 50,
    normal: 10,
    low: 1
};
class EventOrderingEngine {
    static instance;
    orderingState = new Map();
    skippedEvents = [];
    maxBufferSize = 50;
    constructor() { }
    static getInstance() {
        if (!EventOrderingEngine.instance) {
            EventOrderingEngine.instance = new EventOrderingEngine();
        }
        return EventOrderingEngine.instance;
    }
    /**
     * Check if event should be processed based on ordering.
     * Returns true if event is VALID (should be processed).
     * Returns false if event is STALE (should be ignored).
     */
    isValidOrder(event) {
        const state = this.orderingState.get(event.eventType) || {
            lastProcessedTimestamp: 0,
            skippedCount: 0
        };
        if (event.timestamp < state.lastProcessedTimestamp) {
            // Event is older than last processed event for this type
            state.skippedCount += 1;
            console.debug(`[EventOrdering] Out-of-order event skipped: eventType=${event.eventType}`, {
                eventTimestamp: event.timestamp,
                lastProcessedTimestamp: state.lastProcessedTimestamp,
                skipped: state.skippedCount
            });
            this.orderingState.set(event.eventType, state);
            return false;
        }
        // Event is valid - update state
        state.lastProcessedTimestamp = event.timestamp;
        this.orderingState.set(event.eventType, state);
        return true;
    }
    /**
     * Get priority for event type (lower timestamp = higher priority when equal recency).
     * Critical events override normal events even if slightly older.
     */
    getPriority(eventType) {
        return PRIORITY_RULES[eventType] ?? "normal";
    }
    /**
     * Get priority value (higher = more important)
     */
    getPriorityValue(eventType) {
        const priority = this.getPriority(eventType);
        return PRIORITY_VALUE[priority];
    }
    /**
     * Determine if event1 should override event2 (special priority rules).
     * Used for stream:recovered overriding stream:failed, etc.
     */
    shouldOverride(event1, event2) {
        // stream:recovered always overrides stream:failed
        if (event1.eventType === "stream:recovered" && event2.eventType === "stream:failed") {
            return true;
        }
        // iptv:ingestion:completed overrides iptv:provider:updated
        if (event1.eventType === "iptv:ingestion:completed" && event2.eventType === "iptv:provider:updated") {
            return true;
        }
        // Same type - newer timestamp wins
        if (event1.eventType === event2.eventType) {
            return event1.timestamp > event2.timestamp;
        }
        return false;
    }
    /**
     * Get ordering statistics
     */
    getStats() {
        const stats = {};
        for (const [eventType, state] of this.orderingState.entries()) {
            stats[eventType] = {
                lastProcessedTimestamp: state.lastProcessedTimestamp,
                skippedCount: state.skippedCount
            };
        }
        return stats;
    }
    /**
     * Reset for testing
     */
    reset() {
        this.orderingState.clear();
        this.skippedEvents = [];
    }
}
export function getEventOrderingEngine() {
    return EventOrderingEngine.getInstance();
}
