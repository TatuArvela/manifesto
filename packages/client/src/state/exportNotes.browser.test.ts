import type { Note, NoteVersion } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveVersion } from "../storage/VersionStorage.js";
import { importFiles } from "../utils/importExport.js";
import { readZip } from "../utils/zip.js";
import { exportArchive } from "./exportNotes.js";
import { notes } from "./notesStore.js";
import { hiddenTags } from "./prefs.js";

const note = (id: string, title: string, trashed = false): Note => ({
  id,
  title,
  content: `${title} body`,
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed,
  trashedAt: trashed ? "2026-01-02T00:00:00.000Z" : null,
  position: 0,
  tags: ["work"],
  images: [],
  linkPreviews: [],
  reminder: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("exportArchive in open mode", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    notes.value = [];
    localStorage.clear();
  });

  it("writes the server's layout, and importing it gives the notes and history back", async () => {
    notes.value = [
      note("a", "Plan"),
      note("b", "Plan"),
      note("c", "Old", true),
    ];
    saveVersion("a", "Plan", "before");
    hiddenTags.value = ["private"];

    const zip = await exportArchive();
    expect(zip).not.toBeNull();
    const entries = await readZip(zip as Blob);
    expect(entries.map((e) => e.name)).toEqual([
      "notes.json",
      "notes/Plan.md",
      "notes/Plan (2).md",
      "versions.json",
      "preferences.json",
    ]);
    const preferences = entries.find((e) => e.name === "preferences.json");
    const prefs = JSON.parse(
      new TextDecoder().decode(await preferences?.read(1_000_000)),
    );
    expect(prefs).toMatchObject({ hiddenTags: ["private"] });
    hiddenTags.value = [];

    let imported: Note[] = [];
    let history: NoteVersion[] = [];
    const summary = await importFiles(
      [new File([zip as Blob], "backup.zip", { type: "application/zip" })],
      {
        createNote: async () => null,
        importBulk: async (n) => {
          imported = n;
          return true;
        },
        importVersions: async (v) => {
          history = v;
        },
      },
    );
    expect(summary.bulkCount).toBe(3);
    expect(imported.map((n) => [n.id, n.color, n.trashed])).toEqual([
      ["a", NoteColor.Yellow, false],
      ["b", NoteColor.Yellow, false],
      ["c", NoteColor.Yellow, true],
    ]);
    expect(history.map((v) => [v.noteId, v.content])).toEqual([
      ["a", "before"],
    ]);
  });
});
