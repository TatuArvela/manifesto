import {
  deriveKey,
  isCiphertext,
  openNoteKey,
  openSharedFields,
  type ReminderPush,
  type SealedReminder,
} from "@manifesto/shared";

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
  const sealed = readSealed(p.sealed);
  return {
    type: "reminder",
    noteId: p.noteId,
    title: p.title,
    body: p.body,
    ...(sealed && { sealed }),
    next,
    firedAt: p.firedAt,
  };
}

/** The sealed half of a reminder, or null for anything not shaped as one:
 * the message is then shown as a device without a key shows it. */
function readSealed(value: unknown): SealedReminder | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (!Number.isInteger(s.keyVersion) || Number(s.keyVersion) < 1) return null;
  if (!isCiphertext(s.key, 1024)) return null;
  if (!isCiphertext(s.title, 8192)) return null;
  if (s.excerpt !== "" && !isCiphertext(s.excerpt, 8192)) return null;
  return {
    keyVersion: Number(s.keyVersion),
    key: s.key as string,
    title: s.title as string,
    excerpt: s.excerpt as string,
  };
}

/** The account key a signed-in device holds, as far as a push needs it. */
export interface PushKeys {
  userId: string;
  version: number;
  accountKey: CryptoKey;
  /** ISO time after which the keys are not to be used. */
  endsAt: string;
}

/**
 * What the notification says. A device that holds the account's keys opens
 * the note's title and the first of its text, and words them as the app does
 * when it fires a reminder itself (`reminderScheduler.ts`). A device without
 * keys (signed out, or the session run out), or a message that does not
 * open, shows what the server sent: that there is a reminder, and no more.
 */
export async function wordedPush(
  push: ReminderPush,
  keys: PushKeys | null,
  now = Date.now(),
): Promise<{ title: string; body: string }> {
  const plain = { title: push.title, body: push.body };
  const { sealed } = push;
  if (!sealed || !keys || !(Date.parse(keys.endsAt) > now)) return plain;
  try {
    const notes = await deriveKey(keys.accountKey, "account/notes");
    const key = await openNoteKey(
      { userId: keys.userId, version: keys.version, notes, personal: notes },
      push.noteId,
      sealed.keyVersion,
      sealed.key,
    );
    if (!key) return plain;
    const opened = await openSharedFields(key, push.noteId, {
      title: sealed.title,
      ...(sealed.excerpt !== "" && { excerpt: sealed.excerpt }),
    });
    return {
      // An untitled note keeps the name the server gave it, which is the
      // app's own for one, in the account's language.
      title: opened.title.trim() || push.title,
      body: opened.excerpt.replace(/\s+/g, " ").trim().slice(0, 140),
    };
  } catch {
    return plain;
  }
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
