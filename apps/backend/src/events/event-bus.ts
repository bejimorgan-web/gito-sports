export type EventName =
  | "iptv:sync:completed"
  | "iptv:channel:inserted"
  | "iptv:channel:updated"
  | "iptv:channel:inactive"
  | "iptv:provider:updated"
  | "iptv:ingestion:completed"
  | "iptv:channel:rejected"
  | "iptv:channel:duplicate_detected"
  | "scores:updated"
  | "scores:cache:refreshed"
  | "scores:retry"
  | "scores:failed"
  | "stream:recovered"
  | "stream:failed"
  | "stream:reconnected"
  | string;

export type EventPayload = unknown;
export type EventHandler = (payload?: EventPayload) => void;

const listeners = new Map<EventName, Set<EventHandler>>();
const onceListeners = new Map<EventName, Set<EventHandler>>();

function getListenerSet(map: Map<EventName, Set<EventHandler>>, event: EventName) {
  let set = map.get(event);
  if (!set) {
    set = new Set();
    map.set(event, set);
  }
  return set;
}

export const EventBus = {
  on(event: EventName, handler: EventHandler) {
    getListenerSet(listeners, event).add(handler);
  },

  off(event: EventName, handler: EventHandler) {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        listeners.delete(event);
      }
    }
  },

  once(event: EventName, handler: EventHandler) {
    getListenerSet(onceListeners, event).add(handler);
  },

  emit(event: EventName, payload?: EventPayload) {
    const currentListeners = listeners.get(event);
    if (currentListeners) {
      for (const listener of Array.from(currentListeners)) {
        try {
          listener(payload);
        } catch {
          // swallow event handler failures to avoid breaking the caller
        }
      }
    }

    const currentOnce = onceListeners.get(event);
    if (currentOnce) {
      for (const listener of Array.from(currentOnce)) {
        try {
          listener(payload);
        } catch {
          // swallow event handler failures
        }
      }
      onceListeners.delete(event);
    }
  }
};
