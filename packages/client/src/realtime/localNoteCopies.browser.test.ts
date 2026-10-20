import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteLocalNoteCopies,
  deleteReadableNoteCopies,
  LOCAL_COPY_PREFIX,
} from "./localNoteCopies.ts";

/** Where a copy was kept, readable, before the document was sealed. */
const READABLE = "manifesto:yjs:";

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

/**
 * Which of `names` exist. Other test files share this origin, and make their
 * own databases. Thus, the test asks only about those that it created.
 */
async function existing(names: string[]): Promise<string[]> {
  const all = new Set((await indexedDB.databases()).map((db) => db.name));
  return names.filter((name) => all.has(name));
}

/** Names that no other test file uses. */
const id = (n: string) =>
  `copies-test-${n}-${Math.random().toString(36).slice(2)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteLocalNoteCopies", () => {
  it("deletes every note's offline copy and nothing else", async () => {
    const copies = [
      `${LOCAL_COPY_PREFIX}${id("a")}`,
      `${LOCAL_COPY_PREFIX}${id("b")}`,
      `${READABLE}${id("old")}`,
    ];
    const other = `manifesto-${id("other")}`;
    for (const name of [...copies, other]) await createDatabase(name);
    // The real listing, limited to the databases of this test. Thus, the open
    // copies of a different test file in the same origin are not deleted under
    // it.
    const listAll = indexedDB.databases.bind(indexedDB);
    vi.spyOn(indexedDB, "databases").mockImplementation(async () =>
      (await listAll()).filter(
        (db) => db.name !== undefined && [...copies, other].includes(db.name),
      ),
    );
    await deleteLocalNoteCopies([]);
    vi.restoreAllMocks();
    expect(await existing([...copies, other])).toEqual([other]);
    indexedDB.deleteDatabase(other);
  });

  it("deletes the notes it is told about where databases cannot be listed", async () => {
    const note = id("c");
    const names = [`${LOCAL_COPY_PREFIX}${note}`, `${READABLE}${note}`];
    for (const name of names) await createDatabase(name);
    vi.spyOn(indexedDB, "databases").mockRejectedValue(new Error("refused"));
    await deleteLocalNoteCopies([note]);
    vi.restoreAllMocks();
    expect(await existing(names)).toEqual([]);
  });
});

describe("deleteReadableNoteCopies", () => {
  it("deletes the copies from before sealing and leaves the sealed ones", async () => {
    // A readable copy loaded into the synced document would reach the server as
    // it is. Thus, it never opens under the name in use.
    expect(LOCAL_COPY_PREFIX.startsWith(READABLE)).toBe(false);
    expect(READABLE.startsWith(LOCAL_COPY_PREFIX)).toBe(false);
    const listed = `${READABLE}${id("listed")}`;
    const told = id("told");
    const sealed = `${LOCAL_COPY_PREFIX}${told}`;
    const mine = [listed, `${READABLE}${told}`, sealed];
    for (const name of mine) await createDatabase(name);
    const listAll = indexedDB.databases.bind(indexedDB);
    vi.spyOn(indexedDB, "databases").mockImplementation(async () =>
      (await listAll()).filter(
        (db) => db.name !== undefined && mine.includes(db.name),
      ),
    );
    await deleteReadableNoteCopies([told]);
    vi.restoreAllMocks();
    expect(await existing(mine)).toEqual([sealed]);
    indexedDB.deleteDatabase(sealed);
  });

  it("looks no further once a listing has found them all", async () => {
    // The test above listed each copy. No code makes a readable copy since
    // then.
    const listing = vi.spyOn(indexedDB, "databases");
    await deleteReadableNoteCopies([id("later")]);
    expect(listing).not.toHaveBeenCalled();
  });
});
