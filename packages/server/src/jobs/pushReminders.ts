import {
  advanceReminder,
  instantOf,
  MAX_NOTES_PAGE_SIZE,
  type Note,
  type NoteReminder,
  type ReminderPush,
} from "@manifesto/shared";
import { logger } from "../lib/logger.js";
import { startPeriodicJob } from "../lib/periodic.js";
import { type MailLocale, mailLocale } from "../mail/templates.js";
import type { PushSender } from "../push/sender.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import type { StorageDriver } from "../storage/types.js";

/** How often the server looks for reminders that have come due. */
const TICK_MS = 30_000;
/**
 * How long a due reminder is left to the user's own devices. An open app
 * fires it on time and moves it on within a moment; the server steps in only
 * for one still standing after this, which is one no client fired. So a
 * reminder never arrives twice, and one for a closed app arrives this late.
 */
export const PUSH_GRACE_MS = 45_000;
/** Matches the client: an occurrence more than an hour stale is not worth
 * surfacing. The app moves a recurring one past it when it next opens. */
const CATCHUP_WINDOW_MS = 60 * 60_000;

/** The client's `reminder.untitled`, in the languages it speaks. */
const UNTITLED: Record<MailLocale, string> = {
  en: "Untitled reminder",
  fi: "Nimetön muistutus",
};

/**
 * What a notification says about a note, as the client words it
 * (`reminderScheduler.ts`), an untitled note included: in the language the
 * account last reported, so the same reminder reads the same whether the
 * app or the server fired it.
 */
function notificationOf(
  note: Note,
  locale: MailLocale,
): { title: string; body: string } {
  return {
    title: note.title.trim() || UNTITLED[locale],
    body: note.content.replace(/\s+/g, " ").trim().slice(0, 140),
  };
}

/**
 * Whether the server should fire this reminder now: due for longer than the
 * grace, not yet stale, and not fired already for this occurrence.
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
 * One pass: for everyone with a subscribed browser, every reminder that came
 * due and that none of their devices fired is sent as a push and then moved
 * on, exactly as a client firing it would have moved it (the next occurrence,
 * or `lastFiredAt` for one that does not repeat). The write is what stops the
 * next pass, and every open client, from firing it again.
 *
 * Only accounts with a subscription are read at all, so a server nobody has
 * subscribed on does no work here.
 */
export async function pushDueReminders(deps: PushRemindersDeps): Promise<void> {
  const { storage, sender, noteEvents } = deps;
  const now = (deps.now ?? Date.now)();
  for (const userId of await storage.pushSubscriptions.userIds()) {
    /** Looked up for the first reminder to send, which most passes lack. */
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
        // Written before anything is sent: a pass that dies half way must
        // not leave a reminder to be pushed again on the next. And only if
        // the note is still as this pass read it: the sends below can take
        // long enough for a client, the next pass or another process to
        // have fired or edited the reminder since, and whoever wrote first
        // has it. A note changed some other way is met again next pass.
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
        const message: ReminderPush = {
          type: "reminder",
          noteId: note.id,
          ...notificationOf(note, locale),
          next: next
            ? {
                time: next.time,
                ...(next.day !== undefined && { day: next.day }),
              }
            : null,
          firedAt,
        };
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
