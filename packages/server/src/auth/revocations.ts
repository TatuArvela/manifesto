/**
 * Tells the sockets that the sessions of a user ended.
 *
 * When the server deletes session rows, the next HTTP request stops. But a
 * WebSocket authenticates one time, at the handshake, and stays open on that.
 * If a password reset left the sockets of the old sessions connected, their
 * holder would continue to get note events and to write to live documents. A
 * reset must end exactly that. The sockets subscribe here, and close the
 * connections that the revocation covers.
 */

export interface SessionRevocation {
  userId: string;
  /**
   * A raw bearer token whose connections stay: the session that asked for the
   * change, when a user changes their own password.
   */
  keepToken?: string | undefined;
  /**
   * Only the connections opened with this credential, by the SHA-256 of the raw
   * token (`hashToken`). This is for the revocation of one API token, whose raw
   * form the server does not have now.
   */
  onlyTokenHash?: string;
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
          // If one socket layer fails to close, the other must still close.
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
