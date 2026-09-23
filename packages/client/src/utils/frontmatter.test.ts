import { describe, expect, it } from "vitest";
import {
  frontmatterDate,
  frontmatterList,
  splitFrontmatter,
} from "./frontmatter.js";
import {
  importFiles,
  markdownFileToNote,
  parseMarkdownToNote,
} from "./importExport.js";
import { buildZip } from "./zipTestSupport.js";

describe("splitFrontmatter", () => {
  it("reads scalars, inline lists and block lists", () => {
    const { data, body } = splitFrontmatter(
      "---\ntitle: \"Hello\"\ntags: [a, 'b']\naliases:\n  - x\n  - y\ndate: 2024-05-01\n---\n\nBody",
    );
    expect(data).toEqual({
      title: "Hello",
      tags: ["a", "b"],
      aliases: ["x", "y"],
      date: "2024-05-01",
    });
    expect(body).toBe("Body");
  });

  it("leaves a note that opens with a horizontal rule alone", () => {
    const text = "---\nJust a rule and some prose.\n---\nMore";
    expect(splitFrontmatter(text)).toEqual({ data: {}, body: text });
  });

  it("leaves an unclosed block alone", () => {
    const text = "---\ntitle: x\nBody";
    expect(splitFrontmatter(text).body).toBe(text);
  });
});

describe("frontmatter values", () => {
  it("reads a comma list and strips hashes", () => {
    expect(frontmatterList("#one, two")).toEqual(["one", "two"]);
    expect(frontmatterList(undefined)).toEqual([]);
  });

  it("rejects a date that does not parse", () => {
    expect(frontmatterDate("soon")).toBeUndefined();
    expect(frontmatterDate("2024-05-01")).toBe("2024-05-01T00:00:00.000Z");
  });
});

describe("parseMarkdownToNote with frontmatter", () => {
  it("takes title, tags and flags from frontmatter", () => {
    const note = parseMarkdownToNote(
      "---\ntitle: From yaml\ntags:\n  - work\n  - work\npinned: true\n---\nBody",
    );
    expect(note).toEqual({
      title: "From yaml",
      content: "Body",
      tags: ["work"],
      pinned: true,
    });
  });

  it("prefers a heading to a frontmatter title", () => {
    expect(parseMarkdownToNote("---\ntitle: a\n---\n# b\n\nc").title).toBe("b");
  });
});

describe("markdownFileToNote", () => {
  it("titles an unheaded note after its file and tags its folders", () => {
    const now = "2026-09-23T10:00:00.000Z";
    const note = markdownFileToNote("Work/Projects/Plan.md", "Steps", now);
    expect(note.title).toBe("Plan");
    expect(note.content).toBe("Steps");
    expect(note.tags).toEqual(["Work", "Projects"]);
    expect(note.createdAt).toBe(now);
    expect(note.updatedAt).toBe(now);
  });

  it("keeps the dates frontmatter gives", () => {
    const note = markdownFileToNote(
      "a.md",
      "---\ncreated: 2024-01-01\nupdated: 2024-02-01\n---\nx",
    );
    expect(note.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(note.updatedAt).toBe("2024-02-01T00:00:00.000Z");
  });
});

describe("importFiles with a Markdown folder", () => {
  it("imports every Markdown file of a zipped folder in one merge", async () => {
    const zip = await buildZip({
      "Vault/Inbox.md": "# Inbox\n\nstuff",
      "Vault/Work/Plan.md": "Steps",
      "Vault/.obsidian/workspace.md": "internal",
      "Vault/picture.png": new Uint8Array([1]),
    });
    const bulks: { title: string; tags: string[] }[][] = [];
    const summary = await importFiles(
      [new File([zip as BlobPart], "vault.zip")],
      {
        createNote: async () => null,
        importBulk: async (notes) => {
          bulks.push(notes);
          return true;
        },
      },
    );
    expect(summary).toEqual({ singleCount: 0, bulkCount: 2, failedCount: 0 });
    expect(bulks[0].map((n) => ({ title: n.title, tags: n.tags }))).toEqual([
      { title: "Inbox", tags: [] },
      { title: "Plan", tags: ["Work"] },
    ]);
  });
});
