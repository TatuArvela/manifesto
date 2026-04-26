import { signal } from "@preact/signals";

/**
 * Map of noteId → set of viewer connection ids currently viewing that note,
 * for the authenticated user across other tabs/devices. Updated by the WS
 * `presence:join` / `presence:leave` events; cleared on logout.
 */
export const presenceByNote = signal<Map<string, Set<string>>>(new Map());

export function clearPresence(): void {
  presenceByNote.value = new Map();
}

export function recordPresenceJoin(noteId: string, userId: string): void {
  const next = new Map(presenceByNote.value);
  const viewers = new Set(next.get(noteId) ?? []);
  viewers.add(userId);
  next.set(noteId, viewers);
  presenceByNote.value = next;
}

export function recordPresenceLeave(noteId: string, userId: string): void {
  const next = new Map(presenceByNote.value);
  const viewers = new Set(next.get(noteId) ?? []);
  viewers.delete(userId);
  if (viewers.size === 0) {
    next.delete(noteId);
  } else {
    next.set(noteId, viewers);
  }
  presenceByNote.value = next;
}
