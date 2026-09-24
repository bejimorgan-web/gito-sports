/**
 * Stream State Consistency Guards
 *
 * Enforces strict stream state transitions to prevent invalid state flows.
 *
 * Valid stream lifecycle:
 * idle → loading → playing → buffering → recovering → failed → recovered
 *
 * INVALID transitions are rejected:
 * - failed → playing (must go through recovered first)
 * - jumping states without proper intermediates
 * - overwriting recovered state with stale failed event
 */
class StreamStateGuard {
    static instance;
    currentState = "idle";
    lastStateTimestamp = 0;
    stateHistory = [];
    maxHistorySize = 50;
    invalidTransitionCount = 0;
    // Valid state transitions
    validTransitions = {
        idle: ["loading"],
        loading: ["playing", "buffering", "failed"],
        playing: ["buffering", "recovering", "failed"],
        buffering: ["playing", "recovering", "failed"],
        recovering: ["playing", "failed", "recovered"],
        failed: ["recovered", "loading"], // Must go through recovered or restart
        recovered: ["loading", "playing", "idle"]
    };
    constructor() { }
    static getInstance() {
        if (!StreamStateGuard.instance) {
            StreamStateGuard.instance = new StreamStateGuard();
        }
        return StreamStateGuard.instance;
    }
    /**
     * Validate and apply state transition.
     * Returns true if transition is valid and applied.
     * Returns false if transition is invalid and rejected.
     */
    canTransition(nextState, reason) {
        const validNextStates = this.validTransitions[this.currentState] || [];
        if (!validNextStates.includes(nextState)) {
            this.invalidTransitionCount += 1;
            console.warn(`[StreamStateGuard] Invalid transition rejected: ${this.currentState} → ${nextState}`, {
                reason,
                invalidCount: this.invalidTransitionCount
            });
            return false;
        }
        // Prevent "recovered" state from being overwritten by stale "failed" event
        if (this.currentState === "recovered" && nextState === "failed") {
            const timeSinceRecovery = Date.now() - this.lastStateTimestamp;
            if (timeSinceRecovery < 2000) {
                // If recovered less than 2s ago, reject stale failed event
                console.debug(`[StreamStateGuard] Rejected stale failed event (${timeSinceRecovery}ms after recovery)`);
                return false;
            }
        }
        // Apply transition
        this.currentState = nextState;
        this.lastStateTimestamp = Date.now();
        this.stateHistory.push({
            state: nextState,
            timestamp: this.lastStateTimestamp,
            reason
        });
        if (this.stateHistory.length > this.maxHistorySize) {
            this.stateHistory.shift();
        }
        console.debug(`[StreamStateGuard] State transition: ${this.stateHistory[Math.max(0, this.stateHistory.length - 2)]?.state} → ${nextState}`, { reason });
        return true;
    }
    /**
     * Get current state
     */
    getState() {
        return this.currentState;
    }
    /**
     * Get valid next states
     */
    getValidNextStates() {
        return this.validTransitions[this.currentState] || [];
    }
    /**
     * Get state history (for debugging)
     */
    getStateHistory() {
        return [...this.stateHistory];
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            currentState: this.currentState,
            invalidTransitionCount: this.invalidTransitionCount,
            historySize: this.stateHistory.length
        };
    }
    /**
     * Reset for testing
     */
    reset() {
        this.currentState = "idle";
        this.lastStateTimestamp = 0;
        this.stateHistory = [];
        this.invalidTransitionCount = 0;
    }
}
export function getStreamStateGuard() {
    return StreamStateGuard.getInstance();
}
