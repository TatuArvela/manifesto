import type { Note } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { importFiles } from "../importExport.js";
import { buildZip } from "../zipTestSupport.js";
import { evernoteImporter } from "./evernote.js";
import { htmlImporter } from "./html.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { joplinImporter, parseJoplinItem } from "./joplin.js";
import { simplenoteImporter } from "./simplenote.js";
import { standardNotesImporter } from "./standardNotes.js";

const file = (name: string, content: string | Uint8Array) =>
  new File([content as BlobPart], name);

/** A tar archive in memory: ustar headers, 512-byte padding, two end blocks. */
function buildTar(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, text] of Object.entries(files)) {
    const data = encoder.encode(text);
    const header = new Uint8Array(512);
    header.set(encoder.encode(name), 0);
    header.set(encoder.encode(data.length.toString(8).padStart(11, "0")), 124);
    header[156] = "0".charCodeAt(0);
    header.set(encoder.encode("ustar"), 257);
    blocks.push(header);
    const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
    body.set(data);
    blocks.push(body);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

describe("htmlToMarkdown", () => {
  it("keeps a note's structure and drops what cannot be a note", () => {
    const md = htmlToMarkdown(`
      <h2>Trip</h2>
      <p>Pack <b>light</b>, see <a href="https://example.com/x">the list</a>
        and <a href="javascript:alert(1)">this</a>.</p>
      <ul><li>Socks<ul><li>wool</li></ul></li><li>Hat</li></ul>
      <ol><li>First</li><li>Second</li></ol>
      <blockquote><p>Go early</p></blockquote>
      <pre>let x = 1;</pre>
      <script>alert(1)</script>
    `);
    expect(md).toBe(
      [
        "## Trip",
        "Pack **light**, see [the list](https://example.com/x) and this.",
        "- Socks\n  - wool\n- Hat",
        "1. First\n2. Second",
        "> Go early",
        "```\nlet x = 1;\n```",
      ].join("\n\n"),
    );
  });

  it("turns Evernote's checkboxes into one task list", () => {
    const md = htmlToMarkdown(
      '<en-note><div><en-todo checked="true"/>Milk</div><div><en-todo checked="false"/>Eggs</div></en-note>',
    );
    expect(md).toBe("- [x] Milk\n- [ ] Eggs");
  });

  it("escapes text that would read as Markdown", () => {
    expect(htmlToMarkdown("<p>a*b* [c]</p>")).toBe("a\\*b\\* \\[c\\]");
  });
});

describe("Evernote", () => {
  it("reads notes with their tags, dates, checkboxes and pictures", async () => {
    const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Groceries</title>
    <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "x"><en-note><div><en-todo checked="false"/>Milk</div></en-note>]]></content>
    <created>20240131T081500Z</created>
    <updated>20240201T090000Z</updated>
    <tag>home</tag><tag>shopping</tag>
    <resource><data encoding="base64">iVBORw0KGgo=</data><mime>image/png</mime></resource>
    <resource><data encoding="base64">JVBERi0=</data><mime>application/pdf</mime></resource>
  </note>
</en-export>`;
    const notes = (await evernoteImporter.fromFile?.(
      file("export.enex", enex),
    )) as Note[];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Groceries",
      content: "- [ ] Milk",
      tags: ["home", "shopping"],
      images: ["data:image/png;base64,iVBORw0KGgo="],
      createdAt: "2024-01-31T08:15:00.000Z",
      updatedAt: "2024-02-01T09:00:00.000Z",
    });
  });

  it("leaves a file that is not an export alone", async () => {
    expect(
      await evernoteImporter.fromFile?.(file("x.enex", "<other/>")),
    ).toBeNull();
  });
});

describe("Joplin", () => {
  it("reads an item's title, body and metadata", () => {
    const item = parseJoplinItem(
      "Title\n\nBody line\n\nmore\n\nid: abc\ntype_: 1",
    );
    expect(item.title).toBe("Title");
    expect(item.body).toBe("Body line\n\nmore");
    expect(item.meta.get("id")).toBe("abc");
  });

  it("reads notes with their tags from a .jex, leaving resources behind", async () => {
    const tar = buildTar({
      "n1.md":
        "Recipe\n\nFlour ![photo](:/0123456789abcdef0123456789abcdef)\nand [doc](:/0123456789abcdef0123456789abcdef).\n\nid: n1\ncreated_time: 2024-01-01T10:00:00.000Z\nupdated_time: 2024-01-02T10:00:00.000Z\ntype_: 1",
      "t1.md": "cooking\n\nid: t1\ntype_: 5",
      "l1.md": "id: l1\nnote_id: n1\ntag_id: t1\ntype_: 6",
      "b1.md": "Notebook\n\nid: b1\ntype_: 2",
      "enc.md": "\n\nid: n2\nencryption_applied: 1\ntype_: 1",
    });
    const notes = (await joplinImporter.fromFile?.(
      file("export.jex", tar),
    )) as Note[];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Recipe",
      content: "Flour and doc.",
      tags: ["cooking"],
      createdAt: "2024-01-01T10:00:00.000Z",
    });
  });
});

describe("Simplenote", () => {
  it("takes the first line as the title, and keeps the trash", () => {
    const notes = simplenoteImporter.fromJson?.({
      activeNotes: [
        {
          id: "a",
          content: "Groceries\r\nMilk",
          creationDate: "2024-01-01T00:00:00.000Z",
          lastModified: "2024-01-02T00:00:00.000Z",
          tags: ["home"],
          pinned: true,
        },
      ],
      trashedNotes: [{ id: "b", content: "Old" }],
    }) as Note[];
    expect(notes.map((n) => [n.title, n.trashed])).toEqual([
      ["Groceries", false],
      ["Old", true],
    ]);
    expect(notes[0]).toMatchObject({ tags: ["home"], pinned: true });
    expect(notes[0]?.content.trim()).toBe("Milk");
  });
});

describe("Standard Notes", () => {
  it("reads notes and gives them their tags", () => {
    const notes = standardNotesImporter.fromJson?.({
      items: [
        {
          uuid: "n1",
          content_type: "Note",
          content: { title: "Plan", text: "Do it", pinned: true },
          created_at: "2024-01-01T00:00:00.000Z",
        },
        {
          uuid: "t1",
          content_type: "Tag",
          content: { title: "work", references: [{ uuid: "n1" }] },
        },
      ],
    }) as Note[];
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Plan",
      content: "Do it",
      tags: ["work"],
      pinned: true,
    });
  });

  it("refuses an encrypted backup instead of making empty notes", () => {
    expect(() =>
      standardNotesImporter.fromJson?.({
        items: [{ uuid: "n1", content_type: "Note", content: "004:abc" }],
      }),
    ).toThrow();
  });

  it("is not anything else's JSON", () => {
    expect(standardNotesImporter.fromJson?.({ items: [] })).toBeNull();
    expect(simplenoteImporter.fromJson?.([{ title: "x" }])).toBeNull();
  });
});

describe("HTML", () => {
  it("takes the page's title and not its first heading twice", async () => {
    const notes = (await htmlImporter.fromFile?.(
      file(
        "page.html",
        "<html><head><title>Saved</title></head><body><h1>Saved</h1><p>Text</p></body></html>",
      ),
    )) as Note[];
    expect(notes[0]).toMatchObject({ title: "Saved", content: "Text" });
  });
});

describe("importing other apps' files", () => {
  const collect = () => {
    const stored: Note[][] = [];
    return {
      stored,
      handlers: {
        createNote: async () => null,
        importBulk: async (notes: Note[]) => {
          stored.push(notes);
          return true;
        },
      },
    };
  };

  it("takes an Evernote file and a Simplenote zip as they come", async () => {
    const { stored, handlers } = collect();
    const enex =
      "<en-export><note><title>A</title><content>&lt;en-note&gt;x&lt;/en-note&gt;</content></note></en-export>";
    const zip = await buildZip({
      "source/notes.json": JSON.stringify({
        activeNotes: [{ id: "1", content: "B\nbody" }],
      }),
    });
    const summary = await importFiles(
      [file("mine.enex", enex), file("simplenote.zip", zip)],
      handlers,
    );
    expect(summary).toMatchObject({ bulkCount: 2, failedCount: 0 });
    expect(stored.flat().map((n) => n.title)).toEqual(["A", "B"]);
  });

  it("counts an encrypted backup as one file that did not import", async () => {
    const { handlers } = collect();
    const summary = await importFiles(
      [
        file(
          "backup.json",
          JSON.stringify({
            items: [{ content_type: "Note", content: "004:x" }],
          }),
        ),
      ],
      handlers,
    );
    expect(summary).toMatchObject({ bulkCount: 0, failedCount: 1 });
  });
});
