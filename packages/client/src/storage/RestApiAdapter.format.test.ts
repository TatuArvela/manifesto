import {
  NewerNoteFormatError,
  NoteColor,
  type NoteCreate,
  NoteFont,
  setNoteFormatStepsForTests,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "#/test/defined.ts";
import { SealedServer, testKeys } from "#/test/sealedServer.ts";
import { RestApiAdapter } from "./RestApiAdapter.ts";
import { Sealer, type StorageKeys } from "./sealing.ts";

/**
 * A note's format in connected mode, against a server that holds only what
 * it is sent (`noteFormat.ts` in shared). A test raises the format by giving
 * the build a step, and lowers it again to play an older build.
 */

const draft: NoteCreate = {
  title: "Groceries",
  content: "Milk and eggs",
  color: NoteColor.Yellow,
  font: NoteFont.Serif,
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

/** Format 2 while it is set: every title in capitals. */
const shout = (words: { title?: string }) =>
  words.title === undefined ? {} : { title: words.title.toUpperCase() };

describe("a note's format, connected", () => {
  let server: SealedServer;
  let keys: StorageKeys;

  /** A device of the account, as a build of whichever format is set. */
  const device = () => {
    const sealer = new Sealer(keys);
    return {
      sealer,
      adapter: new RestApiAdapter("http://server.test", "tok", { sealer }),
    };
  };

  beforeEach(async () => {
    server = new SealedServer();
    vi.stubGlobal("fetch", server.fetch);
    keys = await testKeys();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setNoteFormatStepsForTests(null);
  });

  it("writes a note and its versions in the current format", async () => {
    const { adapter } = device();
    const created = await adapter.create(draft);
    await adapter.saveVersion(created.id, { title: "Before", content: "" });
    expect(server.notes.get(created.id)?.format).toBe(1);
    expect(server.versions.get(created.id)?.[0]?.format).toBe(1);
  });

  it("shows an older note brought up to date, and moves it with every word when one changes", async () => {
    const created = await device().adapter.create(draft);
    setNoteFormatStepsForTests([shout]);
    const { adapter } = device();
    expect(await adapter.get(created.id)).toMatchObject({
      title: "GROCERIES",
      content: "Milk and eggs",
    });

    // A pin is no word: the note stays in its format.
    await adapter.update(created.id, { pinned: true });
    expect(server.notes.get(created.id)?.format).toBe(1);

    const updated = await adapter.update(created.id, { content: "Bread" });
    expect(updated).toMatchObject({
      title: "GROCERIES",
      content: "Bread",
      font: NoteFont.Serif,
    });
    expect(server.notes.get(created.id)?.format).toBe(2);
    // Read again from the server, as another device would.
    expect(await device().adapter.get(created.id)).toMatchObject({
      title: "GROCERIES",
      content: "Bread",
    });
  });

  it("leaves out a note a newer version saved, and says so", async () => {
    setNoteFormatStepsForTests([shout]);
    const newer = await device().adapter.create(draft);
    setNoteFormatStepsForTests(null);
    const { adapter, sealer } = device();
    const older = await adapter.create({ ...draft, title: "Mine" });

    expect((await adapter.getAll()).map((n) => n.id)).toEqual([older.id]);
    expect(sealer.newer.value.has(newer.id)).toBe(true);
    expect(sealer.unreadable.value.has(newer.id)).toBe(false);
    // An export made now would be without it.
    expect(sealer.missesOwnNotes()).toBe(true);
  });

  it("refuses an older build's write over a newer note, with a reason", async () => {
    const { adapter, sealer } = device();
    const created = await adapter.create(draft);
    // A newer build moves the note on while this one still holds it.
    setNoteFormatStepsForTests([shout]);
    await device().adapter.update(created.id, { content: "From later" });
    setNoteFormatStepsForTests(null);

    await expect(
      adapter.update(created.id, { title: "From before" }),
    ).rejects.toBeInstanceOf(NewerNoteFormatError);
    expect(sealer.newer.value.has(created.id)).toBe(true);
    const held = defined(server.notes.get(created.id));
    expect(held.format).toBe(2);
    // Only the one refused write went out after the newer one.
    expect(
      server.requests.filter((r) => r === `PUT /api/v1/notes/${created.id}`),
    ).toHaveLength(2);
  });
});
