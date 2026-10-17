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

/** The sealed half of a reminder, or null for anything not shaped as one:
 * the message is then shown as a device without a key shows it. */
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
