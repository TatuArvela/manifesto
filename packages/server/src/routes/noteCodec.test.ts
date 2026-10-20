import {
  type AccountSealKeys,
  type Note,
  NoteColor,
  NoteFont,
  type SealedNote,
  setNoteFormatStepsForTests,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso } from "#/lib/time.ts";
import { HttpError } from "#/middleware/error.ts";
import { claimedImages } from "#/storage/contracts/claimed.ts";
import { testAccountKeys } from "#/test/keyedTokens.ts";
import { bootTestApp, registerTestUser, type TestRig } from "#/test/setup.ts";
import { noteCreateSchema } from "#/validation/noteSchemas.ts";
import {
  bodyOf,
  commentBody,
  commentOut,
  createBody,
  importBody,
  noteOut,
  noteRing,
  notesOut,
  tokenKeys,
  updateBody,
  versionBody,
  versionsOut,
} from "./noteCodec.ts";

/**
 * The translation of the request of a token, without the routes around it.
 * `notes.test.ts` tests what the routes do with the result. `tokens.test.ts`
 * tests that a token reaches them. A note here is sealed with real keys. Thus,
 * the test checks that it opens again as it was written.
 */

type Ctx = Parameters<typeof tokenKeys>[0];

/** A request as a route sees it: who asks, and the body that they sent. */
function request(
  body: unknown,
  auth: { via: "session" | "api"; keys?: AccountSealKeys },
): Ctx {
  return {
    get: () => ({ userId: "u", token: "t", ...auth }),
    req: {
      json: async () => {
        if (typeof body === "string") return JSON.parse(body);
        return body;
      },
    },
  } as unknown as Ctx;
}

