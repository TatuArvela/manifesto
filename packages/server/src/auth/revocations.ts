/**
 * Tells the sockets that a user's sessions have been ended.
 *
 * Deleting session rows stops the next HTTP request, but a WebSocket is
 * authenticated once, at the handshake, and stays open on that. A password
 * reset that left the old sessions' sockets connected would leave whoever
 * held them still receiving note events and still writing to live documents,
 * which is exactly what a reset is meant to end. The sockets subscribe here and
 * close what the revocation covers.
 */

export interface SessionRevocation {
  userId: string;
  /** A raw bearer token whose connections survive: the session that asked for
   * the change, when a user changes their own password. */
  keepToken?: string;
}

export type RevocationListener = (revocation: SessionRevocation) => void;

export interface SessionRevocations {
  revoke(revocation: SessionRevocation): void;
  subscribe(listener: RevocationListener): () => void;
}

export function createSessionRevocations(): SessionRevocations {
  const listeners = new Set<RevocationListener>();
  return {
    revoke(revocation) {
      for (const listener of listeners) {
        try {
          listener(revocation);
        } catch {
          // one socket layer failing to close must not spare the other
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
