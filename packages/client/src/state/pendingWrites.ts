import type { Note, NoteUpdate } from "@manifesto/shared";

/**
 * Writes that show to the user before storage acknowledged them.
 *
 * The change goes into the signal on the click, and the request follows it.
 * Thus, a pin, a color or a ticked box shows immediately, not after a round
 * trip, and a selection archived together goes out together.
 *
 * What comes back after that must then be folded in without an undo of anything
 * newer. Each note that the server sends (the response to a write, a
 * `note:updated` from a different device, a full listing after a reconnect) is
 * its last word on that note. {@link PendingWrites.replay} puts the writes that
 * are not complete back on top of it. A response that arrives after a second
 * click cannot undo that click. A write that fails goes back to the note as it
 * was, with the later writes still applied.
 *
 * The `changes` object itself identifies a write. Thus, {@link
 * PendingWrites.settle} must get the same object that {@link
 * PendingWrites.begin} got, whatever the code sent at the end. A conflict retry
 * sends a merged set of changes, and still settles the write that it tried
 * again.
 */
export interface PendingWrites {
  /**
   * Record a write that is about to go, and return the note to show in the
   * meantime.
   */
  begin(note: Note, changes: NoteUpdate): Note;
  /** Forget a write that storage answered, whether it succeeded or failed. */
  settle(id: string, changes: NoteUpdate): void;
  /**
   * `truth`, with each write for that note that is not complete applied on it
   * again.
   */
  replay(truth: Note): Note;
  /** If a write for this note is not complete. */
  pending(id: string): boolean;
}

export function createPendingWrites(): PendingWrites {
  // For each note, oldest first. When the writes apply again in order, the
  // newest write is on top.
  const queues = new Map<string, NoteUpdate[]>();

  return {
    begin(note, changes) {
      const queue = queues.get(note.id);
      if (queue) queue.push(changes);
      else queues.set(note.id, [changes]);
      return { ...note, ...changes };
    },

    settle(id, changes) {
      const queue = queues.get(id);
      if (!queue) return;
      const at = queue.indexOf(changes);
      if (at !== -1) queue.splice(at, 1);
      if (queue.length === 0) queues.delete(id);
    },

    replay(truth) {
      const queue = queues.get(truth.id);
      if (!queue || queue.length === 0) return truth;
      const note = { ...truth };
      for (const changes of queue) Object.assign(note, changes);
      return note;
    },

    pending(id) {
      return queues.has(id);
    },
  };
}
