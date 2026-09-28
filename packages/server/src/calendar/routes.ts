import { MAX_NOTES_PAGE_SIZE, type Note } from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import { nowIso } from "../lib/time.js";
import { CALENDAR_TOKEN_PREFIX, hashToken } from "../lib/token.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { remindersCalendar } from "./ics.js";

/**
 * `GET /api/calendar/<token>.ics`: a user's reminders, for a calendar app to
 * subscribe to. A calendar app sends no header, so the secret is the address:
 * a `calendar` token (`mfc_`), minted in Settings, which opens this feed and
 * nothing else, and is listed, revocable and audited with the other tokens.
 *
 * Any failure is the same 404, so an address that is wrong says nothing
 * about why. Calendar apps poll, some every few minutes, so the answer may be
 * kept five minutes.
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

    const notes: Note[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.notes.listByUser(user.id, {
        limit: MAX_NOTES_PAGE_SIZE,
        ...(cursor !== undefined && { cursor }),
      });
      notes.push(...page.notes);
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
