import {
  type AccountSealKeys,
  excerptOf,
  NoteColor,
  type NoteCreate,
  NoteFont,
  NoteLimitError,
  openReminderKey,
  openSealedNote,
  openSharedFields,
  type SealedNote,
  type SealedNoteCreate,
  sealNewNote,
  tokenHashOf,
  unwrapFeedKey,
  unwrapTokenKeys,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { testKeys } from "../test/sealedServer.js";
import { accountSubkey, createAccountKeys } from "../utils/keyMaterial.js";
import { Sealer, type StorageKeys } from "./sealing.js";

const draft: NoteCreate = {
  title: "Title",
  content: "Text",
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

async function accountOf(keys: StorageKeys): Promise<AccountSealKeys> {
  return {
    userId: keys.userId,
    version: keys.version,
    notes: await accountSubkey(keys.accountKey, "notes"),
    personal: await accountSubkey(keys.accountKey, "personal"),
  };
}

/** A sealed note as a server would hand it back. */
function served(sealed: SealedNoteCreate) {
  const { imageRefs: _i, previewRefs: _p, ...note } = sealed;
  return { ...note, createdAt: "c", updatedAt: "u" } satisfies SealedNote;
}

describe("sealing a note", () => {
  it("gives a colour and a font the same length whichever they are", async () => {
    const account = await accountOf(await testKeys());
    const lengths = new Set<number>();
    for (const color of Object.values(NoteColor)) {
      for (const font of Object.values(NoteFont)) {
        const { sealed } = await sealNewNote(account, "n1", {
          ...draft,
          color,
          font,
        });
        lengths.add(sealed.color.length);
        lengths.add(sealed.font.length);
      }
    }
    // Few values, so the length of a ciphertext would otherwise name one.
    expect(lengths.size).toBe(1);
  });

  it("keeps the first 140 characters of the text beside it, whole ones", async () => {
    const account = await accountOf(await testKeys());
    const content = `${"é".repeat(139)}😀 and more`;
    const { sealed, key } = await sealNewNote(account, "n1", {
      ...draft,
      content,
    });
    const opened = await openSealedNote(account, served(sealed), key);
    expect(opened?.excerpt).toBe(`${"é".repeat(139)}😀`);
    expect(excerptOf("short")).toBe("short");
  });

  it("refuses what a note may not hold", async () => {
    const account = await accountOf(await testKeys());
    const refused = (changes: Partial<NoteCreate>) =>
      expect(
        sealNewNote(account, "n1", { ...draft, ...changes }),
      ).rejects.toBeInstanceOf(NoteLimitError);
    await refused({ title: "x".repeat(501) });
    await refused({ content: "x".repeat(100_001) });
    await refused({ tags: ["x".repeat(65)] });
    await refused({ tags: [""] });
    // An image still inline: it is uploaded before a note is sealed.
    await refused({ images: ["data:image/png;base64,AAAA"] });
  });

  it("leaves out an opened value no client should have written", async () => {
    const account = await accountOf(await testKeys());
    const { sealed, key } = await sealNewNote(account, "n1", {
      ...draft,
      tags: ["ok"],
      linkPreviews: [
        { url: "https://example.com", title: "Fine", domain: "example.com" },
      ],
    });
    // What another client's sealing might hold: checked here, since no
    // server could.
    const other = await sealNewNote(account, "n1", {
      ...draft,
      linkPreviews: [
        {
          url: "javascript:alert(1)",
          title: "Bad",
          domain: "x",
        },
        {
          url: "https://example.com/b",
          title: "Kept",
          domain: "example.com",
          image: "https://tracker.example/pixel.png",
        },
      ],
    });
    const opened = await openSealedNote(account, served(sealed), key);
    expect(opened?.note.tags).toEqual(["ok"]);
    const theirs = await openSealedNote(
      account,
      served(other.sealed),
      other.key,
    );
    // Sealing drops them too, so nothing of either reaches the reader.
    expect(theirs?.note.linkPreviews).toEqual([
      { url: "https://example.com/b", title: "Kept", domain: "example.com" },
    ]);
  });

  it("names a link preview by the host its URL opens", async () => {
    const account = await accountOf(await testKeys());
    const { sealed, key } = await sealNewNote(account, "n1", {
      ...draft,
      linkPreviews: [
        { url: "https://evil.test/login", title: "Bank", domain: "bank.test" },
        { url: "https://other.test:8443/", title: "x", domain: "bank.test" },
      ],
    });
    const opened = await openSealedNote(account, served(sealed), key);
    expect(opened?.note.linkPreviews.map((preview) => preview.domain)).toEqual([
      "evil.test",
      "other.test:8443",
    ]);
  });
});

describe("Sealer", () => {
  it("seals preferences under their names, and opens only its own account's", async () => {
    const keys = await testKeys();
    const sealer = new Sealer(keys);
    const sealed = await sealer.sealPrefs({
      hiddenTags: ["work"],
      theme: "dark",
      gone: null,
    });
    expect(sealed.gone).toBeNull();
    expect(JSON.stringify(sealed)).not.toContain("work");
    const stored = { hiddenTags: sealed.hiddenTags, theme: sealed.theme } as {
      hiddenTags: string;
      theme: string;
    };
    expect(await new Sealer(keys).openPrefs(stored)).toEqual({
      hiddenTags: ["work"],
      theme: "dark",
    });
    // A value moved under another name does not open.
    expect(
      await sealer.openPrefs({ theme: stored.hiddenTags, other: "plain" }),
    ).toEqual({});
    expect(await new Sealer(await testKeys("u2")).openPrefs(stored)).toEqual(
      {},
    );
  });

  it("remembers which notes did not open", async () => {
    const mine = new Sealer(await testKeys());
    const theirs = await accountOf(await testKeys("u2"));
    const { sealed } = await sealNewNote(theirs, "n1", draft);
    expect(await mine.open(served(sealed))).toBeNull();
    expect([...mine.unreadable.value]).toEqual(["n1"]);
  });

  it("opens a listing in the order it came, and forgets a note that is gone", async () => {
    const keys = await testKeys();
    const theirs = await accountOf(await testKeys("u2"));
    const writer = new Sealer(keys);
    const listing: SealedNote[] = [];
    for (let i = 0; i < 20; i++) {
      const note = { ...draft, title: `Note ${i}` };
      // Every fifth is someone else's, and does not open.
      listing.push(
        served(
          i % 5 === 0
            ? (await sealNewNote(theirs, `n${i}`, note)).sealed
            : await writer.sealNew(`n${i}`, note),
        ),
      );
    }
    const mine = new Sealer(keys);
    const opened = await mine.openAll(listing);
    expect(opened.map((note) => note.title)).toEqual(
      listing.flatMap((_, i) => (i % 5 === 0 ? [] : [`Note ${i}`])),
    );
    expect([...mine.unreadable.value].sort()).toEqual([
      "n0",
      "n10",
      "n15",
      "n5",
    ]);
    mine.forget("n5");
    expect(mine.unreadable.value.has("n5")).toBe(false);
  });

  it("says when a note of its own did not open, and not for one shared with it", async () => {
    const mine = new Sealer(await testKeys());
    const theirs = await accountOf(await testKeys("u2"));
    const person = {
      id: "u2",
      username: "them",
      displayName: "Them",
      avatarColor: "blue",
    };
    const shared = served((await sealNewNote(theirs, "n1", draft)).sealed);
    expect(
      await mine.open({
        ...shared,
        sharing: { role: "view", owner: person, members: [] },
      }),
    ).toBeNull();
    expect(mine.missesOwnNotes()).toBe(false);

    const own = served((await sealNewNote(theirs, "n2", draft)).sealed);
    expect(await mine.open(own)).toBeNull();
    expect(mine.missesOwnNotes()).toBe(true);
    // Deleted, it is missed no more.
    mine.forget("n2");
    expect(mine.missesOwnNotes()).toBe(false);
  });

  it("forgets that a deleted note was due a key", async () => {
    const sealer = new Sealer(await testKeys());
    const reminder = {
      time: "2026-05-01T09:30:00",
      recurrence: "none" as const,
      timezone: "Europe/Helsinki",
    };
    const note = served(await sealer.sealNew("n1", draft));
    await sealer.open({ ...note, reminder, rekeyDue: true });
    expect([...sealer.due.value]).toEqual(["n1"]);
    expect([...sealer.feedDue.value]).toEqual(["n1"]);
    sealer.forget("n1");
    expect(sealer.due.value.size).toBe(0);
    expect(sealer.feedDue.value.size).toBe(0);
  });

  it("asks for its private keys again after reading them failed", async () => {
    const made = await createAccountKeys("u1");
    const sealer = new Sealer({
      userId: "u1",
      version: made.version,
      accountKey: made.accountKey,
    });
    await sealer.sealNew("n1", draft);
    const recipient = (await createAccountKeys("u2")).request.publicKeys;
    let asked = 0;
    const load = async () => {
      asked++;
      // The first answer is not what was expected at all.
      if (asked === 1) throw new TypeError("no wrappedPrivateKeys");
      return { version: made.version, ...made.request };
    };
    const offer = () =>
      sealer.offerKey(
        "n1",
        { userId: "u2", exchange: recipient.exchange },
        async () => null,
        load,
      );
    expect(await offer()).toBeNull();
    expect(await offer()).not.toBeNull();
    expect(asked).toBe(2);
  });

  it("seals a comment under its note's key and its own id", async () => {
    const keys = await testKeys();
    const sealer = new Sealer(keys);
    const note = served(await sealer.sealNew("n1", draft));
    const fetch = async () => note;
    const sealed = await sealer.sealComment("n1", "c1", "  Shall we?  ", fetch);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.body).not.toContain("Shall");
    const comment = {
      id: "c1",
      noteId: "n1",
      author: null,
      createdAt: "t",
      editedAt: null,
      ...sealed,
    };
    // Another device, which reads the note's key from the server first.
    const opened = await new Sealer(keys).openComments("n1", [comment], fetch);
    expect(opened).toEqual([{ ...comment, body: "Shall we?" }]);
    // Under another comment's id, or said to be under another key, it does
    // not open and is left out.
    expect(
      await sealer.openComments(
        "n1",
        [
          { ...comment, id: "c2" },
          { ...comment, keyVersion: 2 },
        ],
        fetch,
      ),
    ).toEqual([]);
    await expect(sealer.sealComment("n1", "c3", "   ", fetch)).rejects.toThrow(
      NoteLimitError,
    );
    await expect(
      sealer.sealComment("n1", "c3", "x".repeat(2001), fetch),
    ).rejects.toThrow(NoteLimitError);
  });

  it("makes a token whose keys open the account's notes, and nobody else's secret does", async () => {
    const keys = await testKeys();
    const sealer = new Sealer(keys);
    const note = served(
      await sealer.sealNew("n1", { ...draft, title: "Mine", tags: ["x"] }),
    );
    const made = await sealer.newToken("mfp_");
    if (!made) throw new Error("no token");
    expect(made.secret.startsWith("mfp_")).toBe(true);
    expect(made.fields.prefix).toBe(made.secret.slice(0, 10));
    expect(made.fields.tokenHash).toBe(await tokenHashOf(made.secret));
    expect(made.fields.wrappedKeys).not.toContain(made.secret);

    // What the server does when the token is presented.
    const carried = await unwrapTokenKeys(
      made.secret,
      made.fields.wrappedKeys,
      keys.userId,
    );
    if (!carried) throw new Error("the token's keys did not open");
    const opened = await openSealedNote(carried, note);
    expect(opened?.note).toMatchObject({ title: "Mine", tags: ["x"] });

    expect(
      await unwrapTokenKeys(
        "mfp_another",
        made.fields.wrappedKeys,
        keys.userId,
      ),
    ).toBeNull();
  });

  it("makes a calendar feed an address that opens the notes with a reminder, and no others", async () => {
    const keys = await testKeys();
    const sealer = new Sealer(keys);
    const reminder = {
      time: "2026-05-01T09:30:00",
      recurrence: "none" as const,
      timezone: "Europe/Helsinki",
    };
    const dentist = await sealer.sealNew("n1", {
      ...draft,
      title: "Dentist",
      reminder,
    });
    const diary = await sealer.sealNew("n2", { ...draft, title: "Diary" });
    // The copy for the feed is made with the reminder, and only then.
    expect(dentist.reminderKey).toMatch(/^e1\./);
    expect(diary.reminderKey).toBeUndefined();

    const made = await sealer.newToken("mfc_", "reminders");
    if (!made) throw new Error("no address");
    expect(made.secret.startsWith("mfc_")).toBe(true);
    // The address carries the reminder key and nothing that opens a note
    // directly.
    expect(
      await unwrapTokenKeys(made.secret, made.fields.wrappedKeys, keys.userId),
    ).toBeNull();
    const feed = await unwrapFeedKey(made.secret, made.fields.wrappedKeys);
    if (!feed) throw new Error("the feed's key did not open");
    const owner = { userId: keys.userId, version: feed.version };
    const key = await openReminderKey(
      feed.reminders,
      owner,
      "n1",
      1,
      dentist.reminderKey,
    );
    if (!key) throw new Error("the feed does not open the note");
    expect((await openSharedFields(key, "n1", dentist)).title).toBe("Dentist");
    // Not another note with that copy, and not with another address.
    expect(
      await openReminderKey(
        feed.reminders,
        owner,
        "n2",
        1,
        dentist.reminderKey,
      ),
    ).toBeNull();
    expect(
      await unwrapFeedKey("mfc_another", made.fields.wrappedKeys),
    ).toBeNull();

    // Setting a reminder later sends the copy with it; a note that has a
    // reminder and no copy (a script set it) is marked for one.
    const fetch = async () => served(diary);
    expect(
      (await sealer.sealUpdate("n2", { reminder }, fetch)).reminderKey,
    ).toMatch(/^e1\./);
    expect(
      (await sealer.sealUpdate("n2", { pinned: true }, fetch)).reminderKey,
    ).toBeUndefined();
    await sealer.open({ ...served(diary), reminder });
    expect([...sealer.feedDue.value]).toEqual(["n2"]);
    const left = await sealer.feedKey("n2", fetch);
    await sealer.open({ ...served(diary), reminder, reminderKey: left });
    expect(sealer.feedDue.value.size).toBe(0);
  });
});
