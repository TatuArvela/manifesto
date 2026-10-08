import type { ReminderPush } from "@manifesto/shared";

// What the service worker makes of a push message, kept apart from `sw.ts` so
// it can be tested: that file runs Workbox as it loads.

/**
 * A push message's payload as a reminder, or null for anything else. The
 * message was encrypted to this browser by the server it is signed in to, but
 * the worker runs privileged, so every field is checked before it is used.
 */
export function readReminderPush(payload: unknown): ReminderPush | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "reminder") return null;
  if (typeof p.noteId !== "string" || !p.noteId) return null;
  if (typeof p.title !== "string" || typeof p.body !== "string") return null;
  if (typeof p.firedAt !== "string") return null;
  let next: ReminderPush["next"] = null;
  if (p.next !== null) {
    if (!p.next || typeof p.next !== "object") return null;
    const n = p.next as Record<string, unknown>;
    if (typeof n.time !== "string" || Number.isNaN(Date.parse(n.time))) {
      return null;
    }
    if (
      n.day !== undefined &&
      !(Number.isInteger(n.day) && Number(n.day) >= 1 && Number(n.day) <= 31)
    ) {
      return null;
    }
    next = { time: n.time, ...(n.day !== undefined && { day: Number(n.day) }) };
  }
  return {
    type: "reminder",
    noteId: p.noteId,
    title: p.title,
    body: p.body,
    next,
    firedAt: p.firedAt,
  };
}

/** The worker's own copy of a reminder, as far as a push changes it. */
interface Fired {
  time: string;
  day?: number;
  lastFiredAt: string | null;
}

/**
 * The worker's copy of a reminder after the server fired it: moved to where
 * the server moved it, or marked fired when it does not repeat. Without this
 * the worker, which keeps its own list for when no page is open, would fire
 * the same occurrence again on its next look.
 */
export function afterPush<T extends Fired>(held: T, push: ReminderPush): T {
  if (push.next === null) return { ...held, lastFiredAt: push.firedAt };
  const { day: _replaced, ...rest } = held;
  return {
    ...rest,
    time: push.next.time,
    ...(push.next.day !== undefined && { day: push.next.day }),
    lastFiredAt: push.firedAt,
  } as T;
}
