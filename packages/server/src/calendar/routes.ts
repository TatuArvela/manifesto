import {
  MAX_NOTES_PAGE_SIZE,
  openReminderKey,
  openSharedFields,
  type SealedNote,
  unwrapFeedKey,
} from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "#/config.ts";
import { nowIso } from "#/lib/time.ts";
import { CALENDAR_TOKEN_PREFIX, hashToken } from "#/lib/token.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { type CalendarNote, remindersCalendar } from "./ics.ts";

/**
 * `GET /api/v1/calendar/<token>.ics`: the reminders of a user, to which a
 * calendar app subscribes. A calendar app sends no header. Thus, the secret is
 * the address: a `calendar` token (`mfc_`), made in Settings. It opens this
 * feed and nothing else. It is listed, revocable and audited with the other
 * tokens.
 *
 * All failures are the same 404. Thus, a wrong address tells nothing about the
 * reason. Calendar apps poll, some each few minutes. Thus, clients can keep the
 * answer for five minutes.
 */
export function createCalendarRoutes(deps: {
  storage: StorageDriver;
  cfg: ServerConfig;
}) {
  const { storage, cfg } = deps;
  const routes = new Hono();
  routes.get("/:file", async (c) => {
    const notFound = new HttpError(404, "Not found");
    const file = c.req.param("file");
    if (!file.endsWith(".ics")) throw notFound;
    const secret = file.slice(0, -".ics".length);
    if (!secret.startsWith(CALENDAR_TOKEN_PREFIX)) throw notFound;

    const token = await storage.apiTokens.findByHash(hashToken(secret));
    const now = nowIso();
    if (token?.kind !== "calendar") throw notFound;
    if (token.expiresAt !== null && token.expiresAt < now) throw notFound;
    const user = await storage.users.findById(token.userId);
    if (!user) throw notFound;
    await storage.apiTokens.touch(token.id, now);

    // The address contains the reminder key of the account, wrapped under a key
    // made from the address itself. The code opens it for this request, and
    // keeps it nowhere. It opens the notes that have a reminder, through the
    // copy of the key of each one that their reader left for it, and no other
    // notes. A note without that copy, or a feed made without a key, gets the
    // fallback name.
    const feed = token.wrappedKeys
      ? await unwrapFeedKey(secret, token.wrappedKeys)
      : null;
    const named = async (note: SealedNote) => {
      const key = feed
        ? await openReminderKey(
            feed.reminders,
            { userId: user.id, version: feed.version },
            note.id,
            note.keyVersion,
            note.reminderKey,
          )
        : null;
      if (!key) return { title: "", content: "" };
      const { title, content } = await openSharedFields(key, note.id, note);
      return { title, content };
    };
    const notes: CalendarNote[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.notes.listByUser(user.id, {
        limit: MAX_NOTES_PAGE_SIZE,
        ...(cursor !== undefined && { cursor }),
      });
      for (const note of page.notes) {
        const { id, reminder, trashed } = note;
        // The code opens only a note that the feed will show.
        const words =
          reminder && !trashed ? await named(note) : { title: "", content: "" };
        notes.push({ id, reminder, trashed, ...words });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    const body = remindersCalendar(notes, {
      name: token.name,
      now: new Date(now),
      appUrl: cfg.mail?.appUrl ?? null,
      untitled: "Reminder",
    });
    return c.body(body, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    });
  });

  return routes;
}
