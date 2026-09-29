import {
  IMAGE_DATA_URL_SUBTYPES,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_NOTE,
  type Note,
} from "@manifesto/shared";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { checkImportSize, type Importer, importedNote } from "./importer.js";

const IMAGE_SUBTYPES = new Set<string>(IMAGE_DATA_URL_SUBTYPES);

/** `20240131T081500Z`, Evernote's timestamp, as ISO 8601. */
function enexTime(raw: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
    (raw ?? "").trim(),
  );
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

function text(parent: Element, tag: string): string | null {
  return parent.getElementsByTagName(tag)[0]?.textContent ?? null;
}

/** A note's image resources, as the data URLs a note's `images` holds. */
function imagesOf(note: Element): string[] {
  const images: string[] = [];
  for (const resource of Array.from(note.getElementsByTagName("resource"))) {
    if (images.length >= MAX_IMAGES_PER_NOTE) break;
    const mime = (text(resource, "mime") ?? "").trim().toLowerCase();
    const subtype = /^image\/([a-z0-9+.-]+)$/.exec(mime)?.[1];
    if (!subtype || !IMAGE_SUBTYPES.has(subtype)) continue;
    const data = (text(resource, "data") ?? "").replace(/\s+/g, "");
    // Base64 is four characters for three bytes.
    if (!data || (data.length * 3) / 4 > MAX_IMAGE_SOURCE_BYTES) continue;
    images.push(`data:image/${subtype};base64,${data}`);
  }
  return images;
}

/**
 * Evernote's `.enex` export: XML with one `<note>` per note, its text as
 * ENML (Evernote's HTML) in `<content>`, its tags, its dates, and its
 * attachments inline as base64 `<resource>`s. Images become the note's
 * images; other attachments (PDFs, audio) have no place on a note.
 */
export const evernoteImporter: Importer = {
  format: "Evernote",
  extensions: [".enex"],
  async fromFile(file) {
    checkImportSize(file);
    const xml = new DOMParser().parseFromString(
      await file.text(),
      "application/xml",
    );
    const root = xml.documentElement;
    if (root.nodeName !== "en-export") return null;
    const notes: Note[] = [];
    for (const note of Array.from(root.getElementsByTagName("note"))) {
      notes.push(
        importedNote({
          title: text(note, "title") ?? "",
          content: htmlToMarkdown(text(note, "content") ?? ""),
          tags: Array.from(note.getElementsByTagName("tag")).map(
            (tag) => tag.textContent ?? "",
          ),
          images: imagesOf(note),
          createdAt: enexTime(text(note, "created")),
          updatedAt: enexTime(text(note, "updated")),
        }),
      );
    }
    return notes;
  },
};