const PLAIN = {
  title: "Groceries",
  content: "Milk and eggs",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  position: 0,
  tags: ["home"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

/**
 * The status with which `work` was refused, or null when it was not refused.
 */
async function refusal(work: () => Promise<unknown>): Promise<number | null> {
  try {
    await work();
    return null;
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
}

describe("noteCodec", () => {
  let rig: TestRig;
  let keys: AccountSealKeys;
  let userId: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    ({ userId } = await registerTestUser(rig, "alice"));
    keys = await testAccountKeys(userId);
  });

  afterEach(async () => {
    await rig.close();
  });

  const token = (body: unknown = {}) => request(body, { via: "api", keys });

  /** A note written as the `POST /api/v1/notes` of a token writes it. */
  async function stored(
    plain: Partial<typeof PLAIN> = {},
    as: { userId: string; keys: AccountSealKeys } = { userId, keys },
  ): Promise<SealedNote> {
    const { id, imageRefs, previewRefs, ...fields } = await createBody(
      request({ ...PLAIN, ...plain }, { via: "api", keys: as.keys }),
      as.keys,
      rig.storage,
    );
    const now = nowIso();
    return rig.storage.notes.insert({
      id,
      userId: as.userId,
      data: {
        ...fields,
        imageRefs: claimedImages(imageRefs),
        previewRefs: claimedImages(previewRefs),
        trashedAt: null,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  async function opened(note: SealedNote): Promise<Note> {
    const out = await noteOut(keys, note);
    if (!out || !("title" in out)) throw new Error("The note did not open");
    return out as Note;
  }

  describe("tokenKeys", () => {
    it("answers a session sealed, and a token with the keys it carries", () => {
      expect(tokenKeys(request({}, { via: "session" }))).toBeNull();
      expect(tokenKeys(token())).toBe(keys);
    });

    it("refuses a token that carries no key", async () => {
      expect(
        await refusal(async () => tokenKeys(request({}, { via: "api" }))),
      ).toBe(403);
    });
  });

  describe("bodyOf", () => {
    it("refuses a body that is not JSON with 400, and one off the schema with 422", async () => {
      expect(
        await refusal(() => bodyOf(token("{not json"), noteCreateSchema)),
      ).toBe(400);
      expect(
        await refusal(() =>
          bodyOf(token({ ...PLAIN, color: "plaid" }), noteCreateSchema),
        ),
      ).toBe(422);
    });
  });

  describe("createBody", () => {
    it("holds a session's note to the sealed schema, refusing readable words", async () => {
      expect(
        await refusal(() =>
          createBody(request(PLAIN, { via: "session" }), null, rig.storage),
        ),
      ).toBe(422);
    });

    it("seals a token's note so that only the keys open it", async () => {
      const note = await stored();
      expect(JSON.stringify(note)).not.toContain("Groceries");
      expect(JSON.stringify(note)).not.toContain("home");
      const back = await opened(note);
      expect(back).toMatchObject({
        title: "Groceries",
        content: "Milk and eggs",
        color: NoteColor.Yellow,
        tags: ["home"],
      });
      const stranger = await testAccountKeys("someone else");
      expect(await noteOut(stranger, note)).toBeNull();
    });

    it("refuses a note past what sealing allows as the caller's mistake", async () => {
      expect(
        await refusal(() =>
          createBody(
            token({ ...PLAIN, images: ["attachment:nothing-here"] }),
            keys,
            rig.storage,
          ),
        ),
      ).toBe(422);
    });
  });

  describe("notesOut", () => {
    it("leaves out a note the token's keys do not open", async () => {
      const mine = await stored();
      const other = await testAccountKeys("someone else");
      const listed = await notesOut(other, [mine]);
      expect(listed).toEqual([]);
      expect(await notesOut(keys, [mine])).toHaveLength(1);
      expect(await notesOut(null, [mine])).toEqual([mine]);
    });
  });

  describe("updateBody", () => {
    it("seals the changes under the key the note already has", async () => {
      const note = await stored();
      const changes = await updateBody(
        token({ title: "Errands" }),
        keys,
        rig.storage,
        note.id,
      );
      expect(changes?.keyVersion).toBe(note.keyVersion);
      expect(JSON.stringify(changes)).not.toContain("Errands");
      const written = await rig.storage.notes.update(
        note.id,
        userId,
        changes as Parameters<typeof rig.storage.notes.update>[2],
        nowIso(),
      );
      if (!written) throw new Error("The update was not written");
      expect((await opened(written)).title).toBe("Errands");
      expect((await opened(written)).content).toBe("Milk and eggs");
    });

    it("leaves personal fields out of the key version it states", async () => {
      const note = await stored();
      const changes = await updateBody(
        token({ color: NoteColor.Blue }),
        keys,
        rig.storage,
        note.id,
      );
      expect(changes).not.toHaveProperty("keyVersion");
    });

    it("answers null for a note the account does not hold", async () => {
      expect(
        await updateBody(token({ title: "x" }), keys, rig.storage, "missing"),
      ).toBeNull();
    });
  });

  describe("importBody", () => {
    it("writes over a note the account owns, and gives a taken id a new one", async () => {
      const note = await stored();
      const { userId: bobId } = await registerTestUser(rig, "bob");
      const bobs = (
        await stored({}, { userId: bobId, keys: await testAccountKeys(bobId) })
      ).id;

      const items = await importBody(
        token({
          notes: [
            { ...PLAIN, id: note.id, title: "Mine again" },
            { ...PLAIN, id: bobs, title: "Not Bob's" },
            { ...PLAIN, title: "No id" },
          ],
        }),
        keys,
        rig.storage,
      );
      expect(items).toHaveLength(3);
      expect(items[0]?.id).toBe(note.id);
      expect(items[0]?.key).toBe(note.key);
      expect(items[1]?.id).not.toBe(bobs);
      expect(items[2]?.id).toEqual(expect.any(String));
      expect(JSON.stringify(items)).not.toContain("Mine again");
    });
  });

  describe("versions and comments", () => {
    it("seals a version and opens it again with the note's key", async () => {
      const note = await stored();
      const version = await versionBody(
        token({ title: "Before", content: "it changed" }),
        keys,
        note,
      );
      if (!version) throw new Error("No version was sealed");
      expect(JSON.stringify(version)).not.toContain("Before");
      await rig.storage.versions.add({
        id: version.id,
        noteId: note.id,
        authorId: userId,
        keyVersion: version.keyVersion,
        format: version.format,
        title: version.title,
        content: version.content,
        createdAt: nowIso(),
      });
      const saved = await rig.storage.versions.list(note.id);
      const out = await versionsOut(keys, note, saved);
      expect(out).toEqual([
        expect.objectContaining({ title: "Before", content: "it changed" }),
      ]);
      const stranger = await testAccountKeys("someone else");
      expect(await versionsOut(stranger, note, saved)).toEqual([]);
    });

    it("seals a comment under the note's key and reads it back", async () => {
      const note = await stored();
      const ring = await noteRing(keys, rig.storage, note.id);
      const comment = await commentBody(token({ body: "Buy oat milk" }), ring);
      expect(comment.body).not.toContain("oat");
      expect(await commentOut(ring, { ...comment })).toBe("Buy oat milk");
    });

    it("refuses a ring for a note the account cannot see", async () => {
      expect(await refusal(() => noteRing(keys, rig.storage, "missing"))).toBe(
        404,
      );
    });
  });

  describe("a note's format", () => {
    // A step that writes each title in capitals: format 2, as this build knows
    // it while the test runs.
    const shout = (words: { title?: string }) =>
      words.title === undefined ? {} : { title: words.title.toUpperCase() };

    afterEach(() => setNoteFormatStepsForTests(null));

    it("reads a note in an older format brought up to date", async () => {
      const note = await stored();
      expect(note.format).toBe(1);
      setNoteFormatStepsForTests([shout]);
      expect(await noteOut(keys, note)).toMatchObject({
        title: "GROCERIES",
        content: "Milk and eggs",
      });
    });

    it("moves an older note with every word when one changes, and leaves a pin alone", async () => {
      const note = await stored();
      setNoteFormatStepsForTests([shout]);
      const pin = await updateBody(
        token({ pinned: true }),
        keys,
        rig.storage,
        note.id,
      );
      expect(pin).not.toHaveProperty("format");
      expect(pin).not.toHaveProperty("title");

      const changes = await updateBody(
        token({ content: "Bread" }),
        keys,
        rig.storage,
        note.id,
      );
      expect(changes).toMatchObject({ format: 2 });
      for (const word of ["title", "font", "images", "linkPreviews"]) {
        expect(changes).toHaveProperty(word);
      }
      const written = await rig.storage.notes.update(
        note.id,
        userId,
        changes as Parameters<typeof rig.storage.notes.update>[2],
        nowIso(),
      );
      if (!written) throw new Error("The update was not written");
      expect(written.format).toBe(2);
      expect(await noteOut(keys, written)).toMatchObject({
        title: "GROCERIES",
        content: "Bread",
      });
    });

    it("leaves out a note in a format newer than it reads", async () => {
      setNoteFormatStepsForTests([shout, shout]);
      const newer = await stored({ title: "From later" });
      expect(newer.format).toBe(3);
      setNoteFormatStepsForTests(null);
      const older = await stored();
      expect(await noteOut(keys, newer)).toBeNull();
      expect(await notesOut(keys, [newer, older])).toHaveLength(1);
    });

    it("reads a version in an older format brought up to date", async () => {
      const note = await stored();
      const version = await versionBody(
        token({ title: "Before", content: "it changed" }),
        keys,
        note,
      );
      if (!version) throw new Error("No version was sealed");
      expect(version.format).toBe(1);
      setNoteFormatStepsForTests([shout]);
      const [read] = await versionsOut(keys, note, [
        { ...version, noteId: note.id, timestamp: nowIso() },
      ]);
      expect(read).toMatchObject({ title: "BEFORE", content: "it changed" });
    });
  });
});
