import {
  NoteColor,
  type NoteCreate,
  NoteFont,
  type ReminderPush,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { Sealer } from "./storage/sealing.ts";
import {
  afterPush,
  type PushKeys,
  readReminderPush,
  wordedPush,
} from "./swPush.ts";
import { testKeys } from "./test/sealedServer.ts";

const push: ReminderPush = {
  type: "reminder",
  noteId: "01J",
  title: "Dentist",
  body: "Bring the x-rays",
  next: null,
  firedAt: "2026-10-03T12:00:00.000Z",
};

describe("readReminderPush", () => {
  it("takes a reminder as the server sends it", () => {
    expect(readReminderPush(push)).toEqual(push);
    const repeating = {
      ...push,
      next: { time: "2026-10-04T11:58:00", day: 31 },
    };
    expect(readReminderPush(repeating)).toEqual(repeating);
  });

  it("keeps only the fields it knows", () => {
    expect(readReminderPush({ ...push, extra: "x" })).toEqual(push);
  });

  it.each([
    ["nothing", null],
    ["text", "reminder"],
    ["another kind of message", { ...push, type: "note" }],
    ["no note", { ...push, noteId: "" }],
    ["a title that is not text", { ...push, title: 7 }],
    ["no time of firing", { ...push, firedAt: undefined }],
    ["a next that is not a reminder", { ...push, next: "tomorrow" }],
    ["a next with no time", { ...push, next: {} }],
    ["a next whose time is not one", { ...push, next: { time: "soon" } }],
    ["a day no month has", { ...push, next: { time: "2026-10-04", day: 32 } }],
  ])("refuses %s", (_name, payload) => {
    expect(readReminderPush(payload)).toBeNull();
  });
});

describe("afterPush", () => {
  const held = {
    noteId: "01J",
    time: "2026-10-03T11:58:00",
    recurrence: "monthly" as const,
    day: 31,
    title: "Dentist",
    body: "",
    lastFiredAt: null,
  };

  it("marks a reminder that does not repeat as fired, where it stands", () => {
    expect(afterPush(held, push)).toEqual({
      ...held,
      lastFiredAt: push.firedAt,
    });
  });

  it("moves a repeating one to where the server moved it", () => {
    expect(
      afterPush(held, {
        ...push,
        next: { time: "2026-11-30T11:58:00", day: 31 },
      }),
    ).toEqual({
      ...held,
      time: "2026-11-30T11:58:00",
      day: 31,
      lastFiredAt: push.firedAt,
    });
  });

  it("drops the repeat day once the new time shows it", () => {
    const moved = afterPush(held, {
      ...push,
      next: { time: "2026-12-31T11:58:00" },
    });
    expect(moved.time).toBe("2026-12-31T11:58:00");
    expect("day" in moved).toBe(false);
  });
});

describe("wordedPush", () => {
  const draft: NoteCreate = {
    title: "Dentist",
    content: "Bring the  x-rays\nand the referral",
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
    reminder: null,
  };

  /** A device that is signed in, and the push the server would send it for
   * a note of the account's. */
  async function device(note: Partial<NoteCreate> = {}) {
    const keys = await testKeys();
    const sealed = await new Sealer(keys).sealNew("01J", { ...draft, ...note });
    const held: PushKeys = { ...keys, endsAt: "2026-12-01T00:00:00.000Z" };
    const sent: ReminderPush = {
      ...push,
      title: "Untitled reminder",
      body: "",
      sealed: {
        keyVersion: sealed.keyVersion,
        key: sealed.key,
        title: sealed.title,
        excerpt: sealed.excerpt,
      },
    };
    return { held, sent };
  }
  const NOW = Date.parse("2026-10-03T12:00:00Z");

  it("opens the title and the first of the text on a device that holds the keys", async () => {
    const { held, sent } = await device();
    // Nothing of the note is readable in what was sent.
    expect(JSON.stringify(sent)).not.toContain("Dentist");
    expect(await wordedPush(sent, held, NOW)).toEqual({
      title: "Dentist",
      body: "Bring the x-rays and the referral",
    });
    // As the server sends it, through the check every message gets.
    const read = readReminderPush(JSON.parse(JSON.stringify(sent)));
    expect(read?.sealed).toEqual(sent.sealed);
  });

  it("names an untitled note as the server named it, with its text", async () => {
    const { held, sent } = await device({ title: "  " });
    expect(await wordedPush(sent, held, NOW)).toEqual({
      title: "Untitled reminder",
      body: "Bring the x-rays and the referral",
    });
  });

  it("says only that there is a reminder without the keys, past their day, or for another account", async () => {
    const { held, sent } = await device();
    const bare = { title: "Untitled reminder", body: "" };
    expect(await wordedPush(sent, null, NOW)).toEqual(bare);
    expect(
      await wordedPush(
        sent,
        { ...held, endsAt: "2026-10-01T00:00:00.000Z" },
        NOW,
      ),
    ).toEqual(bare);
    const other = await testKeys("u2");
    expect(
      await wordedPush(sent, { ...other, endsAt: held.endsAt }, NOW),
    ).toEqual(bare);
    // A message about another note than its key is for opens nothing.
    expect(await wordedPush({ ...sent, noteId: "01K" }, held, NOW)).toEqual(
      bare,
    );
  });

  it("drops a sealed half that is not shaped as one", () => {
    const odd = {
      ...push,
      sealed: { keyVersion: 1, key: "k", title: "Dentist" },
    };
    expect(readReminderPush(odd)).toEqual(push);
  });
});
