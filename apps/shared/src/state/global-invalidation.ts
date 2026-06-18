/**
 * Global State Invalidation System
 *
 * Shared across mobile + desktop apps.
 * Triggers refetch of data sources when backend state changes.
 * Ensures single source of truth: backend is always the authority.
 */

import { getEventClient } from "../events/event-client";

type InvalidationCallback = () => Promise<void> | void;

class GlobalInvalidation {
  private static instance: GlobalInvalidation;
  private apiBaseUrl: string;
  private iptvCallbacks: Set<InvalidationCallback> = new Set();
  private scoresCallbacks: Set<InvalidationCallback> = new Set();
  private streamsCallbacks: Set<InvalidationCallback> = new Set();

  private constructor(apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl;
    this.setupEventListeners();
  }

  static getInstance(apiBaseUrl: string): GlobalInvalidation {
    if (!GlobalInvalidation.instance) {
      GlobalInvalidation.instance = new GlobalInvalidation(apiBaseUrl);
    }
    return GlobalInvalidation.instance;
  }

  /**
   * Setup event listeners that trigger invalidations
   */
  private setupEventListeners(): void {
    const eventClient = getEventClient(this.apiBaseUrl);

    // IPTV invalidations
    eventClient.on("iptv:ingestion:completed", () => this.invalidateIPTV());
    eventClient.on("iptv:sync:completed", () => this.invalidateIPTV());
    eventClient.on("iptv:channel:updated", () => this.invalidateIPTV());
    eventClient.on("iptv:channel:inserted", () => this.invalidateIPTV());
    eventClient.on("iptv:channel:inactive", () => this.invalidateIPTV());
    eventClient.on("iptv:provider:updated", () => this.invalidateIPTV());

    // Scores invalidations
    eventClient.on("scores:updated", () => this.invalidateScores());
    eventClient.on("scores:cache:refreshed", () => this.invalidateScores());
    eventClient.on("scores:failed", () => this.invalidateScores());

    // Stream invalidations
    eventClient.on("stream:failed", () => this.invalidateStreams());
    eventClient.on("stream:recovered", () => this.invalidateStreams());
    eventClient.on("stream:reconnected", () => this.invalidateStreams());
  }

  /**
   * Register callback for IPTV invalidation
   */
  onIPTVInvalidate(callback: InvalidationCallback): () => void {
    this.iptvCallbacks.add(callback);
    return () => this.iptvCallbacks.delete(callback);
  }

  /**
   * Register callback for scores invalidation
   */
  onScoresInvalidate(callback: InvalidationCallback): () => void {
    this.scoresCallbacks.add(callback);
    return () => this.scoresCallbacks.delete(callback);
  }

  /**
   * Register callback for streams invalidation
   */
  onStreamsInvalidate(callback: InvalidationCallback): () => void {
    this.streamsCallbacks.add(callback);
    return () => this.streamsCallbacks.delete(callback);
  }

  /**
   * Trigger IPTV refetch via all registered callbacks
   * Called by event listeners + background sync loop
   */
  async invalidateIPTV(): Promise<void> {
    console.log("[GlobalInvalidation] IPTV invalidated, triggering refetch");
    const promises = Array.from(this.iptvCallbacks).map((cb) =>
      Promise.resolve(cb()).catch((err) => console.error("[GlobalInvalidation] IPTV refetch error", err))
    );
    await Promise.all(promises);
  }

  /**
   * Trigger scores refetch via all registered callbacks
   */
  async invalidateScores(): Promise<void> {
    console.log("[GlobalInvalidation] Scores invalidated, triggering refetch");
    const promises = Array.from(this.scoresCallbacks).map((cb) =>
      Promise.resolve(cb()).catch((err) => console.error("[GlobalInvalidation] Scores refetch error", err))
    );
    await Promise.all(promises);
  }

  /**
   * Trigger streams refetch via all registered callbacks
   */
  async invalidateStreams(): Promise<void> {
    console.log("[GlobalInvalidation] Streams invalidated, triggering refetch");
    const promises = Array.from(this.streamsCallbacks).map((cb) =>
      Promise.resolve(cb()).catch((err) => console.error("[GlobalInvalidation] Streams refetch error", err))
    );
    await Promise.all(promises);
  }
}

export function getGlobalInvalidation(apiBaseUrl: string): GlobalInvalidation {
  return GlobalInvalidation.getInstance(apiBaseUrl);
}
