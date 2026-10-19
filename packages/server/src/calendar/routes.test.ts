import type {
  ApiTokenCreatedResponse,
  NoteCreate,
  SealedNote,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";
import { reminderKeyOf } from "#/test/keyedTokens.ts";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";

const baseNote: NoteCreate = {
  title: "Dentist",
  content: "",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: {
    time: "2026-05-01T09:30:00",
    recurrence: "none",
    timezone: "Europe/Helsinki",
  },
};

describe("the reminder feed", () => {
  let rig: TestRig;
  let session: string;
  let userId: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    const olivia = await registerTestUser(rig, "olivia");
    session = olivia.token;
    userId = olivia.userId;
    await rig.request("/api/v1/notes", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify(baseNote),
    });
  });

  afterEach(async () => {
    await rig.close();
  });

  async function mint(kind: string) {
    const res = await rig.request("/api/v1/tokens", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        name: "Phone calendar",
        kind,
        password: "test-pass-12",
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as ApiTokenCreatedResponse;
    return { ...created, secret: defined(created.secret) };
  }

  it("serves the reminders at a calendar token's address, each named once its reader left the feed its key", async () => {
    const { secret, token } = await mint("calendar");
    expect(secret.startsWith("mfc_")).toBe(true);
    expect(token).toMatchObject({ kind: "calendar", scopes: [] });
    const feed = async () => {
      const res = await rig.request(`/api/v1/calendar/${secret}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/calendar");
      return res.text();
    };

    // A note sealed with the account's real keys, as a token writes one.
    const api = await mint("api");
    const made = await rig.request("/api/v1/notes", {
      method: "POST",
      headers: authHeaders(api.secret),
      body: JSON.stringify({ ...baseNote, title: "Checkup" }),
    });
    expect(made.status).toBe(201);
    const { id } = ((await made.json()) as { note: { id: string } }).note;
    const sealed = async () =>
      (
        (await (
          await rig.rawRequest(`/api/v1/notes/${id}`, {
            headers: authHeaders(session),
          })
        ).json()) as { note: SealedNote }
      ).note;

    // Nothing has been left for the feed: it knows when, and not what.
    const before = await feed();
    expect(before).toContain("X-WR-CALNAME:Phone calendar");
    expect(before).toContain("DTSTART;TZID=Europe/Helsinki:20260501T093000");
    expect(before).toContain("SUMMARY:Reminder");
    expect(before).not.toContain("Checkup");

    // The app leaves the note's key under the reminder key.
    const put = (body: object) =>
      rig.rawRequest(`/api/v1/notes/${id}`, {
        method: "PUT",
        headers: authHeaders(session),
        body: JSON.stringify(body),
      });
    const reminderKey = await reminderKeyOf(await sealed(), userId);
    expect((await put({ reminderKey })).status).toBe(200);
    expect(await feed()).toContain("SUMMARY:Checkup");
    // A copy made for another note opens nothing here.
    expect((await put({ reminderKey: "readable" })).status).toBe(422);

    // The copy goes when the reminder does, and does not come back with it.
    expect((await put({ reminder: null })).status).toBe(200);
    expect((await sealed()).reminderKey).toBeUndefined();
    expect((await put({ reminder: baseNote.reminder })).status).toBe(200);
    expect((await sealed()).reminderKey).toBeUndefined();
    expect(await feed()).not.toContain("Checkup");
  });

  it("opens nothing else, and nothing opens it but its own kind", async () => {
    const calendar = await mint("calendar");
    const api = await mint("api");

    // Not a bearer token anywhere.
    const asBearer = await rig.request("/api/v1/notes", {
      headers: authHeaders(calendar.secret),
    });
    expect(asBearer.status).toBe(401);
    // An API token's secret is not a feed address.
    expect(
      (await rig.request(`/api/v1/calendar/${api.secret}.ics`)).status,
    ).toBe(404);
    expect(
      (await rig.request(`/api/v1/calendar/${calendar.secret}`)).status,
    ).toBe(404);
    expect((await rig.request("/api/v1/calendar/mfc_made-up.ics")).status).toBe(
      404,
    );
  });

  it("stops when the token is revoked", async () => {
    const { secret, token } = await mint("calendar");
    await rig.request(`/api/v1/tokens/${token.id}`, {
      method: "DELETE",
      headers: authHeaders(session),
    });
    expect((await rig.request(`/api/v1/calendar/${secret}.ics`)).status).toBe(
      404,
    );
  });
});
