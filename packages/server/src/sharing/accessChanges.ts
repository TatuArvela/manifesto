/**
 * Tells the sockets that people have gained or lost access to a note.
 *
 * A socket checks a note's access when a document is joined or presence is
 * reported, and not again after that. Removing someone from a note, trashing
 * it, or turning an editor into a viewer therefore has to reach the sockets
 * they already hold, or they would carry on writing to a live document they
 * can no longer open. The same shape as `auth/revocations.ts`, for the same
 * reason. Gaining access matters to presence the other way round: someone who
 * accepts a note while others are looking at it should see them there.
 */

export interface AccessChange {
  noteId: string;
  userIds: string[];
  /**
   * - `gained`: the users can now see the note (they accepted it, or its
   *   owner took it back out of the trash).
   * - `lost-edit`: they can still read it but no longer write it, so only the
   *   collaboration socket has anything to end.
   * - `lost-all`: they can no longer see it at all.
   */
  change: "gained" | "lost-edit" | "lost-all";
}

export type AccessChangeListener = (change: AccessChange) => void;

export interface AccessChanges {
  announce(change: AccessChange): void;
  subscribe(listener: AccessChangeListener): () => void;
}

export function createAccessChanges(): AccessChanges {
  const listeners = new Set<AccessChangeListener>();
  return {
    announce(change) {
      if (change.userIds.length === 0) return;
      for (const listener of listeners) {
        try {
          listener(change);
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
