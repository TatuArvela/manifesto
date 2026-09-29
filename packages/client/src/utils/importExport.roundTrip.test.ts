import {
  exportArchiveFiles,
  type Note,
  NoteColor,
  NoteFont,
  noteToMarkdownFile,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { buildZip } from "../test/zipTestSupport.js";
import { importFiles } from "./importExport.js";
import { markdownFileToNote } from "./importedNote.js";

/**
 * An export's Markdown files are written by `@manifesto/shared` and read back
 * by this package's Markdown import, which is how a note leaves for another
 * tool and comes home again. The server's test checks what is written; these
 * check that what is written reads back as the same note.
 */

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "01J8Z3Q4R5S6T7V8W9X0Y1Z2AB",
    title: "Plan",
    content: "Body",
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
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

function roundTrip(original: Note) {
  return markdownFileToNote("exported.md", noteToMarkdownFile(original));
}

describe("an exported Markdown file read back", () => {
  it("keeps the title, body, tags, flags and dates", () => {
    const original = note({
      title: "Plan: v2 (draft) & more",
      content: "Intro\n\n- [ ] task\n",
      tags: ["work", "q3 goals", "ääkköset"],
      pinned: true,
      archived: true,
    });
    const back = roundTrip(original);
    expect(back).toMatchObject({
      title: original.title,
      content: "Intro\n\n- [ ] task",
      tags: original.tags,
      pinned: true,
      archived: true,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });
  });

  it("keeps a title YAML would read as something other than text", () => {
    for (const title of ["yes", "no", "true", "123", "null", "~", "1e3"]) {
      expect(roundTrip(note({ title })).title, title).toBe(title);
    }
  });

  it("keeps a title with a colon, a hash or a leading dash", () => {
    for (const title of ["Re: notes", "#1 idea", "- dash", "[bracketed]"]) {
      expect(roundTrip(note({ title })).title, title).toBe(title);
    }
  });

  it("writes an empty title as an empty string, not as a bare key", () => {
    // A bare `title:` would read back as an empty list.
    expect(noteToMarkdownFile(note({ title: "" }))).toContain('title: ""');
  });

  it("keeps a note whose body opens with a heading", () => {
    const back = roundTrip(
      note({ title: "Recipe", content: "# Ingredients\n\n- flour" }),
    );
    expect(back.title).toBe("Recipe");
    expect(back.content).toBe("# Ingredients\n\n- flour");
  });

  it("keeps an untitled note untitled, whatever its body opens with", () => {
    for (const content of ["# Heading\n\ntext", "plain text"]) {
      const back = roundTrip(note({ title: "", content }));
      expect(back.title, content).toBe("");
      expect(back.content, content).toBe(content);
    }
  });

  it("keeps a title with a double quote or a backslash", () => {
    for (const title of ['Say "hi"', "C:\\temp", 'both " and \\']) {
      expect(roundTrip(note({ title })).title, title).toBe(title);
    }
  });
});

describe("exportArchiveFiles", () => {
  it("writes each note not in the trash as its own Markdown file", () => {
    const files = exportArchiveFiles(
      [
        note({ id: "a", title: "Kept" }),
        note({ id: "b", title: "Binned", trashed: true }),
        note({ id: "c", title: "Shelved", archived: true }),
      ],
      [],
    );
    expect(files.map((f) => f.name)).toEqual([
      "notes.json",
      "notes/Kept.md",
      "notes/Shelved.md",
      "versions.json",
    ]);
    // The trash still travels whole in notes.json.
    expect(JSON.parse(files[0].text)).toHaveLength(3);
  });

  it("names files safely and never lets two notes share one", () => {
    const files = exportArchiveFiles(
      [
        note({ title: "../../etc/passwd" }),
        note({ title: 'a:b*c?"<d>|e\\f' }),
        note({ title: "Same" }),
        note({ title: "same" }),
        note({ title: "Same" }),
        note({ title: "   " }),
        note({ title: "" }),
        note({ title: "line\nbreak\ttab" }),
        note({ title: "x".repeat(200) }),
      ],
      [],
    );
    const names = files
      .map((f) => f.name)
      .filter((name) => name.startsWith("notes/"));
    expect(names).toEqual([
      "notes/....etcpasswd.md",
      "notes/abcdef.md",
      "notes/Same.md",
      "notes/same (2).md",
      "notes/Same (3).md",
      "notes/Untitled.md",
      "notes/Untitled (2).md",
      "notes/line break tab.md",
      `notes/${"x".repeat(80)}.md`,
    ]);
    for (const name of names) {
      expect(name.slice("notes/".length)).not.toMatch(/[/\\]/);
    }
  });

  it("adds preferences only when given", () => {
    expect(exportArchiveFiles([], []).map((f) => f.name)).toEqual([
      "notes.json",
      "versions.json",
    ]);
    const files = exportArchiveFiles([], [], { theme: "dark" });
    expect(files.at(-1)).toEqual({
      name: "preferences.json",
      text: JSON.stringify({ theme: "dark" }, null, 2),
    });
  });

  it("imports as notes.json whole, not as its Markdown twins", async () => {
    const originals = [
      note({
        id: "01J8Z3Q4R5S6T7V8W9X0Y1Z2AB",
        title: "One",
        color: NoteColor.Blue,
      }),
      note({
        id: "01J8Z3Q4R5S6T7V8W9X0Y1Z2CD",
        title: "Two",
        trashed: true,
        trashedAt: "2026-03-01T00:00:00.000Z",
      }),
    ];
    const zip = await buildZip(
      Object.fromEntries(
        exportArchiveFiles(originals, []).map((f) => [f.name, f.text]),
      ),
    );
    const bulks: Note[][] = [];
    const summary = await importFiles(
      [new File([zip as BlobPart], "export.zip")],
      {
        createNote: async () => null,
        importBulk: async (notes) => {
          bulks.push(notes);
          return true;
        },
      },
    );
    expect(summary).toEqual({ singleCount: 0, bulkCount: 2, failedCount: 0 });
    expect(bulks[0].map((n) => [n.title, n.color, n.trashed])).toEqual([
      ["One", NoteColor.Blue, false],
      ["Two", NoteColor.Default, true],
    ]);
  });

  it("reads back from its Markdown alone, for a folder another tool kept", async () => {
    const originals = [
      note({ title: "Groceries", tags: ["home"], pinned: true }),
      note({ title: "Ideas", content: "- one\n- two" }),
    ];
    const markdownOnly = exportArchiveFiles(originals, []).filter((f) =>
      f.name.endsWith(".md"),
    );
    const zip = await buildZip(
      Object.fromEntries(markdownOnly.map((f) => [f.name, f.text])),
    );
    const bulks: Note[][] = [];
    await importFiles([new File([zip as BlobPart], "notes.zip")], {
      createNote: async () => null,
      importBulk: async (notes) => {
        bulks.push(notes);
        return true;
      },
    });
    expect(
      bulks[0].map((n) => ({
        title: n.title,
        content: n.content,
        tags: n.tags,
        pinned: n.pinned,
      })),
    ).toEqual([
      { title: "Groceries", content: "Body", tags: ["home"], pinned: true },
      { title: "Ideas", content: "- one\n- two", tags: [], pinned: false },
    ]);
  });
});
