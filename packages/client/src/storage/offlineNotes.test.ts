import { describe, expect, it } from "vitest";
import { testKeys } from "../test/sealedServer.js";
import {
  type OfflineOwner,
  openModeOwner,
  openOffline,
  sealOffline,
} from "./offlineNotes.js";

/**
 * What a device keeps of notes not stored yet is sealed in connected mode,
 * and opens only for the account, key version, kind and record it was
 * sealed for. The IndexedDB side is the browser project's.
 */

const draft = {
  title: "Plans for Saturday",
  content: "Pick up the dentist's form, then the bakery.",
};

async function owner(userId = "u1"): Promise<OfflineOwner> {
  return { id: userId, keys: await testKeys(userId) };
}

describe("sealOffline / openOffline", () => {
  it("holds none of the words readable, and opens them again", async () => {
    const me = await owner();
    const sealed = await sealOffline(me, "draft", "current", draft);
    for (const word of ["Saturday", "dentist", "bakery"]) {
      expect(sealed).not.toContain(word);
    }
    expect(await openOffline(me, "draft", "current", sealed)).toEqual(draft);
  });

  it("does not open for another account", async () => {
    const me = await owner("u1");
    const sealed = await sealOffline(me, "draft", "current", draft);
    // The same key under another account's name, and another account's key.
    const renamed: OfflineOwner = {
      id: "u2",
      keys: { ...(me.keys ?? (await testKeys())), userId: "u2" },
    };
    expect(await openOffline(renamed, "draft", "current", sealed)).toBeNull();
    expect(
      await openOffline(await owner("u1"), "draft", "current", sealed),
    ).toBeNull();
  });

  it("does not open as another record, kind or key version", async () => {
    const me = await owner();
    const keys = me.keys ?? (await testKeys());
    const sealed = await sealOffline(me, "unsent", "01A", draft);
    expect(await openOffline(me, "unsent", "01B", sealed)).toBeNull();
    expect(await openOffline(me, "draft", "01A", sealed)).toBeNull();
    const later: OfflineOwner = { ...me, keys: { ...keys, version: 2 } };
    expect(await openOffline(later, "unsent", "01A", sealed)).toBeNull();
    expect(await openOffline(me, "unsent", "01A", sealed)).toEqual(draft);
  });

  it("keeps open mode's records as they are, beside its notes", async () => {
    const open = openModeOwner();
    const kept = await sealOffline(open, "draft", "current", draft);
    expect(JSON.parse(kept)).toEqual(draft);
    expect(await openOffline(open, "draft", "current", kept)).toEqual(draft);
  });

  it("reads something that is not a record as nothing", async () => {
    const me = await owner();
    expect(await openOffline(me, "draft", "current", "e1.nope")).toBeNull();
    const open = openModeOwner();
    expect(await openOffline(open, "draft", "current", "{not json")).toBeNull();
  });
});
