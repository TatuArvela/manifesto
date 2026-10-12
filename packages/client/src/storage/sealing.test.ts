import {
  type AccountSealKeys,
  excerptOf,
  NoteColor,
  type NoteCreate,
  NoteFont,
  NoteLimitError,
  openSealedNote,
  type SealedNote,
  sealNewNote,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { testKeys } from "../test/sealedServer.js";
import { accountSubkey } from "../utils/keyMaterial.js";
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
function served(sealed: Awaited<ReturnType<typeof sealNewNote>>["sealed"]) {
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
});
