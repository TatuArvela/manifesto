import { hasUnloadedImages, imageCountOf, type Note } from "@manifesto/shared";

/**
 * Structural equality over the JSON a note is made of.
 *
 * Written out rather than compared field by field so that adding a field to
 * `Note` cannot quietly leave it out of the comparison, which would make a
 * change to that field invisible to {@link foldIncoming} and so to the board.
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
 * A note the server sent, folded into the copy already held.
 *
 * Returns the held note itself, unchanged and identical by reference, when
 * the server's copy says nothing new. That is the point of this: a connected
 * client hears about its own write twice, once as the response and once as
 * the `note:updated` broadcast back to it, and a reconnect re-fetches the
 * whole list. Writing each of those into the signal repainted the board and
 * re-ran the masonry pass for a note that had not moved. The caller compares
 * the result by reference and skips the write when nothing came of it.
 *
 * Attachments are the one thing the held copy may know better. A listing
 * leaves the bytes behind and says so by sending an `imageCount` larger than
 * the `images` it carries, so a card that has already fetched them would lose
 * them to any refetch of the list it was in, and fetch them again on the next
 * scroll past. It keeps them while the note is otherwise the same note: a new
 * `updatedAt` could mean new pictures.
 *
 * `hasUnloadedImages` is what decides that, rather than an empty `images`
 * alone. A note whose attachments were genuinely all removed says so with a
 * count of zero, and must be allowed to.
 */
export function foldIncoming(held: Note | undefined, incoming: Note): Note {
  if (!held) return incoming;
  const next =
    held.updatedAt === incoming.updatedAt &&
    hasUnloadedImages(incoming) &&
    held.images.length === imageCountOf(incoming)
      ? { ...incoming, images: held.images }
      : incoming;
  return sameValue(held, next) ? held : next;
}

/**
 * A whole listing folded into the notes already held, note by note.
 *
 * Returns the held array itself when the listing brought nothing new, so a
 * reconnect on an unchanged board costs no render at all. Otherwise the notes
 * that did not change keep their identity, and only the cards whose note
 * actually moved are re-rendered.
 */
export function foldIncomingList(held: Note[], incoming: Note[]): Note[] {
  const byId = new Map(held.map((note) => [note.id, note]));
  const next = incoming.map((note) => foldIncoming(byId.get(note.id), note));
  const unchanged =
    next.length === held.length && next.every((note, i) => note === held[i]);
  return unchanged ? held : next;
}
