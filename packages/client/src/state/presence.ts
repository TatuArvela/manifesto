import type { PresenceUser } from "@manifesto/shared";
import { signal } from "@preact/signals";

/**
 * A map of noteId → map of userId → PresenceUser, for users who look at that
 * note now in a different tab or device. The WS presence:join and
 * presence:leave events update it. A logout clears it.
 */
export const presenceByNote = signal<Map<string, Map<string, PresenceUser>>>(
  new Map(),
);

export function clearPresence(): void {
  presenceByNote.value = new Map();
}

export function recordPresenceJoin(noteId: string, user: PresenceUser): void {
  const next = new Map(presenceByNote.value);
  const viewers = new Map(next.get(noteId) ?? []);
  viewers.set(user.id, user);
  next.set(noteId, viewers);
  presenceByNote.value = next;
}

export function recordPresenceLeave(noteId: string, userId: string): void {
  const next = new Map(presenceByNote.value);
  const viewers = new Map(next.get(noteId) ?? []);
  viewers.delete(userId);
  if (viewers.size === 0) {
    next.delete(noteId);
  } else {
    next.set(noteId, viewers);
  }
  presenceByNote.value = next;
}
