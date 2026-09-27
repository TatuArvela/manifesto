import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteLocalNoteCopies } from "./localNoteCopies.js";

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

/** Which of `names` exist. Other test files share this origin and make
 * databases of their own, so only the ones a test created are asked about. */
async function existing(names: string[]): Promise<string[]> {
  const all = new Set((await indexedDB.databases()).map((db) => db.name));
  return names.filter((name) => all.has(name));
}

/** Names no other test file uses. */
const id = (n: string) =>
  `copies-test-${n}-${Math.random().toString(36).slice(2)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteLocalNoteCopies", () => {
  it("deletes every note's offline copy and nothing else", async () => {
    const copies = [`manifesto:yjs:${id("a")}`, `manifesto:yjs:${id("b")}`];
    const other = `manifesto-${id("other")}`;
    for (const name of [...copies, other]) await createDatabase(name);
    // The real listing, narrowed to this test's databases, so another test
    // file's open copies in the same origin are not deleted under it.
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
    await createDatabase(`manifesto:yjs:${note}`);
    vi.spyOn(indexedDB, "databases").mockRejectedValue(new Error("refused"));
    await deleteLocalNoteCopies([note]);
    vi.restoreAllMocks();
    expect(await existing([`manifesto:yjs:${note}`])).toEqual([]);
  });
});
