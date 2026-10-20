import { hasUnloadedImages, imageCountOf, type Note } from "@manifesto/shared";

/**
 * Structural equality over the JSON of a note.
 *
 * Written in this way, not as a comparison field by field. Thus, a new field of
 * `Note` cannot silently be missing from the comparison, which would make a
 * change to that field invisible to {@link foldIncoming}, and thus to the
 * board.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
  );
}

/**
 * A note that the server sent, folded into the copy that is already held.
 *
 * Returns the held note itself, unchanged and identical by reference, when the
 * copy of the server tells nothing new. That is the purpose of this. A
 * connected client gets its own write two times: one time as the response, and
 * one time as the `note:updated` broadcast back to it. A reconnect also gets
 * the full list again. When the code wrote each of those into the signal, the
 * board painted again, and the masonry pass ran again for a note that did not
 * move. The caller compares the result by reference, and skips the write when
 * nothing came of it.
 *
 * Attachments are the one thing that the held copy can know better. A listing
 * does not include the bytes, and tells this with an `imageCount` larger than
 * the `images` that it carries. Thus, a card that already loaded them would
 * lose them on each new fetch of its list, and load them again the next time
 * that it scrolls past. It keeps them while the note is otherwise the same
 * note. A new `updatedAt` could mean new pictures.
 *
 * `hasUnloadedImages` decides that, not an empty `images` alone. A note whose
 * attachments were really all removed tells it with a count of zero, and the
 * code must permit that.
 */
export function foldIncoming(held: Note | undefined, incoming: Note): Note {
  if (!held) return incoming;
  const next =
    held.updatedAt === incoming.updatedAt &&
    hasUnloadedImages(incoming) &&
    held.images.length === imageCountOf(incoming)
      ? {
          ...incoming,
          images: held.images,
          ...(held.imageAlts !== undefined && { imageAlts: held.imageAlts }),
        }
      : incoming;
  return sameValue(held, next) ? held : next;
}

/**
 * A full listing folded into the notes that are already held, note by note.
 *
 * Returns the held array itself when the listing brought nothing new. Thus, a
 * reconnect on a board without changes costs no render. Otherwise, the notes
 * that did not change keep their identity, and only the cards whose note really
 * changed render again.
 */
export function foldIncomingList(held: Note[], incoming: Note[]): Note[] {
  const byId = new Map(held.map((note) => [note.id, note]));
  const next = incoming.map((note) => foldIncoming(byId.get(note.id), note));
  const unchanged =
    next.length === held.length && next.every((note, i) => note === held[i]);
  return unchanged ? held : next;
}
