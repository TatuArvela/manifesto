import { NoteColor, NoteFont } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import {
  checkImportSize,
  importedNote,
  MAX_IMPORT_BYTES,
  splitTitle,
} from "./importer.js";
import { IMPORTERS, importerForFile, notesFromForeignJson } from "./index.js";

const NOW = "2026-09-01T12:00:00.000Z";

describe("importedNote", () => {
  it("makes a whole note of what an importer read, dated as the source dated it", () => {
    const note = importedNote(
      {
        title: "  Title  ",
        content: "Body\n\n\n",
        tags: [" work ", "work", "", "  ", "home"],
        pinned: true,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-02-01T00:00:00+02:00",
      },
      NOW,
    );
    expect(note).toMatchObject({
      title: "Title",
      content: "Body",
      color: NoteColor.Default,
      font: NoteFont.Default,
      pinned: true,
      archived: false,
      trashed: false,
      trashedAt: null,
      tags: ["work", "home"],
      images: [],
      linkPreviews: [],
      reminder: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-31T22:00:00.000Z",
      position: -Date.parse("2024-01-01T00:00:00Z"),
    });
    expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("gives every note an id of its own", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => importedNote({}, NOW).id),
    );
    expect(ids.size).toBe(50);
  });

  it("falls back on the other date, then on now, for dates that are missing or unreadable", () => {
    expect(
      importedNote({ createdAt: "2024-01-01T00:00:00Z" }, NOW),
    ).toMatchObject({
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(
      importedNote({ updatedAt: "2024-05-05T00:00:00Z" }, NOW),
    ).toMatchObject({
      createdAt: "2024-05-05T00:00:00.000Z",
      updatedAt: "2024-05-05T00:00:00.000Z",
    });
    expect(
      importedNote({ createdAt: "yesterday-ish", updatedAt: null }, NOW),
    ).toMatchObject({ createdAt: NOW, updatedAt: NOW });
  });

  it("starts the trash's 30 days now, since no source records when it was trashed", () => {
    expect(importedNote({ trashed: true }, NOW)).toMatchObject({
      trashed: true,
      trashedAt: NOW,
    });
  });

  it("reads only true as true", () => {
    const loose = importedNote(
      { pinned: "yes", archived: 1, trashed: "true" } as never,
      NOW,
    );
    expect([loose.pinned, loose.archived, loose.trashed]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("splitTitle", () => {
  it("takes the first line as the title and the rest as the body", () => {
    expect(splitTitle("Shopping\n- milk\n- eggs")).toEqual({
      title: "Shopping",
      content: "- milk\n- eggs",
    });
  });

  it("strips a heading's hashes, a byte order mark and leading blank lines", () => {
    expect(splitTitle("﻿\n## Plan  \n\nsteps")).toEqual({
      title: "Plan",
      content: "steps",
    });
  });

  it("makes a single line all title", () => {
    expect(splitTitle("  just this  ")).toEqual({
      title: "just this",
      content: "",
    });
    expect(splitTitle("")).toEqual({ title: "", content: "" });
  });
});

describe("checkImportSize", () => {
  it("refuses a file over the limit before reading it", () => {
    const over = { size: MAX_IMPORT_BYTES + 1 } as File;
    const at = { size: MAX_IMPORT_BYTES } as File;
    expect(() => checkImportSize(over)).toThrow();
    expect(() => checkImportSize(at)).not.toThrow();
  });
});

describe("the importer registry", () => {
  it("gives each format a name of its own and its extensions in lower case with the dot", () => {
    const formats = IMPORTERS.map((i) => i.format);
    expect(new Set(formats).size).toBe(formats.length);
    for (const importer of IMPORTERS) {
      for (const ext of importer.extensions) {
        expect(ext, importer.format).toMatch(/^\.[a-z0-9]+$/);
      }
    }
  });

  it("offers a file to the importer that takes its extension, and none for an unknown one", () => {
    for (const importer of IMPORTERS) {
      if (!importer.fromFile) continue;
      for (const ext of importer.extensions) {
        expect(importerForFile(ext)?.format).toBe(importer.format);
      }
    }
    expect(importerForFile(".docx")).toBeNull();
    expect(importerForFile("")).toBeNull();
  });

  it("leaves JSON that is no app's format to the caller", async () => {
    for (const data of [null, 42, "text", [], {}, [{ unrelated: true }]]) {
      expect(await notesFromForeignJson(data), JSON.stringify(data)).toBeNull();
    }
  });
});
