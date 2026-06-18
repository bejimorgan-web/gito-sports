/**
 * Event Stream Route
 *
 * Server-Sent Events (SSE) endpoint for real-time event delivery.
 * Broadcasts all backend events to connected clients with dedup/ordering metadata.
 */

import { Router, type Response } from "express";
type SseResponse = Response & import("node:http").ServerResponse;
import { EventBus } from "../events/event-bus";

export const eventsRouter = Router();

// Track active SSE connections for broadcasting
const sseConnections = new Set<SseResponse>();

/**
 * Broadcasting function: emit event to all connected clients with dedup/ordering metadata
 */
export function broadcastEvent(eventType: string, payload?: unknown, eventId?: string) {
  const messageId = eventId || `${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();

  const message = `data: ${JSON.stringify({
    type: eventType,
    eventId: messageId,
    timestamp,
    payload
  })}\n\n`;

  let disconnected = 0;

  for (const res of Array.from(sseConnections)) {
    if (res.writableEnded || res.destroyed) {
      sseConnections.delete(res);
      disconnected += 1;
    } else {
      try {
        res.write(message);
      } catch (error) {
        console.error("[EventStream] Failed to broadcast to client", error);
        sseConnections.delete(res);
      }
    }
  }

  if (disconnected > 0) {
    console.log(`[EventStream] Cleaned up ${disconnected} disconnected clients`);
  }
}

/**
 * SSE Endpoint: /api/events
 *
 * Accepts GET requests and upgrades to streaming response.
 * Sends events in SSE format.
 */
eventsRouter.get("/", (request, response) => {
  // Set SSE headers
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("X-Accel-Buffering", "no");

  // Register this connection
  sseConnections.add(response);
  console.log(`[EventStream] Client connected. Total: ${sseConnections.size}`);

  // Send initial greeting
  response.write(`: Server-sent events connected\n\n`);

  // Setup EventBus listeners to broadcast to all SSE clients
  const handlers = new Map<string, Function>();

  const eventTypes = [
    "iptv:ingestion:completed",
    "iptv:channel:inserted",
    "iptv:channel:updated",
    "iptv:channel:inactive",
    "iptv:channel:duplicate_detected",
    "iptv:provider:updated",
    "iptv:sync:completed",
    "scores:updated",
    "scores:cache:refreshed",
    "scores:retry",
    "scores:failed",
    "stream:recovered",
    "stream:failed",
    "stream:reconnected"
  ];

  for (const eventType of eventTypes) {
    const handler = (payload?: unknown) => {
      // Generate unique event ID for deduplication
      const eventId = `${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      broadcastEvent(eventType, payload, eventId);
    };
    EventBus.on(eventType as any, handler as any);
    handlers.set(eventType, handler);
  }

  // Cleanup on disconnect
  request.on("close", () => {
    sseConnections.delete(response);
    response.end();

    // Unsubscribe from EventBus
    for (const [eventType, handler] of handlers) {
      EventBus.off(eventType as any, handler as any);
    }

    console.log(`[EventStream] Client disconnected. Total: ${sseConnections.size}`);
  });
});

/**
 * Health check endpoint
 */
eventsRouter.get("/health", (request, response) => {
  response.json({
    status: "ok",
    connectedClients: sseConnections.size
  });
});
