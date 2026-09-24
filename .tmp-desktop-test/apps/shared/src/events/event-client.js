import { getEventDeduplicator } from "./event-dedupe";
import { getEventOrderingEngine } from "./event-ordering";
import { getSystemStabilizer } from "../health/system-stabilizer";
class EventClient {
    static instance;
    listeners = new Map();
    eventSource = null;
    reconnectAttempt = 0;
    reconnectDelays = [1000, 2000, 5000, 10000, 15000];
    maxReconnectAttempts = Infinity;
    isConnecting = false;
    isConnected = false;
    pendingEvents = [];
    apiBaseUrl = "";
    reconnectTimer = null;
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
    }
    static getInstance(apiBaseUrl) {
        if (!EventClient.instance) {
            EventClient.instance = new EventClient(apiBaseUrl);
        }
        return EventClient.instance;
    }
    connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnecting) {
                resolve();
                return;
            }
            if (this.isConnected) {
                resolve();
                return;
            }
            this.isConnecting = true;
            try {
                const eventUrl = `${this.apiBaseUrl}/api/events`;
                this.eventSource = new EventSource(eventUrl);
                this.eventSource.onopen = () => {
                    console.log("[EventClient] Connected to event stream");
                    this.isConnected = true;
                    this.isConnecting = false;
                    this.reconnectAttempt = 0;
                    this.replayPendingEvents();
                    resolve();
                };
                this.eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        const eventId = data.eventId || `${data.type}-${Date.now()}`;
                        const timestamp = data.timestamp || Date.now();
                        const deduplicator = getEventDeduplicator();
                        const isDuplicate = deduplicator.isDuplicate({
                            eventId,
                            timestamp,
                            eventType: data.type
                        });
                        if (isDuplicate) {
                            console.debug(`[EventClient] Duplicate event ignored: ${data.type}`);
                            return;
                        }
                        const orderingEngine = getEventOrderingEngine();
                        const isValidOrder = orderingEngine.isValidOrder({
                            eventId,
                            timestamp,
                            eventType: data.type
                        });
                        if (!isValidOrder) {
                            console.debug(`[EventClient] Out-of-order event ignored: ${data.type}`);
                            return;
                        }
                        getSystemStabilizer().recordEventArrival(timestamp);
                        this.emit(data.type, data.payload);
                    }
                    catch (error) {
                        console.error("[EventClient] Failed to parse event", error);
                    }
                };
                this.eventSource.onerror = (error) => {
                    console.error("[EventClient] EventSource error", error);
                    this.isConnected = false;
                    this.isConnecting = false;
                    this.eventSource?.close();
                    this.eventSource = null;
                    this.scheduleReconnect();
                    reject(error);
                };
            }
            catch (error) {
                console.error("[EventClient] Failed to create EventSource", error);
                this.isConnecting = false;
                this.scheduleReconnect();
                reject(error);
            }
        });
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            console.warn("[EventClient] Max reconnection attempts reached");
            return;
        }
        const delay = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)];
        console.log(`[EventClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempt += 1;
            this.connect().catch((error) => {
                console.error("[EventClient] Reconnection failed", error);
            });
        }, delay);
    }
    replayPendingEvents() {
        if (this.pendingEvents.length === 0) {
            return;
        }
        console.log(`[EventClient] Replaying ${this.pendingEvents.length} pending events`);
        const events = [...this.pendingEvents].sort((a, b) => a.timestamp - b.timestamp);
        this.pendingEvents = [];
        for (const event of events) {
            this.emit(event.event, event.payload);
        }
    }
    emit(event, payload) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of Array.from(handlers)) {
                try {
                    handler(payload);
                }
                catch (error) {
                    console.error(`[EventClient] Handler error for event ${event}`, error);
                }
            }
        }
        if (!this.isConnected && !this.isConnecting) {
            this.pendingEvents.push({ event, payload, timestamp: Date.now() });
        }
    }
    on(event, handler) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(handler);
        this.listeners.set(event, set);
        return () => {
            set.delete(handler);
            if (set.size === 0) {
                this.listeners.delete(event);
            }
        };
    }
    once(event, handler) {
        const unsubscribe = this.on(event, (payload) => {
            handler(payload);
            unsubscribe();
        });
        return unsubscribe;
    }
    isOnline() {
        return this.isConnected;
    }
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.isConnected = false;
        this.isConnecting = false;
        console.log("[EventClient] Disconnected from event stream");
    }
    getPendingEventCount() {
        return this.pendingEvents.length;
    }
}
export function getEventClient(apiBaseUrl) {
    return EventClient.getInstance(apiBaseUrl);
}
export function getEventSystemHealth() {
    const deduplicator = getEventDeduplicator();
    const orderingEngine = getEventOrderingEngine();
    const stabilizer = getSystemStabilizer();
    const dedupeStats = deduplicator.getStats();
    const orderingStats = orderingEngine.getStats();
    const stabilityReport = stabilizer.getSystemStabilityReport();
    return {
        status: stabilityReport.status,
        duplicateEventCount: dedupeStats.duplicateCount,
        droppedOldEventCount: orderingStats["_total_skipped"] || 0,
        backgroundSyncSkipCount: 0, // Set by background sync service
        lastEventTimestamp: stabilityReport.lastEventTimestamp,
        eventLagMs: stabilityReport.eventLagMs,
        systemDetails: {
            dedupeStats,
            orderingStats,
            resolverStats: {
                conflicts: stabilityReport.details.resolverStats
            }
        }
    };
}
