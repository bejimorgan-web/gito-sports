/**
 * Acceptance Tests for STEP 8: Real-Time Safety & Consistency Hardening
 *
 * Tests verify:
 * 1. Event deduplication
 * 2. Event ordering correctness
 * 3. IPTV sync storm prevention (no UI flicker)
 * 4. Background sync vs event conflict (event always wins)
 * 5. Stream lifecycle integrity
 */

import { getEventDeduplicator } from "../events/event-dedupe";
import { getEventOrderingEngine } from "../events/event-ordering";
import { getStateResolver } from "../state/state-resolver";
import { getSystemStabilizer } from "../health/system-stabilizer";
import { getStreamStateGuard } from "../stream/stream-state-guard";

export interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  duration: number;
}

export class AcceptanceTests {
  private results: TestResult[] = [];

  /**
   * TEST 1: Event deduplication
   * Send same event twice within 5s
   * EXPECT: only one is processed (duplicate is ignored)
   */
  test1_EventDeduplication(): TestResult {
    const startTime = Date.now();

    try {
      const deduplicator = getEventDeduplicator();
      deduplicator.reset();

      const event1 = {
        eventId: "test-1",
        timestamp: Date.now(),
        eventType: "iptv:channel:updated"
      };

      // First event should NOT be duplicate
      const isDupe1 = deduplicator.isDuplicate(event1);
      if (isDupe1) {
        throw new Error("First event incorrectly marked as duplicate");
      }

      // Same event immediately after should BE duplicate
      const isDupe2 = deduplicator.isDuplicate(event1);
      if (!isDupe2) {
        throw new Error("Second event should be marked as duplicate");
      }

      // Different event should NOT be duplicate
      const event2 = {
        eventId: "test-2",
        timestamp: Date.now(),
        eventType: "iptv:channel:updated"
      };
      const isDupe3 = deduplicator.isDuplicate(event2);
      if (isDupe3) {
        throw new Error("Different event incorrectly marked as duplicate");
      }

      const stats = deduplicator.getStats();
      if (stats.duplicateCount !== 1 || stats.processedCount !== 2) {
        throw new Error(`Stats mismatch: duplicates=${stats.duplicateCount}, processed=${stats.processedCount}`);
      }

      return {
        testName: "Event Deduplication",
        passed: true,
        message: "✓ Duplicates correctly detected and ignored",
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        testName: "Event Deduplication",
        passed: false,
        message: `✗ ${String(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * TEST 2: Event ordering correctness
   * Send out-of-order timestamps
   * EXPECT: older events are ignored
   */
  test2_EventOrdering(): TestResult {
    const startTime = Date.now();

    try {
      const ordering = getEventOrderingEngine();
      ordering.reset();

      const now = Date.now();

      // Send newer event first
      const newEvent = {
        eventId: "new",
        timestamp: now + 1000,
        eventType: "scores:updated"
      };
      const isValid1 = ordering.isValidOrder(newEvent);
      if (!isValid1) {
        throw new Error("Newer event should be valid");
      }

      // Send older event after newer
      const oldEvent = {
        eventId: "old",
        timestamp: now,
        eventType: "scores:updated"
      };
      const isValid2 = ordering.isValidOrder(oldEvent);
      if (isValid2) {
        throw new Error("Older event should be rejected");
      }

      // Send another new event (even newer)
      const newerEvent = {
        eventId: "newer",
        timestamp: now + 2000,
        eventType: "scores:updated"
      };
      const isValid3 = ordering.isValidOrder(newerEvent);
      if (!isValid3) {
        throw new Error("Even newer event should be valid");
      }

      const stats = ordering.getStats();
      if (!stats["scores:updated"]) {
        throw new Error("Stats not tracking scores:updated");
      }

      return {
        testName: "Event Ordering",
        passed: true,
        message: "✓ Out-of-order events correctly rejected",
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        testName: "Event Ordering",
        passed: false,
        message: `✗ ${String(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * TEST 3: State resolution (Event > API > Sync > Cache)
   * Verify priority hierarchy is enforced
   */
  test3_StateResolution(): TestResult {
    const startTime = Date.now();

    try {
      const resolver = getStateResolver();
      resolver.reset();

      const key = "test-channel-list";

      // Accept event update
      const event = { channels: [1, 2, 3] };
      const result1 = resolver.resolve(key, event, "event", "evt-1");
      if (!result1) {
        throw new Error("Event update should be accepted");
      }

      // Try to apply API refresh immediately - should be blocked
      const apiData = { channels: [1, 2] };
      const result2 = resolver.resolve(key, apiData, "api-refresh");
      if (result2) {
        throw new Error("API refresh should be blocked after recent event");
      }

      // Try background sync - should also be blocked
      const syncData = { channels: [1] };
      const result3 = resolver.resolve(key, syncData, "background-sync");
      if (result3) {
        throw new Error("Background sync should be blocked after recent event");
      }

      // Try cache - should also be blocked
      const cacheData = { channels: [] };
      const result4 = resolver.resolve(key, cacheData, "cache");
      if (result4) {
        throw new Error("Cache should be blocked after recent event");
      }

      // Get current state - should still be event data
      const current = resolver.getState(key);
      if (JSON.stringify(current) !== JSON.stringify(event)) {
        throw new Error("State should still be event data");
      }

      return {
        testName: "State Resolution Priority",
        passed: true,
        message: "✓ EVENTS > API > SYNC > CACHE priority enforced",
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        testName: "State Resolution Priority",
        passed: false,
        message: `✗ ${String(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * TEST 4: Stream state consistency
   * Verify invalid state transitions are rejected
   */
  test4_StreamStateConsistency(): TestResult {
    const startTime = Date.now();

    try {
      const guard = getStreamStateGuard();
      guard.reset();

      // Valid: idle → loading
      if (!guard.canTransition("loading", "user_started_preview")) {
        throw new Error("Valid transition idle→loading should succeed");
      }

      // Valid: loading → playing
      if (!guard.canTransition("playing", "playback_started")) {
        throw new Error("Valid transition loading→playing should succeed");
      }

      // Valid: playing → buffering
      if (!guard.canTransition("buffering", "buffering_detected")) {
        throw new Error("Valid transition playing→buffering should succeed");
      }

      // Valid: buffering → recovering
      if (!guard.canTransition("recovering", "auto_retry")) {
        throw new Error("Valid transition buffering→recovering should succeed");
      }

      // Valid: recovering → failed
      if (!guard.canTransition("failed", "recovery_failed")) {
        throw new Error("Valid transition recovering→failed should succeed");
      }

      // Valid: failed → recovered
      if (!guard.canTransition("recovered", "stream_backend_recovered")) {
        throw new Error("Valid transition failed→recovered should succeed");
      }

      // INVALID: recovered → failed (stale event) - should be rejected within 2s
      const result = guard.canTransition("failed", "stale_failed_event");
      if (result) {
        throw new Error("Invalid transition recovered→failed should be rejected");
      }

      return {
        testName: "Stream State Consistency",
        passed: true,
        message: "✓ Valid transitions allowed, invalid transitions rejected",
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        testName: "Stream State Consistency",
        passed: false,
        message: `✗ ${String(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * TEST 5: System stability monitoring
   * Verify metrics are collected and reported
   */
  test5_SystemHealthMonitoring(): TestResult {
    const startTime = Date.now();

    try {
      const stabilizer = getSystemStabilizer();
      stabilizer.reset();

      // Record some events
      stabilizer.recordEventArrival(Date.now() - 100);
      stabilizer.recordEventArrival(Date.now() - 50);
      stabilizer.recordEventArrival(Date.now());

      const report = stabilizer.getSystemStabilityReport();

      if (!report.status || !["stable", "degraded", "unstable"].includes(report.status)) {
        throw new Error("Invalid status value");
      }

      if (report.eventLagMs < 0) {
        throw new Error("Event lag should be non-negative");
      }

      if (!report.duplicateEventRate || typeof report.duplicateEventRate !== "string") {
        throw new Error("Duplicate event rate should be a string percentage");
      }

      if (typeof report.cacheConflictCount !== "number") {
        throw new Error("Cache conflict count should be a number");
      }

      if (!report.details || !report.details.dedupeStats) {
        throw new Error("Report should include detailed stats");
      }

      return {
        testName: "System Health Monitoring",
        passed: true,
        message: "✓ System stability metrics collected and reported",
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        testName: "System Health Monitoring",
        passed: false,
        message: `✗ ${String(error)}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Run all tests and return results
   */
  runAll(): TestResult[] {
    this.results = [
      this.test1_EventDeduplication(),
      this.test2_EventOrdering(),
      this.test3_StateResolution(),
      this.test4_StreamStateConsistency(),
      this.test5_SystemHealthMonitoring()
    ];

    return this.results;
  }

  /**
   * Get summary
   */
  getSummary() {
    const passed = this.results.filter((r) => r.passed).length;
    const total = this.results.length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    return {
      passed,
      total,
      passRate: `${((passed / total) * 100).toFixed(1)}%`,
      totalDuration: `${totalDuration}ms`,
      results: this.results
    };
  }
}
