import type { Note } from "@manifesto/shared";
import { type Importer, importedNote } from "./importer.js";

type Record_ = Record<string, unknown>;

const isObject = (value: unknown): value is Record_ =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Thrown for an encrypted backup, which cannot be read here. */
export class EncryptedBackupError extends Error {
  constructor() {
    super("The Standard Notes backup is encrypted");
    this.name = "EncryptedBackupError";
  }
}

/**
 * A Standard Notes backup: `{ items: [...] }`, notes (`content_type: Note`)
 * and tags (`Tag`) side by side, a tag naming its notes by `references`. Only
 * a decrypted backup can be read; an encrypted one carries each item's
 * content as ciphertext, and is refused as one failed file rather than turned
 * into empty notes.
 */
export const standardNotesImporter: Importer = {
  format: "Standard Notes",
  extensions: [],
  fromJson(data) {
    if (!isObject(data) || !Array.isArray(data.items)) return null;
    const items = data.items.filter(isObject);
    if (!items.some((item) => item.content_type === "Note")) return null;
    if (items.some((item) => typeof item.content === "string")) {
      throw new EncryptedBackupError();
    }

    const tagsByNote = new Map<string, string[]>();
    for (const item of items) {
      if (item.content_type !== "Tag" || !isObject(item.content)) continue;
      const title = item.content.title;
      if (
        typeof title !== "string" ||
        !Array.isArray(item.content.references)
      ) {
        continue;
      }
      for (const ref of item.content.references) {
        if (!isObject(ref) || typeof ref.uuid !== "string") continue;
        tagsByNote.set(ref.uuid, [...(tagsByNote.get(ref.uuid) ?? []), title]);
      }
    }

    const notes: Note[] = [];
    for (const item of items) {
      if (item.content_type !== "Note" || !isObject(item.content)) continue;
      const content = item.content;
      notes.push(
        importedNote({
          title: typeof content.title === "string" ? content.title : "",
          content: typeof content.text === "string" ? content.text : "",
          tags: typeof item.uuid === "string" ? tagsByNote.get(item.uuid) : [],
          pinned: content.pinned === true,
          archived: content.archived === true,
          trashed: content.trashed === true,
          createdAt:
            typeof item.created_at === "string" ? item.created_at : null,
          updatedAt:
            typeof item.updated_at === "string" ? item.updated_at : null,
        }),
      );
    }
    return notes;
  },
};
