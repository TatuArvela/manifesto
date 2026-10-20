import {
  deriveKey,
  isCiphertext,
  openNoteKey,
  openSharedFields,
  type ReminderPush,
  type SealedReminder,
} from "@manifesto/shared";

// What the service worker makes of a push message, kept separate from `sw.ts`
// so that it can be tested. That file runs Workbox when it loads.

/**
 * The payload of a push message as a reminder, or null for all other data. The
 * server to which this browser is signed in encrypted the message to it. But
 * the worker runs with privileges. Thus, the code checks each field before it
 * uses it.
 */
export function readReminderPush(payload: unknown): ReminderPush | null {
  if (!payload || typeof payload !== "object") return null;
  const push = payload as Record<string, unknown>;
  if (push.type !== "reminder") return null;
  if (typeof push.noteId !== "string" || !push.noteId) return null;
  if (typeof push.title !== "string" || typeof push.body !== "string") {
    return null;
  }
  if (typeof push.firedAt !== "string") return null;
  let next: ReminderPush["next"] = null;
  if (push.next !== null) {
    if (!push.next || typeof push.next !== "object") return null;
    const rawNext = push.next as Record<string, unknown>;
    if (
      typeof rawNext.time !== "string" ||
      Number.isNaN(Date.parse(rawNext.time))
    ) {
      return null;
    }
    if (
      rawNext.day !== undefined &&
      !(
        Number.isInteger(rawNext.day) &&
        Number(rawNext.day) >= 1 &&
        Number(rawNext.day) <= 31
      )
    ) {
      return null;
    }
    next = {
      time: rawNext.time,
      ...(rawNext.day !== undefined && { day: Number(rawNext.day) }),
    };
  }
  const sealed = readSealed(push.sealed);
  return {
    type: "reminder",
    noteId: push.noteId,
    title: push.title,
    body: push.body,
    ...(sealed && { sealed }),
    next,
    firedAt: push.firedAt,
  };
}

/**
 * The sealed half of a reminder, or null for all data that does not have its
 * shape. The message then shows as a device without a key shows it.
 */
function readSealed(value: unknown): SealedReminder | null {
  if (!value || typeof value !== "object") return null;
  const sealed = value as Record<string, unknown>;
  if (!Number.isInteger(sealed.keyVersion) || Number(sealed.keyVersion) < 1) {
    return null;
  }
  if (!isCiphertext(sealed.key, 1024)) return null;
  if (!isCiphertext(sealed.title, 8192)) return null;
  if (sealed.excerpt !== "" && !isCiphertext(sealed.excerpt, 8192)) return null;
  return {
    keyVersion: Number(sealed.keyVersion),
    key: sealed.key as string,
    title: sealed.title as string,
    excerpt: sealed.excerpt as string,
  };
}

/** The account key that a signed-in device has, as much as a push needs it. */
export interface PushKeys {
  userId: string;
  version: number;
  accountKey: CryptoKey;
  /** The ISO time after which the keys must not be used. */
  endsAt: string;
}

/**
 * What the notification says. A device that has the keys of the account opens
 * the title of the note and the start of its text, and words them as the app
 * does when it fires a reminder itself (`reminderScheduler.ts`). A device
 * without keys (signed out, or the session ended), or a message that does not
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
      // An untitled note keeps the name that the server gave it, which is the
      // own name of the app for one, in the language of the account.
      title: opened.title.trim() || push.title,
      body: opened.excerpt.replace(/\s+/g, " ").trim().slice(0, 140),
    };
  } catch {
    return plain;
  }
}

/** The own copy of a reminder of the worker, as much as a push changes it. */
interface Fired {
  time: string;
  day?: number;
  lastFiredAt: string | null;
}

/**
 * The copy of a reminder of the worker after the server fired it: moved to
 * where the server moved it, or marked fired when it does not repeat. Without
 * this, the worker, which keeps its own list for when no page is open, would
 * fire the same occurrence again on its next look.
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
