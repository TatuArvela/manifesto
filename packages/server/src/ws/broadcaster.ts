import type { WebSocketEvent } from "@manifesto/shared";

export type BroadcastListener = (userId: string, event: WebSocketEvent) => void;

export interface Broadcaster {
  emit: (userId: string, event: WebSocketEvent) => void;
  subscribe: (listener: BroadcastListener) => () => void;
}

export function createBroadcaster(): Broadcaster {
  const listeners = new Set<BroadcastListener>();
  return {
    emit(userId, event) {
      for (const listener of listeners) {
        try {
          listener(userId, event);
        } catch {
          // listeners must not throw across other subscribers
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
