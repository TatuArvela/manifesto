import type { Note, NoteUpdate } from "@manifesto/shared";

/**
 * Writes shown to the user before storage has acknowledged them.
 *
 * A connected client used to wait for the server before it changed anything.
 * A pin, a colour or a ticked box did nothing for a round trip and then
 * arrived all at once, which reads as the board stuttering rather than as the
 * note changing; a selection of five archived one card at a time, over more
 * than a second. So the change goes into the signal on the click and the
 * request follows it.
 *
 * What comes back afterwards then has to be folded in without undoing
 * anything newer. Every note the server sends (the response to a write, a
 * `note:updated` from another device, a whole listing after a reconnect) is
 * its last word on that note, and {@link PendingWrites.replay} puts the
 * writes still outstanding back on top of it. A response that lands after a
 * second click cannot revert that click, and a write that fails falls back to
 * the note as it stood with the later ones still applied.
 *
 * A write is identified by the `changes` object itself, so {@link
 * PendingWrites.settle} must be handed the same one {@link
 * PendingWrites.begin} was given, whatever was eventually sent: a conflict
 * retry sends a merged set of changes and still settles the write it retried.
 */
export interface PendingWrites {
  /** Record a write about to be sent, and return the note to show meanwhile. */
  begin(note: Note, changes: NoteUpdate): Note;
  /** Forget a write storage has answered, whether it succeeded or failed. */
  settle(id: string, changes: NoteUpdate): void;
  /** `truth` with every write still outstanding for that note replayed on it. */
  replay(truth: Note): Note;
  /** Whether any write for this note is still outstanding. */
  pending(id: string): boolean;
}

export function createPendingWrites(): PendingWrites {
  // Per note, oldest first: replaying in order leaves the newest write on top.
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
