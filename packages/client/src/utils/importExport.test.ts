import type { Note, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import {
  importFiles,
  isImportableFile,
  noteToMarkdown,
  parseMarkdownToNote,
  parseNoteJson,
  parseSingleNoteJson,
} from "./importExport.js";

const baseNote: Note = {
  id: "01HXYZ",
  title: "Hello",
  content: "World",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("noteToMarkdown", () => {
  it("renders title as h1 followed by content", () => {
    expect(noteToMarkdown({ title: "Hi", content: "Body" })).toBe(
      "# Hi\n\nBody\n",
    );
  });

  it("omits the heading when title is empty", () => {
    expect(noteToMarkdown({ title: "", content: "Body" })).toBe("Body\n");
  });

  it("preserves a trailing newline in content", () => {
    expect(noteToMarkdown({ title: "T", content: "L1\nL2" })).toBe(
      "# T\n\nL1\nL2\n",
    );
  });
});

describe("parseMarkdownToNote", () => {
  it("extracts an h1 title and the remaining content", () => {
    const result = parseMarkdownToNote("# Title\n\nBody line 1\nBody line 2");
    expect(result.title).toBe("Title");
    expect(result.content).toBe("Body line 1\nBody line 2");
  });

  it("uses entire input as content when there is no h1", () => {
    const result = parseMarkdownToNote("Just body\nMore body");
    expect(result.title).toBe("");
    expect(result.content).toBe("Just body\nMore body");
  });

  it("strips a leading BOM", () => {
    const result = parseMarkdownToNote("\uFEFF# Title\n\nBody");
    expect(result.title).toBe("Title");
    expect(result.content).toBe("Body");
  });

  it("handles CRLF line endings", () => {
    const result = parseMarkdownToNote("# Title\r\n\r\nBody");
    expect(result.title).toBe("Title");
    expect(result.content).toBe("Body");
  });
});

describe("parseSingleNoteJson", () => {
  it("accepts a minimal note with title and content", () => {
    expect(parseSingleNoteJson({ title: "T", content: "B" })).toEqual({
      title: "T",
      content: "B",
    });
  });

  it("passes through known optional fields", () => {
    const result = parseSingleNoteJson({
      title: "T",
      content: "B",
      color: NoteColor.Blue,
      font: NoteFont.PermanentMarker,
      pinned: true,
      archived: false,
      tags: ["a", "b", 1],
      images: ["data:image/png;base64,x"],
    });
    expect(result.color).toBe(NoteColor.Blue);
    expect(result.font).toBe(NoteFont.PermanentMarker);
    expect(result.pinned).toBe(true);
    expect(result.tags).toEqual(["a", "b"]);
    expect(result.images).toEqual(["data:image/png;base64,x"]);
  });

  it("ignores unknown color and font values", () => {
    const result = parseSingleNoteJson({
      title: "T",
      content: "B",
      color: "neon",
      font: "wingdings",
    });
    expect(result.color).toBeUndefined();
    expect(result.font).toBeUndefined();
  });

  it("throws when title or content is missing", () => {
    expect(() => parseSingleNoteJson({ title: "T" })).toThrow();
    expect(() => parseSingleNoteJson({ content: "B" })).toThrow();
    expect(() => parseSingleNoteJson(null)).toThrow();
    expect(() => parseSingleNoteJson([])).toThrow();
  });
});

describe("parseNoteJson", () => {
  it("returns a bulk result for an array of valid notes", () => {
    const result = parseNoteJson(JSON.stringify([baseNote]));
    expect(result.kind).toBe("bulk");
    if (result.kind === "bulk") expect(result.notes).toHaveLength(1);
  });

  it("returns a single result for a single note object", () => {
    const result = parseNoteJson(JSON.stringify({ title: "T", content: "B" }));
    expect(result.kind).toBe("single");
    if (result.kind === "single") expect(result.note.title).toBe("T");
  });

  it("throws on an array with malformed notes", () => {
    expect(() => parseNoteJson("[{}]")).toThrow();
  });
});

describe("isImportableFile", () => {
  it("accepts .md, .markdown, .json by extension", () => {
    expect(isImportableFile(new File(["x"], "a.md"))).toBe(true);
    expect(isImportableFile(new File(["x"], "a.markdown"))).toBe(true);
    expect(isImportableFile(new File(["x"], "a.json"))).toBe(true);
  });

  it("accepts known MIME types when extension is missing", () => {
    expect(
      isImportableFile(new File(["x"], "a", { type: "application/json" })),
    ).toBe(true);
    expect(
      isImportableFile(new File(["x"], "a", { type: "text/markdown" })),
    ).toBe(true);
  });

  it("rejects unrelated files", () => {
    expect(isImportableFile(new File(["x"], "a.txt"))).toBe(false);
    expect(isImportableFile(new File(["x"], "a.png"))).toBe(false);
  });
});

describe("importFiles", () => {
  it("creates a single note for a markdown file", async () => {
    const created: Partial<NoteCreate>[] = [];
    const summary = await importFiles(
      [new File(["# Hi\n\nBody"], "note.md", { type: "text/markdown" })],
      {
        createNote: async (input) => {
          created.push(input);
        },
        importBulk: async () => {},
      },
    );
    expect(summary).toEqual({
      singleCount: 1,
      bulkCount: 0,
      failedCount: 0,
    });
    expect(created[0].title).toBe("Hi");
    expect(created[0].content).toBe("Body");
  });

  it("creates a single note for a single-note JSON file", async () => {
    const created: Partial<NoteCreate>[] = [];
    const summary = await importFiles(
      [
        new File([JSON.stringify({ title: "T", content: "B" })], "note.json", {
          type: "application/json",
        }),
      ],
      {
        createNote: async (input) => {
          created.push(input);
        },
        importBulk: async () => {},
      },
    );
    expect(summary.singleCount).toBe(1);
    expect(created[0].title).toBe("T");
  });

  it("bulk-imports a JSON array", async () => {
    let bulkLength = 0;
    const summary = await importFiles(
      [
        new File([JSON.stringify([baseNote, baseNote])], "all.json", {
          type: "application/json",
        }),
      ],
      {
        createNote: async () => {},
        importBulk: async (notes) => {
          bulkLength = notes.length;
        },
      },
    );
    expect(summary.bulkCount).toBe(2);
    expect(bulkLength).toBe(2);
  });

  it("counts unsupported and malformed files as failures", async () => {
    const summary = await importFiles(
      [
        new File(["nope"], "a.png", { type: "image/png" }),
        new File(["{not json"], "b.json", { type: "application/json" }),
      ],
      {
        createNote: async () => {},
        importBulk: async () => {},
      },
    );
    expect(summary.failedCount).toBe(2);
    expect(summary.singleCount).toBe(0);
    expect(summary.bulkCount).toBe(0);
  });
});
