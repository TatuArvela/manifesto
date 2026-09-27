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

async function names(): Promise<string[]> {
  return (await indexedDB.databases())
    .map((db) => db.name ?? "")
    .filter((name) => name.startsWith("manifesto"))
    .sort();
}

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteLocalNoteCopies([]);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("manifesto-reminders");
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("deleteLocalNoteCopies", () => {
  it("deletes every note's offline copy and nothing else", async () => {
    await createDatabase("manifesto:yjs:n1");
    await createDatabase("manifesto:yjs:n2");
    await createDatabase("manifesto-reminders");
    await deleteLocalNoteCopies([]);
    expect(await names()).toEqual(["manifesto-reminders"]);
  });

  it("deletes the notes it is told about where databases cannot be listed", async () => {
    await createDatabase("manifesto:yjs:n1");
    vi.spyOn(indexedDB, "databases").mockRejectedValue(new Error("refused"));
    await deleteLocalNoteCopies(["n1"]);
    vi.restoreAllMocks();
    expect(await names()).toEqual([]);
  });
});
