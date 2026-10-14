import { isCiphertext } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import {
  associatedData,
  derivable,
  deriveBytes,
  deriveKey,
  seal,
  unseal,
} from "./seal.js";

const text = (value: string) => new TextEncoder().encode(value);
const read = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder().decode(bytes);

async function keyFor(material: string, purpose = "test"): Promise<CryptoKey> {
  return deriveKey(await derivable(text(material)), purpose);
}

const data = associatedData({ id: "n1", field: "title", version: 1 });

describe("seal", () => {
  it("opens with the same key and the same associated data", async () => {
    const key = await keyFor("a");
    const sealed = await seal(key, text("Shopping list"), data);
    expect(read(await unseal(key, sealed, data))).toBe("Shopping list");
  });

  it("is shaped as the server expects a ciphertext to be", async () => {
    const sealed = await seal(await keyFor("a"), text("Shopping list"), data);
    expect(isCiphertext(sealed, 1024)).toBe(true);
    // Eight letters the random base64url text holds by chance about once in
    // several trillion runs; the "xx" asked about before came up about once
    // in a hundred.
    expect(sealed).not.toContain("Shopping");
  });

  it("seals an empty value", async () => {
    const key = await keyFor("a");
    const sealed = await seal(key, new Uint8Array(0), data);
    expect(isCiphertext(sealed, 1024)).toBe(true);
    expect((await unseal(key, sealed, data))?.length).toBe(0);
  });

  it("uses a nonce of its own each time", async () => {
    const key = await keyFor("a");
    const first = await seal(key, text("same"), data);
    const second = await seal(key, text("same"), data);
    expect(first).not.toBe(second);
  });

  it("does not open under another key", async () => {
    const sealed = await seal(await keyFor("a"), text("x"), data);
    expect(await unseal(await keyFor("b"), sealed, data)).toBeNull();
  });

  it("does not open when moved to another row, field, version or account", async () => {
    const key = await keyFor("a");
    const mine = { id: "n1", field: "tags", version: 1, account: "u1" };
    const sealed = await seal(key, text("x"), associatedData(mine));
    for (const moved of [
      { ...mine, id: "n2" },
      { ...mine, field: "color" },
      { ...mine, version: 2 },
      { ...mine, account: "u2" },
      { id: mine.id, field: mine.field, version: mine.version },
    ]) {
      expect(await unseal(key, sealed, associatedData(moved))).toBeNull();
    }
    expect(read(await unseal(key, sealed, associatedData(mine)))).toBe("x");
  });

  it("does not open once changed, and never throws", async () => {
    const key = await keyFor("a");
    const sealed = await seal(key, text("x"), data);
    // A character in the middle: the last one carries bits that are not
    // part of any byte, so changing it can leave the ciphertext as it was.
    const at = 20;
    const flipped = `${sealed.slice(0, at)}${sealed[at] === "A" ? "B" : "A"}${sealed.slice(at + 1)}`;
    expect(await unseal(key, flipped, data)).toBeNull();
    expect(await unseal(key, "plain text", data)).toBeNull();
    expect(await unseal(key, "e1.", data)).toBeNull();
    expect(await unseal(key, "e1.!!!!", data)).toBeNull();
  });
});

describe("derived keys", () => {
  it("are the same for the same material and purpose", async () => {
    const sealed = await seal(await keyFor("a", "notes"), text("x"), data);
    expect(read(await unseal(await keyFor("a", "notes"), sealed, data))).toBe(
      "x",
    );
  });

  it("differ by purpose", async () => {
    const sealed = await seal(await keyFor("a", "notes"), text("x"), data);
    expect(
      await unseal(await keyFor("a", "personal"), sealed, data),
    ).toBeNull();
    const base = await derivable(text("a"));
    expect(await deriveBytes(base, "one")).not.toEqual(
      await deriveBytes(base, "two"),
    );
    expect(await deriveBytes(base, "one")).toHaveLength(32);
  });

  it("cannot be read out", async () => {
    const base = await derivable(text("a"));
    expect(base.extractable).toBe(false);
    expect((await deriveKey(base, "notes")).extractable).toBe(false);
  });
});
