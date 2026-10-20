import {
  type AccountKeys,
  keyFingerprint,
  MAX_PREVIOUS_KEYS,
  MAX_PREVIOUS_KEYS_LENGTH,
  NoteColor,
  type NoteComment,
  type NoteCreate,
  NoteFont,
  type NoteRekeyRequest,
  newLinkKey,
  newNoteKey,
  noteSealKey,
  openLinkedKey,
  openPreviousKeys,
  openSharedFields,
  openSharedFieldsUnder,
  type PublicLink,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteVersion,
  sealPreviousKeys,
  snapshotKey,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { createAccountKeys } from "#/utils/keyMaterial.ts";
import { Sealer, setOfferHandler } from "./sealing.ts";

/**
 * The key of a note goes from its owner to a person with whom it is shared:
 * wrapped to their public key, signed, checked and kept. Real keys in all
 * places. The server only passes the values on.
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

/** An account as a device and the server each have it. */
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

/** What the server stores of a new note, and gives back. */
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

    // The preview that an invitation shows: the words of the note, not the
    // color or tags of the owner, which belong to the owner.
    expect(await alice.sealer.openPreview("n1", 1, note)).toEqual({
      title: "Trip plan",
      content: "Fly on the third.",
      font: NoteFont.Serif,
    });

    // As the server sends it after the accept: her copy of the key, and no
    // color or tags of hers yet.
    const hers: SealedNote = { ...note, key: held.key, color: "", tags: "" };
    // A different device of hers, which has only what the server has.
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

    // The own key of the server in place of that of the signer: the first thing
    // that a dishonest server would try.
    expect(await adopt("n1", good, mallory.publicKeys.signing)).toBeNull();
    // A key that mallory made, given as that of the owner.
    const hers = stored(await mallory.sealer.sealNew("n1", draft));
    const forged = await offerTo(mallory, "n1", hers, alice);
    if (!forged) throw new Error("no offer");
    expect(await adopt("n1", { ...forged, signer: "u-owner" })).toBeNull();
    // The key of a different note, moved onto this one.
    const moved = await offerTo(owner, "n2", other, alice);
    if (!moved) throw new Error("no offer");
    expect(await adopt("n1", moved)).toBeNull();
    // A key wrapped for a different person.
    const theirs = await offerTo(owner, "n1", note, mallory);
    if (!theirs) throw new Error("no offer");
    expect(await adopt("n1", theirs)).toBeNull();
    // And a key that says it is a later key than it is.
    expect(await adopt("n1", { ...good, keyVersion: 2 })).toBeNull();
    // A key that mallory made under her own name. The signature passes the
    // check, because she is on the note. But it is not the key under which the
    // words of the note are, and a note opened with it would read as empty.
    expect(
      await alice.sealer.adoptOffered(
        "n1",
        forged,
        mallory.publicKeys.signing,
        alice.load,
        note,
      ),
    ).toBeNull();
    // Also not after she wrote one field of the note under it, which an editor
    // can do. The words are still under the key of the note.
    const written: SealedNote = { ...note, font: hers.font };
    expect(
      await alice.sealer.adoptOffered(
        "n1",
        forged,
        mallory.publicKeys.signing,
        alice.load,
        written,
      ),
    ).toBeNull();
    expect(alice.sealer.holds("n1")).toBe(false);
    expect(
      await alice.sealer.adoptOffered(
        "n1",
        good,
        owner.publicKeys.signing,
        alice.load,
        written,
      ),
    ).not.toBeNull();

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
    // No copy of her own: nothing opens until she takes the offer.
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

  it("takes an offered key once, however often the note arrives before the server keeps her copy", async () => {
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
    const behind: SealedNote = {
      ...note,
      key: "",
      color: "",
      tags: "",
      offered,
    };
    let taken = 0;
    setOfferHandler(async (sealing, sealed) => {
      taken++;
      if (!sealed.offered) return;
      await sealing.adoptOffered(
        sealed.id,
        sealed.offered,
        owner.publicKeys.signing,
        alice.load,
        sealed,
      );
    });
    try {
      for (let i = 0; i < 3; i++) {
        expect((await alice.sealer.open(behind))?.title).toBe("Trip plan");
      }
      expect(taken).toBe(1);
    } finally {
      setOfferHandler(null);
    }
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

    // The page: the link key from its address, the remaining data from the
    // server.
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
    // The key of a different link, or the key of this link on a different note,
    // opens nothing.
    expect(
      await openLinkedKey(newLinkKey(), "n1", 1, made.fields.wrappedKey),
    ).toBeNull();
    expect(
      await openLinkedKey(made.linkKey, "n2", 1, made.fields.wrappedKey),
    ).toBeNull();

    // The owner can copy the address again, and the account of no other person
    // can.
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
    // The copy is not under the key of the note. The link gives nothing else
    // away.
    expect(await shownBy(await snapshotKey(newLinkKey()), snapshot)).toEqual({
      title: "",
      content: "",
    });
  });

  it("opens the page's note in one pass only under the key that is the note's", async () => {
    const owner = await account("u-owner");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const made = await owner.sealer.publish(
      { id: "n1", ...draft },
      "snapshot",
      async () => note,
    );
    if (!made?.fields.snapshot) throw new Error("no snapshot");
    const { snapshot } = made.fields;
    const right = await snapshotKey(made.linkKey);
    const wrong = await snapshotKey(newLinkKey());
    if (!right || !wrong) throw new Error("no key");
    expect(await openSharedFieldsUnder(right, "n1", snapshot)).toEqual(
      await openSharedFields(right, "n1", snapshot),
    );
    // The key of a different link also derives a key. Only the open tells.
    expect(await openSharedFieldsUnder(wrong, "n1", snapshot)).toBeNull();
  });
});

