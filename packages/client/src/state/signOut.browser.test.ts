import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { effect } from "@preact/signals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authToken, currentUser } from "./auth.js";
import { notes } from "./notesStore.js";
import { signOut } from "./signOut.js";

/**
 * Signing out must leave none of the account's notes in this browser. The
 * list in memory empties when the session ends; the offline copies of notes
 * opened for editing are IndexedDB databases that outlive it, and only
 * `signOut` deletes them.
 */

const unique = () => Math.random().toString(36).slice(2);

function note(id: string): Note {
  return {
    id,
    title: id,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

async function existing(names: string[]): Promise<string[]> {
  const all = new Set((await indexedDB.databases()).map((db) => db.name));
  return names.filter((name) => all.has(name));
}

let stopEmptying: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  notes.value = [];
  authToken.value = "session-token";
  currentUser.value = null;
  // The browser cannot list its databases here, so only the ids signOut is
  // given can find the copies: exactly the case that depends on reading the
  // list before the session empties it.
  vi.spyOn(indexedDB, "databases").mockResolvedValue([]);
  // What connected mode does when the session ends (notesStore.ts): the
  // list leaves memory at once. Mirrored here, since this build is open mode.
  stopEmptying = effect(() => {
    if (authToken.value === null) notes.value = [];
  });
});

afterEach(() => {
  stopEmptying?.();
  vi.restoreAllMocks();
  authToken.value = null;
  notes.value = [];
  localStorage.clear();
});

describe("signOut", () => {
  it("ends the session and deletes the offline copy of every note held", async () => {
    const ids = [`a-${unique()}`, `b-${unique()}`];
    const copies = ids.map((id) => `manifesto:yjs:${id}`);
    const unrelated = `manifesto:yjs:not-held-${unique()}`;
    for (const name of [...copies, unrelated]) await createDatabase(name);
    notes.value = ids.map(note);

    await signOut();

    expect(authToken.value).toBeNull();
    expect(notes.value).toEqual([]);
    vi.restoreAllMocks();
    expect(await existing([...copies, unrelated])).toEqual([unrelated]);
    indexedDB.deleteDatabase(unrelated);
  });

  it("ends the session when there is nothing to delete", async () => {
    await signOut();
    expect(authToken.value).toBeNull();
    expect(currentUser.value).toBeNull();
  });

  it("still ends the session when IndexedDB refuses to delete", async () => {
    notes.value = [note(`c-${unique()}`)];
    vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      throw new Error("refused");
    });
    await expect(signOut()).resolves.toBeUndefined();
    expect(authToken.value).toBeNull();
  });
});
