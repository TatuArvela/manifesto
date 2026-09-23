import { NoteColor, type NoteCreate, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_INDEX_VERSION } from "./searchTerms.js";
import type { StorageDriver } from "./types.js";

/**
 * What a search finds, run against both drivers. The words are cut in one
 * place (`searchTerms.ts`) precisely so these answers are the same on each;
 * a driver that stores or looks them up differently fails here under its own
 * name.
 */

const T0 = "2026-04-01T00:00:00.000Z";
const T1 = "2026-04-01T00:00:01.000Z";
const T2 = "2026-04-01T00:00:02.000Z";
const PAGE = { limit: 50 };

const base: NoteCreate = {
  title: "",
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
  reminder: null,
};

export function describeSearchContract(
  name: string,
  boot: () => Promise<StorageDriver>,
  /** Marks every note unindexed, as a database from before the index is. */
  forgetIndex: (storage: StorageDriver) => Promise<void>,
): void {
  describe(`${name}: search`, () => {
    let storage: StorageDriver;

    const insert = (id: string, data: Partial<NoteCreate>, userId = "u1") =>
      storage.notes.insert({
        id,
        userId,
        data: { ...base, ...data },
        createdAt: T0,
        updatedAt: T0,
      });

    const found = async (query: string, userId = "u1") =>
      (await storage.notes.search(userId, query, PAGE)).notes
        .map((n) => n.id)
        .sort();

    beforeEach(async () => {
      storage = await boot();
      for (const [id, username] of [
        ["u1", "una"],
        ["u2", "ursula"],
      ]) {
        await storage.users.create({
          id,
          username,
          passwordHash: "h",
          displayName: "",
          avatarColor: "",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
      }
      await insert("groceries", {
        title: "Groceries",
        content: "- [ ] Milk\n- [x] **Eggs**",
      });
      await insert("trip", {
        title: "Trip to Äkäslompolo",
        content: "Pack skis",
      });
      await insert("milky", { content: "The Milky Way" });
      await insert("secret", { content: "milk of another user" }, "u2");
    });

    afterEach(async () => {
      await storage.close();
    });

    it("finds whole words and word prefixes in title and content", async () => {
      expect(await found("milk")).toEqual(["groceries", "milky"]);
      expect(await found("mil")).toEqual(["groceries", "milky"]);
      expect(await found("groc")).toEqual(["groceries"]);
      expect(await found("eggs")).toEqual(["groceries"]);
    });

    it("needs every word of the query", async () => {
      expect(await found("milk eggs")).toEqual(["groceries"]);
      expect(await found("milk skis")).toEqual([]);
    });

    it("folds case beyond ASCII", async () => {
      expect(await found("äkäs")).toEqual(["trip"]);
      expect(await found("ÄKÄSLOMPOLO")).toEqual(["trip"]);
    });

    it("does not match inside a word", async () => {
      expect(await found("ilk")).toEqual([]);
    });

    it("falls back to a substring for a query with no word in it", async () => {
      await insert("arrows", { content: "a -> b" });
      expect(await found("->")).toEqual(["arrows"]);
    });

    it("follows an edit and forgets a deleted note", async () => {
      await storage.notes.update("milky", "u1", { content: "Andromeda" }, T1);
      expect(await found("milk")).toEqual(["groceries"]);
      expect(await found("andro")).toEqual(["milky"]);
      await storage.notes.delete("groceries", "u1");
      expect(await found("milk")).toEqual([]);
    });

    it("leaves the index alone for a write that does not touch the text", async () => {
      await storage.notes.update("groceries", "u1", { pinned: true }, T2);
      expect(await found("milk")).toEqual(["groceries", "milky"]);
    });

    it("finds a shared note's words for its recipient, and its edits", async () => {
      await storage.shares.create({
        noteId: "secret",
        userId: "u1",
        role: "edit",
        createdAt: T1,
      });
      await storage.shares.accept("secret", "u1", T1);
      expect(await found("another")).toEqual(["secret"]);
      await storage.notes.update("secret", "u1", { content: "rewritten" }, T2);
      expect(await found("another")).toEqual([]);
      expect(await found("rewrit", "u2")).toEqual(["secret"]);
    });

    it("indexes notes written before the index at the next start", async () => {
      await forgetIndex(storage);
      expect(await found("milk")).toEqual([]);
      expect(SEARCH_INDEX_VERSION).toBeGreaterThan(0);
    });
  });
}