describe("replacing a note's key", () => {
  /** The note as the server has it after it took `body`. */
  const moved = (note: SealedNote, body: NoteRekeyRequest): SealedNote => {
    const { links: _links, ...fields } = body;
    return { ...note, ...fields };
  };
  const link = (overrides: Partial<PublicLink>): PublicLink => ({
    token: "tok",
    noteId: "n1",
    mode: "live",
    expiresAt: null,
    hasPassword: false,
    maxViews: null,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: "c",
    sealedLinkKey: "",
    ...overrides,
  });

  it("moves the note to a key the person removed never held, and keeps what the old one wrote readable", async () => {
    const owner = await account("u-owner");
    const alice = await account("u-alice");
    const bob = await account("u-bob");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const hand = async (to: typeof alice, from: SealedNote) => {
      const offered = await owner.sealer.offerKey(
        "n1",
        { userId: to.userId, exchange: to.publicKeys.exchange },
        async () => from,
        owner.load,
      );
      if (!offered) throw new Error("no offer");
      const held = await to.sealer.adoptOffered(
        "n1",
        offered,
        owner.publicKeys.signing,
        to.load,
      );
      if (!held) throw new Error("not adopted");
      return held;
    };
    const aliceKey = await hand(alice, note);
    await hand(bob, note);

    // Written while the note was under its first key.
    const fetch = async () => note;
    const version: SealedNoteVersion = {
      noteId: "n1",
      timestamp: "t",
      ...(await owner.sealer.sealVersion(
        "n1",
        { title: "Trip", content: "Fly on the second." },
        fetch,
      )),
    };
    const comment: NoteComment = {
      id: "c1",
      noteId: "n1",
      author: null,
      createdAt: "c",
      editedAt: null,
      ...(await owner.sealer.sealComment("n1", "c1", "Which airport?", fetch)),
    };

    // Alice is removed. The app of the owner gives the note a new key.
    const made = await owner.sealer.rekey({ ...note, rekeyDue: true }, []);
    if (!made) throw new Error("not replaced");
    expect(made.body.keyVersion).toBe(2);
    expect(made.body.links).toBeUndefined();
    expect(JSON.stringify(made.body)).not.toContain("Trip plan");
    made.commit();
    const after = moved(note, made.body);
    expect(owner.sealer.replaced.value.get("n1")).toBe(2);

    // The owner reads it as before, and also what the old key wrote with it.
    expect(await owner.sealer.open(after)).toMatchObject({
      title: "Trip plan",
      content: "Fly on the third.",
      font: NoteFont.Serif,
      tags: ["travel"],
    });
    const later = async () => after;
    expect(await owner.sealer.openVersions("n1", [version], later)).toEqual([
      expect.objectContaining({ content: "Fly on the second." }),
    ]);
    const reply: NoteComment = {
      ...comment,
      id: "c2",
      ...(await owner.sealer.sealComment("n1", "c2", "The small one.", later)),
    };
    expect(reply.keyVersion).toBe(2);
    expect(
      (await owner.sealer.openComments("n1", [comment, reply], later)).map(
        (c) => c.body,
      ),
    ).toEqual(["Which airport?", "The small one."]);

    // The copy of the first key of Alice opens nothing of the note as it is
    // now, whatever the server gives her.
    expect(
      await alice.sealer.open({ ...after, key: aliceKey.key, keyVersion: 1 }),
    ).toMatchObject({ title: "", content: "" });
    expect(await alice.sealer.open({ ...after, key: "" })).toBeNull();

    // Bob, still on the note, has nothing that opens it until the app of the
    // owner wraps the new key for him. Then he reads all of it, old and new.
    expect(await bob.sealer.open({ ...after, key: "" })).toBeNull();
    await expect(
      bob.sealer.sealUpdate("n1", { title: "x" }, async () => ({
        ...after,
        key: "",
      })),
    ).rejects.toThrow();
    const bobKey = await hand(bob, after);
    expect(bobKey.keyVersion).toBe(2);
    const bobs = { ...after, key: bobKey.key };
    expect(await bob.sealer.open(bobs)).toMatchObject({ title: "Trip plan" });
    expect(
      await bob.sealer.openVersions("n1", [version], async () => bobs),
    ).toHaveLength(1);
    // What he writes now tells under which key it is.
    expect(
      await bob.sealer.sealUpdate("n1", { title: "New" }, async () => bobs),
    ).toMatchObject({ keyVersion: 2 });

    // A second replacement also keeps the first key.
    const again = await owner.sealer.rekey({ ...after, rekeyDue: true }, []);
    if (!again) throw new Error("not replaced again");
    again.commit();
    const third = moved(after, again.body);
    expect(third.keyVersion).toBe(3);
    expect(
      await owner.sealer.openVersions("n1", [version], async () => third),
    ).toHaveLength(1);
  });

  it("keeps the newest earlier keys within what the server takes", async () => {
    const key = await noteSealKey(newNoteKey(), MAX_PREVIOUS_KEYS + 10);
    const previous = new Map<number, Uint8Array<ArrayBuffer>>();
    for (let version = 1; version < key.version; version++) {
      previous.set(version, newNoteKey());
    }
    const sealed = await sealPreviousKeys(key, "n1", previous);
    expect(sealed.length).toBeLessThanOrEqual(MAX_PREVIOUS_KEYS_LENGTH);
    const opened = await openPreviousKeys(key, "n1", sealed);
    expect(opened.size).toBe(MAX_PREVIOUS_KEYS);
    // The oldest are the ones that go.
    expect(opened.has(9)).toBe(false);
    expect(opened.get(10)).toEqual(previous.get(10));
    expect(opened.has(key.version - 1)).toBe(true);
  });

  it("hands the new key to the live links that stay", async () => {
    const owner = await account("u-owner");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    const published = await owner.sealer.publish(
      { id: "n1", ...draft },
      "live",
      async () => note,
    );
    if (!published) throw new Error("no link");
    const made = await owner.sealer.rekey(note, [
      link({ sealedLinkKey: published.fields.sealedLinkKey }),
      // A snapshot has no key of the note, and the code leaves a link whose key
      // does not open here.
      link({ token: "copy", mode: "snapshot" }),
      link({ token: "lost", sealedLinkKey: "e1.AAAA" }),
    ]);
    if (!made?.body.links) throw new Error("no links");
    expect(made.body.links.map((l) => l.token)).toEqual(["tok"]);
    const [rewrapped] = made.body.links;
    const key = await openLinkedKey(
      published.linkKey,
      "n1",
      2,
      rewrapped?.wrappedKey ?? "",
    );
    if (!key) throw new Error("the link does not open");
    expect(
      (await openSharedFields(key, "n1", moved(note, made.body))).title,
    ).toBe("Trip plan");
  });

  it("replaces nothing when the note does not open here", async () => {
    const owner = await account("u-owner");
    const other = await account("u-other");
    const note = stored(await owner.sealer.sealNew("n1", draft));
    // The copy of a different account, and a note with a field that is not its
    // own.
    expect(await other.sealer.rekey(note, [])).toBeNull();
    const elsewhere = stored(await owner.sealer.sealNew("n2", draft));
    expect(
      await owner.sealer.rekey({ ...note, content: elsewhere.content }, []),
    ).toBeNull();
  });
});
