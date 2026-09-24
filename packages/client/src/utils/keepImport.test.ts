import type { Note } from "@manifesto/shared";
import { NoteColor } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { importFiles } from "./importExport.js";
import { isKeepNote, keepNoteToNote } from "./keepImport.js";
import { readZip } from "./zip.js";
import { buildZip } from "./zipTestSupport.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const keepText = {
  color: "CERULEAN",
  isTrashed: false,
  isPinned: true,
  isArchived: false,
  textContent: "Buy milk\n",
  title: "Shopping",
  userEditedTimestampUsec: 1_700_000_000_000_000,
  createdTimestampUsec: 1_690_000_000_000_000,
  labels: [{ name: "home" }, { name: "home" }, { name: " errands " }],
  attachments: [
    { filePath: "photo.png", mimetype: "image/png" },
    { filePath: "memo.3gp", mimetype: "audio/3gp" },
  ],
  annotations: [
    {
      source: "WEBLINK",
      url: "https://example.com/a",
      title: "Example",
      description: "",
    },
    { source: "SHEETS", url: "https://docs.google.com/x", title: "Sheet" },
  ],
};

const keepList = {
  color: "DEFAULT",
  isTrashed: true,
  isPinned: false,
  isArchived: false,
  title: "",
  listContent: [
    { text: "eggs", isChecked: false },
    { text: "two\nlines", isChecked: true },
  ],
  userEditedTimestampUsec: 1_700_000_000_000_000,
};

function collect() {
  const bulks: Note[][] = [];
  return {
    bulks,
    handlers: {
      createNote: async () => null,
      importBulk: async (notes: Note[]) => {
        bulks.push(notes);
        return true;
      },
    },
  };
}

describe("isKeepNote", () => {
  it("recognises Keep's text and list notes", () => {
    expect(isKeepNote(keepText)).toBe(true);
    expect(isKeepNote(keepList)).toBe(true);
  });

  it("rejects a Manifesto note and other JSON", () => {
    expect(isKeepNote({ title: "T", content: "B" })).toBe(false);
    expect(isKeepNote([keepText])).toBe(false);
    expect(isKeepNote(null)).toBe(false);
  });
});

describe("keepNoteToNote", () => {
  it("maps fields, labels, colour, links and image attachments", async () => {
    const note = await keepNoteToNote(keepText, (path) =>
      path === "photo.png" ? PNG : null,
    );
    expect(note.title).toBe("Shopping");
    expect(note.content).toBe("Buy milk");
    expect(note.color).toBe(NoteColor.Blue);
    expect(note.pinned).toBe(true);
    expect(note.tags).toEqual(["home", "errands"]);
    expect(note.createdAt).toBe(new Date(1_690_000_000_000).toISOString());
    expect(note.updatedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(note.images).toHaveLength(1);
    expect(note.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(note.linkPreviews.map((p) => p.url)).toEqual([
      "https://example.com/a",
    ]);
  });

  it("turns a checklist into a task list and dates a trashed note now", async () => {
    const now = "2026-09-23T10:00:00.000Z";
    const note = await keepNoteToNote(keepList, () => null, now);
    expect(note.content).toBe("- [ ] eggs\n- [x] two lines");
    expect(note.trashed).toBe(true);
    expect(note.trashedAt).toBe(now);
    expect(note.createdAt).toBe(note.updatedAt);
  });
});

describe("readZip", () => {
  it("reads stored and deflated entries", async () => {
    for (const stored of [true, false]) {
      const zip = await buildZip(
        { "a/b.txt": "hello", "c.bin": PNG },
        { stored },
      );
      const entries = await readZip(new Blob([zip as BlobPart]));
      expect(entries.map((e) => e.name)).toEqual(["a/b.txt", "c.bin"]);
      expect(new TextDecoder().decode(await entries[0].read(100))).toBe(
        "hello",
      );
      expect(await entries[1].read(100)).toEqual(PNG);
    }
  });

  it("refuses an entry larger than the limit", async () => {
    const zip = await buildZip({ "big.txt": "x".repeat(1000) });
    const [entry] = await readZip(new Blob([zip as BlobPart]));
    await expect(entry.read(10)).rejects.toThrow();
  });

  it("rejects something that is not a zip", async () => {
    await expect(readZip(new Blob(["not a zip"]))).rejects.toThrow();
  });
});

describe("importFiles with Takeout", () => {
  it("imports every Keep note in an archive with its attachments", async () => {
    const zip = await buildZip({
      "Takeout/Keep/Shopping.json": JSON.stringify(keepText),
      "Takeout/Keep/Shopping.html": "<html></html>",
      "Takeout/Keep/photo.png": PNG,
      "Takeout/Keep/List.json": JSON.stringify(keepList),
      "Takeout/Keep/Labels.txt": "home",
      "Takeout/archive_browser.html": "<html></html>",
    });
    const { bulks, handlers } = collect();
    const summary = await importFiles(
      [new File([zip as BlobPart], "takeout.zip", { type: "application/zip" })],
      handlers,
    );
    expect(summary).toEqual({ singleCount: 0, bulkCount: 2, failedCount: 0 });
    expect(bulks[0].map((n) => n.title).sort()).toEqual(["", "Shopping"]);
    expect(bulks[0].find((n) => n.title === "Shopping")?.images).toHaveLength(
      1,
    );
  });

  it("gathers loose Keep files and their images into one import", async () => {
    const { bulks, handlers } = collect();
    const summary = await importFiles(
      [
        new File([JSON.stringify(keepText)], "Shopping.json"),
        new File([JSON.stringify(keepList)], "List.json"),
        new File([PNG as BlobPart], "photo.png", { type: "image/png" }),
      ],
      handlers,
    );
    expect(summary).toEqual({ singleCount: 0, bulkCount: 2, failedCount: 0 });
    expect(bulks).toHaveLength(1);
    expect(bulks[0][0].images).toHaveLength(1);
  });

  it("restores a server's account download from its notes.json", async () => {
    const note = {
      id: "01HACCOUNT",
      title: "Kept whole",
      content: "Body",
      color: NoteColor.Blue,
      font: "default",
      pinned: false,
      archived: false,
      trashed: true,
      trashedAt: "2026-01-02T00:00:00.000Z",
      position: 0,
      tags: ["home"],
      images: [],
      linkPreviews: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const zip = await buildZip({
      "notes.json": JSON.stringify([note]),
      "notes/Other.md": "# Other\n\nNot the import",
      "versions.json": "[]",
      "account.json": JSON.stringify({ username: "alice" }),
    });
    const { bulks, handlers } = collect();
    const summary = await importFiles(
      [new File([zip as BlobPart], "notes.zip", { type: "application/zip" })],
      handlers,
    );
    expect(summary).toEqual({ singleCount: 0, bulkCount: 1, failedCount: 0 });
    expect(bulks[0][0]).toMatchObject({
      id: "01HACCOUNT",
      color: NoteColor.Blue,
      trashed: true,
    });
  });

  it("fails an archive with nothing to import", async () => {
    const zip = await buildZip({ "readme.txt": "hi" });
    const { handlers } = collect();
    const summary = await importFiles(
      [new File([zip as BlobPart], "other.zip")],
      handlers,
    );
    expect(summary.failedCount).toBe(1);
  });
});
