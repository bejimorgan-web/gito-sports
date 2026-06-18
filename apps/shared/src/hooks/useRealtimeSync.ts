/**
 * Real-time Sync Hook
 *
 * Unified hook for desktop + mobile apps to subscribe to backend events
 * and trigger data refetches via global invalidation.
 */

import { useEffect, useRef } from "react";
import { getEventClient } from "../events/event-client";
import { getGlobalInvalidation } from "../state/global-invalidation";

interface RealtimeSyncHookConfig {
  apiBaseUrl: string;
  onIPTVRefetch: () => Promise<void> | void;
  onScoresRefetch: () => Promise<void> | void;
  onStreamsRefetch: () => Promise<void> | void;
  onBackendStatusChange?: (online: boolean) => void;
}

/**
 * Hook to integrate real-time event subscriptions and global state invalidation
 */
export function useRealtimeSync(config: RealtimeSyncHookConfig): void {
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const connectionCheckRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const eventClient = getEventClient(config.apiBaseUrl);
    const invalidation = getGlobalInvalidation(config.apiBaseUrl);

    // Register refetch callbacks
    const unsubscribeIPTV = invalidation.onIPTVInvalidate(() => config.onIPTVRefetch());
    const unsubscribeScores = invalidation.onScoresInvalidate(() => config.onScoresRefetch());
    const unsubscribeStreams = invalidation.onStreamsInvalidate(() => config.onStreamsRefetch());

    unsubscribersRef.current = [unsubscribeIPTV, unsubscribeScores, unsubscribeStreams];

    // Connect to event stream
    eventClient
      .connect()
      .then(() => {
        console.log("[useRealtimeSync] Connected to event stream");
        config.onBackendStatusChange?.(true);
      })
      .catch((error) => {
        console.error("[useRealtimeSync] Failed to connect", error);
        config.onBackendStatusChange?.(false);
      });

    // Monitor connection status (check every 5 seconds)
    connectionCheckRef.current = setInterval(() => {
      const isOnline = eventClient.isOnline();
      config.onBackendStatusChange?.(isOnline);
    }, 5000);

    return () => {
      // Cleanup: unsubscribe from invalidations
      for (const unsub of unsubscribersRef.current) {
        unsub();
      }

      // Don't disconnect from event stream (keep persistent connection)
      if (connectionCheckRef.current) {
        clearInterval(connectionCheckRef.current);
      }
    };
  }, [config]);
}
