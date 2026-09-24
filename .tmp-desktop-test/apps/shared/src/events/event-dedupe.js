/**
 * Event Deduplication Layer
 *
 * Detects and filters duplicate events within a 5-10 second window.
 * Maintains a sliding window of the last 100-200 event IDs.
 *
 * RULE: Every event MUST include eventId, timestamp, and eventType.
 * Duplicate events are silently ignored (no UI update).
 *
 * DEDUP STRATEGY:
 * - Primary: exact eventId match
 * - Secondary: (eventType + payload hash) for events without unique IDs
 */
/**
 * Simple hash function for payload comparison (browser-compatible)
 */
function hashPayload(payload) {
    try {
        const json = JSON.stringify(payload);
        let hash = 0;
        for (let i = 0; i < json.length; i++) {
            const char = json.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(16);
    }
    catch {
        return "invalid";
    }
}
class EventDeduplicator {
    static instance;
    dedupeWindow = new Map();
    payloadHashWindow = new Map(); // Secondary dedup by (eventType + payloadHash)
    maxWindowSize = 200; // Increased to 200 for better coverage
    dedupeTimeWindowMs = 10000; // 10 second window
    duplicateCount = 0;
    processedCount = 0;
    payloadDuplicateCount = 0;
    constructor() { }
    static getInstance() {
        if (!EventDeduplicator.instance) {
            EventDeduplicator.instance = new EventDeduplicator();
        }
        return EventDeduplicator.instance;
    }
    /**
     * Check if event is duplicate.
     * Returns true if event should be IGNORED (is duplicate).
     * Returns false if event should be PROCESSED (is new).
     */
    isDuplicate(event) {
        this.cleanOldEntries();
        // PRIMARY: Check exact eventId match
        const key = `${event.eventType}:${event.eventId}`;
        const existing = this.dedupeWindow.get(key);
        if (existing) {
            this.duplicateCount += 1;
            console.debug(`[EventDedupe] Duplicate detected (eventId): eventType=${event.eventType} eventId=${event.eventId}`, {
                duplicateCount: this.duplicateCount,
                payloadDuplicateCount: this.payloadDuplicateCount,
                processedCount: this.processedCount,
                duplicateRate: ((this.duplicateCount / (this.duplicateCount + this.processedCount)) * 100).toFixed(2) + "%"
            });
            return true;
        }
        // SECONDARY: Check payload hash for events without unique IDs or high-frequency events
        const payloadHash = hashPayload(event.payload);
        const payloadKey = `${event.eventType}:${payloadHash}`;
        const existingPayload = this.payloadHashWindow.get(payloadKey);
        if (existingPayload && Date.now() - existingPayload.timestamp < 2000) {
            // Same payload within 2 seconds = likely duplicate
            this.payloadDuplicateCount += 1;
            console.debug(`[EventDedupe] Duplicate detected (payload): eventType=${event.eventType} payloadHash=${payloadHash}`, {
                duplicateCount: this.duplicateCount,
                payloadDuplicateCount: this.payloadDuplicateCount,
                processedCount: this.processedCount
            });
            return true;
        }
        // Record new event in both windows
        const entry = {
            eventId: event.eventId,
            timestamp: event.timestamp,
            eventType: event.eventType,
            payloadHash
        };
        this.dedupeWindow.set(key, entry);
        this.payloadHashWindow.set(payloadKey, entry);
        this.processedCount += 1;
        // Prune if window too large (oldest entries first)
        if (this.dedupeWindow.size > this.maxWindowSize) {
            const sortedEntries = Array.from(this.dedupeWindow.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, this.maxWindowSize / 2); // Keep oldest 50%
            this.dedupeWindow.clear();
            for (const [k, v] of sortedEntries) {
                this.dedupeWindow.set(k, v);
            }
        }
        return false;
    }
    /**
     * Remove entries older than dedupeTimeWindowMs
     */
    cleanOldEntries() {
        const now = Date.now();
        const cutoff = now - this.dedupeTimeWindowMs;
        for (const [key, entry] of this.dedupeWindow.entries()) {
            if (entry.timestamp < cutoff) {
                this.dedupeWindow.delete(key);
            }
        }
    }
    /**
     * Get deduplication statistics
     */
    getStats() {
        return {
            windowSize: this.dedupeWindow.size,
            duplicateCount: this.duplicateCount,
            payloadDuplicateCount: this.payloadDuplicateCount,
            processedCount: this.processedCount,
            duplicateRate: this.duplicateCount + this.processedCount > 0
                ? ((this.duplicateCount / (this.duplicateCount + this.processedCount)) * 100).toFixed(2) + "%"
                : "0%"
        };
    }
    /**
     * Reset for testing
     */
    reset() {
        this.dedupeWindow.clear();
        this.payloadHashWindow.clear();
        this.duplicateCount = 0;
        this.payloadDuplicateCount = 0;
        this.processedCount = 0;
    }
}
export function getEventDeduplicator() {
    return EventDeduplicator.getInstance();
}
