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

export type StreamState = "idle" | "loading" | "playing" | "buffering" | "recovering" | "failed" | "recovered";

interface StateTransition {
  from: StreamState;
  to: StreamState;
  allowed: boolean;
}

interface StreamStateTrace {
  state: StreamState;
  timestamp: number;
  reason?: string | undefined;
}

class StreamStateGuard {
  private static instance: StreamStateGuard;
  private currentState: StreamState = "idle";
  private lastStateTimestamp = 0;
  private stateHistory: StreamStateTrace[] = [];
  private readonly maxHistorySize = 50;
  private invalidTransitionCount = 0;

  // Valid state transitions
  private readonly validTransitions: Record<StreamState, StreamState[]> = {
    idle: ["loading"],
    loading: ["playing", "buffering", "failed"],
    playing: ["buffering", "recovering", "failed"],
    buffering: ["playing", "recovering", "failed"],
    recovering: ["playing", "failed", "recovered"],
    failed: ["recovered", "loading"], // Must go through recovered or restart
    recovered: ["loading", "playing", "idle"]
  };

  private constructor() {}

  static getInstance(): StreamStateGuard {
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
  canTransition(nextState: StreamState, reason?: string): boolean {
    const validNextStates = this.validTransitions[this.currentState] || [];

    if (!validNextStates.includes(nextState)) {
      this.invalidTransitionCount += 1;
      console.warn(
        `[StreamStateGuard] Invalid transition rejected: ${this.currentState} → ${nextState}`,
        {
          reason,
          invalidCount: this.invalidTransitionCount
        }
      );
      return false;
    }

    // Prevent "recovered" state from being overwritten by stale "failed" event
    if (this.currentState === "recovered" && nextState === "failed") {
      const timeSinceRecovery = Date.now() - this.lastStateTimestamp;
      if (timeSinceRecovery < 2000) {
        // If recovered less than 2s ago, reject stale failed event
        console.debug(
          `[StreamStateGuard] Rejected stale failed event (${timeSinceRecovery}ms after recovery)`
        );
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
  getState(): StreamState {
    return this.currentState;
  }

  /**
   * Get valid next states
   */
  getValidNextStates(): StreamState[] {
    return this.validTransitions[this.currentState] || [];
  }

  /**
   * Get state history (for debugging)
   */
  getStateHistory(): StreamStateTrace[] {
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
  reset(): void {
    this.currentState = "idle";
    this.lastStateTimestamp = 0;
    this.stateHistory = [];
    this.invalidTransitionCount = 0;
  }
}

export function getStreamStateGuard(): StreamStateGuard {
  return StreamStateGuard.getInstance();
}
