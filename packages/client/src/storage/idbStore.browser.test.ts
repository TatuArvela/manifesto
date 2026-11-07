import { afterEach, describe, expect, it } from "vitest";
import { idbStore } from "./idbStore.ts";

const DB = "manifesto-test-idb-store";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("delete blocked"));
  });
}

/** Opens the database at version 2, as a later build would. */
function upgrade(): Promise<"upgraded" | "blocked"> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onsuccess = () => {
      req.result.close();
      resolve("upgraded");
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve("blocked");
  });
}

describe("idbStore", () => {
  afterEach(async () => {
    await deleteDb();
  });

  for (const keepOpen of [false, true]) {
    describe(keepOpen ? "with a kept connection" : "per call", () => {
      it("writes, reads and deletes in the store", async () => {
        const store = idbStore(DB, "items", { keyPath: "id", keepOpen });
        await store.run("readwrite", (s) => s.put({ id: "a", n: 1 }));
        await store.runAll("readwrite", (s) => {
          s.put({ id: "b", n: 2 });
          s.put({ id: "c", n: 3 });
        });
        expect(await store.run("readonly", (s) => s.get("b"))).toEqual({
          id: "b",
          n: 2,
        });
        await store.run("readwrite", (s) => s.delete("a"));
        expect(await store.run("readonly", (s) => s.getAllKeys())).toEqual([
          "b",
          "c",
        ]);
      });

      it("lets a later version open", async () => {
        const store = idbStore(DB, "items", { keyPath: "id", keepOpen });
        await store.run("readwrite", (s) => s.put({ id: "a" }));
        expect(await upgrade()).toBe("upgraded");
      });
    });
  }

  it("rejects a failed write", async () => {
    const store = idbStore(DB, "items", { keyPath: "id" });
    await store.run("readwrite", (s) => s.add({ id: "a" }));
    await expect(
      store.run("readwrite", (s) => s.add({ id: "a" })),
    ).rejects.toBeDefined();
  });
});
