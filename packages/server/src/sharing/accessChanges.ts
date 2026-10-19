/**
 * Tells the sockets that people got or lost access to a note.
 *
 * A socket checks the access to a note when a document is joined or presence is
 * reported, and not again after that. Thus, the removal of a person from a
 * note, a move to the trash, or a change of an editor to a viewer must reach
 * the sockets that they already have. If not, they would continue to write to a
 * live document that they cannot open now. This has the same shape as
 * `auth/revocations.ts`, for the same reason. For presence, access that a
 * person gets is also important: a person who accepts a note while others look
 * at it must see them there.
 */

export interface AccessChange {
  noteId: string;
  userIds: string[];
  /**
   * - `gained`: the users can now see the note (they accepted it, or its owner
   *   took it back out of the trash).
   * - `lost-edit`: they can still read it, but cannot write it now. Thus, only
   *   the collaboration socket has something to end.
   * - `lost-all`: they cannot see it now.
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
