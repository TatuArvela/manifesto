import {
  type AccountKeys,
  keyFingerprint,
  NoteColor,
  type NoteCreate,
  NoteFont,
  newLinkKey,
  openLinkedKey,
  openSharedFields,
  type SealedNote,
  type SealedNoteCreate,
  snapshotKey,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { createAccountKeys } from "../utils/keyMaterial.js";
import { Sealer } from "./sealing.js";

/**
 * A note's key going from its owner to someone it is shared with: wrapped to
 * their public key, signed, checked and kept. Real keys throughout; no server
 * is involved in any of it but to pass the values on.
 */

const draft: NoteCreate = {
  title: "Trip plan",
  content: "Fly on the third.",
  color: NoteColor.Yellow,
  font: NoteFont.Serif,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["travel"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

/** An account as a device and the server each hold it. */
async function account(userId: string) {
  const made = await createAccountKeys(userId);
  const held: AccountKeys = {
    version: made.version,
    wrappedBySecret: made.request.wrappedBySecret,
    publicKeys: made.request.publicKeys,
    wrappedPrivateKeys: made.request.wrappedPrivateKeys,
  };
  const keys = { userId, version: made.version, accountKey: made.accountKey };
  return {
    userId,
    keys,
    publicKeys: held.publicKeys,
    load: async () => held,
    sealer: new Sealer(keys),
  };
}

/** What the server stores of a new note, and hands back. */
function stored(sealed: SealedNoteCreate): SealedNote {
  const { imageRefs: _i, previewRefs: _p, ...note } = sealed;
  return { ...note, createdAt: "c", updatedAt: "u" };
}

describe("handing a note's key to someone it is shared with", () => {
  it("lets the recipient open the invitation, keep the key and read the note", async () => {
    const owner = await account("u-owner");
    const alice = await account("u-alice");
    const note = stored(await owner.sealer.sealNew("n1", draft));

    const offered = await owner.sealer.offerKey(
      "n1",
      { userId: alice.userId, exchange: alice.publicKeys.exchange },
      async () => note,
      owner.load,
    );
    if (!offered) throw new Error("no offer");
    expect(offered).toMatchObject({ keyVersion: 1, signer: "u-owner" });

    const held = await alice.sealer.adoptOffered(
      "n1",
      offered,
      owner.publicKeys.signing,
      alice.load,
    );
    if (!held) throw new Error("not adopted");
    expect(held.keyVersion).toBe(1);
    expect(held.key.startsWith("e1.")).toBe(true);

    // The preview an invitation shows: the note's words, not the owner's
    // colour or tags, which are the owner's own.
    expect(await alice.sealer.openPreview("n1", 1, note)).toEqual({
      title: "Trip plan",
      content: "Fly on the third.",
      font: NoteFont.Serif,
    });

    // As the server sends it once accepted: her copy of the key, and no
    // colour or tags of hers yet.
    const hers: SealedNote = { ...note, key: held.key, color: "", tags: "" };
    // Another device of hers, which has only what the server holds.
    const otherDevice = new Sealer(alice.keys);
    expect(await otherDevice.open(hers)).toMatchObject({
      title: "Trip plan",
      content: "Fly on the third.",
      color: NoteColor.Default,
      tags: [],
    });
  });

  it("uses no key whose signature does not check, or that was made for someone or something else", async () => {
    const owner = await account("u-owner");
    const alice = await account("u-alice");
    const mallory = await account("u-mallory");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const other = stored(await owner.sealer.sealNew("n2", draft));
    const offerTo = (
      from: typeof owner,
      noteId: string,
      sealed: SealedNote,
      to: typeof alice,
    ) =>
      from.sealer.offerKey(
        noteId,
        { userId: to.userId, exchange: to.publicKeys.exchange },
        async () => sealed,
        from.load,
      );
    const good = await offerTo(owner, "n1", note, alice);
    if (!good) throw new Error("no offer");
    const adopt = (
      noteId: string,
      offered: typeof good,
      signerKey = owner.publicKeys.signing,
    ) => alice.sealer.adoptOffered(noteId, offered, signerKey, alice.load);

    // The server's own key in place of the signer's: the first thing a
    // dishonest server would try.
    expect(await adopt("n1", good, mallory.publicKeys.signing)).toBeNull();
    // A key of mallory's making, passed off as the owner's.
    const forged = await offerTo(
      mallory,
      "n1",
      stored(await mallory.sealer.sealNew("n1", draft)),
      alice,
    );
    if (!forged) throw new Error("no offer");
    expect(await adopt("n1", { ...forged, signer: "u-owner" })).toBeNull();
    // The key of another note, moved onto this one.
    const moved = await offerTo(owner, "n2", other, alice);
    if (!moved) throw new Error("no offer");
    expect(await adopt("n1", moved)).toBeNull();
    // One wrapped for someone else.
    const theirs = await offerTo(owner, "n1", note, mallory);
    if (!theirs) throw new Error("no offer");
    expect(await adopt("n1", theirs)).toBeNull();
    // And one said to be a later key than it is.
    expect(await adopt("n1", { ...good, keyVersion: 2 })).toBeNull();

    expect(await adopt("n1", good)).not.toBeNull();
  });

  it("takes a key offered with a note whose own copy is behind, through the handler", async () => {
    const owner = await account("u-owner");
    const alice = await account("u-alice");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const offered = await owner.sealer.offerKey(
      "n1",
      { userId: alice.userId, exchange: alice.publicKeys.exchange },
      async () => note,
      owner.load,
    );
    if (!offered) throw new Error("no offer");
    // No copy of her own: nothing opens until the offer is taken.
    const behind: SealedNote = {
      ...note,
      key: "",
      color: "",
      tags: "",
      offered,
    };
    expect(await alice.sealer.open(behind)).toBeNull();
    await alice.sealer.adoptOffered(
      "n1",
      offered,
      owner.publicKeys.signing,
      alice.load,
    );
    expect((await alice.sealer.open(behind))?.title).toBe("Trip plan");
  });

  it("gives two people the same short fingerprint for the same keys, and another for others", async () => {
    const owner = await account("u-owner");
    const alice = await account("u-alice");
    const print = await keyFingerprint(owner.publicKeys);
    expect(print).toMatch(/^([0-9A-F]{4} ){5}[0-9A-F]{4}$/);
    expect(await keyFingerprint({ ...owner.publicKeys })).toBe(print);
    expect(await keyFingerprint(alice.publicKeys)).not.toBe(print);
  });
});

describe("publishing a note by link", () => {
  const shownBy = async (
    key: Awaited<ReturnType<typeof snapshotKey>>,
    fields: Parameters<typeof openSharedFields>[2],
  ) => {
    if (!key) return null;
    const { title, content } = await openSharedFields(key, "n1", fields);
    return { title, content };
  };

  it("lets whoever has the link key open a live link, which follows the note", async () => {
    const owner = await account("u-owner");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const made = await owner.sealer.publish(
      { id: "n1", ...draft },
      "live",
      async () => note,
    );
    if (!made?.fields.wrappedKey) throw new Error("no link");
    expect(made.fields.snapshot).toBeUndefined();

    // The page: the link key from its address, the rest from the server.
    const key = await openLinkedKey(
      made.linkKey,
      "n1",
      note.keyVersion,
      made.fields.wrappedKey,
    );
    expect(await shownBy(key, note)).toEqual({
      title: "Trip plan",
      content: "Fly on the third.",
    });
    // Another link's key, or this one on another note, opens nothing.
    expect(
      await openLinkedKey(newLinkKey(), "n1", 1, made.fields.wrappedKey),
    ).toBeNull();
    expect(
      await openLinkedKey(made.linkKey, "n2", 1, made.fields.wrappedKey),
    ).toBeNull();

    // The owner can copy the address again, and nobody else's account can.
    expect(
      await owner.sealer.openLinkKey("n1", made.fields.sealedLinkKey),
    ).toBe(made.linkKey);
    const other = await account("u-other");
    expect(
      await other.sealer.openLinkKey("n1", made.fields.sealedLinkKey),
    ).toBeNull();
  });

  it("seals a snapshot under the link key, apart from the note's own key", async () => {
    const owner = await account("u-owner");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const made = await owner.sealer.publish(
      { id: "n1", ...draft },
      "snapshot",
      async () => note,
    );
    if (!made?.fields.snapshot) throw new Error("no snapshot");
    expect(made.fields.wrappedKey).toBeUndefined();
    const { snapshot } = made.fields;
    expect(JSON.stringify(snapshot)).not.toContain("Trip plan");
    expect(snapshot.refs).toEqual([]);

    expect(await shownBy(await snapshotKey(made.linkKey), snapshot)).toEqual({
      title: "Trip plan",
      content: "Fly on the third.",
    });
    // The copy is not under the note's key: the link gives nothing else away.
    expect(await shownBy(await snapshotKey(newLinkKey()), snapshot)).toEqual({
      title: "",
      content: "",
    });
  });
});
