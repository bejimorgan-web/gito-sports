/**
 * Background Sync Service with Safety Locks
 *
 * Lightweight fallback sync loop that runs every 30–60 seconds.
 * Refetches IPTV channels, live scores, and stream status.
 * Does NOT override newer event-driven state (events take priority).
 *
 * CRITICAL: Adds sync locks to prevent background sync from overwriting
 * recent event-driven updates.
 */

import { getGlobalInvalidation } from "../state/global-invalidation";
import { getEventClient } from "../events/event-client";

interface BackgroundSyncConfig {
  enabled: boolean;
  intervalMs: number; // 30000 - 60000ms
  apiBaseUrl: string;
}

interface SyncLock {
  domain: "iptv" | "scores" | "streams";
  lockedUntil: number;
}

class BackgroundSyncService {
  private static instance: BackgroundSyncService;
  private syncTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastSyncTimes = {
    iptv: 0,
    scores: 0,
    streams: 0
  };
  private syncLocks: Map<string, SyncLock> = new Map();
  private readonly syncLockDurationMs = 5000; // Lock background sync for 5s after event
  private config: BackgroundSyncConfig;

  private constructor(config: BackgroundSyncConfig) {
    this.config = config;
  }

  static getInstance(config: BackgroundSyncConfig): BackgroundSyncService {
    if (!BackgroundSyncService.instance) {
      BackgroundSyncService.instance = new BackgroundSyncService(config);
    }
    return BackgroundSyncService.instance;
  }

  /**
   * Start background sync loop
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("[BackgroundSync] Disabled via config");
      return;
    }

    if (this.isRunning) {
      console.warn("[BackgroundSync] Already running");
      return;
    }

    this.isRunning = true;
    console.log(`[BackgroundSync] Started (interval: ${this.config.intervalMs}ms)`);

    // Subscribe to events to set sync locks
    this.setupEventListeners();

    this.scheduleSyncLoop();
  }

  /**
   * Setup event listeners to lock background sync when events arrive
   */
  private setupEventListeners(): void {
    try {
      const eventClient = getEventClient(this.config.apiBaseUrl);

      // Lock IPTV sync on provider/channel events
      eventClient.on("iptv:ingestion:completed", () => {
        this.setSyncLock("iptv");
      });
      eventClient.on("iptv:provider:updated", () => {
        this.setSyncLock("iptv");
      });
      eventClient.on("iptv:channel:updated", () => {
        this.setSyncLock("iptv");
      });

      // Lock scores sync on score events
      eventClient.on("scores:updated", () => {
        this.setSyncLock("scores");
      });
      eventClient.on("scores:cache:refreshed", () => {
        this.setSyncLock("scores");
      });

      // Lock stream sync on stream events
      eventClient.on("stream:recovered", () => {
        this.setSyncLock("streams");
      });
      eventClient.on("stream:reconnected", () => {
        this.setSyncLock("streams");
      });
      eventClient.on("stream:failed", () => {
        this.setSyncLock("streams");
      });
    } catch (error) {
      console.warn("[BackgroundSync] Failed to setup event listeners", error);
    }
  }

  /**
   * Set sync lock for a domain (prevents background sync for 5s)
   */
  private setSyncLock(domain: "iptv" | "scores" | "streams"): void {
    const now = Date.now();
    const lock: SyncLock = {
      domain,
      lockedUntil: now + this.syncLockDurationMs
    };
    this.syncLocks.set(domain, lock);
    console.debug(`[BackgroundSync] Lock set for ${domain} until ${lock.lockedUntil}`);
  }

  /**
   * Check if domain is locked (background sync should skip)
   */
  private isSyncLocked(domain: "iptv" | "scores" | "streams"): boolean {
    const lock = this.syncLocks.get(domain);
    if (!lock) {
      return false;
    }

    const now = Date.now();
    if (now > lock.lockedUntil) {
      this.syncLocks.delete(domain);
      return false;
    }

    return true;
  }

  /**
   * Stop background sync loop
   */
  stop(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.isRunning = false;
    console.log("[BackgroundSync] Stopped");
  }

  /**
   * Schedule next sync iteration
   */
  private scheduleSyncLoop(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(async () => {
      try {
        await this.performSync();
      } catch (error) {
        console.error("[BackgroundSync] Sync error", error);
      } finally {
        // Schedule next iteration
        if (this.isRunning) {
          this.scheduleSyncLoop();
        }
      }
    }, this.config.intervalMs);
  }

  /**
   * Perform single sync iteration with sync locks
   * Triggers invalidation callbacks which refetch from API
   */
  private async performSync(): Promise<void> {
    const invalidation = getGlobalInvalidation(this.config.apiBaseUrl);
    const now = Date.now();
    const minIntervalMs = 30000; // Don't sync same resource more than every 30s

    // IPTV sync (respect lock)
    if (!this.isSyncLocked("iptv") && now - this.lastSyncTimes.iptv >= minIntervalMs) {
      console.log("[BackgroundSync] IPTV refetch cycle");
      try {
        await invalidation.invalidateIPTV();
        this.lastSyncTimes.iptv = now;
      } catch (error) {
        console.error("[BackgroundSync] IPTV sync error", error);
      }
    } else if (this.isSyncLocked("iptv")) {
      console.debug("[BackgroundSync] IPTV sync locked (recent event)");
    }

    // Scores sync (respect lock)
    if (!this.isSyncLocked("scores") && now - this.lastSyncTimes.scores >= minIntervalMs) {
      console.log("[BackgroundSync] Scores refetch cycle");
      try {
        await invalidation.invalidateScores();
        this.lastSyncTimes.scores = now;
      } catch (error) {
        console.error("[BackgroundSync] Scores sync error", error);
      }
    } else if (this.isSyncLocked("scores")) {
      console.debug("[BackgroundSync] Scores sync locked (recent event)");
    }

    // Streams sync (respect lock)
    if (!this.isSyncLocked("streams") && now - this.lastSyncTimes.streams >= minIntervalMs) {
      console.log("[BackgroundSync] Streams refetch cycle");
      try {
        await invalidation.invalidateStreams();
        this.lastSyncTimes.streams = now;
      } catch (error) {
        console.error("[BackgroundSync] Streams sync error", error);
      }
    } else if (this.isSyncLocked("streams")) {
      console.debug("[BackgroundSync] Streams sync locked (recent event)");
    }
  }

  /**
   * Check if running
   */
  isEnabled(): boolean {
    return this.isRunning;
  }

  /**
   * Get last sync times (for debugging/testing)
   */
  getLastSyncTimes() {
    return { ...this.lastSyncTimes };
  }

  /**
   * Get sync lock status (for debugging/testing)
   */
  getSyncLocks() {
    const now = Date.now();
    const locks: Record<string, number> = {};
    for (const [domain, lock] of this.syncLocks.entries()) {
      locks[domain] = Math.max(0, lock.lockedUntil - now);
    }
    return locks;
  }
}

export function getBackgroundSyncService(config: BackgroundSyncConfig): BackgroundSyncService {
  return BackgroundSyncService.getInstance(config);
}
