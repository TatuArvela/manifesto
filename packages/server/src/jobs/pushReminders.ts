import {
  advanceReminder,
  instantOf,
  MAX_NOTES_PAGE_SIZE,
  type NoteReminder,
  type ReminderPush,
  type SealedNote,
} from "@manifesto/shared";
import { logger } from "#/lib/logger.ts";
import { startPeriodicJob } from "#/lib/periodic.ts";
import { type MailLocale, mailLocale } from "#/mail/templates.ts";
import type { PushSender } from "#/push/sender.ts";
import { MAX_PAYLOAD_BYTES } from "#/push/webPush.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type { StorageDriver } from "#/storage/types.ts";

/** How frequently the server looks for reminders that are due. */
const TICK_MS = 30_000;
/**
 * How long the devices of the user have to fire a due reminder. An open app
 * fires it on time, and moves it on almost immediately. The server acts only
 * for a reminder that is still there after this time, which is a reminder that
 * no client fired. Thus, a reminder never arrives two times, and a reminder for
 * a closed app arrives this late.
 */
export const PUSH_GRACE_MS = 45_000;
/**
 * The same as the client: an occurrence that is more than one hour old is not
 * worth a notification. The app moves a recurring reminder past it when it
 * opens next.
 */
const CATCHUP_WINDOW_MS = 60 * 60_000;

/** The `reminder.untitled` of the client, in its languages. */
const UNTITLED: Record<MailLocale, string> = {
  en: "Untitled reminder",
  fi: "Nimetön muistutus",
};

/**
 * What a notification says about a note, as the client words it
 * (`reminderScheduler.ts`), also for an untitled note. It uses the language
 * that the account reported last. Thus, the same reminder reads the same,
 * whether the app or the server fired it.
 */
function notificationOf(locale: MailLocale): { title: string; body: string } {
  // The title and the text of the note are sealed, and the server has no key. A
  // device without a key shows this.
  return { title: UNTITLED[locale], body: "" };
}

/**
 * The message with what the reminder is about, sealed as the note has it: the
 * title, the excerpt (the start of the text, which each client that saves a
 * note saves with it), and the own wrapped copy of the note key of the reader.
 * The browser opens them with the account key that it keeps while it is signed
 * in. Not included when the reader has no current key. Made smaller to what a
 * push service accepts: the excerpt goes first, then the title.
 */
function withSealed(message: ReminderPush, note: SealedNote): ReminderPush {
  if (note.key === "") return message;
  const fits = (candidate: ReminderPush) =>
    Buffer.byteLength(JSON.stringify(candidate)) <= MAX_PAYLOAD_BYTES;
  const sealed = {
    keyVersion: note.keyVersion,
    key: note.key,
    title: note.title,
    excerpt: note.excerpt,
  };
  const whole = { ...message, sealed };
  if (fits(whole)) return whole;
  const untexted = { ...message, sealed: { ...sealed, excerpt: "" } };
  return fits(untexted) ? untexted : message;
}

/**
 * If the server must fire this reminder now: due for longer than the grace
 * time, not too old yet, and not already fired for this occurrence.
 */
export function isDueForPush(reminder: NoteReminder, now: number): boolean {
  if (reminder.recurrence === "none" && reminder.lastFiredAt) return false;
  const due = instantOf(reminder.time, reminder.timezone);
  const overdue = now - due;
  if (overdue < PUSH_GRACE_MS || overdue > CATCHUP_WINDOW_MS) return false;
  const lastFired = reminder.lastFiredAt
    ? Date.parse(reminder.lastFiredAt)
    : Number.NaN;
  return !(Number.isFinite(lastFired) && lastFired >= due);
}

export interface PushRemindersDeps {
  storage: StorageDriver;
  sender: PushSender;
  noteEvents: NoteEvents;
  /** Test seam: the clock. */
  now?: () => number;
}

/**
 * One pass. For each person with a subscribed browser, the server sends as a
 * push each reminder that is due and that none of their devices fired. Then it
 * moves the reminder on, exactly as a client that fires it would move it (the
 * next occurrence, or `lastFiredAt` for a reminder that does not repeat). The
 * write stops the next pass, and each open client, from a second fire.
 *
 * The pass reads only accounts with a subscription. Thus, a server on which
 * nobody subscribed does no work here.
 */
export async function pushDueReminders(deps: PushRemindersDeps): Promise<void> {
  const { storage, sender, noteEvents } = deps;
  const now = (deps.now ?? Date.now)();
  for (const userId of await storage.pushSubscriptions.userIds()) {
    /**
     * The code looks it up for the first reminder to send. Most passes have
     * none.
     */
    let locale: MailLocale | undefined;
    let cursor: string | undefined;
    do {
      const page = await storage.notes.listByUser(userId, {
        limit: MAX_NOTES_PAGE_SIZE,
        ...(cursor !== undefined && { cursor }),
      });
      cursor = page.nextCursor ?? undefined;
      for (const note of page.notes) {
        const reminder = note.reminder;
        if (!reminder || note.trashed || !isDueForPush(reminder, now)) continue;

        const next = advanceReminder(reminder);
        const firedAt = new Date(now).toISOString();
        const moved: NoteReminder = {
          ...(next ?? reminder),
          lastFiredAt: firedAt,
        };
        // Written before anything is sent. A pass that stops halfway must not
        // leave a reminder that the next pass pushes again. The write occurs
        // only if the note is still as this pass read it. The sends below can
        // take long enough for a client, the next pass or a different process
        // to fire or edit the reminder in the meantime, and the first writer
        // gets it. The next pass handles a note that changed in a different
        // way.
        const written = await storage.notes.update(
          note.id,
          userId,
          { reminder: moved },
          firedAt,
          note.updatedAt,
        );
        if (!written) continue;
        await noteEvents.changed(note.id);

        locale ??= mailLocale(
          (await storage.users.findById(userId))?.locale?.split("-")[0],
        );
        const message = withSealed(
          {
            type: "reminder",
            noteId: note.id,
            ...notificationOf(locale),
            next: next
              ? {
                  time: next.time,
                  ...(next.day !== undefined && { day: next.day }),
                }
              : null,
            firedAt,
          },
          note,
        );
        for (const subscription of await storage.pushSubscriptions.listByUser(
          userId,
        )) {
          await sender.send(subscription, message);
        }
      }
    } while (cursor !== undefined);
  }
}

export function startPushReminders(
  deps: PushRemindersDeps & { intervalMs?: number },
): () => void {
  return startPeriodicJob("push reminders", deps.intervalMs ?? TICK_MS, () =>
    pushDueReminders(deps).catch((err) => {
      logger.warn("Push reminders pass failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }),
  );
}
