import type { Note } from "@manifesto/shared";
import { type Importer, importedNote, splitTitle } from "./importer.js";

type Record_ = Record<string, unknown>;

const isObject = (value: unknown): value is Record_ =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toNote(raw: unknown, trashed: boolean): Note | null {
  if (!isObject(raw) || typeof raw.content !== "string") return null;
  const { title, content } = splitTitle(raw.content);
  return importedNote({
    title,
    content,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pinned: raw.pinned === true,
    trashed,
    createdAt: typeof raw.creationDate === "string" ? raw.creationDate : null,
    updatedAt: typeof raw.lastModified === "string" ? raw.lastModified : null,
  });
}

/**
 * Simplenote's export: a zip whose `source/notes.json` holds
 * `{ activeNotes, trashedNotes }`, each note one string of text whose first
 * line Simplenote shows as its title. The same file picked on its own imports
 * too.
 */
export const simplenoteImporter: Importer = {
  format: "Simplenote",
  extensions: [],
  fromJson(data) {
    if (!isObject(data) || !Array.isArray(data.activeNotes)) return null;
    const trashed = Array.isArray(data.trashedNotes) ? data.trashedNotes : [];
    return [
      ...data.activeNotes.map((raw) => toNote(raw, false)),
      ...trashed.map((raw) => toNote(raw, true)),
    ].filter((note): note is Note => note !== null);
  },
};
